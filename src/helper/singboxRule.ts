import ipaddr from 'ipaddr.js'
import type { Rule } from '@/types'

/**
 * sing-box 内核的 /rules 与 mihomo 完全不同：
 * - type 只有 default / logical
 * - payload 是 sing-box 的匹配条件文本，例如
 *   `rule_set=geosite-ai && network=udp port=443`、
 *   `domain=[a.com b.com] domain_suffix=[c.com]`、
 *   `!(domain_regex=^[^:]*[a-z][^:]*$)`、`ip_is_private=true`
 * - proxy 是动作：`route(策略名)` / `reject` / `direct` / `hijack-dns` / `sniff`
 *
 * 该模块把这些文本解析成结构化条件，并按内核顺序逐条推演目标路由。
 */

export const GARBLED_MARK = '\uFFFD'

export type RuleCondition = {
  field: string
  negate: boolean
  values: string[]
}

export type RuleGroup = {
  conditions: RuleCondition[]
  logic: 'and' | 'or'
}

export type RuleActionKind = 'reject' | 'direct' | 'proxy' | 'dns' | 'sniff' | 'unknown'

export type RuleAction = {
  kind: RuleActionKind
  label: string
  /** 策略 / 出站名，直连与拦截归一为 DIRECT / REJECT */
  target: string
  /** 出站名含乱码：内核写入的非 UTF-8 名称无法还原 */
  garbled: boolean
}

export type MatchState = true | false | null

export type RuleMatch = {
  state: MatchState
  unknown: string[]
}

const FIELD_PATTERN = /([a-z0-9_]+)=/gi

/** 把 `a=1 b=[x y]` 切成若干 field=value 条件 */
export function parseConditionToken(token: string, negateAll: boolean): RuleCondition[] {
  const conditions: RuleCondition[] = []
  let cursor = 0
  while (cursor < token.length) {
    FIELD_PATTERN.lastIndex = cursor
    const found = FIELD_PATTERN.exec(token)
    if (!found) break
    const field = found[1].toLowerCase()
    let position = found.index + found[0].length
    let values: string[] = []
    if (token[position] === '[') {
      const end = token.indexOf(']', position)
      const body = token.slice(position + 1, end < 0 ? token.length : end)
      values = body.split(/\s+/).filter(Boolean)
      position = end < 0 ? token.length : end + 1
    } else {
      let end = token.indexOf(' ', position)
      if (end < 0) end = token.length
      const bare = token.slice(position, end).trim()
      values = bare ? [bare] : []
      position = end
    }
    conditions.push({ field, negate: negateAll, values })
    cursor = position + 1
  }
  return conditions
}

function stripOuter(value: string) {
  let text = value.trim()
  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim()
  return text
}

