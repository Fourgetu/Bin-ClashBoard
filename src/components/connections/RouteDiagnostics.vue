<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
    <form
      class="mb-3 flex flex-wrap items-center gap-2"
      @submit.prevent="lookup"
    >
      <label class="input input-sm min-w-48 flex-1"
        ><MagnifyingGlassIcon class="size-4 opacity-50" /><input
          v-model="input"
          aria-label="路由目标"
          placeholder="输入域名、IP 或 HTTPS 地址"
      /></label>
      <input
        v-model="source"
        aria-label="来源设备 IP"
        placeholder="来源 IP（可选）"
        class="input input-sm w-48"
      />
      <span
        v-if="looking || probing"
        class="text-base-content/50 text-xs"
        >{{ looking ? '推演中…' : '检测真实路由中…' }}</span
      >
      <button
        v-if="probing"
        class="btn btn-ghost btn-sm"
        type="button"
        @click="cancelProbe"
      >
        停止
      </button>
    </form>
    <p
      v-if="error"
      role="alert"
      class="text-error mb-3 text-sm"
    >
      {{ error }}
    </p>

    <template v-if="target">
      <div class="mb-4 grid gap-4 xl:grid-cols-2">
        <article class="bg-base-100 border-base-content/5 rounded-2xl border">
          <header class="border-base-content/10 flex items-center gap-2 border-b p-4">
            <MapIcon class="text-base-content/50 size-5" />
            <div class="flex-1">
              <h2 class="text-sm font-semibold">
                规则路由
                <span
                  v-if="routeHit"
                  class="badge badge-success badge-xs ml-1"
                  >{{ routeHit.fromOracle ? '规则引擎' : '实测' }}</span
                >
                <span
                  v-else-if="probing"
                  class="badge badge-warning badge-soft badge-xs ml-1"
                  >判定中</span
                >
                <span
                  v-else
                  class="badge badge-xs ml-1"
                  :class="predictionTone"
                  >{{ predictionLabel }}</span
                >
                <span
                  v-if="routeHit && routeHit.ruleIndex >= 0"
                  class="text-base-content/50 ml-1 text-xs"
                  >命中第 {{ routeHit.ruleIndex + 1 }} 条规则</span
                >
                <span
                  v-else-if="!routeHit && prediction && prediction.index"
                  class="text-base-content/50 ml-1 text-xs"
                  >推演第 {{ prediction.index }} 条</span
                >
              </h2>
              <p class="text-base-content/45 mt-1 text-xs">
                {{ routeSubtitle }}
              </p>
            </div>
          </header>
          <ol class="p-5">
            <li
              v-for="(step, index) in routeSteps"
              :key="step.title"
              class="relative flex gap-3 pb-6 last:pb-0"
            >
              <div
                v-if="index < routeSteps.length - 1"
                class="border-primary/25 absolute top-6 bottom-0 left-3 border-l"
              />
              <span
                class="border-primary/40 text-primary z-1 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
                >{{ index + 1 }}</span
              >
              <div class="min-w-0">
                <p class="text-base-content/45 mb-1 text-xs">{{ step.title }}</p>
                <p class="text-sm break-words">{{ step.value }}</p>
                <p
                  v-if="step.note"
                  class="text-base-content/50 mt-1 text-xs leading-5 break-words"
                >
                  {{ step.note }}
                </p>
              </div>
            </li>
          </ol>
          <details
            v-if="!routeHit && prediction && prediction.uncertain.length"
            class="border-base-content/10 mx-5 mb-4 border-t pt-3 text-xs"
          >
            <summary class="text-warning cursor-pointer">
              {{ prediction.uncertain.length }} 条前序规则缺少端口 / 网络 / 入站上下文，结果仅供参考
            </summary>
            <ul class="text-base-content/50 mt-2 space-y-1 leading-5">
              <li
                v-for="item in prediction.uncertain.slice(0, 12)"
                :key="item.index"
                class="break-all"
              >
                #{{ item.index }} {{ item.rule.payload || '（无附加条件）' }} ·
                {{ item.unknown.join('；') || '无法判定' }}
              </li>
            </ul>
          </details>
        </article>
        <article class="bg-base-100 border-base-content/5 rounded-2xl border">
          <header class="border-base-content/10 flex items-center gap-2 border-b p-4">
            <BoltIcon class="text-base-content/50 size-5" />
            <div>
              <h2 class="text-sm font-semibold">
                真实路由
                <span
                  class="badge badge-xs ml-1"
                  :class="realRouteTone"
                  >{{ realRouteLabel }}</span
                >
              </h2>
              <p class="text-base-content/45 mt-1 text-xs">{{ realRouteSubtitle }}</p>
            </div>
          </header>
          <ol
            v-if="realRouteSteps.length"
            class="p-5"
          >
            <li
              v-for="(step, index) in realRouteSteps"
              :key="step.title"
              class="relative flex gap-3 pb-6 last:pb-0"
            >
              <div
                v-if="index < realRouteSteps.length - 1"
                class="border-success/30 absolute top-6 bottom-0 left-3 border-l"
              />
              <span
                class="border-success/50 text-success z-1 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
                >{{ index + 1 }}</span
              >
              <div class="min-w-0">
                <p class="text-base-content/45 mb-1 text-xs">{{ step.title }}</p>
                <p class="text-sm break-words">{{ step.value }}</p>
                <p
                  v-if="step.note"
                  class="text-base-content/50 mt-1 text-xs leading-5 break-words"
                >
                  {{ step.note }}
                </p>
              </div>
            </li>
          </ol>
          <div
            v-else
            class="text-base-content/50 px-6 py-14 text-center text-sm leading-7"
          >
            {{ probeError || '尚未获得真实路由结果，输入域名后会自动检测。' }}
          </div>
        </article>
      </div>

      <div
        v-if="penetrationGroups.length"
        class="bg-base-100 mb-4 rounded-2xl p-4"
      >
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold">规则集穿透</span>
          <span class="badge badge-sm badge-soft"
            >{{ penetrationHitCount }} / {{ penetrationGroups.length }} 个规则集真命中</span
          >
          <span class="text-base-content/45 text-xs">{{ queryHint }}</span>
          <span
            v-if="routeHit?.fromOracle"
            class="text-base-content/45 text-xs"
            >本节只列出面板规则源缓存中的条目；上方「规则引擎」结论已按内核本地规则集判定</span
          >
        </div>
        <div class="space-y-2">
          <details
            v-for="group in penetrationGroups"
            :key="group.name"
            class="bg-base-200/40 rounded-xl p-3"
          >
            <summary class="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <span class="font-medium">{{ group.name }}</span>
              <span class="badge badge-xs badge-soft">{{ group.totalRules }} 条规则</span>
              <span
                class="badge badge-xs"
                :class="
                  providerTrulyMatches(group, target)
                    ? 'badge-success badge-soft'
                    : 'badge-ghost'
                "
                >{{ providerTrulyMatches(group, target) ? '命中' : '仅相关' }}</span
              >
              <span class="text-base-content/50 text-xs">{{ group.matches.length }} 条条目</span>
            </summary>
            <ul class="text-base-content/70 mt-2 space-y-1 text-xs">
              <li
                v-for="entry in group.matches.slice(0, 20)"
                :key="`${entry.line}-${entry.raw}`"
                class="flex flex-wrap items-center gap-2 break-all"
              >
                <span class="badge badge-xs">{{ entry.mode || entry.type }}</span>
                <span
                  :class="
                    entryMatchesTarget(entry, target)
                      ? 'text-success font-medium'
                      : 'text-base-content/60'
                  "
                  >{{ entry.value || entry.raw }}</span
                >
              </li>
            </ul>
            <p
              v-if="group.matches.length > 20"
              class="text-base-content/45 mt-1 text-xs"
            >
              仅显示前 20 条相关条目
            </p>
          </details>
        </div>
      </div>

      <p class="text-base-content/50 mb-5 text-xs leading-5">
        真实路由由面板服务器经内核 HTTP 代理自动发起（最多读取 64 KB），不模拟所选 LAN
        设备，也不能验证防火墙入口旁路。左右路由不同可能来自源 IP、DNS、进程规则或动态节点选择。
      </p>
      <div class="mb-5">
        <h3 class="mb-2 text-sm font-medium">
          匹配连接 <span class="text-base-content/45">{{ observed.length }}</span>
        </h3>
        <div class="space-y-2">
          <button
            v-for="conn in observed.slice(0, 30)"
            :key="conn.id"
            class="bg-base-100 hover:bg-base-200 flex w-full flex-wrap items-center gap-2 rounded-xl p-3 text-left text-xs"
            :class="actual?.id === conn.id && 'ring-primary/40 ring-1'"
            @click="selectedId = conn.id"
          >
            <span>{{ conn.metadata.sourceIP || '本机' }}</span
            ><span class="text-base-content/50"
              >{{ conn.metadata.network }} · {{ formatTime(conn.start) }} ·
              {{ activeIds.has(conn.id) ? '活动中' : '已关闭' }}</span
            ><span class="min-w-0 flex-1 truncate text-right">{{
              [...conn.chains].reverse().join(' → ')
            }}</span>
          </button>
        </div>
      </div>
    </template>

    <section class="bg-base-100 border-base-content/5 mb-4 rounded-2xl border">
      <header
        class="border-base-content/10 flex flex-wrap items-center gap-2 border-b px-4 py-3"
      >
        <h2 class="text-sm font-semibold">
          规则顺序
          <span class="text-base-content/45 font-normal">{{ filteredRules.length }} / {{ rules.length }} 条</span>
        </h2>
        <label class="input input-sm ml-auto w-64"
          ><MagnifyingGlassIcon class="size-4 opacity-50" /><input
            v-model="keyword"
            aria-label="搜索规则"
            placeholder="搜索 域名 / IP / 关键字"
        /></label>
      </header>
      <p
        v-if="!rules.length"
        class="text-base-content/50 px-6 py-10 text-center text-sm"
      >
        尚未读取到内核规则，请确认面板已连接到内核 API。
      </p>
      <ol
        v-else
        class="divide-base-content/5 divide-y"
      >
        <li
          v-for="item in filteredRules"
          :key="`${item.rule.type}-${item.rule.payload}-${item.rule.proxy}-${item.index}`"
        >
          <button
            class="hover:bg-base-200/60 flex w-full flex-wrap items-start gap-2 px-4 py-3 text-left"
            :class="[
              prediction && prediction.index === item.index + 1 ? 'bg-primary/5' : '',
              selectedRuleIndex === item.index ? 'ring-primary/30 ring-1 ring-inset' : '',
            ]"
            @click="toggleRule(item.index)"
          >
            <span class="text-base-content/40 w-6 shrink-0 text-xs">{{ item.index + 1 }}</span>
            <span
              class="badge badge-xs shrink-0"
              :class="ruleTypeTone(item.rule.type)"
              >{{ ruleTypeLabel(item.rule.type) }}</span
            >
            <span class="min-w-0 flex-1 font-mono text-xs leading-5 break-all">{{
              item.rule.payload || '（无附加条件）'
            }}</span>
            <span
              class="badge badge-sm shrink-0"
              :class="actionTone(item.action.kind)"
              >{{ item.action.label }}</span
            >
            <span
              v-if="!item.terminal"
              class="badge badge-sm badge-ghost shrink-0"
              >不决定出口</span
            >
            <span
              v-if="prediction && prediction.index === item.index + 1"
              class="badge badge-sm badge-primary badge-soft shrink-0"
              >命中</span
            >
            <span
              v-else-if="item.unresolved.length"
              class="badge badge-sm badge-ghost shrink-0"
              >待核实</span
            >
          </button>
          <div
            v-if="selectedRuleIndex === item.index"
            class="bg-base-200/30 border-base-content/5 mx-4 mb-3 rounded-xl border p-3 text-xs"
          >
            <p class="mb-2 font-medium">条件明细</p>
            <ul class="mb-3 space-y-1">
              <li
                v-for="(condition, index) in conditionRows(item.rule)"
                :key="index"
                class="flex flex-wrap items-center gap-2"
              >
                <span
                  class="badge badge-xs"
                  :class="condition.state === true ? 'badge-success badge-soft' : condition.state === false ? 'badge-error badge-soft' : 'badge-ghost'"
                  >{{ condition.state === true ? '命中' : condition.state === false ? '不命中' : '待核实' }}</span
                >
                <span class="font-mono break-all">{{ condition.text }}</span>
                <span
                  v-if="condition.mappedTo"
                  class="badge badge-xs badge-info badge-soft"
                  >→ {{ condition.mappedTo }}</span
                >
              </li>
            </ul>
            <p
              v-if="ruleSetsOf(item.rule).length"
              class="text-base-content/50 mb-1"
            >
              引用规则集：{{ ruleSetsOf(item.rule).join('、') }}
            </p>
            <p class="text-base-content/45">
              出站：{{ item.rule.proxy || '未指定'
              }}<span v-if="item.action.garbled">（名称含乱码，内核写入时不是 UTF-8）</span>
            </p>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
