import { createHash } from 'node:crypto'
import { parse } from 'yaml'

export const IMPORT_LIMIT = 6 * 1024 * 1024
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
    })),
  }
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
  const get = db.prepare('SELECT * FROM diagnostic_imports WHERE backend_uuid = ?')
  const put = db.prepare(`INSERT INTO diagnostic_imports VALUES (?, ?, ?, ?)
    ON CONFLICT(backend_uuid) DO UPDATE SET fingerprint=excluded.fingerprint,
    nodes_json=excluded.nodes_json, updated_at=excluded.updated_at`)
  return {
    status(backend) {
      const row = get.get(backend.uuid)
      return row ? { configured: true, stale: row.fingerprint !== fingerprint(backend),
        nodeCount: JSON.parse(row.nodes_json).length, updatedAt: row.updated_at } : { configured: false }
    },
    read(backend) {
      const row = get.get(backend.uuid)
      if (!row) return null
      if (row.fingerprint !== fingerprint(backend))
        fail('后端地址已变化，请在编辑后端中重新导入或移除节点检测配置')
      return JSON.parse(row.nodes_json)
    },
    save(backend, nodes) {
      put.run(backend.uuid, fingerprint(backend), JSON.stringify(nodes), new Date().toISOString())
      return this.status(backend)
    },
    remove(backend) {
      db.prepare('DELETE FROM diagnostic_imports WHERE backend_uuid = ?').run(backend.uuid)
      return { configured: false }
    },
  }
}

export function registerDiagnosticImports(app, { store, readBackend, readLiveNames }) {
  const endpoint = operation => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const backend = readBackend(req.body?.backendUuid)
      res.json(await operation(req.body || {}, backend))
    } catch (error) {
      res.status(400).json({ message: error.message || '配置导入失败' })
    }
  }
  app.post('/api/diagnostics/config/status', endpoint((_, backend) => store.status(backend)))
  app.post('/api/diagnostics/config/preview', endpoint(body => previewDiagnosticImport(body.configText)))
  app.post('/api/diagnostics/config/import', endpoint(async (body, backend) => {
    const nodes = parseDiagnosticImport(body)
    const names = await readLiveNames(backend)
    const matchedCount = nodes.filter(node => names.has(node.name)).length
    if (!matchedCount) fail('配置中的节点名称与此后端不匹配，请导入该客户端当前使用的配置')
    return { ...store.save(backend, nodes), matchedCount }
  }))
  app.post('/api/diagnostics/config/remove', endpoint((_, backend) => store.remove(backend)))
}
