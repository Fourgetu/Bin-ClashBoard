<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <p
      v-if="error"
      role="status"
      class="text-warning px-5 pt-2 text-xs"
    >
      {{ error }}
    </p>
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 md:px-5">
      <p
        v-if="!groups.length"
        class="text-base-content/50 py-16 text-center text-sm"
      >
        {{ query || deviceFilter ? '没有匹配的连接' : '暂无连接，等待内核上报' }}
      </p>
      <section
        v-for="group in groups"
        :key="group.key"
        class="border-base-content/5 bg-base-100 overflow-hidden rounded-2xl border"
      >
        <div class="flex flex-wrap items-center gap-2 p-3 md:p-4">
          <button
            class="flex min-w-0 items-center gap-2 text-left"
            :aria-expanded="expanded.has(group.key)"
            @click="toggle(group.key)"
          >
            <ChevronDownIcon
              class="size-4 shrink-0 transition-transform"
              :class="!expanded.has(group.key) && '-rotate-90'"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-semibold">{{ group.label }}</span>
                <span
                  v-if="groupMode === 'device'"
                  class="text-base-content/45 text-xs"
                  @click.stop="startRename(group.key)"
                  >重命名 ›</span
                >
                <button
                  v-else
                  class="text-success link link-hover text-xs"
                  @click.stop="openRuleDialogForHost(group.host || group.label)"
                >
                  改分流 ›
                </button>
              </div>
              <div class="text-base-content/50 mt-0.5 truncate text-xs">
                <template v-if="group.subtitle">{{ group.subtitle }} · </template
                >{{ group.connections.length }} 条连接
              </div>
            </div>
          </button>
          <div
            v-if="groupMode === 'device'"
            class="bg-base-200/70 flex gap-1 rounded-full p-1"
            role="group"
            aria-label="设备内分组"
          >
            <button
              v-for="mode in SUB_MODES"
              :key="mode.key"
              class="rounded-full px-2.5 py-0.5 text-xs"
              :class="subMode === mode.key ? 'bg-primary/15 text-primary' : 'text-base-content/55'"
              :aria-pressed="subMode === mode.key"
              @click="subMode = mode.key"
            >
              {{ mode.label }}
            </button>
          </div>
          <div class="text-base-content/55 ml-auto shrink-0 text-right text-xs">
            <div>
              ↓ {{ prettyBytesHelper(group.download) }}
              <span v-if="connectionTabShow === CONNECTION_TAB_TYPE.ACTIVE"
                >· {{ prettyBytesHelper(group.downloadSpeed) }}/s</span
              >
            </div>
            <div class="mt-0.5">
              ↑ {{ prettyBytesHelper(group.upload) }}
              <span v-if="connectionTabShow === CONNECTION_TAB_TYPE.ACTIVE"
                >· {{ prettyBytesHelper(group.uploadSpeed) }}/s</span
              >
            </div>
          </div>
        </div>
        <div
          v-if="expanded.has(group.key)"
          class="border-base-content/5 border-t"
        >
          <template
            v-for="item in renderItems(group)"
            :key="item.key"
          >
            <button
              v-if="item.kind === 'subheader'"
              class="bg-base-200/40 hover:bg-base-200/70 flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left md:px-4"
              :aria-expanded="expandedSubs.has(item.key)"
              @click="toggleSub(item.key)"
            >
              <ChevronDownIcon
                class="size-4 shrink-0 opacity-50 transition-transform"
                :class="!expandedSubs.has(item.key) && '-rotate-90'"
              />
              <ProxyIcon
                v-if="item.icon"
                :icon="item.icon"
                class="size-5 shrink-0"
                :margin="0"
              />
              <span
                v-else
                class="bg-base-300 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              >
                {{ item.label.slice(0, 1) }}
              </span>
              <span class="text-sm font-semibold">{{ item.label }}</span>
              <span class="text-base-content/50 text-xs"
                >{{ item.subtitle }} · {{ item.count }} 条连接</span
              >
              <span
                class="text-base-content/45 ml-auto shrink-0 text-xs whitespace-nowrap"
                >↓ {{ prettyBytesHelper(item.download) }} · ↑
                {{ prettyBytesHelper(item.upload) }}</span
              >
            </button>
            <div
              v-else
              class="border-base-content/5 hover:bg-base-200/40 flex flex-col gap-1 border-t px-2 py-2 md:flex-row md:items-center md:gap-3 md:px-3"
            >
              <div class="flex w-full shrink-0 items-center gap-1.5 md:w-44">
                <button
                  class="btn btn-ghost btn-xs btn-circle shrink-0"
                  aria-label="关闭这条连接"
                  :disabled="connectionTabShow !== CONNECTION_TAB_TYPE.ACTIVE"
                  @click="closeConnection(item.connection)"
                >
                  <XMarkIcon class="size-4 opacity-60" />
                </button>
                <div class="min-w-0">
                  <div class="truncate text-xs font-medium">
                    {{ deviceName(canonicalIP(item.connection.metadata.sourceIP)) }}
                  </div>
                  <div class="text-base-content/45 mt-0.5 text-xs">
                    {{ timeAgo(item.connection.start) }}
                  </div>
                </div>
              </div>
              <button
                class="min-w-0 w-full text-left md:flex-1 md:text-center"
                :aria-label="`查看 ${targetOf(item.connection)} 连接详情`"
                @click="handlerInfo(item.connection)"
              >
                <div class="flex flex-wrap items-center gap-1 md:justify-center">
                  <template
                    v-for="(chip, index) in chainChips(item.connection)"
                    :key="`${chip.name}-${index}`"
                  >
                    <span
                      class="badge badge-xs gap-1 whitespace-nowrap"
                      :class="chip.tone"
                      :title="chip.role"
                    >
                      <ShareIcon
                        v-if="chip.role !== '节点'"
                        class="size-3"
                      />
                      <SignalIcon
                        v-else
                        class="size-3"
                      />
                      {{ chip.name }}
                      <span
                        v-if="chip.delay && chip.role === '节点'"
                        class="opacity-60"
                        >{{ chip.delay }}</span
                      >
                    </span>
                    <ChevronRightIcon
                      v-if="index < chainChips(item.connection).length - 1"
                      class="size-3 shrink-0 opacity-30"
                    />
                  </template>
                  <span
                    v-if="!chainChips(item.connection).length"
                    class="text-base-content/40 text-xs"
                    >内核未上报链路</span
                  >
                </div>
                <div class="text-base-content/45 mt-0.5 truncate text-xs">
                  {{ inboundOf(item.connection) }}
                </div>
              </button>
              <div class="w-full shrink-0 text-left md:w-52 md:text-right">
                <button
                  class="text-success link link-hover text-xs font-medium whitespace-nowrap"
                  :aria-label="`为 ${targetOf(item.connection)} 新增分流规则`"
                  @click="openRuleDialog(item.connection)"
                >
                  {{ targetOf(item.connection) }}:{{ item.connection.metadata.destinationPort }}
                  <span class="text-base-content/45">改分流 ›</span>
                </button>
                <div
                  v-if="cardFields.includes('traffic')"
                  class="text-base-content/45 mt-0.5 text-xs whitespace-nowrap"
                >
                  <span>↓ {{ speedText(item.connection, 'down') }}</span>
                  <span class="ml-2">↑ {{ speedText(item.connection, 'up') }}</span>
                </div>
              </div>
            </div>
          </template>
          <button
            v-if="group.connections.length > (limits[group.key] || 50)"
            class="btn btn-ghost btn-sm m-3"
            @click="limits[group.key] = (limits[group.key] || 50) + 50"
          >
            显示更多连接
          </button>
        </div>
      </section>
    </div>
    <DialogWrapper
      v-model="renameOpen"
      title="设备名称"
    >
      <form
        class="flex flex-col gap-3"
        @submit.prevent="saveName"
      >
        <p class="text-base-content/50 text-sm break-all">{{ renameIP }}</p>
        <input
          v-model="renameValue"
          aria-label="设备名称"
          class="input w-full"
          maxlength="80"
          placeholder="例如：客厅电视，留空删除备注"
        />
        <p class="text-base-content/45 text-xs">
          仅保存到当前后端的设备备注，IPv4 和 IPv6 地址分别命名。
        </p>
        <button
          class="btn btn-primary btn-sm self-end"
          type="submit"
        >
          保存
        </button>
      </form>
    </DialogWrapper>
    <DialogWrapper
      v-model="ruleOpen"
      title="新增域名规则"
    >
      <form
        class="flex flex-col gap-3"
        @submit.prevent="submitRule"
      >
        <label class="flex flex-col gap-1 text-sm">
          规则名称
          <select
            v-model="ruleForm.customGroupMode"
            class="select select-sm w-full"
            aria-label="规则名称"
          >
            <option value="pre">前置自定义</option>
            <option value="post">后置自定义</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          规则类型
          <select
            v-model="ruleForm.type"
            class="select select-sm w-full"
            aria-label="规则类型"
          >
            <option value="DOMAIN-SUFFIX">域名后缀</option>
            <option value="DOMAIN">完整域名</option>
            <option value="DOMAIN-KEYWORD">域名关键字</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          域名
          <span class="relative block">
            <input
              v-model="ruleForm.value"
              aria-label="域名"
              class="input input-sm w-full pr-8"
              placeholder="example.com"
            />
            <button
              v-if="ruleForm.value"
              class="btn btn-ghost btn-xs btn-circle absolute top-1/2 right-1 -translate-y-1/2"
              type="button"
              aria-label="清空域名"
              @click="ruleForm.value = ''"
            >
              ×
            </button>
          </span>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          节点
          <select
            v-model="ruleForm.target"
            class="select select-sm w-full"
            aria-label="节点"
          >
            <option value="">请选择策略组 / 节点</option>
            <option
              v-for="name in ruleTargetOptions"
              :key="name"
              :value="name"
            >
              {{ name }}
            </option>
          </select>
        </label>
        <p
          v-if="ruleError"
          class="text-error text-xs"
        >
          {{ ruleError }}
        </p>
        <p
          v-else
          class="text-warning text-xs"
        >
          新增只会写入配置文件，点击右上角重启后生效
        </p>
        <div class="flex justify-end gap-2">
          <button
            class="btn btn-sm"
            type="button"
            @click="ruleOpen = false"
          >
            取消
          </button>
          <button
            class="btn btn-primary btn-sm"
            type="submit"
            :disabled="ruleSubmitting || !ruleForm.value.trim() || !ruleForm.target"
          >
            {{ ruleSubmitting ? '提交中…' : '确定' }}
          </button>
        </div>
      </form>
    </DialogWrapper>
  </div>