<script setup lang="ts">
import {
  isTerminalAction,
  matchRule,
  parseRuleAction,
  parseRuleGroup,
  predictSingboxRoute,
  extractRuleSets,
  ruleMatchesKeyword,
  type RuleAction,
} from '@/helper/singboxRule'
import { matchesRouteTarget, normalizeRouteTarget, predictRoute, selectedChain } from '@/helper/networkDiagnostics'
import { fetchServerApi } from '@/store/auth'
import { configs } from '@/store/config'
import { activeConnections, closedConnections } from '@/store/connections'
import { diagnosticsRequest } from '@/store/diagnostics'
import { fetchProxies, proxyMap } from '@/store/proxies'
import { fetchRules, rules } from '@/store/rules'
import { activeUuid } from '@/store/setup'
import type { Connection, Rule } from '@/types'
import { BoltIcon, MagnifyingGlassIcon, MapIcon } from '@heroicons/vue/24/outline'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { debounce } from 'lodash'

const props = defineProps<{ initialTarget?: string; initialSource?: string }>()

type PenetrationEntry = { line?: number; value?: string; mode?: string; type?: string; raw?: string }
type PenetrationGroup = { name: string; totalRules: number; matches: PenetrationEntry[] }
type RouteDecision = {
  ruleIndex: number
  ruleType: string
  rulePayload: string
  target: string
  incomplete: boolean
  missingProviders: string[]
  droppedRules: string[]
  decidedAt: string
  cached?: boolean
}
type RouteHit = {
  ruleIndex: number
  ruleType: string
  rulePayload: string
  group: string
  chains: string[]
  node: string
  fromOracle: boolean
  incomplete: boolean
  missingProviders: string[]
  droppedRules: number
}
type ProbeResult = {
  status: number | null
  elapsedMs: number
  checkedAt: string
  evidence: Connection | null
  source: string
  hostname?: string
  oracle?: RouteDecision | null
  oracleError?: string
  attribution?: { matchedBy: string; ambiguous: boolean; degraded: boolean } | null
  hit?: RouteHit | null
}

