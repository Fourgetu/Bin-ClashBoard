import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import tls from 'node:tls'

export const DOWNLOAD_BYTES = 10_000_000
export const DOWNLOAD_URL = `https://speed.cloudflare.com/__down?bytes=${DOWNLOAD_BYTES}`

// OpenClash adds provider cache paths to its generated runtime YAML, not the UCI source YAML.
export function openClashRuntimeConfigs(processList) {
  const paths = []
  for (const line of String(processList).split(/\r?\n/)) {
    if (!/(?:^|\s)\/[^\s]*openclash\/(?:clash|mihomo)(?:\s|$)/.test(line)) continue
    const match = /(?:^|\s)(?:-f|--config|-config)(?:=|\s+)(?:"([^"\n]+)"|'([^'\n]+)'|(\S+))/.exec(
      line,
    )
    const file = match?.[1] || match?.[2] || match?.[3]
    if (file?.startsWith('/') && /\.ya?ml$/i.test(file)) paths.push(file)
  }
  return [...new Set(paths)]
}

// One bounded HTTPS GET through an explicit proxy. Never falls back to the server's connection.
export function proxyGet(
  proxy,
  target,
  { signal, maxBytes = 256_000, collect = true, onTunnel, ca } = {},
) {
  return new Promise((resolve, reject) => {
    const url = new URL(target)
    if (url.protocol !== 'https:') return reject(new Error('仅支持 HTTPS 检测目标'))
    let tunnel,
      secure,
      request,
      response,
      agent,
      finished = false
    const started = performance.now()
    const timeout = setTimeout(() => finish(new Error('检测超时（30 秒）')), 30_000)
    const abort = () => finish(new Error('检测已取消'))
    const finish = (error, result) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      response?.destroy()
      request?.destroy()
      secure?.destroy()
      agent?.destroy()
      tunnel?.destroy()
      connect.destroy()
      error ? reject(error) : resolve(result)
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const authority = `${net.isIP(hostname) === 6 ? `[${hostname}]` : hostname}:${url.port || 443}`
    const connect = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: authority,
      headers: {
        Host: authority,
        ...(proxy.auth
          ? { 'Proxy-Authorization': `Basic ${Buffer.from(proxy.auth).toString('base64')}` }
          : {}),
      },
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    connect.on('error', (error) => finish(error))
    connect.on('connect', async (res, socket, head) => {
      tunnel = socket
      socket.on('error', (error) => finish(error))
      if (finished) return socket.destroy()
      if (res.statusCode !== 200) return finish(new Error(`代理入口返回 HTTP ${res.statusCode}`))
      try {
        await onTunnel?.(socket)
        if (finished) return
        if (head.length) socket.unshift(head)
        secure = tls.connect({
          socket,
          servername: net.isIP(hostname) ? undefined : hostname,
          rejectUnauthorized: true,
          ca,
        })
        secure.on('error', (error) => finish(error))
        agent = new https.Agent({ keepAlive: false })
        agent.createConnection = () => secure
        request = https.request(
          url,
          {
            method: 'GET',
            agent,
            headers: {
              'User-Agent': 'Bin-ClashBoard-Diagnostics',
              'Accept-Encoding': 'identity',
              Connection: 'close',
            },
          },
          (res) => {
            response = res
            let bytes = 0
            const chunks = []
            const bodyStarted = performance.now()
            const result = (limited) => ({
              status: res.statusCode,
              bytes,
              limited,
              elapsedMs: performance.now() - started,
              downloadMs: performance.now() - bodyStarted,
              body: collect ? Buffer.concat(chunks).toString('utf8') : '',
            })
            // A redirect is reported, never followed to a different target.
            res.on('data', (chunk) => {
              const accepted = chunk.subarray(0, Math.max(0, maxBytes - bytes))
              bytes += accepted.length
              if (collect) chunks.push(accepted)
              if (bytes >= maxBytes) finish(null, result(true))
            })
            res.on('end', () => finish(null, result(false)))
            res.on('error', (error) => finish(error))
            res.on('aborted', () => finish(new Error('下载中断，请重试')))
          },
        )
        request.on('error', (error) => finish(error))
        request.end()
      } catch (error) {
        finish(error)
      }
    })
    connect.end()
  })
}

