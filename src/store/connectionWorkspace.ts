import { canonicalIP } from '@/helper/networkDiagnostics'
import { getIPLabelFromMap } from '@/helper/sourceip'
import { connections } from '@/store/connections'
import { diagnosticsRequest } from '@/store/diagnostics'
import { proxyMap } from '@/store/proxies'
import { sourceIPLabelList } from '@/store/settings'
import { activeUuid } from '@/store/setup'
import type { Connection } from '@/types'
import { useStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

export const GROUP_PROXY_TYPES = [
  'Selector',
  'URLTest',
  'Fallback',
  'LoadBalance',
  'Relay',
  'Compatible',
]

export const targetOf = (conn: Connection) =>
  conn.metadata.host || conn.metadata.sniffHost || conn.metadata.destinationIP || '未知目标'

/** 分流策略（出站策略组）：按代理类型识别，兼容 sing-box / mihomo 的 chains 顺序差异 */
export const policyOf = (conn: Connection) => {
  const chains = conn.chains || []
  const groups = chains.filter((name) => {
    const proxy = proxyMap.value[name]
    return proxy && GROUP_PROXY_TYPES.includes(proxy.type)
  })
  const last = (list: string[]) => (list.length ? list[list.length - 1] : '')
  const policy = last(groups) || last(chains)
  const name = policy || conn.rule || '未匹配分流'
  if (name === 'DIRECT') return '直连'
  if (name === 'REJECT') return '拦截'
  return name
}

export const policyOptions = computed(() => {
  const set = new Set<string>()
  for (const conn of connections.value) set.add(policyOf(conn))
  return [...set].sort((a, b) => a.localeCompare(b)).slice(0, 200)
})

/**
 * 连接工作区的共享状态：分组方式、排序、筛选、搜索、设置面板开关。
 * 工具栏渲染在「连接」页的标签行里，列表组件读取这些状态。
 */
export const groupMode = useStorage<'device' | 'target'>('config/connection-group-mode', 'device')
export const subMode = useStorage<'none' | 'policy' | 'host'>(
  'config/connection-subgroup-mode',
  'policy',
)
export const sortKey = useStorage<'default' | 'count' | 'download' | 'upload' | 'recent'>(
  'config/connection-sort-key',
  'default',
)
export const sortAsc = useStorage('config/connection-sort-asc', false)
export const cardFields = useStorage<string[]>('config/connection-card-fields', [
  'inbound',
  'traffic',
])
export const workspaceView = useStorage('config/connection-workspace-view', 'devices')

export const query = ref('')
export const deviceFilter = ref('')
export const settingsOpen = ref(false)

export const devices = ref<Record<string, string>>({})
export const devicesLoading = ref(false)
export const devicesError = ref('')

export const deviceName = (ip: string) => {
  const explicit = sourceIPLabelList.value.find(
    (item) => item.key === ip && item.scope?.includes(activeUuid.value),
  )
  if (explicit) return explicit.label
  try {
    const label = getIPLabelFromMap(ip)
    if (label && label !== ip) return label
  } catch {
    /* Unknown source */
  }
  return devices.value[ip] || ip
}

/** 顶栏「全部」筛选：按设备（终端）维度 */
export const deviceOptions = computed(() => {
  const ips = new Set<string>()
  for (const conn of connections.value) ips.add(canonicalIP(conn.metadata.sourceIP))
  return [...ips]
    .sort((a, b) => a.localeCompare(b))
    .map((ip) => ({ ip, label: deviceName(ip) }))
})

let controller: AbortController | undefined

export const GROUP_MODES = [
  { key: 'device' as const, label: '按终端' },
  { key: 'target' as const, label: '按目标' },
]
export const SUB_MODES = [
  { key: 'none' as const, label: '不分组' },
  { key: 'policy' as const, label: '按分流分组' },
  { key: 'host' as const, label: '按目标分组' },
]
export const CARD_FIELDS = [
  { key: 'inbound', label: '入站 / 协议' },
  { key: 'traffic', label: '上下行' },
] as const

export async function fetchDevices() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  devicesLoading.value = true
  devicesError.value = ''
  try {
    const data = await diagnosticsRequest<{ devices: { ip: string; name: string }[] }>(
      'devices',
      {},
      request.signal,
    )
    if (!request.signal.aborted)
      devices.value = Object.fromEntries(
        data.devices.map((item) => [canonicalIP(item.ip), item.name]),
      )
  } catch (cause) {
    if (!request.signal.aborted)
      devicesError.value =
        cause instanceof Error ? cause.message : '读取设备名称失败；可直接手动命名'
  } finally {
    if (!request.signal.aborted) devicesLoading.value = false
  }
}

export function cancelDevices() {
  controller?.abort()
}
