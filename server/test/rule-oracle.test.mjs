import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { buildRouteHit } from '../diagnostics.mjs'
import {
  buildRuleOracleConfig,
  findRuleIndex,
  parseMatchLine,
  resolveRuleProviders,
  selectProbeEvidence,
} from '../rule-oracle.mjs'

const md5 = (value) => createHash('md5').update(value, 'utf8').digest('hex')

test('kernel match lines are parsed in both info and dial-failure shapes', () => {
  const info = parseMatchLine(
    'time="..." level=info msg="[TCP] 127.0.0.1:33468 --> www.youtube.com:443 match RuleSet(youtube_domain) using YouTube[DIRECT]"',
  )
  assert.deepEqual(info, {
    host: 'www.youtube.com',
    type: 'RuleSet',
    payload: 'youtube_domain',
    target: 'YouTube',
  })
  const dial = parseMatchLine(
    'level=warning msg="[TCP] dial 兜底流量 (match Match/) 127.0.0.1:59175 --> tokenrhythm.studio:443 error: refused"',
  )
  assert.equal(dial.host, 'tokenrhythm.studio')
  assert.equal(dial.type, 'Match')
  assert.equal(dial.payload, '')
  assert.equal(dial.target, '兜底流量')
  assert.equal(parseMatchLine('level=info msg="Start initial configuration in progress"'), null)
})

test('rule providers resolve inline payloads, client paths and url caches', () => {
  const { resolved, unresolved } = resolveRuleProviders(
    {
      'rule-providers': {
        inlineOne: { type: 'inline', behavior: 'classical', payload: ['DOMAIN-SUFFIX,example.com'] },
        pathOne: { type: 'http', behavior: 'domain', format: 'mrs', path: './ruleset/geosite/cn.mrs', url: 'https://example.com/cn.mrs' },
        urlOne: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://example.com/youtube.mrs' },
        broken: { type: 'http' },
      },
    },
    { mountDir: '/app/clashmi' },
  )
  assert.deepEqual(resolved.inlineOne, {
    type: 'inline',
    behavior: 'classical',
    payload: ['DOMAIN-SUFFIX,example.com'],
  })
  assert.equal(resolved.pathOne.path, '/app/clashmi/ruleset/geosite/cn.mrs')
  assert.equal(resolved.urlOne.path, `/app/clashmi/rules/${md5('https://example.com/youtube.mrs')}`)
  assert.deepEqual(unresolved, ['broken'])
})

