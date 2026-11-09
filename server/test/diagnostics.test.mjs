import express from 'express'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  canonicalIP,
  groupDeviceConnections,
  matchesRouteTarget,
  normalizeRouteTarget,
  predictRoute,
  selectedChain,
} from '../../src/helper/networkDiagnostics.ts'
import {
  DOWNLOAD_BYTES,
  DOWNLOAD_URL,
  createDiagnosticConfigCache,
  createProbeQueue,
  diagnosticsErrorMessage,
  isPublicAddress,
  loadDiagnosticNodeDependencies,
  matchesProbeConnection,
  normalizeIntelligence,
  openClashRuntimeConfigs,
  parseDhcpLeases,
  proxyGet,
  registerDiagnostics,
  selectProbeNodes,
  withProbe,
} from '../diagnostics.mjs'

const rule = (type, payload, proxy = 'Proxy') => ({ type, payload, proxy })
test('OpenClash diagnostics find the running generated YAML instead of a provider-less UCI source', () => {
  assert.deepEqual(
    openClashRuntimeConfigs(
      [
        '26321 root 1625m S /etc/openclash/clash -d /etc/openclash -f /etc/openclash/active.yaml',
        '26400 root 12m S /usr/bin/nikki -f /etc/nikki/run/config.yaml',
        '27000 root 2m S cat /etc/openclash/config/source.yaml',
      ].join('\n'),
    ),
    ['/etc/openclash/active.yaml'],
  )
  assert.deepEqual(
    openClashRuntimeConfigs(
      '12 root /etc/openclash/mihomo --config="/etc/openclash/my config.yml"',
    ),
    ['/etc/openclash/my config.yml'],
  )
  assert.deepEqual(openClashRuntimeConfigs('no running core'), [])
})
const connection = (sourceIP, host = 'example.com') => ({
  id: sourceIP,
  metadata: { sourceIP, host },
  chains: ['Node', 'Proxy'],
  download: 100,
  upload: 20,
  downloadSpeed: 10,
  uploadSpeed: 5,
})
test('probe attribution never borrows another device, stale request or NAT-translated connection', () => {
  const now = Date.now()
  const socket = { localAddress: '192.168.1.2', localPort: 32123 }
  const record = { ...connection('::ffff:192.168.1.2'), start: new Date(now).toISOString() }
  record.metadata.sourcePort = '32123'
  assert.equal(matchesProbeConnection(record, socket, 'example.com', now), true)
  for (const metadata of [
    { ...record.metadata, sourceIP: '192.168.1.3' },
    { ...record.metadata, sourcePort: '32124' },
    { ...record.metadata, host: 'another.example' },
  ])
    assert.equal(matchesProbeConnection({ ...record, metadata }, socket, 'example.com', now), false)
  assert.equal(
    matchesProbeConnection(
      { ...record, start: new Date(now - 60000).toISOString() },
      socket,
      'example.com',
      now,
    ),
    false,
  )
  assert.equal(matchesProbeConnection({ ...record, start: '' }, socket, 'example.com', now), false)
})
test('devices merge equivalent IPv6 and IPv4-mapped addresses without merging distinct IPs', () => {
  assert.equal(canonicalIP('::ffff:192.168.1.2'), '192.168.1.2')
  const groups = groupDeviceConnections([
    connection('192.168.1.2'),
    connection('::ffff:192.168.1.2'),
    connection('2001:db8:0:0:0:0:0:1'),
    connection('2001:db8::1'),
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].connections.length, 2)
  assert.equal(groups[0].download, 200)
})
test('route targets normalize URLs and only match the requested host and device', () => {
  assert.equal(normalizeRouteTarget('https://EXAMPLE.com/path?q=1'), 'example.com')
  assert.equal(normalizeRouteTarget('https://user:password@example.com'), '')
  assert.equal(normalizeRouteTarget('2001:db8::1'), '2001:db8::1')
  assert.equal(matchesRouteTarget(connection('192.168.1.2'), 'example.com', '192.168.1.3'), false)
  assert.equal(
    matchesRouteTarget(connection('192.168.1.2', 'notexample.com'), 'example.com'),
    false,
  )
})
test('route prediction uses domain boundaries, rule order and disabled state', () => {
  const rules = [
    { ...rule('DomainSuffix', 'example.com'), disabled: true },
    rule('DOMAIN-SUFFIX', 'example.org'),
    rule('MATCH', '', 'DIRECT'),
  ]
  assert.equal(predictRoute(rules, 'notexample.org').rule.proxy, 'DIRECT')
  assert.equal(predictRoute(rules, 'a.example.org').rule.payload, 'example.org')
})
test('unresolved GEOIP, rule sets and process rules prevent a false definitive fallback', () => {
  for (const type of ['GEOIP', 'RuleSet', 'ProcessName']) {
    const result = predictRoute([rule(type, 'unknown'), rule('MATCH', '', 'DIRECT')], 'example.com')
    assert.equal(result.certain, false)
    assert.equal(result.uncertain.length, 1)
  }
  assert.equal(
    predictRoute([rule('RuleSet', 'known'), rule('MATCH', '', 'DIRECT')], 'example.com', '', [
      'known',
    ]).certain,
    true,
  )
})
test('source CIDR only matches the correct family and resolved source address', () => {
  const rules = [rule('SRC-IP-CIDR', '192.168.1.0/24'), rule('MATCH', '', 'DIRECT')]
  assert.equal(predictRoute(rules, 'example.com', '192.168.1.10').rule.proxy, 'Proxy')
  assert.equal(predictRoute(rules, 'example.com', '2001:db8::1').rule.proxy, 'DIRECT')
  assert.equal(predictRoute(rules, 'example.com').certain, false)
})
test('dynamic selection and cycle paths remain explicit', () => {
  assert.deepEqual(selectedChain('Load', { Load: { all: ['Node'] } }), ['Load', '由内核动态选择'])
  assert.deepEqual(selectedChain('A', { A: { now: 'B' }, B: { now: 'A' } }), ['A', 'B', '循环引用'])
})
test('missing Net.Coffee risk fields are unknown, never marked clean or zero', () => {
  const result = normalizeIntelligence({ ip: '82.22.31.236' })
  assert.equal(result.flags.is_vpn, null)
  assert.equal(result.trustScore, null)
  assert.equal(result.httpThreat, null)
  assert.equal(result.threats, null)
  assert.equal(result.humanTraffic, null)
  assert.equal(result.source, 'Net.Coffee')
  assert.throws(() => normalizeIntelligence({ ip: 'invalid' }))
})
test('Net.Coffee scoring preserves zero and ASN statistics without inventing IP estimates', () => {
  const result = normalizeIntelligence(
    {
      ip: '82.22.31.236',
      trust_score: 0,
      is_vpn: false,
      asn: 142433,
      countryCode: 'HK',
      registered_country_code: 'gb',
      rpki_status: 'valid',
      intelligence: { threats: [], rep_threat: 0 },
    },
    { ok: true, human: 43, bot: 57, range: '28d' },
  )
  assert.equal(result.trustScore, 0)
  assert.equal(result.flags.is_vpn, false)
  assert.equal(result.native, false)
  assert.equal(result.httpThreat, 0)
  assert.equal(result.humanTraffic.human, 43)
  assert.equal(result.reportUrl, 'https://ip.net.coffee/ip/82.22.31.236')
})
test('DHCP only imports valid named leases', () => {
  assert.deepEqual(parseDhcpLeases('0 aa:bb 192.168.1.2 TV *\n0 aa:cc 192.168.1.3 * *\ninvalid'), [
    { ip: '192.168.1.2', mac: 'aa:bb', name: 'TV' },
  ])
})
test('probe configuration includes only the chosen node and its required dialer chain', () => {
  const nodes = [
    { name: 'exit', type: 'socks5', 'dialer-proxy': 'group' },
    { name: 'front', type: 'http' },
    { name: 'unused', password: 'not-to-copy' },
  ]
  const selected = selectProbeNodes(nodes, 'exit', { group: { now: 'front' } })
  assert.deepEqual(
    selected.map((node) => node.name),
    ['front', 'group', 'exit'],
  )
  assert.equal(
    selected.some((node) => node.name === 'unused'),
    false,
  )
  assert.throws(() => selectProbeNodes([{ name: 'x', 'dialer-proxy': 'x' }], 'x'), /循环/)
  assert.throws(() => selectProbeNodes([{ name: 'x' }, { name: 'x' }], 'x'), /重复/)
})
test('public route validation rejects internal and mapped loopback addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
  ])
    assert.equal(isPublicAddress(ip), false, ip)
  assert.equal(isPublicAddress('1.1.1.1'), true)
})

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = (server) => new Promise((resolve) => server.close(resolve))
test('probe queue serializes browsers and releases the slot after failure', async () => {
  const enqueue = createProbeQueue()
  const gate = Promise.withResolvers()
  const order = []
  const first = enqueue(async () => {
    order.push('first')
    await gate.promise
    throw new Error('probe failed')
  })
  const rejected = assert.rejects(first, /probe failed/)
  const second = enqueue(async () => {
    order.push('second')
    return 'ok'
  })
  await Promise.resolve()
  assert.deepEqual(order, ['first'])
  gate.resolve()
  await rejected
  assert.equal(await second, 'ok')
  assert.deepEqual(order, ['first', 'second'])
})