export function selectProbeNodes(nodes, name, runtime = {}) {
  const selected = new Map()
  const visiting = new Set()
  const visit = (current) => {
    if (visiting.has(current)) throw new Error('节点的前置代理存在循环')
    if (selected.has(current) || ['DIRECT', 'REJECT'].includes(current)) return
    visiting.add(current)
    const candidates = nodes.filter((node) => node?.name === current)
    if (candidates.length > 1) throw new Error(`节点名称重复，无法确认检测对象：${current}`)
    let node = candidates[0]
    if (!node && runtime[current]?.now) {
      const next = runtime[current].now
      visit(next)
      node = { name: current, type: 'socks5' } // Replaced by a fixed selector below.
      selected.set(current, { name: current, type: 'select', proxies: [next] })
    } else {
      if (!node) throw new Error(`配置中找不到节点：${current}。请确认当前配置和订阅缓存已同步。`)
      if (node['dialer-proxy']) visit(node['dialer-proxy'])
      // Relative certificate/key files belong to the original host, not the probe host.
      for (const key of ['certificate', 'private-key']) {
        if (node[key] && !String(node[key]).includes('-----BEGIN'))
          throw new Error('该节点使用外部证书文件，无法进行独立检测')
      }
      selected.set(current, { ...node })
    }
    visiting.delete(current)
  }
  visit(name)
  return [...selected.values()]
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })


