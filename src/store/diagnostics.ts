import { fetchServerApi } from '@/store/auth'
import { getTestUrl, proxyLatencyTest } from '@/store/proxies'
import { activeUuid } from '@/store/setup'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

export type DownloadResult = {
  bytes: number
  elapsedMs: number
  mbps: number
  checkedAt: string
  source: string
  direction: 'download'
}
export type NodeInfo = {
  server: string
  port: number
  protocol: string
  udp: boolean | null
  addresses: { address: string; family: number }[]
  dnsError: string
  checkedAt: string
}
export type Intelligence = {
  ip: string
  country: string
  city: string
  asn: string
  company: string
  flags: Record<string, boolean | null>
  source: string
  checkedAt: string
  trustScore: number | null
  registeredCountry: string
  native: boolean | null
  abuseLevel: string
  abuseScore: string
  threats: string[] | null
  httpThreat: number | null
  rpki: string
  reportUrl: string
  humanTraffic: {
    human: number
    bot: number
    range: string
    stale: boolean
    updatedAt: string | null
  } | null
}
type NodeResults = { info?: NodeInfo; intelligence?: Intelligence; download?: DownloadResult }
export const nodeDiagnostics = ref<{ name: string; groupName?: string } | null>(null)
export const diagnosticsAnchor = shallowRef<HTMLElement | null>(null)
type CheckKind = 'latency' | 'info' | 'intelligence' | 'download'
type CheckState = { pending: boolean; error: string }
const checks = reactive<Record<string, Partial<Record<CheckKind, CheckState>>>>({})
export const isNodeLatencyPending = (name: string) =>
  checks[nodeResultKey(name)]?.latency?.pending === true
export const currentNodeChecks = computed(
  () => checks[nodeResultKey(nodeDiagnostics.value?.name || '')] || {},
)
export const diagnosticsBusy = computed(() =>
  Object.values(currentNodeChecks.value).some((check) => check.pending),
)
const pending = new Map<string, Promise<void>>()
const controllers = new Map<string, AbortController>()
let closeTimer: ReturnType<typeof setTimeout> | undefined
export function keepNodeDiagnosticsOpen() {
  clearTimeout(closeTimer)
}
export function closeNodeDiagnostics() {
  keepNodeDiagnosticsOpen()
  nodeDiagnostics.value = null
  diagnosticsAnchor.value = null
}
export function scheduleNodeDiagnosticsClose() {
  keepNodeDiagnosticsOpen()
  closeTimer = setTimeout(() => {
    const panel = document.getElementById('node-diagnostics-popover')
    if (
      diagnosticsBusy.value ||
      panel?.matches(':hover') ||
      diagnosticsAnchor.value?.matches(':hover') ||
      panel?.contains(document.activeElement) ||
      diagnosticsAnchor.value === document.activeElement
    )
      return
    closeNodeDiagnostics()
  }, 250)
}
export const nodeResults = reactive<Record<string, NodeResults>>({})
export const nodeResultKey = (name: string) => JSON.stringify([activeUuid.value, name])
export const currentNodeResults = computed(
  () => nodeResults[nodeResultKey(nodeDiagnostics.value?.name || '')] || {},
)
export function saveNodeResult(
  key: string,
  kind: keyof NodeResults,
  value: NodeInfo | Intelligence | DownloadResult,
) {
  nodeResults[key] = { ...nodeResults[key], [kind]: value }
}
// One attempt per node/backend per page session, including failures. Only explicit
// refresh retries. Serial requests also respect the backend's isolated-probe lock.
export function checkNode(
  name: string,
  groupName: string | undefined,
  kind: CheckKind,
  force = false,
) {
  const backendUuid = activeUuid.value
  const key = nodeResultKey(name)
  const requestKey = JSON.stringify([key, kind])
  if (pending.has(requestKey)) return pending.get(requestKey)!
  if (!force && kind !== 'latency' && nodeResults[key]?.[kind]) return Promise.resolve()
  if (!force && checks[key]?.[kind]) return Promise.resolve()
  checks[key] ||= {}
  checks[key][kind] = { pending: true, error: '' }
  const state = checks[key][kind]!
  const controller = new AbortController()
  controllers.set(requestKey, controller)
  const testUrl = getTestUrl(groupName)
  // The server shares config reads and queues isolated probes. Basic info and
  // core latency can return without waiting for external intelligence lookups.
  const task = Promise.resolve().then(async () => {
    try {
      if (backendUuid !== activeUuid.value) {
        delete checks[key][kind]
        return
      }
      controller.signal.throwIfAborted()
      if (kind === 'latency') await proxyLatencyTest(name, testUrl)
      else {
        const value = await diagnosticsRequest<NodeInfo | Intelligence | DownloadResult>(
          'node',
          { name, kind, backendUuid, refresh: force },
          controller.signal,
        )
        saveNodeResult(key, kind, value)
      }
    } catch (cause) {
      state.error = controller.signal.aborted
        ? '已停止测速'
        : cause instanceof Error
          ? cause.message
          : '检测失败'
    } finally {
      state.pending = false
      pending.delete(requestKey)
      controllers.delete(requestKey)
    }
  })
  pending.set(requestKey, task)
  return task
}
export function cancelNodeDownload() {
  if (!nodeDiagnostics.value) return
  controllers.get(JSON.stringify([nodeResultKey(nodeDiagnostics.value.name), 'download']))?.abort()
}
export function openNodeDiagnostics(
  name: string,
  groupName: string | undefined,
  anchor: HTMLElement,
) {
  keepNodeDiagnosticsOpen()
  diagnosticsAnchor.value = anchor
  if (nodeDiagnostics.value?.name === name && nodeDiagnostics.value.groupName === groupName) return
  nodeDiagnostics.value = { name, groupName }
}
watch(activeUuid, closeNodeDiagnostics)

export async function diagnosticsRequest<T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchServerApi(`/api/diagnostics/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backendUuid: activeUuid.value, ...body }),
    signal,
  })
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('当前部署未提供检测服务，请更新 Node 后端（纯静态部署不支持此检测）')
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || `检测失败：HTTP ${response.status}`)
  return data
}
