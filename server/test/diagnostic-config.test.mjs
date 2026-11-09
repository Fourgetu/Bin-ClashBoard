import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import express from 'express'
import { createDiagnosticImportStore, downloadProvider, parseDiagnosticImport, previewDiagnosticImport, registerDiagnosticImports, resolveDiagnosticImport, IMPORT_LIMIT } from '../diagnostic-config.mjs'
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
  assert.deepEqual(previewDiagnosticImport(text).providers, [{ name: 'remote', needsFile: true, canDownload: true }, { name: 'inline', needsFile: false, canDownload: false }])
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

async function withHttp(handler, run) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try { await run(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

const remoteConfig = providers => JSON.stringify({ 'proxy-providers': providers })

test('one main YAML imports HTTP subscriptions, headers, redirects, inline nodes and overrides', async () => {
  const requests = []
  await withHttp((req, res) => {
    requests.push({ path: req.url, headers: req.headers })
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/nodes' }); res.end(); return }
    res.end(JSON.stringify({ proxies: [node] }))
  }, async url => {
    const configText = remoteConfig({
      first: { type: 'http', url: `${url}/redirect`, header: { 'User-Agent': ['mihomo-test'], Authorization: ['Bearer fixture'] }, override: { 'additional-prefix': 'one-' } },
      second: { type: 'http', url: `${url}/nodes`, override: { 'additional-prefix': 'two-' } },
      inline: { type: 'inline', payload: [{ ...node, name: 'inline' }] },
    })
    previewDiagnosticImport(configText)
    assert.equal(requests.length, 0, 'preview must not fetch subscriptions')
    const nodes = await resolveDiagnosticImport({ configText })
    assert.deepEqual(nodes.map(n => n.name), [`one-${node.name}`, `two-${node.name}`, 'inline'])
    assert.equal(requests.length, 3)
    assert.equal(requests.find(r => r.path === '/redirect').headers['user-agent'], 'mihomo-test')
    assert.equal(requests.find(r => r.path === '/redirect').headers.authorization, 'Bearer fixture')
    assert.ok(!JSON.stringify(nodes).includes('/redirect'))
  })
})

test('partial failures only request failed/local providers; uploaded caches bypass requests', async () => {
  const calls = []
  const configText = remoteConfig({
    good: { type: 'http', url: 'https://example.test/good' },
    bad: { type: 'http', url: 'https://example.test/private?token=DO_NOT_LEAK' },
    local: { type: 'file', path: '/private/file.yaml' },
  })
  const download = async provider => {
    calls.push(provider.url)
    if (provider.url.includes('private')) throw new Error(`request failed ${provider.url}`)
    return JSON.stringify({ proxies: [node] })
  }
  await assert.rejects(resolveDiagnosticImport({ configText }, { download }), error => {
    assert.deepEqual(error.providers.map(p => p.name), ['bad', 'local'])
    assert.ok(!JSON.stringify(error).includes('DO_NOT_LEAK'))
    return true
  })
  assert.equal(calls.length, 2)
  calls.length = 0
  const nodes = await resolveDiagnosticImport({ configText, providerFiles: {
    bad: JSON.stringify({ proxies: [{ ...node, name: 'bad-cache' }] }),
    local: JSON.stringify({ proxies: [{ ...node, name: 'local-cache' }] }),
  } }, { download })
  assert.equal(calls.length, 1)
  assert.equal(nodes.length, 3)
  await assert.rejects(resolveDiagnosticImport({ configText, providerFiles: { good: configText } }, { download }), error => {
    assert.match(error.providers.find(p => p.name === 'good').reason, /请勿重复选择主配置/)
    return true
  })
})

test('downloads have bounded concurrency and cancellation propagates', async () => {
  let active = 0
  let peak = 0
  const configText = remoteConfig(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`p${i}`, { type: 'http', url: `https://example.test/${i}`, override: { 'additional-prefix': `${i}-` } }])))
  const nodes = await resolveDiagnosticImport({ configText }, { download: async () => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 10))
    active--
    return JSON.stringify({ proxies: [node] })
  } })
  assert.equal(nodes.length, 7)
  assert.equal(peak, 3)
  await assert.rejects(resolveDiagnosticImport({ configText }, { signal: AbortSignal.abort(), download: async (_, { signal }) => signal.throwIfAborted() }), /abort/i)
})

