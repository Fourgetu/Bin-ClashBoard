<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
    <form
      class="mb-4 flex flex-wrap items-center gap-2"
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
      <button
        class="btn btn-primary btn-sm"
        :disabled="looking"
        type="submit"
      >
        {{ looking ? '查询中…' : '查询路由' }}
      </button>
      <button
        class="btn btn-sm"
        :disabled="probing || !target"
        type="button"
        @click="probe"
      >
        {{ probing ? '检测中…' : '检测真实访问' }}
      </button>
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
    <p
      v-if="!target"
      class="text-base-content/50 py-16 text-center text-sm"
    >
      输入访问目标，查看规则推演与内核真实路由
    </p>
    <template v-else>
      <div class="grid gap-4 xl:grid-cols-2">
        <article class="bg-base-100 border-base-content/5 rounded-2xl border">
          <header class="border-base-content/10 flex items-center gap-2 border-b p-4">
            <MapIcon class="text-base-content/50 size-5" />
            <div class="flex-1">
              <h2 class="text-sm font-semibold">
                规则路由
                <span
                  class="badge badge-xs ml-1"
                  :class="
                    prediction.certain ? 'badge-success badge-soft' : 'badge-warning badge-soft'
                  "
                  >{{ prediction.certain ? '已推演' : '待核实' }}</span
                >
              </h2>
              <p class="text-base-content/45 mt-1 text-xs">依据当前内核模式和规则顺序推演</p>
            </div>
          </header>
          <ol class="p-5">
            <li
              v-for="(step, index) in predictedSteps"
              :key="step.title"
              class="relative flex gap-3 pb-7 last:pb-0"
            >
              <div
                v-if="index < predictedSteps.length - 1"
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
            v-if="prediction.uncertain.length"
            class="border-base-content/10 mx-5 mb-4 border-t pt-3 text-xs"
          >
            <summary class="text-warning cursor-pointer">
              {{ prediction.uncertain.length }} 条前序规则需要额外上下文，结果仅供参考
            </summary>
            <p class="text-base-content/50 mt-2 leading-5 break-all">
              {{ prediction.uncertain.join('；') }}
            </p>
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
                  :class="actual ? 'badge-success badge-soft' : 'badge-ghost'"
                  >{{ actual ? '内核记录' : '等待连接' }}</span
                >
              </h2>
              <p class="text-base-content/45 mt-1 text-xs">
                {{ actual?.metadata.sourceIP || '尚无匹配设备连接'
                }}{{ actual ? ` · ${formatTime(actual.start)}` : '' }}
              </p>
            </div>
          </header>
          <ol
            v-if="actual"
            class="p-5"
          >
            <li
              v-for="(step, index) in actualSteps"
              :key="step.title"
              class="relative flex gap-3 pb-7 last:pb-0"
            >
              <div
                v-if="index < actualSteps.length - 1"
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
            请在目标设备访问此地址，连接出现后会自动展示。<br />未进入代理内核的旁路流量无法从 Clash
            API 观测。
          </div>
        </article>
      </div>
      <div
        v-if="probeResult"
        class="bg-base-100 mt-4 rounded-2xl p-4 text-sm"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">真实访问检测</span
          ><span class="badge badge-sm">HTTP {{ probeResult.status }}</span
          ><span class="text-base-content/50">{{ Math.round(probeResult.elapsedMs) }} ms</span>
        </div>
        <p class="mt-2 break-words">
          {{
            probeResult.evidence
              ? [...probeResult.evidence.chains].reverse().join(' → ')
              : '请求已完成，但未捕获与此次请求对应的内核链路'
          }}
        </p>
        <p
          v-if="probeResult.evidence"
          class="text-base-content/60 mt-1"
        >
          命中规则：{{ probeResult.evidence.rule }} {{ probeResult.evidence.rulePayload }}
        </p>
        <p class="text-base-content/45 mt-2 text-xs">
          {{ probeResult.source }} · {{ formatTime(probeResult.checkedAt) }}
        </p>
      </div>
      <p class="text-base-content/50 mt-4 text-xs leading-5">
        “检测真实访问”从面板服务器经内核 HTTP 代理发起，最多读取 64 KB，不模拟所选 LAN
        设备，也不能验证防火墙入口旁路。左右路由不同可能来自源 IP、DNS、进程规则或动态节点选择。
      </p>
      <div class="mt-5">
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
  </div>