const input = ref(props.initialTarget || '')
const source = ref(props.initialSource || '')
const target = ref('')
const lookupSource = ref('')
const error = ref('')
const selectedId = ref('')
const keyword = ref('')
const selectedRuleIndex = ref(-1)
const looking = ref(false)
const probing = ref(false)
const probeResult = ref<ProbeResult | null>(null)
const ruleResult = ref<ProbeResult | null>(null)
const probeError = ref('')
const penetrationGroups = ref<PenetrationGroup[]>([])
const matchedProviders = ref<string[] | null>(null)
const queried = ref(false)
let lookupController: AbortController | undefined
let probeController: AbortController | undefined

const activeIds = computed(() => new Set(activeConnections.value.map((conn) => conn.id)))

const isSingboxRules = computed(() =>
  rules.value.some((rule) => ['default', 'logical'].includes((rule.type || '').toLowerCase())),
)
const cachedProviderNames = computed(() => {
  const names = new Set<string>()
  for (const group of penetrationGroups.value) names.add(group.name)
  return [...names]
})

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** sing-box 的 rule_set 名（geosite-*、obflip-*）与缓存规则集名可能不同，按名称包含关系推断 */
const ruleSetCandidates = computed(() => {
  const names = new Set<string>()
  for (const group of penetrationGroups.value) names.add(group.name)
  for (const name of cachedProviderNames.value) names.add(name)
  return [...names].sort((a, b) => b.length - a.length)
})