test('aborting a queued probe never runs it or overlaps the active probe', async () => {
  const enqueue = createProbeQueue()
  const gate = Promise.withResolvers()
  const first = enqueue(() => gate.promise)
  const controller = new AbortController()
  let cancelledRuns = 0,
    lastRuns = 0
  const second = enqueue(() => {
    cancelledRuns++
  }, controller.signal)
  const rejected = assert.rejects(second, { name: 'AbortError' })
  const last = enqueue(() => {
    lastRuns++
  })
  controller.abort()
  await rejected
  assert.equal(cancelledRuns, 0)
  assert.equal(lastRuns, 0)
  gate.resolve()
  await Promise.all([first, last])
  assert.equal(lastRuns, 1)
})

test('basic info queries run concurrently without occupying the isolated probe queue', async () => {
  const app = express()
  app.use(express.json())
  let running = 0,
    maxRunning = 0,
    loads = 0
  registerDiagnostics(app, {
    readBackend: () => ({}),
    loadNodes: async () => {
      loads++
      maxRunning = Math.max(maxRunning, ++running)
      await new Promise((resolve) => setTimeout(resolve, 30))
      running--
      return { nodes: [{ name: 'Node', type: 'http', server: '127.0.0.1', port: 9 }] }
    },
  })
  const server = http.createServer(app)
  const port = await listen(server)
  try {
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        fetch(`http://127.0.0.1:${port}/api/diagnostics/node`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Node', kind: 'info' }),
        }),
      ),
    )
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200, 200],
    )
    for (const response of responses) assert.equal((await response.json()).server, '127.0.0.1')
    assert.equal(loads, 3)
    assert.equal(maxRunning, 3)
  } finally {
    await close(server)
  }
})