</template>
<script setup lang="ts">
import { disconnectByIdAPI } from '@/api'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import ProxyIcon from '@/components/proxies/ProxyIcon.vue'
import { useConnections } from '@/composables/connections'
import { CONNECTION_TAB_TYPE } from '@/constant'
import { canonicalIP } from '@/helper/networkDiagnostics'
import { prettyBytesHelper } from '@/helper/utils'
import { showNotification } from '@/helper/notification'
import { fetchServerApi } from '@/store/auth'
import {
  GROUP_PROXY_TYPES,
  SUB_MODES,
  cardFields,
  deviceFilter,
  deviceName,
  devices,
  groupMode,
  policyOf,
  query,
  sortAsc,
  sortKey,
  subMode,
  targetOf,
} from '@/store/connectionWorkspace'
import { connections, connectionTabShow } from '@/store/connections'
import { proxyGroupList, proxyMap } from '@/store/proxies'
import { sourceIPLabelList } from '@/store/settings'
import { activeBackend, activeUuid } from '@/store/setup'
import type { Connection } from '@/types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ShareIcon,
  SignalIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { computed, reactive, ref, watch } from 'vue'

defineEmits<{ route: [connection: Connection] }>()

const expanded = reactive(new Set<string>())
const limits = reactive<Record<string, number>>({})
const error = ref('')