function resolveRuleSet(name: string) {
  const key = normalizeKey(name)
  if (!key) return ''
  for (const candidate of ruleSetCandidates.value) {
    const candidateKey = normalizeKey(candidate)
    if (candidateKey.length >= 2 && key.includes(candidateKey)) return candidate
  }
  return ''
}

/**
 * 服务端的规则集检索是「双向」的：除了「规则能命中目标」，还会返回「目标是规则条目的父域」
 * （例如查 youtube.com 会返回 ads_domain 里的 ads.youtube.com，用于规则集穿透展示）。
 * 推演只能采用真实匹配方向，否则 ads_domain 这类规则集会被误判为命中。
 */
function entryMatchesTarget(entry: PenetrationEntry, query: string) {
  const mode = (entry.mode || '').toLowerCase()
  if (mode.startsWith('ip-cidr')) return true
  const value = (entry.value || '').trim().toLowerCase().replace(/\.$/, '')
  const host = (query || '').trim().toLowerCase().replace(/\.$/, '')
  if (!value || !host) return false
  if (mode === 'keyword') return host.includes(value)
  if (mode === 'domain') return host === value
  return host === value || host.endsWith(`.${value}`)
}

/** 只有存在「真命中」条目的规则集才会让对应 RuleSet 规则命中 */
function providerTrulyMatches(group: PenetrationGroup, query: string) {
  return (group.matches || []).some((entry) => entryMatchesTarget(entry, query))
}