</template>
<script setup lang="ts">
import {
  matchesRouteTarget,
  normalizeRouteTarget,
  predictRoute,
  selectedChain,
} from '@/helper/networkDiagnostics'
import { fetchServerApi } from '@/store/auth'
import { configs } from '@/store/config'
import { activeConnections, closedConnections } from '@/store/connections'
import { diagnosticsRequest } from '@/store/diagnostics'
import { proxyMap } from '@/store/proxies'
import { rules } from '@/store/rules'
import { activeUuid } from '@/store/setup'
import type { Connection } from '@/types'
import { BoltIcon, MagnifyingGlassIcon, MapIcon } from '@heroicons/vue/24/outline'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
const props = defineProps<{ initialTarget?: string; initialSource?: string }>()
const input = ref(props.initialTarget || ''),
  source = ref(props.initialSource || '')
const target = ref(''),
  lookupSource = ref(''),
  error = ref(''),
  selectedId = ref('')
const looking = ref(false),
  probing = ref(false)
const providers = ref<string[]>([])
let lookupController: AbortController | undefined, probeController: AbortController | undefined
type ProbeResult = {
  status: number
  elapsedMs: number
  checkedAt: string
  evidence: Connection | null
  source: string
}
const probeResult = ref<ProbeResult | null>(null)
const activeIds = computed(() => new Set(activeConnections.value.map((conn) => conn.id)))
const observed = computed(() =>
  target.value
    ? [...activeConnections.value, ...closedConnections.value]
        .filter((conn) => matchesRouteTarget(conn, target.value, lookupSource.value))
        .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    : [],
)
const actual = computed(
  () => observed.value.find((conn) => conn.id === selectedId.value) || observed.value[0],
)
const prediction = computed(() => {
  const mode = configs.value.mode.toLowerCase()
  if (mode === 'direct' || mode === 'global')
    return { rule: null, uncertain: [] as string[], certain: true }
  return predictRoute(rules.value, target.value, lookupSource.value, providers.value)
})
const predictedProxy = computed(() =>
  configs.value.mode.toLowerCase() === 'direct'
    ? 'DIRECT'
    : configs.value.mode.toLowerCase() === 'global'
      ? 'GLOBAL'
      : prediction.value.rule?.proxy || '',
)
const predictedSteps = computed(() => [
  {
    title: '发起访问',
    value: target.value,
    note: lookupSource.value ? `设备 IP：${lookupSource.value}` : '未指定来源设备',
  },
  {
    title: 'DNS 解析',
    value: '以目标域名 / IP 查询规则',
    note: '未对目标域名补做 DNS 推断；需要解析的 IP / GEO 规则标记为待核实',
  },
  {
    title: '业务入口',
    value: `内核模式：${configs.value.mode || '未知'}`,
    note: '防火墙 / TUN 入口状态需要路由器侧观测',
  },
  {
    title: '规则匹配',
    value: prediction.value.rule
      ? `${prediction.value.rule.type} · ${prediction.value.rule.payload || '兜底规则'}`
      : ['global', 'direct'].includes(configs.value.mode.toLowerCase())
        ? '当前模式跳过分流规则'
        : '无可确认匹配',
    note: prediction.value.certain
      ? '基于当前规则与已知条件'
      : '前序规则仍可能命中，以真实连接为准',
  },
  {
    title: '预计出口',
    value: selectedChain(predictedProxy.value, proxyMap.value).join(' → ') || '未确定',
    note: '策略当前选择可能随时间变化',
  },
])
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
      value: [conn.metadata.type, conn.metadata.network, conn.metadata.inboundName]
        .filter(Boolean)
        .join(' · '),
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
function cancelProbe() {
  probeController?.abort()
  probing.value = false
}
function reset() {
  lookupController?.abort()
  cancelProbe()
  target.value = ''
  providers.value = []
  probeResult.value = null
  selectedId.value = ''
  error.value = ''
  looking.value = false
}
watch([input, source, activeUuid], reset)
onUnmounted(reset)
onMounted(() => {
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
    const data = (await response.json()) as { matches?: { name: string }[] }
    if (!controller.signal.aborted)
      providers.value = (data.matches || []).map((match) => match.name)
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '无法查询规则集缓存'
  } finally {
    if (!controller.signal.aborted) looking.value = false
  }
}
async function probe() {
  if (probing.value || !target.value) return
  const controller = new AbortController()
  probeController = controller
  probing.value = true
  error.value = ''
  probeResult.value = null
  try {
    const result = await diagnosticsRequest<ProbeResult>(
      'route',
      { target: input.value },
      controller.signal,
    )
    if (!controller.signal.aborted) probeResult.value = result
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '真实访问检测失败'
  } finally {
    if (!controller.signal.aborted) probing.value = false
  }
}
</script>
