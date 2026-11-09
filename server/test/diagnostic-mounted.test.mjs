import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import express from 'express'
import { createMountedDiagnosticSource } from '../diagnostic-mounted.mjs'
import { createDiagnosticImportStore, registerDiagnosticImports } from '../diagnostic-config.mjs'
import { registerDiagnostics } from '../diagnostics.mjs'

const node = { name: 'desktop', type: 'anytls', server: '127.0.0.1', port: 443, password: 'private-fixture' }
const backend = { uuid: 'desktop', protocol: 'http', host: 'host.docker.internal', port: '9090' }
const main = 'service_core_runtime_profile.yaml'

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bin-mounted-test-'))
  const root = path.join(directory, 'mount')
  await fs.mkdir(root)
  const write = async (relative, data) => {
    const file = path.join(root, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, typeof data === 'string' ? data : JSON.stringify(data))
    return file
  }
  try { await run({ root, directory, write, source: createMountedDiagnosticSource(root) }) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('mounted Clash Mi runtime is preferred and absolute Windows paths map to their original cache suffix', async () => {
  await fixture(async ({ write, source }) => {
    await write('config.yaml', { proxies: [{ ...node, name: 'unused-original' }] })
    await write(main, { 'proxy-providers': { remote: { type: 'file', path: 'C:\\Users\\Other User\\ClashMi\\datas\\providers\\香港.yaml', override: { 'additional-prefix': 'HK-', udp: false } } } })
    await write('datas/providers/香港.yaml', { proxies: [node] })
    await write('backup/香港.yaml', { proxies: [{ ...node, name: 'wrong-backup' }] })
    assert.deepEqual(await source.discover(), [main])
    const nodes = await source.read({ configPath: main })
    assert.equal(nodes[0].name, 'HK-desktop')
    assert.equal(nodes[0].udp, false)
    assert.equal(nodes[0].password, node.password)
    assert.ok(!JSON.stringify(await source.status()).includes(node.password))
  })
})

test('mounted node files are re-read after subscription changes and no snapshot is retained', async () => {
  await fixture(async ({ write, source }) => {
    await write(main, { 'proxy-providers': { sub: { type: 'file', path: './providers/sub.yaml' } } })
    await write('providers/sub.yaml', { proxies: [node] })
    assert.equal((await source.read({ configPath: main }))[0].port, 443)
    await write('providers/sub.yaml', { proxies: [{ ...node, port: 8443, password: 'updated-private-fixture' }] })
    assert.equal((await source.read({ configPath: main }))[0].port, 8443)
    await write(main, { proxies: [{ ...node, port: 9443 }] })
    assert.equal((await source.read({ configPath: main }))[0].port, 9443)
  })
})

test('targeted mount reads follow provider membership and cross-provider dialer dependencies', async () => {
  await fixture(async ({ write, source }) => {
    await write(main, { 'proxy-providers': {
      selected: { type: 'file', path: './selected.yaml' },
      dialer: { type: 'inline', payload: [{ ...node, name: 'upstream' }] },
      unused: { type: 'file', path: './not-downloaded.yaml' },
    } })
    await write('selected.yaml', { proxies: [{ ...node, 'dialer-proxy': 'upstream' }] })
    const nodes = await source.read({ configPath: main, name: 'desktop', providerOwners: new Map([['desktop', ['selected']], ['upstream', ['dialer']]]) })
    assert.deepEqual(nodes.map(n => n.name), ['desktop', 'upstream'])
    await assert.rejects(source.read({ configPath: main }), /unused.*暂无可用节点缓存/)
  })
})

test('missing, malformed, ambiguous and escaping mounted files fail without fallback or leaked YAML', async () => {
  await fixture(async ({ root, directory, write, source }) => {
    await write(main, { 'proxy-providers': { sub: { type: 'file', path: '/old/missing/foo.yaml' } } })
    await write('one/foo.yaml', { proxies: [node] })
    await write('two/foo.yaml', { proxies: [node] })
    await assert.rejects(source.read({ configPath: main }), /同名订阅缓存/)
    await assert.rejects(source.read({ configPath: '../outside.yaml' }), /超出挂载目录/)
    await assert.rejects(source.read({ configPath: 'C:\\outside.yaml' }), /位于挂载目录/)
    await write(main, { 'proxy-providers': { sub: { type: 'file', path: '../outside.yaml' } } })
    await assert.rejects(source.read({ configPath: main }), /超出挂载目录/)
    const outside = path.join(directory, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'secret.yaml'), JSON.stringify({ proxies: [node] }))
    await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await write(main, { 'proxy-providers': { sub: { type: 'file', path: './linked/secret.yaml' } } })
    await assert.rejects(source.read({ configPath: main }), /目录之外/)
    await write(main, 'password: [PRIVATE_DO_NOT_LEAK')
    await assert.rejects(source.read({ configPath: main }), error => /YAML/.test(error.message) && !error.message.includes('PRIVATE_DO_NOT_LEAK'))
    await write(main, { 'proxy-providers': { sub: { type: 'file', path: './missing.yaml' } } })
    await assert.rejects(source.read({ configPath: main }), /暂无可用节点缓存/)
    await assert.rejects(source.read({ configPath: main, signal: AbortSignal.abort() }), /abort/i)
  })
})