/** 收集「真命中」的规则集：既包含缓存里的名字，也包含内核规则中引用的 rule-set 名 */
function collectTrulyMatchedProviders(query: string) {
  const names = new Set<string>()
  for (const group of penetrationGroups.value) {
    if (providerTrulyMatches(group, query)) names.add(group.name)
  }
  for (const rule of rules.value) {
    for (const name of extractRuleSets(rule)) {
      const provider = resolveRuleSet(name)
      if (provider && names.has(provider)) names.add(name)
    }
  }
  return [...names]
}
/**

 * 传给内核推演的规则集命中集合。
 * 缓存没有命中任何规则集时返回 undefined，让 rule_set 条件保持「待核实」而不是误判为不命中。
 */
const effectiveRuleSets = computed<string[] | undefined>(() => {
  const matched = matchedProviders.value
  if (!matched || matched.length === 0) return undefined
  const names = new Set(matched)
  for (const rule of rules.value)
    for (const name of extractRuleSets(rule)) {
      const provider = resolveRuleSet(name)
      if (provider && matched.includes(provider)) names.add(name)
    }
  return [...names]
})

const prediction = computed(() => {
  if (!target.value) return null
  if (isSingboxRules.value)
    return predictSingboxRoute(rules.value, target.value, {
      sourceIP: lookupSource.value,
      matchedRuleSets: effectiveRuleSets.value,
    })
  const legacy = predictRoute(rules.value, target.value, lookupSource.value, matchedProviders.value || [])
  return legacy
    ? {
        index: legacy.rule ? rules.value.indexOf(legacy.rule) + 1 : 0,
        rule: legacy.rule,
        action: parseRuleAction(legacy.rule?.proxy || ''),
        uncertain: legacy.uncertain.map((payload, index) => ({
          index: index + 1,
          rule: { type: 'mihomo', payload, proxy: '', size: 0, uuid: '', index } as Rule,
          unknown: [] as string[],
        })),
        certain: legacy.certain,
      }
    : null
})

const predictionLabel = computed(() => {
  if (!prediction.value) return '待查询'
  if (prediction.value.action.kind === 'reject') return '已拦截'
  return prediction.value.certain ? '已推演' : '待核实'
})
const predictionTone = computed(() => {
  const state = prediction.value
  if (!state) return 'badge-ghost'
  if (state.action.kind === 'reject') return 'badge-error badge-soft'
  return state.certain ? 'badge-success badge-soft' : 'badge-warning badge-soft'
})

const predictedSteps = computed(() => {
  const state = prediction.value
  const action = state?.action
  const chain = action && action.kind === 'proxy' ? selectedChain(action.target, proxyMap.value) : []
  return [
    {
      title: '发起访问',
      value: target.value || '（未填写目标）',
      note: lookupSource.value ? `设备 IP：${lookupSource.value}` : '未指定来源设备',
    },
    {
      title: '规则匹配',
      value: state?.index
        ? `第 ${state.index} 条 · ${state.rule?.type} · ${state.rule?.payload || '（无附加条件）'}`
        : '没有规则命中，将落到兜底策略',
      note: state?.certain ? '基于当前规则与已知条件' : '前序规则缺少端口 / 网络 / 入站上下文，仍可能命中',
    },
    {
      title: '策略目标',
      value: action ? action.label : '未知',
      note: action?.garbled ? '出站名在内核里不是 UTF-8，无法还原原始名称' : '',
    },
    {
      title: '最终出口',
      value:
        action?.kind === 'reject'
          ? '已拦截，不发出流量'
          : action?.kind === 'direct'
            ? '本地直连（不经代理）'
            : chain.length
              ? chain.join(' → ')
              : action?.kind === 'proxy'
                ? action.target
                : '未确定',
      note: action?.kind === 'proxy' ? '策略当前选择可能随时间变化' : '',
    },
  ]
})

