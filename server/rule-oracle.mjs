// 规则判定引擎（oracle）：只带「规则 + 规则集」，用镜像自带的 mihomo 判定任意域名命中哪条规则。
// 不连目标站点、不解析 mrs、不留常驻状态：判定结果按域名缓存，内核空闲即关闭。
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { parse } from 'yaml'

const READY_PATTERN = /proxy listening at/i
// 内核两种日志形态：成功时是 info 的 "... --> host:443 match RuleSet(x) using G[..]"，
// 出站失败时是 warning 的 "dial G (match RuleSet/x) src --> host:443 error: ..."。
const INFO_MATCH = /-->\s*([^\s:]+):\d+\s+match\s+([A-Za-z-]+)(?:\(([^)]*)\))?\s+using\s+(\S+)/
const DIAL_MATCH = /dial\s+(.+?)\s+\(match\s+([A-Za-z-]+)\/([^)]*)\)\s+\S+\s+-->\s+([^\s:]+):\d+/

export function parseMatchLine(text) {
  const raw = String(text || '')
  const info = raw.match(INFO_MATCH)
  if (info)
    return {
      host: info[1].toLowerCase(),
      type: info[2],
      payload: (info[3] || '').replace(/["']$/, ''),
      target: info[4].replace(/\[.*$/, '').replace(/["']$/, ''),
    }
  const dial = raw.match(DIAL_MATCH)
  if (dial)
    return {
      host: dial[4].toLowerCase(),
      type: dial[2],
      payload: dial[3] || '',
      target: dial[1].trim(),
    }
  return null
}
const DECISION_TTL_MS = 10 * 60_000
const IDLE_SHUTDOWN_MS = 60_000
const MAX_CACHED_DECISIONS = 500
const SINK_PROXY = '__oracle_sink'

const slash = (value) => String(value).replaceAll('\\', '/')
const isWildcardTarget = (name) => !name || name === 'DIRECT' || name === 'REJECT' || name === 'PASS'

// 只按域名判定时，这些规则需要端口、网络、进程或入站上下文，本次判定无法覆盖。
const CONTEXT_RULE = /^(AND|OR|NOT)$|^(NETWORK|DST-PORT|SRC-PORT|SRC-IP-CIDR|SRC-IP-CIDR6|INBOUND|PROCESS-NAME)$/i

export function ruleTargetOf(rule) {
  const parts = String(rule).split(',')
  return parts[parts.length - 1].trim()
}

export function ruleProviderName(rule) {
  const parts = String(rule).split(',')
  return parts[0].trim().toUpperCase() === 'RULE-SET' ? parts[1].trim() : ''
}

// 规则集来源优先级：inline payload → 客户端给的相对 path → rules/<md5(url)> 缓存
export function resolveRuleProviders(profile, { mountDir = '/app/clashmi' } = {}) {
  const providers = profile['rule-providers'] || {}
  const resolved = {}
  const unresolved = []
  for (const [name, provider] of Object.entries(providers)) {
    const behavior = provider?.behavior || 'domain'
    const format = provider?.format || 'yaml'
    if (Array.isArray(provider?.payload) && provider.payload.length) {
      resolved[name] = { type: 'inline', behavior, payload: provider.payload }
      continue
    }
    if (typeof provider?.path === 'string' && provider.path) {
      const relative = slash(provider.path).replace(/^\.\//, '')
      const file = slash(provider.path).startsWith('/') ? slash(provider.path) : `${mountDir}/${relative}`
      resolved[name] = { type: 'file', behavior, format, path: file }
      continue
    }
    if (typeof provider?.url === 'string' && provider.url) {
      const hash = createHash('md5').update(provider.url, 'utf8').digest('hex')
      resolved[name] = { type: 'file', behavior, format, path: `${mountDir}/rules/${hash}` }
      continue
    }
    unresolved.push(name)
  }
  return { resolved, unresolved }
}

export function findRuleIndex(rules, type, payload) {
  const wanted = String(type || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const wantedPayload = String(payload || '')
  for (let index = 0; index < rules.length; index++) {
    const parts = String(rules[index]).split(',').map((part) => part.trim())
    if (parts[0].toUpperCase().replace(/[^A-Z0-9]/g, '') !== wanted) continue
    if (wanted.toUpperCase() === 'MATCH') return index
    if (parts[1] === wantedPayload) return index
  }
  return -1
}

export async function buildRuleOracleConfig(
  profile,
  { mountDir = '/app/clashmi', port, exists = defaultExists } = {},
) {
  const { resolved, unresolved } = resolveRuleProviders(profile, { mountDir })
  const available = {}
  const missing = [...unresolved]
  for (const [name, provider] of Object.entries(resolved)) {
    if (provider.type === 'inline') {
      available[name] = provider
      continue
    }
    if (await exists(provider.path)) {
      available[name] = provider
      continue
    }
    missing.push(name)
  }

  const sourceRules = Array.isArray(profile.rules) ? profile.rules : []
  const rules = []
  const droppedRules = []
  for (const rule of sourceRules) {
    const provider = ruleProviderName(rule)
    if (provider && !available[provider]) {
      droppedRules.push(String(rule))
      continue
    }
    rules.push(String(rule))
  }

  const targets = new Set()
  for (const rule of rules) {
    const target = ruleTargetOf(rule)
    if (!isWildcardTarget(target)) targets.add(target)
  }
  const proxyGroups = [...targets].map((name) => ({ name, type: 'select', proxies: [SINK_PROXY] }))

  return {
    config: {
      'mixed-port': port,
      'allow-lan': false,
      'bind-address': '127.0.0.1',
      mode: 'rule',
      ipv6: true,
      'log-level': 'info',
      'external-controller': '',
      'find-process-mode': 'off',
      dns: { enable: false },
      tun: { enable: false },
      'rule-providers': available,
      // 判定不需要真实出站：所有策略组都指向一个不可达的本地端口，连接立刻失败，不会碰到目标站点。
      proxies: [{ name: SINK_PROXY, type: 'socks5', server: '127.0.0.1', port: 1 }],
      'proxy-groups': proxyGroups,
      rules,
    },
    missing,
    droppedRules,
    contextRules: rules.filter((rule) => CONTEXT_RULE.test(String(rule).split(',')[0].trim())),
  }
}

async function defaultExists(file) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * 真实流量探测的归属判断：源 IP+端口精确匹配优先，其次按 Docker NAT 特征，
 * 最后按「探测期间新增 + 目标域名 + 时间窗」。返回命中连接与匹配方式。
 */
export function selectProbeEvidence({
  before,
  connections,
  hostname,
  hostIps = [],
  startedAt,
  socket,
  now = Date.now(),
  natAddresses = [],
}) {
  const host = String(hostname || '').toLowerCase()
  const ips = new Set(hostIps.map((ip) => String(ip)))
  const seen = before instanceof Set ? before : new Set(Array.isArray(before) ? before : [])
  const exact = []
  const dockerNat = []
  const byHost = []
  const nat = new Set(['127.0.0.1', ...natAddresses])

  for (const connection of Array.isArray(connections) ? connections : []) {
    if (!connection || (connection.id && seen.has(connection.id))) continue
    const meta = connection.metadata || {}
    const start = Date.parse(connection.start)
    if (Number.isFinite(start) && (start < startedAt - 5000 || start > now + 5000)) continue
    const names = [meta.host, meta.sniffHost, meta.destinationIP].map((value) => String(value || '').toLowerCase())
    const hostHit = names.includes(host) || ips.has(meta.destinationIP) || ips.has(meta.sniffHost)
    if (!hostHit) continue
    if (
      socket?.localAddress &&
      canonicalProbeIP(socket.localAddress) === canonicalProbeIP(meta.sourceIP) &&
      String(meta.sourcePort) === String(socket.localPort)
    ) {
      exact.push(connection)
      continue
    }
    if (meta.process === 'com.docker.backend.exe' || nat.has(String(meta.sourceIP || ''))) {
      dockerNat.push(connection)
      continue
    }
    byHost.push(connection)
  }

  const pick = (list) =>
    list.length ? list.reduce((earliest, item) => (Date.parse(item.start) < Date.parse(earliest.start) ? item : earliest)) : null

  for (const [list, matchedBy] of [
    [exact, 'socket'],
    [dockerNat, 'docker-nat'],
    [byHost, 'host-window'],
  ]) {
    if (list.length) return { connection: pick(list), matchedBy, ambiguous: list.length > 1 }
  }
  return { connection: null, matchedBy: '', ambiguous: false }
}

export function canonicalProbeIP(address) {
  if (!net.isIP(address || '')) return ''
  let value = String(address)
  if (net.isIP(value) === 4) {
    const bytes = value.split('.').map(Number)
    value = `::ffff:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
  }
  return new URL(`http://[${value}]/`).hostname
}

/**
 * 创建规则判定器。核心按需启动，连续查询复用，空闲 60 秒或显式 close 时退出。
 */
export function createRuleOracle({
  binary,
  mountDir,
  tempRoot,
  profileName = 'service_core_runtime_profile.yaml',
  spawnCore = spawn,
  now = () => Date.now(),
}) {
  let child = null
  let ready = false
  let profileKey = ''
  let oracleConfig = null
  let missing = []
  let droppedRules = []
  let contextRules = []
  let directory = ''
  let idleTimer = null
  let queue = Promise.resolve()
  const cache = new Map()

  const shutdown = async () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    const current = child
    child = null
    ready = false
    if (!current) return
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        current.kill('SIGKILL')
        resolve()
      }, 2000)
      current.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      current.kill()
    })
    if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    directory = ''
  }

  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      shutdown().catch(() => {})
    }, IDLE_SHUTDOWN_MS)
    idleTimer.unref?.()
  }

  const startCore = async () => {
    const profilePath = path.join(mountDir, profileName)
    const stat = await fs.stat(profilePath).catch(() => null)
    if (!stat) throw new Error('未找到 Clash Mi 运行配置，请确认数据目录已挂载')
    const key = `${profilePath}:${stat.mtimeMs}:${stat.size}`
    if (child && ready && profileKey === key) return
    await shutdown()
    const profile = parse(await fs.readFile(profilePath, 'utf8'))
    const port = await freePort()
    const built = await buildRuleOracleConfig(profile, { mountDir, port })
    oracleConfig = built.config
    missing = built.missing
    droppedRules = built.droppedRules
    contextRules = built.contextRules
    profileKey = key
    directory = await fs.mkdtemp(path.join(tempRoot, 'rule-oracle-'))
    const configPath = path.join(directory, 'config.json')
    await fs.writeFile(configPath, JSON.stringify(oracleConfig))
    const core = spawnCore(binary, ['-d', directory, '-f', configPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SAFE_PATHS: mountDir },
    })
    let log = ''
    const collect = (chunk) => {
      if (log.length < 128_000) log += chunk.toString()
    }
    core.stdout?.on('data', collect)
    core.stderr?.on('data', collect)
    let exited = false
    core.once('exit', () => {
      exited = true
    })
    child = core
    ready = false
    for (let attempt = 0; attempt < 200; attempt++) {
      if (exited) {
        child = null
        throw new Error(`规则判定内核启动失败：${log.split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'unknown'}`)
      }
      if (READY_PATTERN.test(log)) {
        ready = true
        break
      }
      await delay(50)
    }
    if (!ready) {
      await shutdown()
      throw new Error('规则判定内核启动超时')
    }
    core.oracleLog = () => log
  }

  const decide = async (hostname) => {
    const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
    if (!host) throw new Error('请输入有效域名')
    const cached = cache.get(host)
    if (cached && cached.expires > now()) return { ...cached.value, cached: true }
    await startCore()
    touch()
    const port = oracleConfig['mixed-port']
    const log = () => child?.oracleLog?.() || ''
    const marker = log().length
    await new Promise((resolve) => {
      const request = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${host}:443` })
      request.on('connect', (_res, socket) => {
        socket.destroy()
        resolve()
      })
      request.on('error', () => resolve())
      request.setTimeout(5000, () => {
        request.destroy()
        resolve()
      })
      request.end()
    })
    let line = ''
    for (let attempt = 0; attempt < 25; attempt++) {
      line = log()
        .slice(marker)
        .split(/\r?\n/)
        .filter((entry) => parseMatchLine(entry)?.host === host)
        .slice(-1)[0]
      if (line) break
      await delay(40)
    }
    touch()
    const match = parseMatchLine(line)
    if (!match) throw new Error('规则判定未返回结果，请重试')
    const index = findRuleIndex(oracleConfig.rules, match.type, match.payload)
    const target = match.target.replace(/\[.*$/, '')
    const value = {
      hostname: host,
      ruleIndex: index,
      ruleType: match.type,
      rulePayload: match.payload || '',
      target,
      chain: match.target,
      incomplete: contextRules.length > 0 && index >= 0 && oracleConfig.rules.slice(0, index).some((rule) => contextRules.includes(rule)),
      missingProviders: missing,
      droppedRules,
      decidedAt: new Date(now()).toISOString(),
    }
    cache.set(host, { value, expires: now() + DECISION_TTL_MS })
    if (cache.size > MAX_CACHED_DECISIONS) cache.delete(cache.keys().next().value)
    return value
  }

  return {
    async decide(hostname) {
      const run = queue.then(() => decide(hostname))
      queue = run.catch(() => {})
      return run
    },
    async status() {
      const profilePath = path.join(mountDir, profileName)
      const stat = await fs.stat(profilePath).catch(() => null)
      return {
        available: Boolean(stat),
        profile: stat ? profileName : '',
        running: Boolean(child && ready),
        cached: cache.size,
        missingProviders: missing,
        droppedRules: droppedRules.length,
      }
    },
    async close() {
      cache.clear()
      await shutdown()
    },
  }
}