/** crypto.randomUUID 仅在安全上下文可用，局域网 http 访问时需回退 */
const createLocalId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const { handlerInfo } = useConnections()

/** 活动连接显示实时速度，已关闭显示累计流量 */
const speedText = (conn: Connection, dir: 'down' | 'up') => {
  const active = connectionTabShow.value === CONNECTION_TAB_TYPE.ACTIVE
  const value =
    dir === 'down'
      ? active
        ? conn.downloadSpeed
        : conn.download
      : active
        ? conn.uploadSpeed
        : conn.upload
  return `${prettyBytesHelper(value || 0)}${active ? '/s' : ''}`
}



const inboundOf = (conn: Connection) => {
  const inbound = conn.metadata.inboundName || conn.metadata.type || ''
  const network = (conn.metadata.network || '').toUpperCase()
  return [inbound, network].filter(Boolean).join(' | ')
}

/** 链路切片：策略组 → 节点组 → 节点 */
const chainChips = (conn: Connection) => {
  const names = [...(conn.chains || [])].reverse()
  return names.map((name, index) => {
    const proxy = proxyMap.value[name]
    const isGroup = !!proxy && GROUP_PROXY_TYPES.includes(proxy.type)
    const last = index === names.length - 1
    const role = index === 0 ? (isGroup ? '策略组' : '出站') : isGroup && !last ? '节点组' : isGroup ? '节点组' : '节点'
    const tone =
      role === '策略组'
        ? 'badge-primary badge-soft'
        : role === '节点组'
          ? 'badge-warning badge-soft'
          : 'badge-ghost'
    return {
      name,
      role,
      tone,
      delay: proxy?.history?.[0]?.delay,
    }
  })
}