const filteredRules = computed(() =>
  rules.value
    .map((rule, index) => ({ rule, index }))
    .filter((item) => ruleMatchesKeyword(item.rule, keyword.value))
    .map((item) => {
      const action = parseRuleAction(item.rule.proxy)
      const unresolved = extractRuleSets(item.rule).filter((name) => !resolveRuleSet(name))
      return { ...item, action, unresolved, terminal: isTerminalAction(action) }
    }),
)

/** 真正会让 RuleSet 规则命中的规则集数量（服务端检索结果含「仅相关」条目） */
const penetrationHitCount = computed(() =>
  target.value
    ? penetrationGroups.value.filter((group) => providerTrulyMatches(group, target.value)).length
    : 0,
)

const queryHint = computed(() =>
  matchedProviders.value && matchedProviders.value.length
    ? `规则集缓存按「${target.value || keyword.value}」检索`
    : '规则集缓存未命中，相关条件标记为待核实',
)

const observed = computed(() =>
  target.value
    ? [...activeConnections.value, ...closedConnections.value]
        .filter((conn) => matchesRouteTarget(conn, target.value, lookupSource.value))
        .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    : [],
)
const actual = computed(() => observed.value.find((conn) => conn.id === selectedId.value) || observed.value[0])
const actualSteps = computed(() => {
  const conn = actual.value
  if (!conn) return []
  return [
    {
      title: '发起访问',
      value: `${conn.metadata.sourceIP || '本机'} → ${conn.metadata.host || conn.metadata.destinationIP}`,
      note: conn.metadata.process || '',
    },
    {
      title: 'DNS / 目标地址',
      value: conn.metadata.destinationIP || '内核未上报 IP',
      note: conn.metadata.dnsMode || '内核未上报 DNS 模式',
    },
    {
      title: '业务入口',
      value: [conn.metadata.type, conn.metadata.network, conn.metadata.inboundName].filter(Boolean).join(' · '),
      note: '此连接已进入代理内核',
    },
    {
      title: '实际命中规则',
      value: [conn.rule, conn.rulePayload].filter(Boolean).join(' · ') || '内核未上报',
      note: '',
    },
    {
      title: '真实出站链路',
      value: [...conn.chains].reverse().join(' → ') || '内核未上报',
      note: conn.metadata.remoteDestination ? `远端：${conn.metadata.remoteDestination}` : '',
    },
  ]
})

const formatTime = (time: string) => new Date(time).toLocaleString()
const actionTone = (kind: RuleAction['kind']) =>
  kind === 'reject'
    ? 'badge-error badge-soft'
    : kind === 'direct'
      ? 'badge-success badge-soft'
      : kind === 'proxy'
        ? 'badge-info badge-soft'
        : 'badge-ghost'

const RULE_TYPE_LABELS: Record<string, string> = {
  domain: '域名',
  domainsuffix: '域名后缀',
  domainkeyword: '域名关键字',
  domainregex: '域名正则',
  ipcidr: 'IP 段',
  ipcidr6: 'IPv6 段',
  srcipcidr: '来源 IP 段',
  srcipcidr6: '来源 IPv6 段',
  geoip: '地区 IP',
  geosite: '地区域名',
  ruleset: '规则集',
  dstport: '目标端口',
  srcport: '来源端口',
  processname: '进程名',
  processpath: '进程路径',
  network: '网络',
  protocol: '协议',
  match: '兜底',
  final: '兜底',
}

/** sing-box 只有 default/logical，mihomo 则是 DomainSuffix、IPCIDR 等驼峰写法 */
function ruleTypeLabel(type: string) {
  const normalized = (type || '').toLowerCase().replace(/[-_]/g, '')
  if (normalized === 'logical') return '逻辑'
  if (normalized === 'default') return '默认'
  return RULE_TYPE_LABELS[normalized] || type
}

function ruleTypeTone(type: string) {
  const normalized = (type || '').toLowerCase().replace(/[-_]/g, '')
  if (normalized === 'logical') return 'badge-warning badge-soft'
  if (normalized === 'default') return 'badge-ghost'
  return 'badge-info badge-soft'
}

function ruleSetsOf(rule: Rule) {
  return extractRuleSets(rule)
}