test('diagnostic errors distinguish a TLS handshake failure from timeout', () => {
  assert.match(
    diagnosticsErrorMessage(
      new Error('Client network socket disconnected before secure TLS connection was established'),
    ),
    /TLS.*建立前断开/,
  )
  assert.match(diagnosticsErrorMessage(new DOMException('aborted', 'AbortError')), /超时/)
})

test('config cache shares reads, isolates backends, expires and supports explicit refresh', async () => {
  let time = 0,
    loads = 0
  const read = createDiagnosticConfigCache({ ttlMs: 100, now: () => time })
  const load = async () => ({ revision: ++loads })
  const [first, shared] = await Promise.all([read('a', load), read('a', load)])
  assert.equal(first, shared)
  assert.equal(loads, 1)
  assert.equal(await read('a', load), first)
  assert.notEqual(await read('b', load), first)
  assert.equal(loads, 2)
  assert.equal((await read('a', load, undefined, true)).revision, 3)
  time = 101
  assert.equal((await read('a', load)).revision, 4)
})

test('cancelled config waiter does not abort another request or poison the cache', async () => {
  const read = createDiagnosticConfigCache()
  const gate = Promise.withResolvers()
  const controller = new AbortController()
  let loadSignal,
    loads = 0
  const load = async (signal) => {
    loads++
    loadSignal = signal
    return gate.promise
  }
  const cancelled = read('a', load, controller.signal)
  const rejection = assert.rejects(cancelled, { name: 'AbortError' })
  const second = read('a', load)
  await Promise.resolve()
  controller.abort()
  await rejection
  assert.equal(loadSignal.aborted, false)
  gate.resolve({ nodes: ['Node'] })
  assert.deepEqual(await second, { nodes: ['Node'] })
  assert.deepEqual(await read('a', load), { nodes: ['Node'] })
  assert.equal(loads, 1)
})

