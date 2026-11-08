import { fetchServerApi } from '@/store/auth'
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
export const diagnosticsBusy = ref(false)
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
  const keys = Object.keys(nodeResults)
  if (keys.length > 200) delete nodeResults[keys[0]]
}
export function openNodeDiagnostics(
  name: string,
  groupName: string | undefined,
  anchor: HTMLElement,
) {
  keepNodeDiagnosticsOpen()
  if (diagnosticsBusy.value) return
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
    body: JSON.stringify({ ...body, backendUuid: activeUuid.value }),
    signal,
  })
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('当前部署未提供检测服务，请更新 Node 后端（纯静态部署不支持此检测）')
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || `检测失败：HTTP ${response.status}`)
  return data
}
