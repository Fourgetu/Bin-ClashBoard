<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2 px-3 pt-3 md:px-5">
      <label class="input input-sm min-w-44 flex-1"
        ><MagnifyingGlassIcon class="size-4 opacity-50" /><input
          v-model="query"
          aria-label="搜索设备和连接"
          placeholder="搜索 IP、设备名称、域名或节点"
      /></label>
      <select
        v-model="connectionTabShow"
        aria-label="连接状态"
        class="select select-sm w-auto"
      >
        <option :value="CONNECTION_TAB_TYPE.ACTIVE">活动连接</option>
        <option :value="CONNECTION_TAB_TYPE.CLOSED">已关闭</option>
      </select>
      <button
        class="btn btn-sm"
        @click="isPaused = !isPaused"
      >
        {{ isPaused ? '继续刷新' : '暂停刷新' }}
      </button>
      <button
        class="btn btn-sm"
        :disabled="loading"
        @click="fetchDevices"
      >
        {{ loading ? '读取中…' : '识别设备名称' }}
      </button>
    </div>
    <div
      class="text-base-content/50 flex flex-wrap items-center justify-between gap-2 px-3 text-xs md:px-5"
    >
      <span
        >{{ groups.length }} 台设备 ·
        {{ groups.reduce((sum, group) => sum + group.connections.length, 0) }} 条连接</span
      ><span>名称来自设备备注或 DHCP；IPv4 / IPv6 按 IP 分组</span>
    </div>
    <p
      v-if="error"
      role="status"
      class="text-warning px-5 text-xs"
    >
      {{ error }}
    </p>
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 md:px-5">
      <p
        v-if="!groups.length"
        class="text-base-content/50 py-16 text-center text-sm"
      >
        {{ query ? '没有匹配的设备或连接' : '暂无连接，等待内核上报' }}
      </p>
      <section
        v-for="group in groups"
        :key="group.ip"
        class="border-base-content/5 bg-base-100 overflow-hidden rounded-2xl border"
      >
        <div class="flex items-center gap-2 p-4">
          <button
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            :aria-expanded="expanded.has(group.ip)"
            @click="toggle(group.ip)"
          >
            <ChevronDownIcon
              class="size-4 shrink-0 transition-transform"
              :class="!expanded.has(group.ip) && '-rotate-90'"
            />
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold">{{ deviceName(group.ip) }}</div>
              <div class="text-base-content/50 mt-1 text-xs break-all">
                {{ group.ip }} · {{ group.connections.length }} 条连接
              </div>
            </div>
          </button>
          <button
            class="btn btn-ghost btn-xs shrink-0"
            :aria-label="`重命名 ${group.ip}`"
            @click="startRename(group.ip)"
          >
            重命名
          </button>
          <div class="text-base-content/55 hidden text-right text-xs sm:block">
            <div>
              ↓ {{ prettyBytesHelper(group.download) }}
              <span v-if="connectionTabShow === CONNECTION_TAB_TYPE.ACTIVE"
                >· {{ prettyBytesHelper(group.downloadSpeed) }}/s</span
              >
            </div>
            <div class="mt-1">↑ {{ prettyBytesHelper(group.upload) }}</div>
          </div>
        </div>
        <div
          v-if="expanded.has(group.ip)"
          class="border-base-content/5 border-t"
        >
          <div
            v-for="conn in group.connections.slice(0, limits[group.ip] || 50)"
            :key="conn.id"
            class="hover:bg-base-200/50 flex items-center gap-2 px-4 py-3"
          >
            <button
              class="min-w-0 flex-1 text-left"
              @click="handlerInfo(conn)"
            >
              <div class="truncate text-sm">
                {{ conn.metadata.host || conn.metadata.sniffHost || conn.metadata.destinationIP
                }}<span class="text-base-content/40">:{{ conn.metadata.destinationPort }}</span>
              </div>
              <div class="text-base-content/50 mt-1 truncate text-xs">
                {{ conn.metadata.network.toUpperCase() }} · {{ conn.rule }} {{ conn.rulePayload }} ·
                {{ [...conn.chains].reverse().join(' → ') || '未上报链路' }}
              </div>
            </button>
            <span class="text-base-content/45 hidden text-xs sm:block"
              >↓ {{ prettyBytesHelper(conn.download) }}</span
            >
            <button
              class="btn btn-ghost btn-xs"
              :aria-label="`查看 ${conn.metadata.host || conn.metadata.destinationIP} 路由`"
              @click="$emit('route', conn)"
            >
              路由<ArrowTopRightOnSquareIcon class="size-3" />
            </button>
          </div>
          <button
            v-if="group.connections.length > (limits[group.ip] || 50)"
            class="btn btn-ghost btn-sm m-3"
            @click="limits[group.ip] = (limits[group.ip] || 50) + 50"
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
  </div>
