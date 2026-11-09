import { createHash } from 'node:crypto'
import { parse } from 'yaml'

export const IMPORT_LIMIT = 6 * 1024 * 1024
const SUBSCRIPTION_TIMEOUT = 15_000
const record = (value) => value && typeof value === 'object' && !Array.isArray(value)
const fail = (message) => { throw new Error(message) }

function parseConfig(text) {
  if (typeof text !== 'string' || !text.trim()) fail('请选择或粘贴 YAML 配置')
  if (Buffer.byteLength(text) > IMPORT_LIMIT) fail('配置文件不能超过 6 MB')
  try {
    const value = parse(text, { maxAliasCount: 50 })
    if (!record(value) && !Array.isArray(value)) fail('invalid')
    return value
  } catch {
    // Parser errors can include node passwords and subscription URLs.
    fail('YAML 格式无效，请导入 Clash / Mihomo 配置或包含 proxies 的订阅文件')
  }
}

function providersOf(config) {
  const providers = config['proxy-providers'] ?? {}
  if (!record(providers)) fail('proxy-providers 必须为对象')
  for (const value of Object.values(providers)) {
    if (!record(value)) fail('订阅配置格式无效')
  }
  return providers
}

export function previewDiagnosticImport(text) {
  const config = parseConfig(text)
  return {
    providers: Object.entries(providersOf(config)).map(([name, provider]) => ({
      name, needsFile: !Array.isArray(provider.payload) || !provider.payload.length,
      canDownload: provider.type === 'http' && typeof provider.url === 'string' && /^https?:\/\//i.test(provider.url),
    })),
  }
}

function subscriptionUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url
  } catch { fail('订阅地址无效，仅支持 HTTP / HTTPS 地址') }
}

// Called only by an explicit import request. Never execute uploaded paths or use
// the controller secret for subscription requests. Bound decompressed bytes too.
export async function downloadProvider(provider, { signal, consume }) {
  let url = subscriptionUrl(provider.url)
  let headers = new Headers({ 'User-Agent': 'mihomo', Accept: 'application/yaml, text/yaml, */*' })
  if (record(provider.header)) {
    for (const [name, value] of Object.entries(provider.header)) {
      if (/^(host|content-length|connection|transfer-encoding|upgrade|proxy-.*)$/i.test(name)) continue
      const values = Array.isArray(value) ? value : [value]
      if (!values.every(item => typeof item === 'string')) fail('订阅请求头格式无效')
      headers.set(name, values.join(', '))
    }
  }
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { headers, signal, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirects === 3) fail('订阅重定向过多或地址缺失')
      const next = subscriptionUrl(new URL(location, url).href)
      if (url.protocol === 'https:' && next.protocol !== 'https:') fail('订阅重定向降级为 HTTP')
      if (next.origin !== url.origin) headers = new Headers({ 'User-Agent': 'mihomo', Accept: 'application/yaml, text/yaml, */*' })
      url = next
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      fail(`订阅返回 HTTP ${response.status}`)
    }
    if (Number(response.headers.get('content-length')) > IMPORT_LIMIT) {
      await response.body?.cancel()
      fail('订阅文件超过 6 MB')
    }
    const chunks = []
    for await (const chunk of response.body) {
      consume(chunk.byteLength)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
}