// Mihomo 先绑定监听端口、后完成代理初始化：端口刚可连时就发 CONNECT 会先拿到 200，
// 随后隧道被 RST（表现为「TLS 连接在建立前断开」）。所以用内核自己打印的监听日志
// 作为「代理已可服务」的就绪信号，而不是只看 TCP 是否可连。
const PROXY_SERVING_PATTERN = /proxy listening at/i
export const isProxyServing = (log) => PROXY_SERVING_PATTERN.test(String(log || ''))
export async function withProbe(
  { binary, tempRoot, nodes, name, runtime, signal, spawnCore = spawn },
  run,
) {
  const selected = selectProbeNodes(nodes, name, runtime)
  if (!selected.length) throw new Error('请选择一个实际代理节点')
  // 部分订阅的节点名带首尾空格，而内核解析规则时会 trim，导致 MATCH 找不到代理、探测内核直接退出。
  // 这里统一 trim，保证 proxies / proxy-groups / rules 引用的是同一个名字。
  const probeName = String(name).trim()
  const probeNodes = selected.map((entry) => ({
    ...entry,
    name: String(entry.name ?? '').trim(),
    ...(Array.isArray(entry.proxies)
      ? { proxies: entry.proxies.map((item) => String(item ?? '').trim()) }
      : {}),
  }))
  // 面板所在网络的 DNS 常被内核 fake-ip 接管，节点域名必须先换成真实地址，
  // 否则探测内核会去连 198.18.x，或者拿不到只有 AAAA 的节点。
  const resolvedNodes = await Promise.all(
    probeNodes.map(async (node) => {
      if (node.type === 'select' || !node.server || net.isIP(node.server)) return node
      const { address, resolved } = await resolveServerAddress(node.server, signal)
      if (!resolved || address === node.server) return node
      // 保留 SNI：原域名写回 servername，避免 TLS / REALITY 用 IP 当 SNI
      return { ...node, server: address, servername: node.servername || node.server }
    }),
  )
  await fs.access(binary).catch(() => {
    throw new Error('缺少独立检测内核，请安装项目配套的 Mihomo')
  })
  await fs.mkdir(tempRoot, { recursive: true })
  const directory = await fs.mkdtemp(path.join(tempRoot, 'node-'))
  let child,
    exited = false
  try {
    const port = await freePort()
    const auth = `probe:${randomBytes(24).toString('hex')}`
    const config = {
      'mixed-port': port,
      'allow-lan': false,
      'bind-address': '127.0.0.1',
      authentication: [auth],
      mode: 'rule',
      ipv6: true,
      'log-level': 'silent',
      'external-controller': '',
      'find-process-mode': 'off',
      // 独立 DNS：不用系统解析器（会被内核 fake-ip 接管），改用加密 DNS，
      // normal 模式直接返回真实地址，不做 fake-ip。
      dns: {
        enable: true,
        ipv6: true,
        'enhanced-mode': 'normal',
        'respect-rules': false,
        'default-nameserver': ['223.5.5.5', '119.29.29.29'],
        nameserver: ['https://1.1.1.1/dns-query', 'https://223.5.5.5/dns-query'],
        'proxy-server-nameserver': ['https://1.1.1.1/dns-query', 'https://223.5.5.5/dns-query'],
      },
      tun: { enable: false },
      proxies: resolvedNodes.filter((node) => node.type !== 'select'),
      'proxy-groups': resolvedNodes.filter((node) => node.type === 'select'),
      rules: [`MATCH,${probeName}`],
    }
    if (probeName.includes(',') || /[\r\n]/.test(probeName))
      throw new Error('节点名称含有规则分隔符，无法进行独立检测')
    const configPath = path.join(directory, 'config.json')
    await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
    child = spawnCore(binary, ['-d', directory, '-f', configPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let coreLog = ''
    const collectCoreLog = (chunk) => {
      if (coreLog.length < 64_000) coreLog += chunk.toString()
    }
    child.stdout?.on('data', collectCoreLog)
    child.stderr?.on('data', collectCoreLog)
    let startError
    child.on('error', (error) => {
      startError = error
      exited = true
    })
    child.on('exit', () => {
      exited = true
    })
    let ready = false
    let readySince = 0
    for (let attempt = 0; attempt < 200; attempt++) {
      signal?.throwIfAborted()
      if (exited)
        throw new Error(
          startError ? '检测内核启动失败' : '检测内核拒绝了节点配置，请检查协议及依赖文件',
        )
      ready = await new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port })
        socket.setTimeout(60)
        const done = (value) => {
          socket.destroy()
          resolve(value)
        }
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
        socket.once('timeout', () => done(false))
      })
      if (ready) {
        if (!readySince) readySince = Date.now()
        // 端口可连不代表代理链路已就绪：等到内核自己报告 mixed 端口开始监听，
        // 或兜底 1.2s（老版本内核日志格式变化时不至于一直等）。
        if (isProxyServing(coreLog) || Date.now() - readySince > 1200) break
      }
      await delay(25, undefined, { signal })
    }
    if (!ready) throw new Error('检测内核启动超时')
    return await run({ host: '127.0.0.1', port, auth })
  } finally {
    if (child && !exited) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 2000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill()
      })
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const serverAddressCache = new Map()

/**
 * 面板所在网络的 DNS 往往被内核 fake-ip 接管：域名会被解析成 198.18.x，
 * 只有 AAAA 的节点甚至查不到记录。这里用加密 DNS（DoH）拿真实地址，并缓存 5 分钟。
 */
export async function resolveServerAddress(server, signal) {
  if (!server || net.isIP(server)) return { address: server, resolved: false }
  const cached = serverAddressCache.get(server)
  if (cached && cached.expires > Date.now()) return cached
  for (const [type, record] of [
    ['A', 1],
    ['AAAA', 28],
  ]) {
    try {
      const response = await fetch(
        `https://1.1.1.1/dns-query?name=${encodeURIComponent(server)}&type=${type}`,
        {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(4000)].filter(Boolean)),
        },
      )
      if (!response.ok) continue
      const data = await response.json()
      const answer = (data.Answer || []).find((entry) => entry.type === record)
      if (!answer?.data) continue
      const value = { address: answer.data, resolved: true, expires: Date.now() + 300_000 }
      serverAddressCache.set(server, value)
      if (serverAddressCache.size > 200)
        serverAddressCache.delete(serverAddressCache.keys().next().value)
      return value
    } catch {
      // 加密 DNS 不可用时保持原域名，退回原有行为
    }
  }
  return { address: server, resolved: false }
}