test('oracle config drops rules whose rule set has no local cache and builds sink groups', async () => {
  const profile = {
    'rule-providers': {
      cached: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://example.com/cached.mrs' },
      missing: { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://example.com/missing.mrs' },
      inlineOne: { type: 'inline', behavior: 'classical', payload: ['DOMAIN-SUFFIX,inline.test'] },
    },
    rules: [
      'RULE-SET,cached,YouTube',
      'RULE-SET,missing,Google',
      'RULE-SET,inlineOne,Streaming',
      'AND,((NETWORK,UDP),(DST-PORT,500)),VoWiFi',
      'MATCH,兜底流量',
    ],
  }
  const built = await buildRuleOracleConfig(profile, {
    mountDir: '/app/clashmi',
    port: 19999,
    exists: async (file) => file.endsWith(md5('https://example.com/cached.mrs')),
  })
  assert.deepEqual(built.missing, ['missing'])
  assert.deepEqual(built.droppedRules, ['RULE-SET,missing,Google'])
  assert.deepEqual(built.config.rules, [
    'RULE-SET,cached,YouTube',
    'RULE-SET,inlineOne,Streaming',
    'AND,((NETWORK,UDP),(DST-PORT,500)),VoWiFi',
    'MATCH,兜底流量',
  ])
  assert.deepEqual(
    built.config['proxy-groups'].map((group) => group.name),
    ['YouTube', 'Streaming', 'VoWiFi', '兜底流量'],
  )
  assert.equal(built.config['proxy-groups'][0].proxies.length, 1)
  assert.ok(built.config.proxies[0].name.startsWith('__oracle'))
  assert.deepEqual(built.contextRules, ['AND,((NETWORK,UDP),(DST-PORT,500)),VoWiFi'])
})

test('rule index lookup normalizes kernel type names', () => {
  const rules = ['DOMAIN-SUFFIX,jsdelivr.net,一键代理', 'RULE-SET,youtube_domain,YouTube', 'IP-CIDR,1.1.1.1/32,DIRECT', 'MATCH,兜底流量']
  assert.equal(findRuleIndex(rules, 'RuleSet', 'youtube_domain'), 1)
  assert.equal(findRuleIndex(rules, 'RULE-SET', 'youtube_domain'), 1)
  assert.equal(findRuleIndex(rules, 'IpCidr', '1.1.1.1/32'), 2)
  assert.equal(findRuleIndex(rules, 'Match', ''), 3)
  assert.equal(findRuleIndex(rules, 'RuleSet', 'nope'), -1)
})

const connection = (id, host, extra = {}) => ({
  id,
  start: new Date().toISOString(),
  rule: 'RuleSet',
  rulePayload: 'youtube_domain',
  chains: ['羽迹 🇭🇰 香港2', '香港手动', 'YouTube'],
  metadata: { host, sourceIP: '127.0.0.1', sourcePort: '52000', process: 'com.docker.backend.exe', ...extra },
})

test('probe evidence prefers an exact socket match over Docker NAT and host heuristics', () => {
  const socket = { localAddress: '172.17.0.2', localPort: 49326 }
  const exact = connection('a', 'youtube.com', { sourceIP: '172.17.0.2', sourcePort: '49326', process: 'node' })
  const nat = connection('b', 'youtube.com')
  const picked = selectProbeEvidence({
    before: new Set(),
    connections: [nat, exact],
    hostname: 'youtube.com',
    startedAt: Date.now() - 1000,
    socket,
  })
  assert.equal(picked.connection.id, 'a')
  assert.equal(picked.matchedBy, 'socket')
  assert.equal(picked.ambiguous, false)
})

test('probe evidence still attributes the connection when Docker rewrites the source address', () => {
  const socket = { localAddress: '172.17.0.2', localPort: 49326 }
  const picked = selectProbeEvidence({
    before: new Set(),
    connections: [connection('nat', 'youtube.com')],
    hostname: 'youtube.com',
    startedAt: Date.now() - 1000,
    socket,
  })
  assert.equal(picked.connection.id, 'nat')
  assert.equal(picked.matchedBy, 'docker-nat')
})

test('probe evidence ignores connections that already existed and falls back to the host window', () => {
  const existing = connection('old', 'youtube.com')
  const fresh = connection('fresh', 'youtube.com', { sourceIP: '198.18.0.1', process: 'chrome.exe' })
  const picked = selectProbeEvidence({
    before: new Set(['old']),
    connections: [existing, fresh],
    hostname: 'youtube.com',
    startedAt: Date.now() - 1000,
  })
  assert.equal(picked.connection.id, 'fresh')
  assert.equal(picked.matchedBy, 'host-window')
  assert.equal(
    selectProbeEvidence({ before: new Set(['old']), connections: [existing], hostname: 'youtube.com', startedAt: Date.now() - 1000 })
      .connection,
    null,
  )
})

test('probe evidence matches resolved addresses and reports ambiguity', () => {
  const first = connection('one', '', { destinationIP: '142.250.1.1', sourceIP: '198.18.0.1', process: 'chrome.exe' })
  const second = connection('two', '', { destinationIP: '142.250.1.1', sourceIP: '198.18.0.1', process: 'chrome.exe' })
  second.start = new Date(Date.now() - 500).toISOString()
  const picked = selectProbeEvidence({
    before: new Set(),
    connections: [first, second],
    hostname: 'youtube.com',
    hostIps: ['142.250.1.1'],
    startedAt: Date.now() - 1000,
  })
  assert.equal(picked.connection.id, 'two')
  assert.equal(picked.ambiguous, true)
})

test('route hit merges the rule decision with the observed chain', () => {
  const decision = { ruleIndex: 16, ruleType: 'RuleSet', rulePayload: 'youtube_domain', target: 'YouTube', incomplete: false, missingProviders: [], droppedRules: [] }
  const hit = buildRouteHit(connection('x', 'youtube.com'), decision)
  assert.equal(hit.ruleIndex, 16)
  assert.equal(hit.rulePayload, 'youtube_domain')
  assert.equal(hit.group, 'YouTube')
  assert.equal(hit.node, '羽迹 🇭🇰 香港2')
  assert.equal(hit.fromOracle, true)

  const noChain = buildRouteHit(null, decision)
  assert.equal(noChain.group, 'YouTube')
  assert.deepEqual(noChain.chains, [])

  const noDecision = buildRouteHit(connection('y', 'youtube.com'), null)
  assert.equal(noDecision.ruleIndex, -1)
  assert.equal(noDecision.rulePayload, 'youtube_domain')
  assert.equal(noDecision.group, 'YouTube')
  assert.equal(noDecision.fromOracle, false)
})