test('mount discovery reports absent directories and multiple configs instead of guessing', async () => {
  await fixture(async ({ root, write, source }) => {
    assert.equal((await createMountedDiagnosticSource(path.join(root, 'missing')).status()).available, false)
    assert.deepEqual(await source.discover(), [])
    await write('a.yaml', { proxies: [node] })
    await write('b.yaml', { proxies: [node] })
    await write('setting.json', { theme: 'light' })
    assert.deepEqual(await source.discover(), ['a.yaml', 'b.yaml'])
  })
})

test('store migrates old imports, binds a source per backend and invalidates address/root changes', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE diagnostic_imports (backend_uuid TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, nodes_json TEXT NOT NULL, updated_at TEXT NOT NULL)')
    const store = createDiagnosticImportStore(db)
    store.save(backend, [node])
    const other = { ...backend, uuid: 'other' }
    store.save(other, [{ ...node, name: 'other' }])
    assert.deepEqual(createDiagnosticImportStore(db).read(backend), [node])
    store.bindMount(backend, '/app/clashmi', main)
    assert.equal(store.status(backend).sourceKind, 'mounted')
    assert.equal(store.read(backend), null)
    assert.equal(db.prepare('SELECT nodes_json FROM diagnostic_imports WHERE backend_uuid=?').get(backend.uuid).nodes_json, '[]')
    assert.deepEqual(store.readMount(backend, '/app/clashmi'), { configPath: main })
    assert.throws(() => store.readMount({ ...backend, port: '9191' }, '/app/clashmi'), /已变化/)
    assert.throws(() => store.readMount(backend, '/changed'), /已变化/)
    assert.equal(store.status(backend, '/changed').stale, true)
    assert.equal(store.read(other)[0].name, 'other')
    store.save(backend, [node])
    assert.equal(store.readMount(backend, '/app/clashmi'), null)
    assert.equal(store.status(backend).sourceKind, 'import')
    store.remove(backend)
    assert.equal(store.status(backend).configured, false)
  } finally { db.close() }
})

test('mount API matches the selected backend; diagnostics read updated files, failed bindings preserve the source', async () => {
  await fixture(async ({ write, source }) => {
    await write(main, { proxies: [node] })
    const db = new DatabaseSync(':memory:')
    const store = createDiagnosticImportStore(db)
    store.save(backend, [node])
    const app = express()
    app.use(express.json())
    registerDiagnosticImports(app, { store, mountedSource: source, readBackend: () => backend, readLiveNames: async () => new Set(['desktop']) })
    registerDiagnostics(app, { readBackend: () => backend, loadNodes: async (b, signal, options) => ({ nodes: await source.read({ ...store.readMount(b, source.root), ...options, signal }), runtime: {} }) })
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const post = async (action, body = {}) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/diagnostics/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backendUuid: backend.uuid, ...body }) })
      return { code: res.status, body: await res.json() }
    }
    try {
      const before = await fs.readFile(path.join(source.root, main), 'utf8')
      const connected = await post('config/mount')
      assert.equal(connected.code, 200)
      assert.equal(connected.body.sourceKind, 'mounted')
      assert.ok(!JSON.stringify(connected).includes(node.password))
      assert.equal(await fs.readFile(path.join(source.root, main), 'utf8'), before)
      assert.equal((await post('node', { name: 'desktop', kind: 'info' })).body.port, 443)
      await write(main, { proxies: [{ ...node, port: 8443 }] })
      assert.equal((await post('node', { name: 'desktop', kind: 'info' })).body.port, 8443)
      await write(main, { proxies: [{ ...node, name: 'wrong-backend' }] })
      assert.equal((await post('config/mount')).code, 400)
      assert.equal(store.status(backend).sourceKind, 'mounted')
      assert.equal((await post('config/import', { configText: 'invalid' })).code, 400)
      assert.equal(store.status(backend).sourceKind, 'mounted')
      assert.equal((await post('config/mount', { configPath: '../escape' })).code, 400)
      assert.equal((await post('config/status')).body.mount.available, true)
      await post('config/remove')
      assert.equal(store.readMount(backend, source.root), null)
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      db.close()
    }
  })
})
