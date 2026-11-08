import ipaddr from 'ipaddr.js'
import type { Connection, Proxy, Rule } from '../types/index.d.ts'

export function canonicalIP(value: string) {
  try {
    return ipaddr.process(value).toString()
  } catch {
    return value || '本机 / 未知来源'
  }
}
export function groupDeviceConnections(connections: Connection[]) {
  const groups = new Map<
    string,
    {
      ip: string
      connections: Connection[]
      download: number
      upload: number
      downloadSpeed: number
      uploadSpeed: number
    }
  >()
  for (const connection of connections) {
    const ip = canonicalIP(connection.metadata.sourceIP)
    const group = groups.get(ip) || {
      ip,
      connections: [],
      download: 0,
      upload: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
    }
    group.connections.push(connection)
    group.download += connection.download
    group.upload += connection.upload
    group.downloadSpeed += Math.max(0, connection.downloadSpeed)
    group.uploadSpeed += Math.max(0, connection.uploadSpeed)
    groups.set(ip, group)
  }
  return [...groups.values()].sort(
    (a, b) => b.connections.length - a.connections.length || a.ip.localeCompare(b.ip),
  )
}
export function normalizeRouteTarget(input: string) {
  const value = input.trim()
  if (!value) return ''
  if (ipaddr.isValid(value)) return canonicalIP(value)
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
  } catch {
    return ''
  }
}
export function matchesRouteTarget(connection: Connection, target: string, sourceIP = '') {
  if (sourceIP && canonicalIP(connection.metadata.sourceIP) !== canonicalIP(sourceIP)) return false
  return [
    connection.metadata.host,
    connection.metadata.sniffHost,
    connection.metadata.destinationIP,
  ].some((value) => value && normalizeRouteTarget(value) === target)
}
export function selectedChain(name: string, proxies: Record<string, Proxy>) {
  const chain: string[] = []
  let current = name
  while (current && chain.length < 20) {
    if (chain.includes(current)) {
      chain.push('循环引用')
      break
    }
    chain.push(current)
    const node = proxies[current]
    if (node?.all?.length && !node.now) {
      chain.push('由内核动态选择')
      break
    }
    current = node?.now || node?.['dialer-proxy'] || ''
  }
  return chain
}

export function predictRoute(
  rules: Rule[],
  target: string,
  sourceIP = '',
  matchedProviders: string[] = [],
) {
  const uncertain: string[] = []
  const normalized = target.toLowerCase()
  const typeOfIP = ipaddr.isValid(target) ? ipaddr.process(target) : null
  for (const rule of rules) {
    if (rule.disabled || rule.extra?.disabled) continue
    const type = rule.type.toLowerCase().replace(/-/g, '')
    const payload = rule.payload.toLowerCase()
    let match: boolean | null = null
    if (type === 'domain') match = normalized === payload
    else if (type === 'domainsuffix')
      match = normalized === payload || normalized.endsWith(`.${payload}`)
    else if (type === 'domainkeyword') match = !typeOfIP && normalized.includes(payload)
    else if (type === 'match' || type === 'final') match = true
    else if (type === 'ruleset') match = matchedProviders.includes(rule.payload) ? true : null
    else if (['ipcidr', 'ipcidr6', 'srcipcidr'].includes(type)) {
      const value = type === 'srcipcidr' ? sourceIP : target
      try {
        if (ipaddr.isValid(value)) {
          const address = ipaddr.process(value)
          const [network, prefix] = ipaddr.parseCIDR(rule.payload)
          match = address.kind() === network.kind() && address.match(network, prefix)
        }
      } catch {
        match = null
      }
    }
    if (match === null) uncertain.push(`${rule.type}${rule.payload ? ` · ${rule.payload}` : ''}`)
    if (match) return { rule, uncertain, certain: uncertain.length === 0 }
  }
  return { rule: null, uncertain, certain: false }
}