export function normalizeIntelligence(data, radar = null) {
  if (!net.isIP(data?.ip || '')) throw new Error('IP 情报服务没有返回有效的出口 IP')
  const flags = Object.fromEntries(
    ['is_bogon', 'is_proxy', 'is_vpn', 'is_tor', 'is_datacenter', 'is_abuser', 'is_crawler'].map(
      (key) => [key, typeof data[key] === 'boolean' ? data[key] : null],
    ),
  )
  return {
    ip: data.ip,
    country: String(data.country || ''),
    city: String(data.city || ''),
    asn: [data.asn && `AS${data.asn}`, data.asOrganization].filter(Boolean).join(' · '),
    company: String(data.company_name || data.isp || ''),
    trustScore:
      typeof data.trust_score === 'number' && data.trust_score >= 0 && data.trust_score <= 100
        ? data.trust_score
        : null,
    registeredCountry: String(data.registered_country || ''),
    native:
      data.countryCode && data.registered_country_code
        ? String(data.countryCode).toLowerCase() ===
          String(data.registered_country_code).toLowerCase()
        : null,
    abuseLevel: String(data.intelligence?.abuser_level || ''),
    abuseScore: String(data.intelligence?.abuser_score_raw || data.abuser_score || ''),
    threats: Array.isArray(data.intelligence?.threats)
      ? data.intelligence.threats.filter((value) => typeof value === 'string').slice(0, 20)
      : null,
    httpThreat:
      typeof data.intelligence?.rep_threat === 'number' ? data.intelligence.rep_threat : null,
    rpki: ['valid', 'invalid', 'notfound'].includes(String(data.rpki_status).toLowerCase())
      ? String(data.rpki_status).toLowerCase()
      : '',
    humanTraffic:
      radar?.ok === true &&
      typeof radar.human === 'number' &&
      typeof radar.bot === 'number' &&
      radar.human >= 0 &&
      radar.human <= 100 &&
      radar.bot >= 0 &&
      radar.bot <= 100 &&
      Math.abs(radar.human + radar.bot - 100) < 1
        ? {
            human: radar.human,
            bot: radar.bot,
            range: String(radar.range || ''),
            stale: radar.stale === true,
            updatedAt:
              typeof radar.fetched_at === 'number'
                ? new Date(radar.fetched_at * 1000).toISOString()
                : null,
          }
        : null,
    flags,
    source: 'Net.Coffee',
    reportUrl: `https://ip.net.coffee/ip/${encodeURIComponent(data.ip)}`,
    checkedAt: new Date().toISOString(),
  }
}