</template>
<script setup lang="ts">
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { useConnections } from '@/composables/connections'
import { CONNECTION_TAB_TYPE } from '@/constant'
import { canonicalIP, groupDeviceConnections } from '@/helper/networkDiagnostics'
import { getIPLabelFromMap } from '@/helper/sourceip'
import { prettyBytesHelper } from '@/helper/utils'
import { connections, connectionTabShow, isPaused } from '@/store/connections'
import { diagnosticsRequest } from '@/store/diagnostics'
import { sourceIPLabelList } from '@/store/settings'
import { activeUuid } from '@/store/setup'
import type { Connection } from '@/types'
import {
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/vue/24/outline'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
defineEmits<{ route: [connection: Connection] }>()
const { handlerInfo } = useConnections()
const query = ref('')
const expanded = reactive(new Set<string>())
const limits = reactive<Record<string, number>>({})
const devices = ref<Record<string, string>>({})
const loading = ref(false)
const error = ref('')
let controller: AbortController | undefined
const deviceName = (ip: string) => {
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
const groups = computed(() => {
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  // Referencing the list also invalidates computed groups after an inline rename.
  void sourceIPLabelList.value
  return groupDeviceConnections(
    connections.value.filter((conn) => {
      const ip = canonicalIP(conn.metadata.sourceIP)
      const text = [
        ip,
        deviceName(ip),
        conn.metadata.host,
        conn.metadata.sniffHost,
        conn.metadata.destinationIP,
        conn.rule,
        conn.rulePayload,
        ...conn.chains,
      ]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => text.includes(term))
    }),
  )
})
const toggle = (ip: string) => (expanded.has(ip) ? expanded.delete(ip) : expanded.add(ip))
const renameOpen = ref(false),
  renameIP = ref(''),
  renameValue = ref('')
const startRename = (ip: string) => {
  renameIP.value = ip
  renameValue.value = deviceName(ip) === ip ? '' : deviceName(ip)
  renameOpen.value = true
}
function saveName() {
  const uuid = activeUuid.value
  if (!uuid) return
  sourceIPLabelList.value = sourceIPLabelList.value.flatMap((item) => {
    if (item.key !== renameIP.value || !item.scope?.includes(uuid)) return [item]
    const scope = item.scope.filter((value) => value !== uuid)
    return scope.length ? [{ ...item, scope }] : []
  })
  if (renameValue.value.trim())
    sourceIPLabelList.value.unshift({
      key: renameIP.value,
      label: renameValue.value.trim(),
      id: crypto.randomUUID(),
      scope: [uuid],
    })
  renameOpen.value = false
}
async function fetchDevices() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
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
      error.value = cause instanceof Error ? cause.message : '读取设备名称失败；可直接手动命名'
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}
watch(activeUuid, () => {
  controller?.abort()
  devices.value = {}
  expanded.clear()
  renameOpen.value = false
  error.value = ''
  loading.value = false
})
onUnmounted(() => controller?.abort())
</script>
