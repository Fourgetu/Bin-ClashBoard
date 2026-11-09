<template>
  <Teleport to="body">
    <div
      v-if="selection"
      id="node-diagnostics-popover"
      ref="panel"
      role="dialog"
      :aria-label="selection.name + ' 节点检测'"
      tabindex="-1"
      class="bg-base-100 text-base-content border-base-content/10 fixed z-[100] flex h-[368px] w-[304px] max-w-[calc(100vw-24px)] flex-col gap-2 overflow-hidden rounded-3xl border p-3 text-[11px] shadow-xl outline-none"
      :style="position"
      @mouseenter="keepNodeDiagnosticsOpen"
      @mouseleave="scheduleNodeDiagnosticsClose"
      @focusin="keepNodeDiagnosticsOpen"
      @focusout="scheduleNodeDiagnosticsClose"
      @keydown.esc.stop.prevent="dismiss"
    >
      <header class="flex h-5 shrink-0 items-center gap-1.5">
        <span
          class="text-xs font-semibold"
          :title="selection.name"
          >{{ tabs.find((item) => item.key === tab)?.label }}</span
        >
        <button
          v-if="tab !== 'download'"
          type="button"
          class="hover:bg-base-200 flex size-5 items-center justify-center rounded-full"
          :disabled="busy"
          :aria-label="tab === 'latency' ? '重新检测延迟' : '刷新查询'"
          :title="tab === 'latency' ? '重新检测延迟' : '刷新查询'"
          @click="refreshTab"
        >
          <span
            v-if="busy"
            class="loading loading-spinner loading-xs"
          />
          <BoltIcon
            v-else-if="tab === 'latency'"
            class="size-3.5"
          />
          <ArrowPathIcon
            v-else
            class="size-3.5"
          />
        </button>
        <button
          type="button"
          class="hover:bg-base-200 ml-auto flex size-5 items-center justify-center rounded-full"
          aria-label="关闭节点检测"
          @click="dismiss"
        >
          <XMarkIcon class="size-3.5" />
        </button>
      </header>
      <div class="node-diagnostics-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <p
          v-if="error"
          role="alert"
          class="text-error break-words"
        >
          {{ error }}
        </p>

        <div
          v-if="tab === 'latency'"
          class="py-1"
        >
          <p
            v-if="!history.length"
            class="text-base-content/40 py-7 text-center"
          >
            {{ busy ? '检测中…' : '暂无记录' }}
          </p>
          <div
            v-for="(entry, index) in history"
            :key="entry.time + '-' + index"
            class="grid grid-cols-[124px_12px_1fr] items-center gap-1.5"
          >
            <time class="text-base-content/65 py-1.5 whitespace-nowrap">{{
              formatTime(entry.time)
            }}</time>
            <div class="border-base-content/15 relative h-full border-l">
              <span
                class="absolute top-2 -left-[4.5px] size-2 rounded-full"
                :class="entry.delay > 0 ? 'bg-success' : 'bg-error'"
              />
            </div>
            <div
              :class="entry.delay > 0 ? 'text-success' : 'text-error'"
              class="flex items-center gap-2 whitespace-nowrap"
            >
              <span
                class="h-1 shrink-0 rounded-full"
                :class="entry.delay > 0 ? 'bg-success/40' : 'bg-error/40'"
                :style="{
                  width: (entry.delay > 0 ? Math.max(3, Math.min(30, entry.delay / 8)) : 20) + 'px',
                }"
              />
              {{ entry.delay > 0 ? entry.delay + 'ms' : '失败 / 超时' }}
            </div>
          </div>
        </div>

        <div
          v-else-if="tab === 'download'"
          class="flex h-full flex-col justify-center gap-2 py-1"
        >
          <div class="py-5 text-center">
            <div class="text-3xl font-light tabular-nums">
              {{ results.download ? results.download.mbps.toFixed(2) : '—' }}
              <span class="text-base-content/45 text-[11px]">Mbps</span>
            </div>
            <div
              v-if="results.download"
              class="text-base-content/45 mt-2"
              :title="formatTime(results.download.checkedAt)"
            >
              {{ (results.download.mbps / 8).toFixed(2) }} MB/s ·
              {{ (results.download.bytes / 1_000_000).toFixed(0) }} MB
            </div>
          </div>
          <button
            class="btn btn-sm h-7 min-h-7 text-[11px]"
            :class="!busy && 'btn-primary'"
            title="仅下载，最多 10 MB，最长 30 秒"
            :disabled="busy && runningKind !== 'download'"
            @click="runningKind === 'download' ? cancelNodeDownload() : run('download')"
          >
            <span
              v-if="busy"
              class="loading loading-spinner loading-xs"
            />
            <ArrowDownTrayIcon
              v-else
              class="size-3.5"
            />
            {{
              runningKind === 'download' ? '停止测速' : busy ? '查询中…' : '开始下载测速 · 10 MB'
            }}
          </button>
        </div>

        <dl
          v-else-if="tab === 'info'"
          class="grid grid-cols-[60px_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-1 leading-4"
        >
          <dt class="text-base-content/45">协议</dt>
          <dd>{{ node?.type || '—' }}</dd>
          <dt class="text-base-content/45">服务器</dt>
          <dd class="break-all">
            {{ results.info?.server ? results.info.server + ':' + results.info.port : '—' }}
          </dd>
          <dt class="text-base-content/45">入口 IPv4</dt>
          <dd class="break-all">{{ addresses(4) }}</dd>
          <dt class="text-base-content/45">入口 IPv6</dt>
          <dd class="break-all">{{ addresses(6) }}</dd>
          <dt class="text-base-content/45">UDP</dt>
          <dd>{{ node?.udp ? '支持' : '未启用' }}</dd>
          <dt class="text-base-content/45 border-base-content/10 mt-1 border-t pt-2">出口 IPv4</dt>
          <dd class="border-base-content/10 mt-1 border-t pt-2 break-all">
            {{
              results.intelligence?.ip && !results.intelligence.ip.includes(':')
                ? results.intelligence.ip
                : '—'
            }}
          </dd>
          <dt class="text-base-content/45">出口 IPv6</dt>
          <dd class="break-all">
            {{ results.intelligence?.ip.includes(':') ? results.intelligence.ip : '—' }}
          </dd>
          <dt class="text-base-content/45">归属地</dt>
          <dd>
            {{
              [results.intelligence?.country, results.intelligence?.city]
                .filter(Boolean)
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(' · ') || '—'
            }}
          </dd>
          <dt class="text-base-content/45">ASN</dt>
          <dd class="break-words">{{ results.intelligence?.asn || '—' }}</dd>
          <dt class="text-base-content/45">运营机构</dt>
          <dd class="break-words">{{ results.intelligence?.company || '—' }}</dd>
          <dt class="text-base-content/45">IP 类型</dt>
          <dd>{{ results.intelligence?.flags.is_datacenter === true ? '数据中心' : '—' }}</dd>
          <dt class="text-base-content/45">信任评分</dt>
          <dd class="flex items-center gap-2">
            <progress
              v-if="results.intelligence?.trustScore != null"
              class="progress progress-success w-16"
              :value="results.intelligence.trustScore"
              max="100"
            />{{
              results.intelligence?.trustScore != null
                ? results.intelligence.trustScore + ' / 100'
                : '—'
            }}
          </dd>
          <dt class="text-base-content/45">原生 IP</dt>
          <dd :title="results.intelligence?.registeredCountry">
            {{
              results.intelligence?.native == null
                ? '—'
                : results.intelligence.native
                  ? '原生'
                  : '广播'
            }}
          </dd>
        </dl>

        <div
          v-else
          class="flex flex-col gap-2 py-1"
        >
          <div class="font-semibold">IP 情报</div>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 leading-4">
            <dt class="text-base-content/45">风险标记</dt>
            <dd
              class="text-right break-words"
              :class="threatClass"
            >
              {{ threatLabel }}
            </dd>
            <dt class="text-base-content/45">滥用等级</dt>
            <dd
              class="text-right"
              :class="abuseClass"
              :title="results.intelligence?.abuseScore"
            >
              {{ abuseLabel }}
            </dd>
            <dt class="text-base-content/45">HTTP 蜜罐黑名单</dt>
            <dd
              class="text-right"
              :class="results.intelligence?.httpThreat ? 'text-error' : 'text-base-content/45'"
            >
              {{ httpThreatLabel }}
            </dd>
            <dt class="text-base-content/45">RPKI 状态</dt>
            <dd
              class="text-right"
              :class="rpkiClass"
            >
              {{ rpkiLabel }}
            </dd>
          </dl>
          <dl
            class="border-base-content/10 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t pt-2 leading-4"
          >
            <template
              v-for="flag in riskFlags"
              :key="flag.key"
            >
              <dt class="text-base-content/45">{{ flag.label }}</dt>
              <dd
                class="text-right"
                :class="
                  flagValue(flag.key) === true
                    ? 'text-error'
                    : flagValue(flag.key) === false
                      ? 'text-success'
                      : 'text-base-content/45'
                "
              >
                {{
                  flagValue(flag.key) === null
                    ? '暂无数据'
                    : flagValue(flag.key)
                      ? '已检测到'
                      : '未检测到'
                }}
              </dd>
            </template>
          </dl>
          <div
            class="flex items-center gap-1.5 text-[10px] whitespace-nowrap"
            :title="trafficTitle"
          >
            <span class="text-base-content/45">人机流量（估算）</span>
            <template v-if="results.intelligence?.humanTraffic">
              <span class="text-success"
                >人类 {{ trafficPercent(results.intelligence.humanTraffic.human) }}%</span
              >
              <div class="flex h-1.5 min-w-4 flex-1 overflow-hidden rounded-sm bg-[#ff8e98]">
                <div
                  class="bg-[#95b880]"
                  :style="{ width: results.intelligence.humanTraffic.human + '%' }"
                />
              </div>
              <span class="text-error"
                >机器 {{ trafficPercent(results.intelligence.humanTraffic.bot) }}%</span
              >
            </template>
            <span
              v-else
              class="text-base-content/45 ml-auto"
              >暂无数据</span
            >
          </div>
          <div class="text-base-content/45 flex items-center justify-between gap-2 text-[10px]">
            <span :title="results.intelligence ? formatTime(results.intelligence.checkedAt) : ''">{{
              results.intelligence
                ? formatTime(results.intelligence.checkedAt).slice(5, 16) + ' 查询'
                : '尚未查询'
            }}</span>
            <a
              v-if="results.intelligence"
              :href="results.intelligence.reportUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
              >Net.Coffee 完整报告 ↗</a
            >
          </div>
        </div>
      </div>
      <div
        role="tablist"
        aria-label="节点检测类型"
        class="bg-base-200 flex shrink-0 rounded-full p-1"
      >
        <button
          v-for="item in tabs"
          :key="item.key"
          role="tab"
          :aria-selected="tab === item.key"
          :disabled="busy && runningKind === 'download'"
          class="flex-1 rounded-full px-1 py-1 text-[11px] transition-colors"
          :class="tab === item.key ? 'bg-primary text-primary-content' : 'text-base-content/55'"
          @click="selectTab(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import {
  diagnosticsBusy as busy,
  cancelNodeDownload,
  checkNode,
  closeNodeDiagnostics,
  currentNodeChecks,
  diagnosticsAnchor,
  keepNodeDiagnosticsOpen,
  currentNodeResults as results,
  scheduleNodeDiagnosticsClose,
  nodeDiagnostics as selection,
} from '@/store/diagnostics'
import { getHistoryByName, proxyMap } from '@/store/proxies'
import { ArrowDownTrayIcon, ArrowPathIcon, BoltIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const tabs = [
  { key: 'latency', label: '延时检测' },
  { key: 'download', label: '带宽检测' },
  { key: 'info', label: '节点信息' },
  { key: 'risk', label: '风险评估' },
] as const
const tab = ref<(typeof tabs)[number]['key']>('latency')
const runningKind = computed(() =>
  currentNodeChecks.value.download?.pending ? 'download' : 'metadata',
)
const error = computed(() => {
  const kinds =
    tab.value === 'latency'
      ? (['latency'] as const)
      : tab.value === 'download'
        ? (['download'] as const)
        : tab.value === 'info'
          ? (['info', 'intelligence'] as const)
          : (['intelligence'] as const)
  return [
    ...new Set(kinds.map((kind) => currentNodeChecks.value[kind]?.error).filter(Boolean)),
  ].join('；')
})
const panel = ref<HTMLElement>()
const position = ref({
  left: '12px',
  top: '12px',
  maxHeight: 'calc(100dvh - 24px)',
  visibility: 'hidden' as 'hidden' | 'visible',
})
let observer: ResizeObserver | undefined
function updatePosition() {
  const anchor = diagnosticsAnchor.value
  if (!anchor || !panel.value) return
  if (!anchor.isConnected) return closeNodeDiagnostics()
  const rect = anchor.getBoundingClientRect()
  const width = panel.value.offsetWidth
  const height = panel.value.offsetHeight
  const below = rect.bottom + 8
  const top =
    below + height <= window.innerHeight - 12
      ? below
      : rect.top - height - 8 >= 12
        ? rect.top - height - 8
        : Math.max(12, window.innerHeight - height - 12)
  position.value = {
    left: `${Math.max(12, Math.min(rect.left - width / 2 + rect.width / 2, window.innerWidth - width - 12))}px`,
    top: `${top}px`,
    maxHeight: 'calc(100dvh - 24px)',
    visibility: 'visible',
  }
}
function dismiss() {
  diagnosticsAnchor.value?.focus({ preventScroll: true })
  closeNodeDiagnostics()
}
function outsidePointer(event: PointerEvent) {
  if (
    event.target instanceof Node &&
    !panel.value?.contains(event.target) &&
    !diagnosticsAnchor.value?.contains(event.target)
  )
    closeNodeDiagnostics()
}
watch([selection, diagnosticsAnchor], async () => {
  observer?.disconnect()
  if (!selection.value) return
  position.value.visibility = 'hidden'
  await nextTick()
  updatePosition()
  if (panel.value) {
    observer = new ResizeObserver(updatePosition)
    observer.observe(panel.value)
  }
})
onMounted(() => {
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  document.addEventListener('pointerdown', outsidePointer)
})
onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  document.removeEventListener('pointerdown', outsidePointer)
  closeNodeDiagnostics()
})
const node = computed(() => proxyMap.value[selection.value?.name || ''])
const history = computed(() =>
  selection.value
    ? [...getHistoryByName(selection.value.name, selection.value.groupName)].reverse().slice(0, 30)
    : [],
)
const formatTime = (time: string) => {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
const addresses = (family: number) =>
  results.value.info
    ? results.value.info.dnsError ||
      results.value.info.addresses
        .filter((item) => item.family === family)
        .map((item) => item.address)
        .join(', ') ||
      '—'
    : '—'
const riskFlags = [
  { key: 'is_vpn', label: 'VPN' },
  { key: 'is_proxy', label: '代理（Proxy）' },
  { key: 'is_tor', label: 'Tor' },
  { key: 'is_crawler', label: '爬虫 / 机器人' },
]
const flagValue = (key: string) => results.value.intelligence?.flags[key] ?? null
const threatLabel = computed(() => {
  const threats = results.value.intelligence?.threats
  return threats ? (threats.length ? threats.join('、') : '未发现明显威胁') : '暂无数据'
})
const threatClass = computed(() => {
  const threats = results.value.intelligence?.threats
  return threats ? (threats.length ? 'text-error' : 'text-success') : 'text-base-content/45'
})
const abuseLabel = computed(() => {
  const level = results.value.intelligence?.abuseLevel || ''
  return (
    (
      { low: '极度纯净', elevated: '轻度风险', high: '高风险', very_high: '极高风险' } as Record<
        string,
        string
      >
    )[level] ||
    level ||
    '暂无数据'
  )
})
const abuseClass = computed(() => {
  const level = results.value.intelligence?.abuseLevel
  return level === 'low'
    ? 'text-success'
    : level === 'elevated'
      ? 'text-warning'
      : level === 'high' || level === 'very_high'
        ? 'text-error'
        : 'text-base-content/45'
})
const httpThreatLabel = computed(() => {
  const value = results.value.intelligence?.httpThreat
  return value == null ? '暂无数据' : value === 0 ? '未发现记录' : `已收录 · ${value}`
})
const rpkiLabel = computed(
  () =>
    ({ valid: '已授权', invalid: '无效', notfound: '未声明' })[
      results.value.intelligence?.rpki || ''
    ] || '待核实',
)
const rpkiClass = computed(() =>
  results.value.intelligence?.rpki === 'valid'
    ? 'text-success'
    : results.value.intelligence?.rpki === 'invalid'
      ? 'text-error'
      : 'text-base-content/45',
)
const trafficPercent = (value: number) => Number(value.toFixed(2))
const trafficTitle = computed(() => {
  const traffic = results.value.intelligence?.humanTraffic
  return traffic
    ? `ASN 级别流量估算 · ${traffic.range}${traffic.stale ? ' · 过期缓存' : ''}`
    : '暂无 ASN 流量统计'
})
function selectTab(value: typeof tab.value) {
  if (busy.value && runningKind.value === 'download') return
  tab.value = value
  if (!selection.value) return
  const { name, groupName } = selection.value
  // Opening the popover never requests data. Metadata is loaded only on its
  // tab's first visit; subsequent visits reuse results, including failures.
  if (value === 'info') {
    void checkNode(name, groupName, 'info')
    void checkNode(name, groupName, 'intelligence')
  } else if (value === 'risk') void checkNode(name, groupName, 'intelligence')
}
watch(
  selection,
  () => {
    tab.value = 'latency'
  },
  { flush: 'sync' },
)
async function refreshTab() {
  if (busy.value || !selection.value) return
  const { name, groupName } = selection.value
  if (tab.value === 'latency') await checkNode(name, groupName, 'latency', true)
  else if (tab.value === 'info') {
    await Promise.all([
      checkNode(name, groupName, 'info', true),
      checkNode(name, groupName, 'intelligence', true),
    ])
  } else if (tab.value === 'risk') await checkNode(name, groupName, 'intelligence', true)
}
async function run(kind: 'download') {
  if (busy.value || !selection.value) return
  await checkNode(selection.value.name, selection.value.groupName, kind, true)
}
</script>

<style scoped>
.node-diagnostics-content {
  scrollbar-width: none;
}
.node-diagnostics-content::-webkit-scrollbar {
  display: none;
}
</style>
