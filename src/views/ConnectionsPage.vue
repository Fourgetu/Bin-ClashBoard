<template>
  <div
    class="network-workspace relative flex size-full min-h-0 flex-col overflow-hidden max-md:pb-20"
  >
    <div
      class="border-base-content/10 bg-base-100/60 relative flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 md:px-5"
    >
      <nav
        class="bg-base-200/70 flex gap-1 rounded-full p-1"
        aria-label="连接工作区"
      >
        <button
          v-for="item in tabs"
          :key="item.key"
          class="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm"
          :class="tab === item.key ? 'bg-primary/15 text-primary' : 'text-base-content/55'"
          :aria-current="tab === item.key ? 'page' : undefined"
          @click="setTab(item.key)"
        >
          <component
            :is="item.icon"
            class="size-4"
          />{{ item.label }}
        </button>
      </nav>

      <template v-if="tab === 'connections'">
        <div
          class="bg-base-200/70 flex gap-1 rounded-full p-1"
          role="group"
          aria-label="分组方式"
        >
          <button
            v-for="mode in GROUP_MODES"
            :key="mode.key"
            class="rounded-full px-3 py-1 text-sm"
            :class="
              groupMode === mode.key ? 'bg-success/25 text-success' : 'text-base-content/55'
            "
            :aria-pressed="groupMode === mode.key"
            @click="groupMode = mode.key"
          >
            {{ mode.label }}
          </button>
        </div>
        <span class="text-base-content/60 text-sm">排序</span>
        <div class="border-base-content/15 flex items-center gap-0.5 rounded-lg border px-1">
          <select
            v-model="sortKey"
            aria-label="排序方式"
            class="select select-sm w-auto border-0 bg-transparent pr-6 text-sm"
          >
            <option value="default">目标</option>
            <option value="count">连接数</option>
            <option value="download">下行流量</option>
            <option value="upload">上行流量</option>
            <option value="recent">最近活动</option>
          </select>
          <button
            class="btn btn-ghost btn-xs btn-circle"
            :title="sortAsc ? '当前升序，点击切换降序' : '当前降序，点击切换升序'"
            :aria-label="sortAsc ? '当前升序，点击切换降序' : '当前降序，点击切换升序'"
            @click="sortAsc = !sortAsc"
          >
            <InformationCircleIcon class="size-4 opacity-60" />
          </button>
        </div>
        <select
          v-if="deviceOptions.length > 1"
          v-model="deviceFilter"
          aria-label="按设备筛选"
          class="select select-sm w-auto max-w-44 text-sm"
        >
          <option value="">全部</option>
          <option
            v-for="item in deviceOptions"
            :key="item.ip"
            :value="item.ip"
          >
            {{ item.label }}
          </option>
        </select>
        <label class="input input-sm min-w-44 flex-1"
          ><input
            v-model="query"
            aria-label="搜索连接"
            placeholder="搜索｜多个关键词用空格分隔"
          /><button
            v-if="query"
            class="btn btn-ghost btn-xs btn-circle"
            type="button"
            aria-label="清空搜索"
            @click.prevent="query = ''"
          >
            ×
          </button></label
        >
        <button
          class="btn btn-ghost btn-sm btn-circle"
          :aria-expanded="settingsOpen"
          aria-label="连接设置"
          @click="settingsOpen = !settingsOpen"
        >
          <Squares2X2Icon class="size-4" />
        </button>
      </template>

      <div
        v-if="tab === 'connections' && settingsOpen"
        class="bg-base-100 border-base-content/10 absolute top-full right-3 z-30 w-72 space-y-3 rounded-xl border p-3 text-xs shadow-lg md:right-5"
      >
        <div class="flex items-center gap-2">
          <span class="text-base-content/50 w-10 shrink-0">状态</span>
          <select
            v-model="connectionTabShow"
            aria-label="连接状态"
            class="select select-xs flex-1"
          >
            <option :value="CONNECTION_TAB_TYPE.ACTIVE">活动连接</option>
            <option :value="CONNECTION_TAB_TYPE.CLOSED">已关闭</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-base-content/50 w-10 shrink-0">视图</span>
          <select
            v-model="workspaceView"
            aria-label="连接展示方式"
            class="select select-xs flex-1"
          >
            <option value="devices">按设备卡片</option>
            <option value="classic">原始列表 / 表格</option>
          </select>
        </div>
        <div class="flex gap-2">
          <button
            class="btn btn-xs flex-1"
            @click="isPaused = !isPaused"
          >
            {{ isPaused ? '继续刷新' : '暂停刷新' }}
          </button>
          <button
            class="btn btn-xs flex-1"
            :disabled="devicesLoading"
            @click="fetchDevices"
          >
            {{ devicesLoading ? '读取中…' : '识别设备名称' }}
          </button>
        </div>
        <div>
          <p class="text-base-content/50 mb-1">显示字段</p>
          <label
            v-for="field in CARD_FIELDS"
            :key="field.key"
            class="flex items-center gap-2 py-0.5"
          >
            <input
              v-model="cardFields"
              type="checkbox"
              class="checkbox checkbox-xs"
              :value="field.key"
            />
            {{ field.label }}
          </label>
        </div>
        <div class="border-base-content/10 text-base-content/45 flex flex-wrap items-center gap-1 border-t pt-2">
          <span class="badge badge-xs badge-primary badge-soft">策略组</span>→
          <span class="badge badge-xs badge-warning badge-soft">节点组</span>→
          <span class="badge badge-xs badge-ghost">节点</span>
        </div>
        <p class="text-base-content/45">{{ deviceCount }} 台设备 · {{ connectionCount }} 条连接</p>
      </div>
    </div>
    <RouteDiagnostics
      v-if="tab === 'route'"
      :initial-target="routeTarget"
      :initial-source="routeSource"
    />
    <LogsPage
      v-else-if="tab === 'logs'"
      embedded
    />
    <DeviceConnections
      v-else-if="workspaceView === 'devices'"
      @route="inspectRoute"
    />
    <div
      v-else
      class="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ConnectionCardList
        v-if="useConnectionCard"
        embedded
      />
      <template v-else><ConnectionCtrl /><ConnectionTable /></template>
    </div>
    <ConnectionDetails />
  </div>