async function coffeeJson(suffix, signal, timeoutMs = 25_000) {
  const response = await fetch(`https://ip.net.coffee/api/${suffix}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)),
    headers: { Accept: 'application/json', 'User-Agent': 'Bin-ClashBoard-Diagnostics' },
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Net.Coffee 查询失败（HTTP ${response.status}），请稍后重试`)
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Net.Coffee 暂未提供 JSON 数据，请通过完整报告查看')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 512_000) throw new Error('Net.Coffee 响应过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function testNode(proxy, kind, signal) {
  if (kind === 'download') {
    const result = await proxyGet(proxy, DOWNLOAD_URL, {
      signal,
      collect: false,
      maxBytes: DOWNLOAD_BYTES,
    })
    if (result.status !== 200 || result.bytes !== DOWNLOAD_BYTES)
      throw new Error(`下载未完成（HTTP ${result.status}，${result.bytes} 字节），本次结果无效`)
    return {
      bytes: result.bytes,
      elapsedMs: result.elapsedMs,
      mbps: (result.bytes * 8) / result.elapsedMs / 1000,
      checkedAt: new Date().toISOString(),
      source: 'Cloudflare',
      direction: 'download',
    }
  }
  const result = await proxyGet(proxy, 'https://ip.net.coffee/cdn-cgi/trace', {
    signal,
    maxBytes: 16_000,
  })
  if (result.status !== 200 || result.limited)
    throw new Error(`无法获取节点出口（HTTP ${result.status}）`)
  const ip = result.body
    .split('\n')
    .find((line) => line.startsWith('ip='))
    ?.slice(3)
    .trim()
  if (!net.isIP(ip || '')) throw new Error('检测站点未返回有效的节点出口 IP')
  const data = await coffeeJson(`ip/lookup/${encodeURIComponent(ip)}`, signal)
  if (data.ip !== ip) throw new Error('Net.Coffee 返回的 IP 与节点出口不一致，本次结果无效')
  // Radar is ASN-wide historical data, not a measurement of this individual IP.
  const radar =
    Number.isSafeInteger(data.asn) && data.asn > 0
      ? await coffeeJson(`ipv2/radar/${data.asn}`, signal, 1200).catch(() => null)
      : null
  signal?.throwIfAborted()
  return normalizeIntelligence(data, radar)
}

export async function resolveEntry(server) {
  if (!server) return []
  return (await dns.lookup(server, { all: true })).map(({ address, family }) => ({
    address,
    family,
  }))
}

export function parseDhcpLeases(content) {
  return String(content)
    .split('\n')
    .flatMap((line) => {
      const [, mac, ip, name] = line.trim().split(/\s+/)
      return net.isIP(ip || '') && name && name !== '*' ? [{ ip, mac, name }] : []
    })
}

export async function loadDiagnosticNodeDependencies({
  name,
  nodes: initialNodes,
  providers,
  providerOwners,
  runtime,
  readProvider,
}) {
  const nodes = [...initialNodes]
  const loaded = new Set()
  const visited = new Set()
  const loadProviders = async (names) => {
    const pending = names.filter(
      (providerName) => providers[providerName] && !loaded.has(providerName),
    )
    pending.forEach((providerName) => loaded.add(providerName))
    for (let offset = 0; offset < pending.length; offset += 4) {
      const batches = await Promise.all(
        pending
          .slice(offset, offset + 4)
          .map((providerName) => readProvider(providers[providerName])),
      )
      nodes.push(...batches.flat())
    }
  }
  const ensureNode = async (nodeName) => {
    if (visited.has(nodeName) || ['DIRECT', 'REJECT'].includes(nodeName)) return
    visited.add(nodeName)
    // The core's provider membership identifies the exact subscription;
    // node names alone are not used to guess a provider or credentials.
    await loadProviders(providerOwners.get(nodeName) || [])
    let matches = nodes.filter((node) => node?.name === nodeName)
    if (!matches.length && runtime[nodeName]?.now) {
      await ensureNode(runtime[nodeName].now)
      return
    }
    // Older cores may not expose provider membership. Keep the full read
    // as a compatibility fallback rather than omit a dialer dependency.
    if (!matches.length) {
      await loadProviders(Object.keys(providers))
      matches = nodes.filter((node) => node?.name === nodeName)
    }
    for (const node of matches) if (node['dialer-proxy']) await ensureNode(node['dialer-proxy'])
  }
  if (name) await ensureNode(name)
  else await loadProviders(Object.keys(providers))
  return nodes
}

// Share config reads between info/risk requests. Caller cancellation must not
// abort another caller's read. Secrets stay in memory, for a short bounded TTL.
export function createDiagnosticConfigCache({ ttlMs = 86_400_000, now = Date.now } = {}) {
  const values = new Map()
  const loading = new Map()
  return async (key, loader, signal, refresh = false) => {
    signal?.throwIfAborted()
    const cached = values.get(key)
    if (!refresh && cached && cached.expires > now()) return cached.value
    let task = loading.get(key)
    if (!task) {
      task = Promise.resolve()
        .then(() => loader(AbortSignal.timeout(15_000)))
        .then((value) => {
          values.delete(key)
          values.set(key, { value, expires: now() + ttlMs })
          if (values.size > 8) values.delete(values.keys().next().value)
          return value
        })
        .finally(() => loading.delete(key))
      loading.set(key, task)
    }
    if (!signal) return task
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      if (signal.aborted) abort()
    })
  }
}

