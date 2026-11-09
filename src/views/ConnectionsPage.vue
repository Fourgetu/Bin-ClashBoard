<template>
  <div
    class="network-workspace relative flex size-full min-h-0 flex-col overflow-hidden max-md:pb-20"
  >
    <div
      class="border-base-content/10 bg-base-100/60 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-3 md:px-5"
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
      <select
        v-if="tab === 'connections'"
        v-model="view"
        aria-label="连接展示方式"
        class="select select-sm ml-auto w-auto"
      >
        <option value="devices">按设备展示</option>
        <option value="classic">原始列表 / 表格</option>
      </select>
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
      v-else-if="view === 'devices'"
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
import { useConnectionCard } from '@/store/settings'
import type { Connection } from '@/types'
import LogsPage from '@/views/LogsPage.vue'
import { ArrowsRightLeftIcon, DocumentTextIcon, MapIcon } from '@heroicons/vue/24/outline'
import { useStorage } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute(),
  router = useRouter()
const tabs = [
  { key: 'route', label: '路由', icon: MapIcon },
  { key: 'connections', label: '连接', icon: ArrowsRightLeftIcon },
  { key: 'logs', label: '日志', icon: DocumentTextIcon },
]
const tab = computed(() =>
  ['route', 'logs'].includes(String(route.query.tab)) ? String(route.query.tab) : 'connections',
)
const view = useStorage('config/connection-workspace-view', 'devices')
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
