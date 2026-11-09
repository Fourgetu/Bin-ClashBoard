import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { createDiagnosticImportStore, parseDiagnosticImport, previewDiagnosticImport, registerDiagnosticImports, IMPORT_LIMIT } from '../diagnostic-config.mjs'
import { registerDiagnostics, selectProbeNodes } from '../diagnostics.mjs'

const backend = { uuid: 'desktop', host: '192.0.2.10', protocol: 'http', port: '9090' }
const other = { ...backend, uuid: 'router', host: '192.0.2.1' }
const node = { name: 'desktop-node', type: 'anytls', server: '127.0.0.1', port: 443, password: 'fixture-node-secret', udp: true }
const configText = JSON.stringify({ proxies: [node], 'mixed-port': 8888, secret: 'fixture-api-secret', rules: ['MATCH,DIRECT'] })

test('desktop imports retain proxy credentials but exclude unrelated client configuration', () => {
  assert.deepEqual(parseDiagnosticImport({ configText }), [node])
  assert.deepEqual(parseDiagnosticImport({ configText: JSON.stringify([node]) }), [node])
  assert.deepEqual(previewDiagnosticImport(configText), { providers: [] })
})

test('provider imports require explicit cache content and preserve override names and dialer dependencies', () => {
  const text = JSON.stringify({
    proxies: [{ ...node, name: 'entry', 'dialer-proxy': 'provider-base' }],
    'proxy-providers': {
      remote: { type: 'http', url: 'https://invalid.example/private-subscription', path: '/etc/private-file', override: { 'additional-prefix': 'provider-', udp: false } },
      inline: { type: 'inline', payload: [{ ...node, name: 'inline-node' }] },
    },
  })
  assert.deepEqual(previewDiagnosticImport(text).providers, [{ name: 'remote', needsFile: true }, { name: 'inline', needsFile: false }])
  assert.throws(() => parseDiagnosticImport({ configText: text }), /请补充订阅/)
  const nodes = parseDiagnosticImport({ configText: text, providerFiles: { remote: JSON.stringify({ proxies: [{ ...node, name: 'base' }] }) } })
  assert.equal(nodes.find(n => n.name === 'provider-base').udp, false)
  assert.deepEqual(selectProbeNodes(nodes, 'entry').map(n => n.name), ['provider-base', 'entry'])
  assert.ok(!JSON.stringify(nodes).includes('private-subscription'))
  assert.ok(!JSON.stringify(nodes).includes('/etc/private-file'))
})

test('malformed, ambiguous and oversized imports never leak YAML source in error messages', () => {
  assert.throws(() => parseDiagnosticImport({ configText: 'password: [TOP_SECRET' }), error => !error.message.includes('TOP_SECRET') && /YAML/.test(error.message))
  assert.throws(() => parseDiagnosticImport({ configText: JSON.stringify({ proxies: [node, node] }) }), /名称重复/)
  assert.throws(() => parseDiagnosticImport({ configText: JSON.stringify({ proxies: [{ name: 'summary', type: 'AnyTLS' }] }) }), /完整节点配置/)
  assert.throws(() => parseDiagnosticImport({ configText: 'x'.repeat(IMPORT_LIMIT + 1) }), /6 MB/)
  assert.throws(() => parseDiagnosticImport({ configText: 'proxy-providers: []' }), /必须为对象/)
  assert.throws(() => parseDiagnosticImport({ configText, providerFiles: { extra: 'x'.repeat(IMPORT_LIMIT) } }), /6 MB/)
})

test('imports survive store recreation, stay backend-bound and invalidate changed endpoints', () => {
  const db = new DatabaseSync(':memory:')
  try {
    const store = createDiagnosticImportStore(db)
    store.save(backend, [node])
    assert.equal(store.read(other), null)
    assert.equal(store.status(backend).nodeCount, 1)
    assert.ok(!JSON.stringify(store.status(backend)).includes(node.password))
    assert.deepEqual(createDiagnosticImportStore(db).read(backend), [node])
    const moved = { ...backend, port: '9191' }
    assert.equal(store.status(moved).stale, true)
    assert.throws(() => store.read(moved), /地址已变化/)
    store.save(other, [{ ...node, name: 'router-node' }])
    store.remove(backend)
    assert.equal(store.read(backend), null)
    assert.equal(store.read(other)[0].name, 'router-node')
  } finally { db.close() }
})

test('API imports desktop config and resolves info without SSH; mismatch never overwrites saved credentials', async () => {
  const db = new DatabaseSync(':memory:')
  const store = createDiagnosticImportStore(db)
  const app = express()
  app.use(express.json({ limit: '8mb' }))
  const readBackend = uuid => {
    if (uuid === backend.uuid) return backend
    if (uuid === other.uuid) return other
    throw new Error('Unknown backend')
  }
  registerDiagnosticImports(app, { store, readBackend, readLiveNames: async () => new Set([node.name]) })
  registerDiagnostics(app, {
    readBackend,
    loadNodes: async b => {
      const nodes = store.read(b)
      if (!nodes) throw new Error('No imported config')
      return { nodes, runtime: {} }
    },
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const post = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/diagnostics/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backendUuid: backend.uuid, ...body }),
    })
    return { status: response.status, data: await response.json() }
  }
  try {
    const saved = await post('config/import', { configText })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.matchedCount, 1)
    assert.ok(!JSON.stringify(saved.data).includes(node.password))
    const info = await post('node', { name: node.name, kind: 'info' })
    assert.equal(info.status, 200)
    assert.equal(info.data.server, '127.0.0.1')
    assert.equal(info.data.protocol, 'anytls')
    assert.ok(!JSON.stringify(info.data).includes(node.password))
    assert.equal((await post('node', { name: node.name, kind: 'info', backendUuid: other.uuid })).status, 400)
    assert.equal((await post('config/import', { configText: JSON.stringify({ proxies: [{ ...node, name: 'wrong-client' }] }) })).status, 400)
    assert.deepEqual(store.read(backend), [node])
    assert.equal((await post('config/import', { configText: 'invalid yaml' })).status, 400)
    assert.deepEqual(store.read(backend), [node])
    assert.equal((await post('config/status', { backendUuid: 'missing' })).status, 400)
    assert.equal((await post('config/remove', {})).data.configured, false)
    assert.equal((await post('node', { name: node.name, kind: 'info' })).status, 400)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