const timeAgo = (iso: string) => {
  const diff = Date.now() - (Date.parse(iso) || 0)
  if (!Number.isFinite(diff) || diff < 0) return ''
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

const filtered = computed(() => {
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  void sourceIPLabelList.value
  return connections.value.filter((conn) => {
    const ip = canonicalIP(conn.metadata.sourceIP)
    if (deviceFilter.value && canonicalIP(conn.metadata.sourceIP) !== deviceFilter.value)
      return false
    if (!terms.length) return true
    const text = [
      ip,
      deviceName(ip),
      conn.metadata.host,
      conn.metadata.sniffHost,
      conn.metadata.destinationIP,
      conn.metadata.destinationPort,
      conn.metadata.network,
      conn.rule,
      conn.rulePayload,
      ...conn.chains,
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => text.includes(term))
  })
})



function aggregate(list: Connection[]) {
  let download = 0
  let upload = 0
  let downloadSpeed = 0
  let uploadSpeed = 0
  let latest = 0
  for (const conn of list) {
    download += conn.download
    upload += conn.upload
    downloadSpeed += Math.max(0, conn.downloadSpeed)
    uploadSpeed += Math.max(0, conn.uploadSpeed)
    latest = Math.max(latest, Date.parse(conn.start) || 0)
  }
  return { download, upload, downloadSpeed, uploadSpeed, latest }
}

type Group = {
  key: string
  label: string
  subtitle: string
  host?: string
  connections: Connection[]
  download: number
  upload: number
  downloadSpeed: number
  uploadSpeed: number
  latest: number
}

const groupValue = (group: Group) => {
  switch (sortKey.value) {
    case 'count':
      return group.connections.length
    case 'download':
      return group.download
    case 'upload':
      return group.upload
    case 'recent':
      return group.latest
    default:
      return 0
  }
}

const groups = computed<Group[]>(() => {
  if (!filtered.value.length) return []
  const result: Group[] = []
  if (groupMode.value === 'device') {
    const buckets = new Map<string, Connection[]>()
    for (const conn of filtered.value) {
      const ip = canonicalIP(conn.metadata.sourceIP)
      buckets.set(ip, [...(buckets.get(ip) || []), conn])
    }
    for (const [ip, list] of buckets) {
      result.push({
        key: ip,
        label: deviceName(ip),
        subtitle: ip,
        connections: list,
        ...aggregate(list),
      })
    }
  } else {
    const buckets = new Map<string, Connection[]>()
    for (const conn of filtered.value) {
      const target = targetOf(conn)
      buckets.set(target, [...(buckets.get(target) || []), conn])
    }
    for (const [target, list] of buckets) {
      result.push({
        key: target,
        label: target,
        subtitle: '',
        host: target,
        connections: list,
        ...aggregate(list),
      })
    }
  }
  if (sortKey.value !== 'default') {
    result.sort((a, b) => {
      const delta = groupValue(a) - groupValue(b)
      return sortAsc.value ? delta : -delta
    })
  } else
    result.sort((a, b) => {
      const delta = a.label.localeCompare(b.label)
      return sortAsc.value ? -delta : delta
    })
  return result
})


const sortConnections = (list: Connection[]) => {
  const rows = [...list]
  if (sortKey.value === 'default') {
    rows.sort((a, b) => {
      const delta = targetOf(a).localeCompare(targetOf(b))
      return sortAsc.value ? -delta : delta
    })
    return rows
  }
  const value = (conn: Connection) => {
    switch (sortKey.value) {
      case 'download':
        return conn.download
      case 'upload':
        return conn.upload
      case 'recent':
        return Date.parse(conn.start) || 0
      default:
        return Date.parse(conn.start) || 0
    }
  }
  rows.sort((a, b) => (sortAsc.value ? value(a) - value(b) : value(b) - value(a)))
  return rows
}

type RenderItem =
  | {
      kind: 'subheader'
      key: string
      label: string
      subtitle: string
      count: number
      download: number
      upload: number
      icon?: string
    }
  | { kind: 'row'; key: string; connection: Connection }

/** 设备内二级分组：不分组 / 按分流分组 / 按目标分组 */
function renderItems(group: Group): RenderItem[] {
  const limit = limits[group.key] || 50
  const rows = sortConnections(group.connections).slice(0, limit)
  if (subMode.value === 'none' || groupMode.value === 'target')
    return rows.map((conn) => ({ kind: 'row' as const, key: conn.id, connection: conn }))

  const buckets = new Map<string, Connection[]>()
  for (const conn of rows) {
    const label = subMode.value === 'policy' ? policyOf(conn) : targetOf(conn)
    buckets.set(label, [...(buckets.get(label) || []), conn])
  }
  const items: RenderItem[] = []
  const entries = [...buckets.entries()]
  if (sortKey.value !== 'default') {
    entries.sort((a, b) => {
      const delta = aggregate(a[1]).download - aggregate(b[1]).download
      return sortAsc.value ? delta : -delta
    })
  } else {
    entries.sort((a, b) => a[0].localeCompare(b[0]))
  }
  for (const [label, list] of entries) {
    const totals = aggregate(list)
    const subKey = `${group.key}-${label}`
    items.push({
      kind: 'subheader',
      key: subKey,
      label,
      subtitle:
        subMode.value === 'policy'
          ? `${new Set(list.map(targetOf)).size} 个目标`
          : `${new Set(list.map((conn) => canonicalIP(conn.metadata.sourceIP))).size} 台设备`,
      count: list.length,
      download: totals.download,
      upload: totals.upload,
      icon: subMode.value === 'policy' ? proxyMap.value[label]?.icon : undefined,
    })
    if (expandedSubs.has(subKey))
      for (const conn of list) items.push({ kind: 'row', key: conn.id, connection: conn })
  }
  return items
}

const expandedSubs = reactive(new Set<string>())
const toggleSub = (key: string) =>
  expandedSubs.has(key) ? expandedSubs.delete(key) : expandedSubs.add(key)

const toggle = (key: string) => (expanded.has(key) ? expanded.delete(key) : expanded.add(key))

async function closeConnection(conn: Connection) {
  try {
    await disconnectByIdAPI(conn.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '关闭连接失败；内核可能不支持'
  }
}

const ruleOpen = ref(false)
const ruleSubmitting = ref(false)
const ruleError = ref('')
const ruleForm = reactive({ type: 'DOMAIN-SUFFIX', value: '', target: '', customGroupMode: 'pre' })

const ruleTargetOptions = computed(() => {
  const names = new Set<string>()
  for (const name of proxyGroupList.value) names.add(name)
  for (const name of Object.keys(proxyMap.value)) if (name !== 'GLOBAL') names.add(name)
  names.add('DIRECT')
  names.add('REJECT')
  if (ruleForm.target) names.add(ruleForm.target)
  return [...names].sort((a, b) => a.localeCompare(b))
})

/** 「改分流」＝给这条连接的目标域名新增一条分流规则 */
function openRuleDialog(conn: Connection) {
  const host = conn.metadata.host || conn.metadata.sniffHost || ''
  const policy = policyOf(conn)
  openRuleDialogForHost(host, policy === '直连' ? 'DIRECT' : policy === '拦截' ? 'REJECT' : policy)
}

function openRuleDialogForHost(host: string, target = '') {
  ruleForm.type = 'DOMAIN-SUFFIX'
  ruleForm.value = String(host || '').replace(/^\./, '')
  if (target) ruleForm.target = target
  ruleError.value = ''
  ruleOpen.value = true
}

async function submitRule() {
  if (ruleSubmitting.value) return
  const value = ruleForm.value.trim()
  if (!value || !ruleForm.target) return
  ruleSubmitting.value = true
  ruleError.value = ''
  try {
    const response = await fetchServerApi('/api/proxy-domain-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value,
        type: ruleForm.type,
        target: ruleForm.target,
        customGroupMode: ruleForm.customGroupMode,
      }),
    })
    const data = (await response.json().catch(() => null)) as {
      message?: string
      changed?: boolean
      duplicated?: boolean
      rule?: string
    } | null
    if (!response.ok) throw new Error(data?.message || `写入失败（${response.status}）`)
    ruleOpen.value = false
    showNotification({
      key: `domain-rule-${Date.now()}`,
      content: data?.duplicated
        ? `规则已存在：${data.rule || value}`
        : `已写入配置：${ruleForm.type},${value},${ruleForm.target}（重启内核后生效）`,
      type: data?.duplicated ? 'alert-warning' : 'alert-success',
      timeout: 4000,
    })
  } catch (cause) {
    ruleError.value = cause instanceof Error ? cause.message : '写入规则失败'
  } finally {
    ruleSubmitting.value = false
  }
}

const renameOpen = ref(false),
  renameIP = ref(''),
  renameValue = ref('')
const startRename = (key: string) => {
  renameIP.value = key
  renameValue.value = deviceName(key) === key ? '' : deviceName(key)
  renameOpen.value = true
}
function saveName() {
  const uuid = activeUuid.value || activeBackend.value?.uuid
  if (!uuid) {
    showNotification({
      content: '当前后端尚未就绪，设备名称无法保存',
      type: 'alert-error',
      timeout: 3000,
    })
    return
  }
  sourceIPLabelList.value = sourceIPLabelList.value.flatMap((item) => {
    if (item.key !== renameIP.value || !item.scope?.includes(uuid)) return [item]
    const scope = item.scope.filter((value) => value !== uuid)
    return scope.length ? [{ ...item, scope }] : []
  })
  if (renameValue.value.trim())
    sourceIPLabelList.value.unshift({
      key: renameIP.value,
      label: renameValue.value.trim(),
      id: createLocalId(),
      scope: [uuid],
    })
  renameOpen.value = false
}

watch(activeUuid, () => {
  devices.value = {}
  expanded.clear()
  renameOpen.value = false
  deviceFilter.value = ''
  error.value = ''
})
</script>