</template>

<script setup lang="ts">
import ConnectionCardList from '@/components/connections/ConnectionCardList.vue'
import ConnectionDetails from '@/components/connections/ConnectionDetails.vue'
import ConnectionTable from '@/components/connections/ConnectionTable.vue'
import DeviceConnections from '@/components/connections/DeviceConnections.vue'
import RouteDiagnostics from '@/components/connections/RouteDiagnostics.vue'
import ConnectionCtrl from '@/components/sidebar/ConnectionCtrl.tsx'
import { CONNECTION_TAB_TYPE } from '@/constant'
import { canonicalIP } from '@/helper/networkDiagnostics'
import {
  CARD_FIELDS,
  GROUP_MODES,
  cancelDevices,
  cardFields,
  deviceFilter,
  deviceOptions,
  devicesLoading,
  fetchDevices,
  groupMode,
  query,
  settingsOpen,
  sortAsc,
  sortKey,
  workspaceView,
} from '@/store/connectionWorkspace'
import { connections, connectionTabShow, initConnections, isPaused } from '@/store/connections'
import { fetchConfigs } from '@/store/config'
import { initLogs } from '@/store/logs'
import { fetchProxies } from '@/store/proxies'
import { useConnectionCard } from '@/store/settings'
import { activeUuid } from '@/store/setup'
import type { Connection } from '@/types'
import LogsPage from '@/views/LogsPage.vue'
import {
  ArrowsRightLeftIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  MapIcon,
  Squares2X2Icon,
} from '@heroicons/vue/24/outline'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute(),
  router = useRouter()

// 直接进入「连接」页时内核数据流尚未启动，这里补齐（与概览页重复调用是安全的，store 会自行取消上一次订阅）
let kernelStreamKey = ''
watch(
  activeUuid,
  () => {
    if (!activeUuid.value || kernelStreamKey === activeUuid.value) return
    kernelStreamKey = activeUuid.value
    void fetchConfigs()
    void fetchProxies()
    initConnections()
    initLogs()
  },
  { immediate: true },
)
const tabs = [
  { key: 'route', label: '路由', icon: MapIcon },
  { key: 'connections', label: '连接', icon: ArrowsRightLeftIcon },
  { key: 'logs', label: '日志', icon: DocumentTextIcon },
]
const tab = computed(() =>
  ['route', 'logs'].includes(String(route.query.tab)) ? String(route.query.tab) : 'connections',
)
const deviceCount = computed(
  () => new Set(connections.value.map((conn) => canonicalIP(conn.metadata.sourceIP))).size,
)
const connectionCount = computed(() => connections.value.length)
onUnmounted(cancelDevices)
const routeTarget = ref(''),
  routeSource = ref('')
const setTab = (value: string) => router.replace({ query: { ...route.query, tab: value } })
const inspectRoute = (connection: Connection) => {
  routeTarget.value =
    connection.metadata.host || connection.metadata.sniffHost || connection.metadata.destinationIP
  routeSource.value = connection.metadata.sourceIP
  void setTab('route')
}
</script>

<style>
.network-workspace .ctrls-bar {
  position: relative !important;
  top: auto !important;
}
.network-workspace .ctrls-bar + * {
  scroll-margin-top: 0;
}
.vjs-tree {
  font-family:
    NotoEmoji,
    Monaco,
    Menlo,
    Consolas,
    Bitstream Vera Sans Mono,
    monospace;
}
.vjs-tree-node.is-highlight,
.vjs-tree-node:hover {
  background-color: var(--color-base-200);
}
</style>
