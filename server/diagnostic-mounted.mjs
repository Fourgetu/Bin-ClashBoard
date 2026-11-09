import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { IMPORT_LIMIT, parseDiagnosticImport } from './diagnostic-config.mjs'
import { loadDiagnosticNodeDependencies } from './diagnostics.mjs'

const fail = message => { throw new Error(message) }
const slash = value => String(value).replaceAll('\\', '/')
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
const parseConfig = text => {
  try {
    const value = parse(text, { maxAliasCount: 50 })
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { fail('挂载目录中的 YAML 格式无效，请先在客户端检查配置') }
}

// This root is configured by the operator, never by an HTTP request. No host
// path from uploaded/client YAML is opened directly. No files are written.
export function createMountedDiagnosticSource(directory) {
  const root = path.resolve(directory)
  const openRoot = async () => {
    try {
      const real = await fs.realpath(root)
      if (!(await fs.stat(real)).isDirectory()) throw new Error()
      return real
    } catch { fail('未找到 Clash Mi 挂载目录，请将数据目录只读挂载到 /app/clashmi') }
  }
  const safeFile = async (realRoot, relative) => {
    if (typeof relative !== 'string' || !relative || path.posix.isAbsolute(slash(relative)) || path.win32.isAbsolute(relative))
      fail('主配置必须位于挂载目录内')
    const full = path.resolve(realRoot, relative)
    if (!inside(realRoot, full)) fail('文件路径超出挂载目录')
    let real
    try { real = await fs.realpath(full) } catch { return null }
    if (!inside(realRoot, real)) fail('文件链接指向挂载目录之外')
    const stat = await fs.stat(real)
    if (!stat.isFile()) return null
    if (stat.size > IMPORT_LIMIT) fail('单个节点配置文件不能超过 6 MB')
    return real
  }
  const readText = async file => {
    // Read through a bounded handle, including if the client replaces/grows a file.
    const handle = await fs.open(file, 'r')
    try {
      const chunks = []
      let total = 0
      for await (const chunk of handle.createReadStream()) {
        total += chunk.length
        if (total > IMPORT_LIMIT) fail('单个节点配置文件不能超过 6 MB')
        chunks.push(chunk)
      }
      return Buffer.concat(chunks).toString('utf8')
    } finally { await handle.close() }
  }
  const discover = async () => {
    const realRoot = await openRoot()
    // Clash Mi writes the effective profile here; prefer it to unmerged originals.
    const runtime = 'service_core_runtime_profile.yaml'
    if (await safeFile(realRoot, runtime)) return [runtime]
    const candidates = []
    for (const entry of await fs.readdir(realRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ya?ml|json)$/i.test(entry.name)) continue
      const file = await safeFile(realRoot, entry.name)
      if (!file) continue
      try {
        const value = parseConfig(await readText(file))
        if (Array.isArray(value.proxies) || value['proxy-providers']) candidates.push(entry.name)
      } catch { /* unrelated JSON settings are not node configurations */ }
    }
    return candidates.sort()
  }
  const read = async ({ configPath, name, providerOwners = new Map(), runtime = {}, signal } = {}) => {
    const realRoot = await openRoot()
    signal?.throwIfAborted()
    const main = await safeFile(realRoot, configPath)
    if (!main) fail('挂载的主配置不存在，请检查客户端数据目录或重新连接配置目录')
    const config = parseConfig(await readText(main))
    const providers = config['proxy-providers'] || {}
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) fail('主配置的 proxy-providers 格式无效')
    let index
    const listFiles = async () => {
      const files = []
      let count = 0
      const walk = async (relative, depth) => {
        signal?.throwIfAborted()
        if (depth > 12) fail('挂载目录层级过深，请只挂载客户端数据目录')
        for (const entry of await fs.readdir(path.join(realRoot, relative), { withFileTypes: true })) {
          if (++count > 10000) fail('挂载目录文件过多，请只挂载客户端数据目录')
          const file = path.join(relative, entry.name)
          if (entry.isDirectory()) await walk(file, depth + 1)
          else if (entry.isFile()) files.push(slash(file))
          // Never traverse symlinks/junctions while searching for moved caches.
        }
      }
      await walk('', 0)
      return files
    }
    const resolveProvider = async providerPath => {
      const raw = slash(providerPath)
      if (!raw || raw.includes('\0')) fail('订阅缓存路径无效')
      if (!path.posix.isAbsolute(raw) && !path.win32.isAbsolute(raw)) {
        const candidate = path.resolve(path.dirname(main), raw)
        if (!inside(realRoot, candidate)) fail('订阅缓存路径超出挂载目录')
        for (const base of [path.dirname(main), realRoot]) {
          const direct = await safeFile(realRoot, path.relative(realRoot, path.resolve(base, raw)))
          if (direct) return direct
        }
      }
      // A Windows/macOS absolute path belongs to the client. Match its longest
      // unique suffix within the mount, never access the container's same path.
      index ||= listFiles()
      const files = await index
      const segments = raw.split('/').filter(segment => segment && segment !== '.')
      if (segments.includes('..')) fail('订阅缓存路径含有不支持的上级目录引用')
      for (let offset = 0; offset < segments.length; offset++) {
        const suffix = segments.slice(offset).join('/')
        const matches = files.filter(file => file === suffix || file.endsWith(`/${suffix}`))
        if (matches.length > 1) fail('挂载目录中存在同名订阅缓存，无法确认来源，请保留原有目录结构')
        if (matches.length === 1) return safeFile(realRoot, matches[0])
      }
      return null
    }
    // Clash Mi desktop writes HTTP subscription caches as proxies/<md5(url)> with no
    // extension and no `path` in the generated proxy-providers, so the cache can only
    // be found by hashing the subscription URL. Try the observed name variants.
    const resolveUrlCache = async provider => {
      if (provider?.type !== 'http' || typeof provider?.url !== 'string' || !provider.url) return null
      const hash = createHash('md5').update(provider.url, 'utf8').digest('hex')
      for (const name of [hash, `${hash}.yaml`, `${hash}.yml`, hash.toUpperCase()]) {
        const file = await safeFile(realRoot, path.posix.join('proxies', name))
        if (file) return file
      }
      return null
    }
    const providerNames = new Map(Object.entries(providers).map(([key, value]) => [value, key]))
    const nodes = await loadDiagnosticNodeDependencies({
      name, nodes: Array.isArray(config.proxies) ? config.proxies : [], providers, providerOwners, runtime,
      readProvider: async provider => {
        signal?.throwIfAborted()
        const label = providerNames.get(provider)
        let entries = Array.isArray(provider?.payload) ? provider.payload : []
        if (!entries.length) {
          const file = typeof provider?.path === 'string'
            ? await resolveProvider(provider.path)
            : await resolveUrlCache(provider)
          if (file) {
            const parsed = parseConfig(await readText(file))
            entries = Array.isArray(parsed.proxies) ? parsed.proxies : []
          }
        }
        if (!entries.length) fail(`订阅「${label}」暂无可用节点缓存，请先在 Clash Mi 更新订阅，并挂载完整数据目录`)
        const override = { ...(provider.override || {}) }
        const prefix = override['additional-prefix'] || ''
        const suffix = override['additional-suffix'] || ''
        delete override['additional-prefix']
        delete override['additional-suffix']
        return entries.map(node => ({ ...node, ...override, name: `${prefix}${node?.name || ''}${suffix}` }))
      },
    })
    signal?.throwIfAborted()
    return parseDiagnosticImport({ configText: JSON.stringify(nodes) })
  }
  return { root, read, discover, async status() {
    try { return { available: true, candidates: await discover() } }
    catch (error) { return { available: false, candidates: [], message: error.message } }
  } }
}