test('failed config reads are retriable and never become cached results', async () => {
  const read = createDiagnosticConfigCache()
  await assert.rejects(
    read('a', async () => {
      throw new Error('SSH failed')
    }),
    /SSH failed/,
  )
  assert.deepEqual(await read('a', async () => ['Node']), ['Node'])
})

test('targeted config loading reads only the selected provider and cross-provider dialer', async () => {
  const reads = []
  const providers = {
    selected: [{ name: 'Target', 'dialer-proxy': 'Group' }],
    upstream: [{ name: 'Upstream' }],
    unrelated: [{ name: 'Unused' }],
  }
  const nodes = await loadDiagnosticNodeDependencies({
    name: 'Target',
    nodes: [],
    providers,
    providerOwners: new Map([
      ['Target', ['selected']],
      ['Upstream', ['upstream']],
    ]),
    runtime: { Group: { now: 'Upstream' } },
    readProvider: async (entries) => {
      reads.push(entries[0].name)
      return entries
    },
  })
  assert.deepEqual(reads, ['Target', 'Upstream'])
  assert.deepEqual(
    nodes.map((node) => node.name),
    ['Target', 'Upstream'],
  )
})

test('targeted loading supports inline nodes and falls back when core membership is absent', async () => {
  let loads = 0
  const options = {
    nodes: [{ name: 'Inline' }],
    providers: { fallback: [{ name: 'ProviderNode' }] },
    providerOwners: new Map(),
    runtime: {},
    readProvider: async (nodes) => {
      loads++
      return nodes
    },
  }
  await loadDiagnosticNodeDependencies({ ...options, name: 'Inline' })
  assert.equal(loads, 0)
  const nodes = await loadDiagnosticNodeDependencies({ ...options, name: 'ProviderNode' })
  assert.equal(loads, 1)
  assert.equal(
    nodes.some((node) => node.name === 'ProviderNode'),
    true,
  )
})

test('targeted loading retains duplicate-name and circular-dialer safety checks', async () => {
  const providers = { a: [{ name: 'Same' }], b: [{ name: 'Same' }] }
  const nodes = await loadDiagnosticNodeDependencies({
    name: 'Same',
    nodes: [],
    providers,
    providerOwners: new Map([['Same', ['a', 'b']]]),
    runtime: {},
    readProvider: async (nodes) => nodes,
  })
  assert.throws(() => selectProbeNodes(nodes, 'Same'), /重复/)
  const cycle = await loadDiagnosticNodeDependencies({
    name: 'A',
    nodes: [
      { name: 'A', 'dialer-proxy': 'B' },
      { name: 'B', 'dialer-proxy': 'A' },
    ],
    providers: {},
    providerOwners: new Map(),
    runtime: {},
    readProvider: async () => [],
  })
  assert.throws(() => selectProbeNodes(cycle, 'A'), /循环/)
})