test('HTTP failures and non-YAML responses produce per-provider fallbacks', async () => {
  await withHttp((req, res) => {
    if (req.url === '/denied') res.writeHead(403)
    res.end('<html>private response</html>')
  }, async url => {
    await assert.rejects(resolveDiagnosticImport({ configText: remoteConfig({
      denied: { type: 'http', url: `${url}/denied` },
      html: { type: 'http', url: `${url}/html` },
    }) }), error => {
      assert.match(error.providers[0].reason, /HTTP 403/)
      assert.match(error.providers[1].reason, /YAML/)
      assert.ok(!JSON.stringify(error).includes('private response'))
      return true
    })
  })
})

test('download limits streamed bytes, timeouts, redirect schemes and cross-origin credentials', async () => {
  await assert.rejects(downloadProvider({ url: 'file:///private' }, { consume() {} }), /HTTP/)
  await withHttp((req, res) => {
    if (req.url === '/large') { res.write('x'.repeat(4096)); res.end('x'.repeat(4096)) }
    else if (req.url === '/bad') { res.writeHead(302, { Location: 'file:///private' }); res.end() }
    else if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end() }
    else if (req.url === '/slow') { res.writeHead(200); res.flushHeaders() }
    else res.end(JSON.stringify(req.headers))
  }, async url => {
    await assert.rejects(downloadProvider({ url: `${url}/large` }, { consume() { throw new Error('byte limit') } }), /byte limit/)
    await assert.rejects(downloadProvider({ url: `${url}/bad` }, { consume() {} }), /HTTP/)
    await assert.rejects(downloadProvider({ url: `${url}/loop` }, { consume() {} }), /重定向/)
    await assert.rejects(downloadProvider({ url: `${url}/slow` }, { signal: AbortSignal.timeout(50), consume() {} }), /abort|timeout/i)
    await withHttp((req, res) => { res.writeHead(302, { Location: `${url}/headers` }); res.end() }, async redirect => {
      const text = await downloadProvider({ url: redirect, header: { Authorization: ['private'], Cookie: ['private'], 'X-Token': ['private'] } }, { consume() {} })
      assert.ok(!text.includes('private'))
    })
  })
  await assert.rejects(resolveDiagnosticImport({ configText: remoteConfig({ big: { type: 'http', url: 'https://example.test' } }) }, {
    download: async (_, { consume }) => { consume(IMPORT_LIMIT); return '' },
  }), error => /6 MB/.test(error.providers[0].reason))
})

test('API import resolves URLs only on import; failed resolution preserves saved data', async () => {
  const db = new DatabaseSync(':memory:')
  const store = createDiagnosticImportStore(db)
  store.save(backend, [node])
  const app = express()
  app.use(express.json())
  let calls = 0
  registerDiagnosticImports(app, {
    store, readBackend: () => backend, readLiveNames: async () => new Set([node.name]),
    download: async provider => {
      calls++
      if (provider.url.endsWith('/bad')) throw new Error('private-token')
      return JSON.stringify({ proxies: [{ ...node, password: 'updated-fixture' }] })
    },
  })
  try {
    await withHttp(app, async url => {
      const post = async (action, configText) => {
        const response = await fetch(`${url}/api/diagnostics/config/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backendUuid: backend.uuid, configText }) })
        return { status: response.status, data: await response.json() }
      }
      const good = remoteConfig({ subscription: { type: 'http', url: 'https://example.test/good' } })
      assert.equal((await post('preview', good)).status, 200)
      assert.equal(calls, 0)
      const failed = await post('import', remoteConfig({ subscription: { type: 'http', url: 'https://example.test/bad' } }))
      assert.equal(failed.status, 400)
      assert.deepEqual(failed.data.providers.map(p => p.name), ['subscription'])
      assert.ok(!JSON.stringify(failed.data).includes('private-token'))
      assert.deepEqual(store.read(backend), [node])
      const saved = await post('import', good)
      assert.equal(saved.status, 200)
      assert.equal(saved.data.matchedCount, 1)
      assert.equal(store.read(backend)[0].password, 'updated-fixture')
      assert.ok(!JSON.stringify(saved.data).includes('updated-fixture'))
    })
  } finally { db.close() }
})