// Keep isolated probes serial across all browsers, without rejecting a second
// query just because another client is still checking a node.
export function createProbeQueue() {
  const waiting = []
  let active = false
  const drain = () => {
    if (active || !waiting.length) return
    const job = waiting.shift()
    active = true
    job.signal?.removeEventListener('abort', job.abort)
    Promise.resolve()
      .then(() => {
        job.signal?.throwIfAborted()
        return job.operation()
      })
      .then(job.resolve, job.reject)
      .finally(() => {
        active = false
        drain()
      })
  }
  return (operation, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      if (waiting.length >= 32)
        return reject(Object.assign(new Error('等待检测的请求过多，请稍后刷新'), { status: 429 }))
      const job = { operation, signal, resolve, reject, abort: null }
      job.abort = () => {
        const index = waiting.indexOf(job)
        if (index !== -1) waiting.splice(index, 1)
        signal.removeEventListener('abort', job.abort)
        reject(signal.reason)
      }
      signal?.addEventListener('abort', job.abort, { once: true })
      waiting.push(job)
      drain()
    })
}

export function diagnosticsErrorMessage(error) {
  if (error.name === 'AbortError' || error.name === 'TimeoutError')
    return '检测等待或查询超时，请点刷新重试'
  if (/before secure TLS connection was established/.test(error.message || ''))
    return '节点到查询站点的 TLS 连接在建立前断开，请点刷新重试'
  return error.message || '检测失败'
}