export async function resolveDiagnosticImport(body, { signal, download = downloadProvider } = {}) {
  const { configText, providerFiles = {} } = body
  if (!record(providerFiles)) fail('订阅缓存格式无效')
  const config = parseConfig(configText)
  const files = Object.assign(Object.create(null), providerFiles)
  let total = Buffer.byteLength(configText) + Object.values(files).reduce((size, text) => size + Buffer.byteLength(String(text)), 0)
  const consume = size => {
    total += size
    if (total > IMPORT_LIMIT) fail('配置和订阅缓存合计不能超过 6 MB')
  }
  consume(0)
  const pending = Object.entries(providersOf(config)).filter(([name, provider]) =>
    Object.hasOwn(files, name) || !Array.isArray(provider.payload) || !provider.payload.length)
  const failures = new Map()
  let index = 0
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (index < pending.length) {
      signal?.throwIfAborted()
      const [name, provider] = pending[index++]
      const uploaded = Object.hasOwn(files, name)
      if (!uploaded && (provider.type !== 'http' || !provider.url)) {
        failures.set(name, '此订阅仅有本地路径或缺少地址，请补充对应的节点缓存 YAML')
        continue
      }
      try {
        const timeout = AbortSignal.timeout(SUBSCRIPTION_TIMEOUT)
        const text = uploaded ? files[name] : await download(provider, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, consume })
        const parsed = parseConfig(text)
        const nodes = Array.isArray(parsed) ? parsed : parsed.proxies
        if (!Array.isArray(nodes) || !nodes.length) fail('订阅文件缺少实际 proxies 节点，请勿重复选择主配置')
        files[name] = text
      } catch (error) {
        if (signal?.aborted) throw error
        // Network errors may contain signed subscription URLs; only expose our
        // own fixed messages, never the raw transport/parser error.
        const reason = /^(订阅|配置和订阅缓存|YAML 格式)/.test(error.message)
          ? error.message : '订阅读取失败或超时，请重试或补充对应的节点缓存 YAML'
        failures.set(name, reason)
      }
    }
  }))
  if (failures.size) {
    const error = new Error('部分订阅未能读取。可重试导入，或仅补充下列订阅的节点缓存 YAML；原有配置未修改。')
    error.providers = pending.filter(([name]) => failures.has(name)).map(([name]) => ({ name, reason: failures.get(name) }))
    throw error
  }
  return parseDiagnosticImport({ configText, providerFiles: files })
}

export function parseDiagnosticImport({ configText, providerFiles = {} }) {
  if (!record(providerFiles)) fail('订阅缓存格式无效')
  const total = Buffer.byteLength(String(configText || '')) +
    Object.values(providerFiles).reduce((size, text) => size + Buffer.byteLength(String(text)), 0)
  if (total > IMPORT_LIMIT) fail('配置和订阅缓存合计不能超过 6 MB')
  const config = parseConfig(configText)
  const nodes = [...(Array.isArray(config) ? config : Array.isArray(config.proxies) ? config.proxies : [])]
  for (const [name, provider] of Object.entries(providersOf(config))) {
    let entries = provider.payload
    if (Object.hasOwn(providerFiles, name)) {
      const uploaded = parseConfig(providerFiles[name])
      entries = Array.isArray(uploaded) ? uploaded : uploaded.proxies
    }
    if (!Array.isArray(entries) || !entries.length)
      fail(`请补充订阅「${name}」的节点缓存 YAML；仅有订阅地址或文件路径无法进行独立检测`)
    const override = record(provider.override) ? { ...provider.override } : {}
    const prefix = override['additional-prefix'] || ''
    const suffix = override['additional-suffix'] || ''
    delete override['additional-prefix']
    delete override['additional-suffix']
    nodes.push(...entries.map(node => ({ ...node, ...override, name: `${prefix}${node?.name || ''}${suffix}` })))
  }
  if (!nodes.length || nodes.length > 20000) fail('配置需要包含 1–20000 个实际节点')
  const names = new Set()
  for (const node of nodes) {
    if (!record(node) || typeof node.name !== 'string' || !node.name.trim() ||
        node.name.length > 512 || typeof node.type !== 'string' || !node.type ||
        typeof node.server !== 'string' || !node.server.trim() ||
        !Number.isInteger(Number(node.port)) || Number(node.port) < 1 || Number(node.port) > 65535)
      fail('节点缺少有效的 name、type、server 或 port，请导入完整节点配置')
    if (names.has(node.name)) fail(`节点名称重复：${node.name}，请保留与当前后端一致的唯一名称`)
    names.add(node.name)
  }
  // Persist only proxy definitions: never rules, listeners, paths or provider URLs.
  const serialized = JSON.stringify(nodes)
  if (Buffer.byteLength(serialized) > IMPORT_LIMIT) fail('解析后的节点配置超过 6 MB')
  return JSON.parse(serialized)
}

const fingerprint = backend => createHash('sha256').update(JSON.stringify([
  backend.protocol, backend.host, String(backend.port), backend.secondaryPath || '',
])).digest('hex')