function conditionRows(rule: Rule) {
  const group = parseRuleGroup(rule.payload || '')
  if (!group) return []
  return group.conditions.map((condition) => {
    const text = `${condition.negate ? '!' : ''}${condition.field}=${condition.values.join(' ') || '(空)'}`
    let state: boolean | null = null
    if (target.value) {
      const match = matchRule(
        { ...rule, payload: text } as Rule,
        target.value,
        { sourceIP: lookupSource.value, matchedRuleSets: effectiveRuleSets.value },
      )
      state = match.state
    }
    const mappedTo = condition.field === 'rule_set' ? condition.values.map((name) => resolveRuleSet(name)).filter(Boolean).join('、') : ''
    return { text, state, mappedTo }
  })
}

function toggleRule(index: number) {
  selectedRuleIndex.value = selectedRuleIndex.value === index ? -1 : index
}

function cancelProbe() {
  probeController?.abort()
  probing.value = false
}
function reset() {
  lookupController?.abort()
  cancelProbe()
  target.value = ''
  probeResult.value = null
  probeError.value = ''
  selectedId.value = ''
  error.value = ''
  looking.value = false
  penetrationGroups.value = []
  matchedProviders.value = null
  queried.value = false
}

watch(activeUuid, () => {
  selectedRuleIndex.value = -1
  reset()
})

/** 输入即自动推演，不再需要点「查询路由」；不在此处清空结果，避免面板闪一下 */
const scheduleLookup = debounce(() => {
  if (input.value.trim()) void lookup()
}, 400)
watch(input, () => {
  selectedRuleIndex.value = -1
  scheduleLookup()
})
watch(source, () => {
  if (input.value.trim()) void lookup()
})
onUnmounted(reset)

onMounted(() => {
  void fetchRules()
  void fetchProxies()
  if (input.value) void lookup()
})