export function registerDiagnostics(
  app,
  { readBackend, loadNodes, loadDevices, controllerFetch, binary, tempRoot, runProbe = withProbe },
) {
  const enqueueProbe = createProbeQueue()
  const endpoint = (operation) => async (req, res) => {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 55_000)
    res.once('close', () => abort.abort())
    try {
      const backend = readBackend(req.body?.backendUuid)
      const result = await operation(req.body || {}, backend, abort.signal)
      if (!res.destroyed) res.json(result)
    } catch (error) {
      if (!res.destroyed)
        res.status(error.status || 400).json({ message: diagnosticsErrorMessage(error) })
    } finally {
      clearTimeout(timeout)
    }
  }
  app.post(
    '/api/diagnostics/devices',
    endpoint(async (_, backend) => ({ devices: await loadDevices(backend) })),
  )
  app.post(
    '/api/diagnostics/node',
    endpoint(async (body, backend, signal) => {
      const { name, kind } = body
      if (
        typeof name !== 'string' ||
        !name ||
        name.length > 512 ||
        !['info', 'intelligence', 'download'].includes(kind)
      )
        throw new Error('无效的节点检测请求')
      const started = performance.now()
      const { nodes, runtime } = await loadNodes(backend, signal, {
        refresh: body.refresh === true,
        name,
      })
      const configMs = Math.round(performance.now() - started)
      const selected = selectProbeNodes(nodes, name, runtime)
      const node = selected.find((entry) => entry.name === name)
      if (!node || node.type === 'select') throw new Error('请选择实际节点，不支持对策略组检测')
      if (kind === 'info') {
        let addresses = [],
          dnsError = ''
        try {
          addresses = await resolveEntry(node.server)
        } catch {
          dnsError = '面板服务器无法解析入口域名'
        }
        return {
          server: node.server || '',
          port: node.port || '',
          protocol: node.type,
          udp: node.udp ?? null,
          addresses,
          dnsError,
          checkedAt: new Date().toISOString(),
          timing: { configMs, totalMs: Math.round(performance.now() - started) },
        }
      }
      return enqueueProbe(async () => {
        const value = await runProbe({ binary, tempRoot, nodes, name, runtime, signal }, (proxy) =>
          testNode(proxy, kind, signal),
        )
        return { ...value, timing: { configMs, totalMs: Math.round(performance.now() - started) } }
      }, signal)
    }),
  )
  app.post(
    '/api/diagnostics/route',
    endpoint(async (body, backend, signal) => {
      const input = String(body.target || '').trim()
      if (!input || input.length > 2048) throw new Error('请输入有效域名或 HTTPS 地址')
      const url = new URL(input.includes('://') ? input : `https://${input}`)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443')
      )
        throw new Error('真实路由检测仅支持不含凭据的 HTTPS 443 地址')
      const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        !hostname.includes('.')
      )
        throw new Error('请输入公网域名')
      const addresses = await dns.lookup(hostname, { all: true })
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicAddress(address) && !isKernelFakeIp(address))
      )
        throw new Error('真实路由检测不支持私网、环回及保留地址')
      const config = await (await controllerFetch(backend, '/configs', { signal })).json()
      const port = Number(config['mixed-port'] || config.port)
      if (!(port > 0 && port < 65536))
        throw new Error('内核未开放 HTTP / mixed 代理端口，仍可查看下方真实连接记录')
      let evidence = null
      const startedAt = Date.now()
      const result = await proxyGet(
        { host: backend.host, port, auth: process.env.ZASHBOARD_DIAGNOSTICS_PROXY_AUTH || '' },
        url.href,
        {
          signal,
          collect: false,
          maxBytes: 64_000,
          onTunnel: async (socket) => {
            for (let attempt = 0; attempt < 4; attempt++) {
              const data = await (await controllerFetch(backend, '/connections', { signal })).json()
              // Require the same source address, port, destination and a recent start.
              // NAT or clock skew can prevent attribution; return no evidence in that case.
              evidence =
                (data.connections || []).find((connection) =>
                  matchesProbeConnection(connection, socket, hostname, startedAt),
                ) || null
              if (evidence) break
              await delay(100, undefined, { signal })
            }
          },
        },
      )
      return {
        status: result.status,
        elapsedMs: result.elapsedMs,
        checkedAt: new Date().toISOString(),
        evidence,
        source: '面板服务器 → 内核 HTTP 代理入口',
        target: url.href,
      }
    }),
  )
}

function canonicalProbeIP(address) {
  if (!net.isIP(address || '')) return ''
  if (net.isIP(address) === 4) {
    const bytes = address.split('.').map(Number)
    address = `::ffff:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
  }
  return new URL(`http://[${address}]/`).hostname
}

export function matchesProbeConnection(connection, socket, hostname, startedAt) {
  const source = canonicalProbeIP(socket.localAddress)
  const start = Date.parse(connection.start)
  return (
    Boolean(source) &&
    source === canonicalProbeIP(connection.metadata?.sourceIP) &&
    Number(socket.localPort) > 0 &&
    String(connection.metadata?.sourcePort) === String(socket.localPort) &&
    Number.isFinite(start) &&
    start >= startedAt - 5000 &&
    start <= Date.now() + 5000 &&
    [
      connection.metadata?.host,
      connection.metadata?.sniffHost,
      connection.metadata?.destinationIP,
    ].some((value) => String(value || '').toLowerCase() === hostname)
  )
}

export function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  return (
    net.isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !address.toLowerCase().startsWith('2001:db8:')
  )
}

/**
 * mihomo / OpenClash 的 fake-ip 段（默认 198.18.0.0/15）。
 * 命中说明域名由内核代理解析，此时经内核 HTTP 代理探测反而能得到真实链路，
 * 因此不按「保留地址」拒绝。
 */
export function isKernelFakeIp(address) {
  if (net.isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return a === 198 && (b === 18 || b === 19)
}