test('basic info returns while a risk probe is still pending', async () => {
  const app = express()
  app.use(express.json())
  const started = Promise.withResolvers(),
    gate = Promise.withResolvers()
  registerDiagnostics(app, {
    readBackend: () => ({}),
    loadNodes: async () => ({
      nodes: [{ name: 'Node', type: 'http', server: '127.0.0.1', port: 9 }],
    }),
    runProbe: async () => {
      started.resolve()
      return gate.promise
    },
  })
  const server = http.createServer(app)
  const port = await listen(server)
  const request = (kind) =>
    fetch(`http://127.0.0.1:${port}/api/diagnostics/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Node', kind }),
      signal: AbortSignal.timeout(2000),
    })
  try {
    const risk = request('intelligence')
    await started.promise
    const info = await request('info')
    assert.equal(info.status, 200)
    assert.equal((await info.json()).server, '127.0.0.1')
    gate.resolve({ ip: '1.1.1.1' })
    assert.equal((await (await risk).json()).ip, '1.1.1.1')
  } finally {
    gate.resolve({})
    await close(server)
  }
})

test('download has one bounded GET target and the API rejects upload and missing actions', async () => {
  assert.equal(DOWNLOAD_BYTES, 10_000_000)
  assert.equal(new URL(DOWNLOAD_URL).pathname, '/__down')
  let loads = 0
  const app = express()
  app.use(express.json())
  registerDiagnostics(app, {
    readBackend: () => ({}),
    loadNodes: () => {
      loads++
      throw new Error('not expected')
    },
  })
  const server = http.createServer(app)
  const port = await listen(server)
  try {
    for (const body of [{ name: 'Node', kind: 'upload' }, { name: 'Node' }]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/diagnostics/node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 400)
    }
    assert.equal(loads, 0)
  } finally {
    await close(server)
  }
})
test('proxy failure never falls back to a direct connection', async () => {
  const proxy = http.createServer()
  proxy.on('connect', (_req, socket) =>
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'),
  )
  const port = await listen(proxy)
  try {
    await assert.rejects(
      proxyGet({ host: '127.0.0.1', port }, 'https://not-resolvable.invalid'),
      /407/,
    )
  } finally {
    await close(proxy)
  }
})
test('proxy transfer is GET only, capped, TLS verified and cancellable', async () => {
  const cert = await fs.readFile(new URL('./fixtures/diagnostics-cert.pem', import.meta.url))
  const key = await fs.readFile(new URL('./fixtures/diagnostics-key.pem', import.meta.url))
  const requests = []
  const origin = https.createServer({ key, cert }, (req, res) => {
    requests.push(req.method)
    if (req.url === '/slow') {
      res.writeHead(200)
      res.write('x')
      return
    }
    res.end('0123456789abcdef')
  })
  const originPort = await listen(origin)
  const sockets = new Set()
  const proxy = http.createServer()
  proxy.on('connect', (_req, client) => {
    const upstream = net.connect(originPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      client.pipe(upstream).pipe(client)
    })
    sockets.add(client)
    sockets.add(upstream)
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => {
      sockets.delete(client)
      upstream.destroy()
    })
    upstream.on('close', () => {
      sockets.delete(upstream)
      client.destroy()
    })
  })
  const port = await listen(proxy)
  const endpoint = { host: '127.0.0.1', port }
  try {
    const result = await proxyGet(endpoint, 'https://diagnostics.invalid', {
      ca: cert,
      maxBytes: 10,
    })
    assert.equal(result.bytes, 10)
    assert.equal(result.body, '0123456789')
    assert.equal(result.limited, true)
    await assert.rejects(
      proxyGet(endpoint, 'https://diagnostics.invalid'),
      /certificate|self.signed/i,
    )
    const abort = new AbortController()
    const pending = proxyGet(endpoint, 'https://diagnostics.invalid/slow', {
      ca: cert,
      signal: abort.signal,
    })
    setTimeout(() => abort.abort(), 100)
    await assert.rejects(pending, /取消/)
    assert.deepEqual([...new Set(requests)], ['GET'])
  } finally {
    sockets.forEach((socket) => socket.destroy())
    origin.closeAllConnections()
    await Promise.all([close(proxy), close(origin)])
  }
})
test('isolated Mihomo probe cleans its credentials and child process on failure', async (context) => {
  const binary = path.resolve(
    process.platform === 'win32'
      ? '.tools/mihomo-bin/mihomo-windows-amd64-compatible.exe'
      : '.tools/mihomo-bin/mihomo',
  )
  if (
    !(await fs.access(binary).then(
      () => true,
      () => false,
    ))
  )
    return context.skip('Mihomo is not installed')
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bin-probe-test-'))
  try {
    await assert.rejects(
      withProbe(
        {
          binary,
          tempRoot,
          nodes: [{ name: 'fixture', type: 'http', server: '127.0.0.1', port: 9 }],
          name: 'fixture',
          signal: new AbortController().signal,
        },
        async (proxy) => {
          assert.equal(proxy.host, '127.0.0.1')
          assert.ok(proxy.auth.startsWith('probe:'))
          throw new Error('intentional fixture failure')
        },
      ),
      /intentional fixture failure/,
    )
    assert.deepEqual(await fs.readdir(tempRoot), [])
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