async function lookup() {
  reset()
  target.value = normalizeRouteTarget(input.value)
  lookupSource.value = source.value.trim()
  if (!target.value) {
    error.value = '请输入有效的域名、IP 或网址'
    return
  }
  const controller = new AbortController()
  lookupController = controller
  looking.value = true
  try {
    const response = await fetchServerApi('/api/rule-provider-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: target.value, rules: rules.value }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('规则集缓存查询失败；仍展示本地规则和真实连接')
    const data = (await response.json()) as { matches?: PenetrationGroup[] }
    if (controller.signal.aborted) return
    penetrationGroups.value = (data.matches || []).map((match) => ({
      name: match.name,
      totalRules: match.totalRules || 0,
      matches: match.matches || [],
    }))
    matchedProviders.value = collectTrulyMatchedProviders(target.value)
    queried.value = true
    void probe()
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '无法查询规则集缓存'
  } finally {
    if (!controller.signal.aborted) looking.value = false
  }
}

async function probe() {
  if (!target.value) return
  probeController?.abort()
  const controller = new AbortController()
  probeController = controller
  probing.value = true
  probeError.value = ''
  probeResult.value = null
  ruleResult.value = null
  try {
    // 规则判定：只读本地规则与规则集，不访问目标站点，未访问过的域名同样可判。
    const decided = await diagnosticsRequest<ProbeResult>(
      'route',
      { target: input.value, mode: 'rule' },
      controller.signal,
    )
    if (!controller.signal.aborted) ruleResult.value = decided
  } catch {
    // 规则判定失败不阻塞下面的真实探测
  }
  try {
    const result = await diagnosticsRequest<ProbeResult>(
      'route',
      { target: input.value, mode: 'both' },
      controller.signal,
    )
    if (!controller.signal.aborted) probeResult.value = result
  } catch (cause) {
    if (!controller.signal.aborted)
      probeError.value = cause instanceof Error ? cause.message : '真实路由检测失败'
  } finally {
    if (!controller.signal.aborted) probing.value = false
  }
}

const probeSteps = computed(() => {
  const probe = probeResult.value
  if (!probe) return []
  const hit = probe.hit
  return [
    {
      title: '自动发起探测',
      value: `面板服务器 → ${target.value}`,
      note: `${probe.source} · 用时 ${Math.round(probe.elapsedMs)} ms · ${formatTime(probe.checkedAt)}`,
    },
    {
      title: '响应结果',
      value: probe.status == null ? '未发起（仅规则判定）' : `HTTP ${probe.status}`,
      note:
        probe.status == null
          ? '规则判定完成，未发起真实请求'
          : probe.status >= 200 && probe.status < 400
            ? '目标可达，请求已按内核规则转发'
            : '目标返回异常状态码，请求同样经过内核',
    },
    {
      title: '真实出站链路',
      value: hit?.chains?.length
        ? [...hit.chains].reverse().join(' → ')
        : '未捕获到本次探测对应的内核连接',
      note: hit?.chains?.length
        ? `命中规则：${[hit.ruleType, hit.rulePayload].filter(Boolean).join(' · ')}${
            probe.attribution?.matchedBy === 'docker-nat' ? ' · 经 Docker NAT 归属' : ''
          }${probe.attribution?.ambiguous ? ' · 存在多条候选，仅供参考' : ''} · 出口节点：${hit.node || '—'}`
        : probe.attribution?.degraded
          ? '无法读取内核连接列表，本次未做归属'
          : 'Docker NAT 会改写源地址导致归属失败，可参考下方「匹配连接」或改用规则引擎结果',
    },
  ]
})

const routeHit = computed<RouteHit | null>(() => probeResult.value?.hit || ruleResult.value?.hit || null)
const routeRuleText = computed(() => {
  const hit = routeHit.value
  if (!hit) return ''
  return hit.rulePayload ? `${hit.ruleType}(${hit.rulePayload})` : hit.ruleType || '未知规则'
})
const routeSteps = computed(() => {
  const hit = routeHit.value
  if (!hit) return predictedSteps.value
  const chainText = hit.chains.length ? [...hit.chains].reverse().join(' → ') : hit.group || '—'
  return [
    {
      title: '发起访问',
      value: target.value || hit.group || '—',
      note: hit.fromOracle
        ? '规则引擎只读本地规则与规则集，不访问目标站点，任意域名都能判'
        : '规则命中来自内核实测连接',
    },
    {
      title: '规则匹配',
      value: hit.ruleIndex >= 0 ? `第 ${hit.ruleIndex + 1} 条 · ${routeRuleText.value}` : routeRuleText.value,
      note: hit.incomplete
        ? '前序存在需要端口 / 网络上下文的规则，实际结果可能不同'
        : '按内核规则顺序取第一条命中',
    },
    {
      title: '策略目标',
      value: hit.group || '—',
      note: hit.droppedRules > 0
        ? `${hit.droppedRules} 条规则集缺少本地缓存，已跳过`
        : '规则指向的策略组',
    },
    {
      title: '最终出口',
      value: chainText,
      note: hit.chains.length ? '实测链路：规则组 → 子策略 → 出口节点' : '尚未取得实测链路，此处为规则目标',
    },
  ]
})
const routeSubtitle = computed(() => {
  if (routeHit.value?.fromOracle) return '规则引擎判定 · 只读本地规则与规则集 · 不访问目标站点'
  if (routeHit.value) return '命中的规则来自内核实测连接'
  return '按内核顺序逐条推演（无规则引擎结果时仅供参考）'
})

const realRouteSteps = computed(() =>
  probeResult.value ? probeSteps.value : actualSteps.value,
)
const realRouteLabel = computed(() => {
  if (probing.value) return '检测中'
  if (probeResult.value)
    return probeResult.value.status ? `HTTP ${probeResult.value.status}` : '规则已判定'
  if (probeError.value) return '检测失败'
  if (actual.value) return '内核记录'
  return '等待检测'
})
const realRouteTone = computed(() => {
  if (probing.value) return 'badge-warning badge-soft'
  if (probeResult.value) return 'badge-success badge-soft'
  if (probeError.value) return 'badge-error badge-soft'
  if (actual.value) return 'badge-info badge-soft'
  return 'badge-ghost'
})
const realRouteSubtitle = computed(() => {
  if (probing.value) return '正在经内核代理自动探测目标'
  if (probeResult.value?.evidence)
    return `${probeResult.value.evidence.metadata.sourceIP || '面板服务器'} 已产生对应连接 · ${formatTime(probeResult.value.checkedAt)}`
  if (probeResult.value) return `${probeResult.value.source} · ${formatTime(probeResult.value.checkedAt)}`
  if (probeError.value) return probeError.value
  if (actual.value) return `${actual.value.metadata.sourceIP || '本机'} · ${formatTime(actual.value.start)}`
  return '输入域名后自动检测'
})
</script>