/** 顶层按 && / || 切分，忽略 [] 与 () 内部的操作符 */
export function splitTopLevel(payload: string): { logic: 'and' | 'or'; parts: string[] } {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let logic: 'and' | 'or' = 'and'
  for (let i = 0; i < payload.length; i += 1) {
    const char = payload[i]
    if (char === '[' || char === '(') depth += 1
    else if (char === ']' || char === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (payload.startsWith('&&', i) || payload.startsWith('||', i))) {
      if (payload.startsWith('||', i)) logic = 'or'
      if (current.trim()) parts.push(current.trim())
      current = ''
      i += 1
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return { logic, parts }
}

export function parseRuleGroup(payload: string): RuleGroup | null {
  if (!payload.trim()) return null
  const { logic, parts } = splitTopLevel(payload)
  const conditions: RuleCondition[] = []
  for (const part of parts) {
    let token = part.trim()
    let negate = false
    if (token.startsWith('!')) {
      negate = true
      token = token.replace(/^!\s*/, '')
    }
    conditions.push(...parseConditionToken(stripOuter(token), negate))
  }
  return conditions.length ? { conditions, logic } : null
}

/** 内核动作文本 → 语义化动作 */
export function parseRuleAction(proxy: string): RuleAction {
  const raw = (proxy || '').trim()
  const lower = raw.toLowerCase()
  if (!raw) return { kind: 'unknown', label: '未指定', target: '', garbled: false }
  if (lower.startsWith('reject'))
    return { kind: 'reject', label: '拦截', target: 'REJECT', garbled: false }
  if (lower === 'direct' || lower === 'route(direct)')
    return { kind: 'direct', label: '直连', target: 'DIRECT', garbled: false }
  if (lower === 'hijack-dns' || lower === 'dns' || lower === 'resolve')
    return { kind: 'dns', label: 'DNS 劫持', target: raw, garbled: false }
  if (lower === 'sniff') return { kind: 'sniff', label: '协议嗅探', target: raw, garbled: false }
  const routeMatch = /^(?:route|outbound)\(\s*(.*?)\s*\)$/i.exec(raw)
  const target = routeMatch ? routeMatch[1] : raw
  const garbled = target.includes(GARBLED_MARK)
  if (garbled) return { kind: 'proxy', label: '内置出站', target, garbled: true }
  if (['直连', 'direct', 'direct-out'].includes(target.toLowerCase()))
    return { kind: 'direct', label: '直连', target: 'DIRECT', garbled: false }
  if (['拦截', 'block', 'reject', 'reject-drop'].includes(target.toLowerCase()))
    return { kind: 'reject', label: '拦截', target: 'REJECT', garbled: false }
  return { kind: 'proxy', label: target, target, garbled: false }
}

/** 是否为终态动作：只有终态动作才决定最终出口（sniff / hijack-dns / dnsmasq 等仍会继续匹配） */
export function isTerminalAction(action: RuleAction) {
  if (action.kind === 'reject' || action.kind === 'direct') return true
  // route(a,b) 这类带参数的动作用于 DNS/特殊处理，不决定出口
  if (action.kind === 'proxy') return !action.target.includes(',')
  return false
}

const IP_FIELDS = new Set(['ip_cidr', 'ipcidr', 'src_ip_cidr', 'srcipcidr'])
const DOMAIN_FIELDS = new Set(['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'])

export function isIPTarget(target: string) {
  try {
    return ipaddr.isValid(target)
  } catch {
    return false
  }
}

function matchDomainCondition(field: string, values: string[], target: string, isIP: boolean): MatchState {
  const host = target.toLowerCase().replace(/\.$/, '')
  if (!host) return null
  // sing-box 中 IP 目标不会命中任何域名类条件（含 domain_regex）
  if (isIP) return false
  switch (field) {
    case 'domain':
      return values.some((value) => value.toLowerCase().replace(/\.$/, '') === host)
    case 'domain_suffix':
      return values.some((value) => {
        const suffix = value.toLowerCase().replace(/^\./, '')
        return host === suffix || host.endsWith(`.${suffix}`)
      })
    case 'domain_keyword':
      return values.some((value) => host.includes(value.toLowerCase()))
    case 'domain_regex':
      return values.some((value) => {
        try {
          return new RegExp(value, 'i').test(host)
        } catch {
          return false
        }
      })
    default:
      return null
  }
}

function matchIPCondition(values: string[], address: string): MatchState {
  if (!isIPTarget(address)) return null
  try {
    const parsed = ipaddr.process(address)
    return values.some((value) => {
      try {
        if (value.includes('/')) {
          const [network, prefix] = ipaddr.parseCIDR(value)
          return network.kind() === parsed.kind() && parsed.match(network, prefix)
        }
        const single = ipaddr.process(value)
        return single.kind() === parsed.kind() && single.toString() === parsed.toString()
      } catch {
        return false
      }
    })
  } catch {
    return null
  }
}

function evaluateCondition(
  condition: RuleCondition,
  target: string,
  options: { sourceIP?: string; matchedRuleSets?: string[] },
  isIP: boolean,
): MatchState {
  const { field, values } = condition
  let state: MatchState = null
  if (DOMAIN_FIELDS.has(field)) state = matchDomainCondition(field, values, target, isIP)
  else if (IP_FIELDS.has(field)) {
    const address = field.startsWith('src') ? options.sourceIP || '' : target
    state = address ? matchIPCondition(values, address) : null
  } else if (field === 'ip_is_private') {
    if (!isIP) state = false
    else {
      try {
        state = ipaddr.process(target).range() === 'private'
      } catch {
        state = null
      }
    }
  } else if (field === 'rule_set') {
    if (!options.matchedRuleSets) state = null
    else state = values.some((value) => options.matchedRuleSets!.includes(value))
  } else if (field === 'final') state = true
  if (condition.negate && state !== null) state = !state
  return state
}

/**
 * 判定单条规则对给定目标的结果。
 * true=命中，false=确定不命中，null=缺少上下文（端口/网络/进程/入站等）无法判定
 */
export function matchRule(
  rule: Rule,
  target: string,
  options: { sourceIP?: string; matchedRuleSets?: string[] } = {},
): RuleMatch {
  const payload = (rule.payload || '').trim()
  const type = (rule.type || '').toLowerCase()
  if (!payload) return { state: type === 'logical' ? null : true, unknown: [] }
  const group = parseRuleGroup(payload)
  if (!group) return { state: null, unknown: [payload] }
  const isIP = isIPTarget(target)
  const unknown: string[] = []
  const states = group.conditions.map((condition) => {
    const state = evaluateCondition(condition, target, options, isIP)
    if (state === null)
      unknown.push(`${condition.negate ? '!' : ''}${condition.field}=${condition.values.join(' ') || '(空)'}`)
    return state
  })
  if (group.logic === 'or') {
    if (states.some((state) => state === true)) return { state: true, unknown: [] }
    return states.every((state) => state === false)
      ? { state: false, unknown: [] }
      : { state: null, unknown }
  }
  if (states.some((state) => state === false)) return { state: false, unknown: [] }
  return states.every((state) => state === true)
    ? { state: true, unknown: [] }
    : { state: null, unknown }
}

export type UncertainRule = { index: number; rule: Rule; unknown: string[] }

export type RoutePrediction = {
  /** 命中的规则序号（1 起），0 表示未命中任何规则 */
  index: number
  rule: Rule | null
  action: RuleAction
  uncertain: UncertainRule[]
  certain: boolean
}

/** 按内核顺序推演目标命中的第一条规则 */
export function predictSingboxRoute(
  rules: Rule[],
  target: string,
  options: { sourceIP?: string; matchedRuleSets?: string[] } = {},
): RoutePrediction | null {
  if (!target) return null
  const uncertain: UncertainRule[] = []
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    if (rule.disabled || rule.extra?.disabled) continue
    const action = parseRuleAction(rule.proxy)
    // sniff / hijack-dns / dnsmasq 等非终态动作不决定出口，跳过并继续匹配
    if (!isTerminalAction(action)) continue
    const match = matchRule(rule, target, options)
    if (match.state === true)
      return {
        index: index + 1,
        rule,
        action,
        uncertain,
        certain: uncertain.length === 0,
      }
    if (match.state === null) uncertain.push({ index: index + 1, rule, unknown: match.unknown })
  }
  return {
    index: 0,
    rule: null,
    action: { kind: 'unknown', label: '兜底策略', target: '', garbled: false },
    uncertain,
    certain: false,
  }
}

/** 规则引用的规则集名称 */
export function extractRuleSets(rule: Rule | null): string[] {
  if (!rule) return []
  const group = parseRuleGroup(rule.payload || '')
  if (!group) return []
  const names = new Set<string>()
  for (const condition of group.conditions)
    if (condition.field === 'rule_set') condition.values.forEach((value) => names.add(value))
  return [...names]
}

export function ruleMatchesKeyword(rule: Rule, keyword: string) {
  const text = keyword.trim().toLowerCase()
  if (!text) return true
  return `${rule.type} ${rule.payload} ${rule.proxy}`.toLowerCase().includes(text)
}

/** 规则集名称是否是 Open-Box / sing-box 的内置 geosite 分类 */
export function isGeositeRuleSet(name: string) {
  return name.startsWith('geosite-') || name.startsWith('geosite:')
}