export function createDiagnosticImportStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS diagnostic_imports (
    backend_uuid TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
    nodes_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  const columns = new Set(db.prepare('PRAGMA table_info(diagnostic_imports)').all().map(column => column.name))
  for (const column of ['source_path', 'source_root']) {
    if (!columns.has(column)) db.exec(`ALTER TABLE diagnostic_imports ADD COLUMN ${column} TEXT`)
  }
  const get = db.prepare('SELECT * FROM diagnostic_imports WHERE backend_uuid = ?')
  const put = db.prepare(`INSERT INTO diagnostic_imports (backend_uuid, fingerprint, nodes_json, updated_at, source_path, source_root) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(backend_uuid) DO UPDATE SET fingerprint=excluded.fingerprint,
    nodes_json=excluded.nodes_json, updated_at=excluded.updated_at,
    source_path=excluded.source_path, source_root=excluded.source_root`)
  return {
    status(backend, root) {
      const row = get.get(backend.uuid)
      return row ? { configured: true, stale: row.fingerprint !== fingerprint(backend) || Boolean(row.source_path && root && row.source_root !== root),
        sourceKind: row.source_path ? 'mounted' : 'import', sourcePath: row.source_path || undefined,
        nodeCount: row.source_path ? undefined : JSON.parse(row.nodes_json).length, updatedAt: row.updated_at } : { configured: false }
    },
    read(backend) {
      const row = get.get(backend.uuid)
      if (!row) return null
      if (row.fingerprint !== fingerprint(backend))
        fail('后端地址已变化，请在编辑后端中重新导入或移除节点检测配置')
      if (row.source_path) return null
      return JSON.parse(row.nodes_json)
    },
    readMount(backend, root) {
      const row = get.get(backend.uuid)
      if (!row?.source_path) return null
      if (row.fingerprint !== fingerprint(backend) || row.source_root !== root)
        fail('后端地址或挂载目录已变化，请重新连接配置目录')
      return { configPath: row.source_path }
    },
    bindMount(backend, root, configPath) {
      put.run(backend.uuid, fingerprint(backend), '[]', new Date().toISOString(), configPath, root)
      return this.status(backend, root)
    },
    save(backend, nodes) {
      put.run(backend.uuid, fingerprint(backend), JSON.stringify(nodes), new Date().toISOString(), null, null)
      return this.status(backend)
    },
    remove(backend) {
      db.prepare('DELETE FROM diagnostic_imports WHERE backend_uuid = ?').run(backend.uuid)
      return { configured: false }
    },
  }
}

export function registerDiagnosticImports(app, { store, readBackend, readLiveNames, download, mountedSource }) {
  const endpoint = operation => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const controller = new AbortController()
    const onClose = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', onClose)
    try {
      const backend = readBackend(req.body?.backendUuid)
      res.json(await operation(req.body || {}, backend, controller.signal))
    } catch (error) {
      if (!controller.signal.aborted) res.status(400).json({ message: error.message || '配置导入失败', ...(error.providers ? { providers: error.providers } : {}) })
    } finally { res.off('close', onClose) }
  }
  app.post('/api/diagnostics/config/status', endpoint(async (_, backend) => ({
    ...store.status(backend, mountedSource?.root),
    ...(mountedSource ? { mount: await mountedSource.status() } : {}),
  })))
  app.post('/api/diagnostics/config/mount', endpoint(async (body, backend, signal) => {
    if (!mountedSource) fail('此部署未配置客户端数据目录挂载')
    const candidates = await mountedSource.discover()
    const configPath = body.configPath || (candidates.length === 1 ? candidates[0] : '')
    if (!configPath || !candidates.includes(configPath)) fail('请选择挂载目录中的主配置；Clash Mi 请挂载包含 service_core_runtime_profile.yaml 的数据目录')
    const nodes = await mountedSource.read({ configPath, signal })
    const names = await readLiveNames(backend)
    const matchedCount = nodes.filter(node => names.has(node.name)).length
    if (!matchedCount) fail('挂载目录中的节点与当前后端不匹配，原有配置未修改')
    signal.throwIfAborted()
    return { ...store.bindMount(backend, mountedSource.root, configPath), matchedCount, mount: await mountedSource.status() }
  }))
  app.post('/api/diagnostics/config/preview', endpoint(body => previewDiagnosticImport(body.configText)))
  app.post('/api/diagnostics/config/import', endpoint(async (body, backend, signal) => {
    const nodes = await resolveDiagnosticImport(body, { signal, download })
    const names = await readLiveNames(backend)
    const matchedCount = nodes.filter(node => names.has(node.name)).length
    if (!matchedCount) fail('配置中的节点名称与此后端不匹配，请导入该客户端当前使用的配置')
    signal.throwIfAborted()
    return { ...store.save(backend, nodes), matchedCount }
  }))
  app.post('/api/diagnostics/config/remove', endpoint((_, backend) => store.remove(backend)))
}
