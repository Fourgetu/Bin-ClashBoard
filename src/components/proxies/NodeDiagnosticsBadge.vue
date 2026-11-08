<template>
  <div
    class="bg-base-100 text-base-content ml-1 flex h-5 shrink-0 items-center rounded-full text-xs tabular-nums"
    @click.stop
  >
    <button
      ref="anchor"
      type="button"
      class="flex h-full min-w-8 items-center justify-center rounded-l-full px-1.5 outline-offset-2"
      :class="getColorForLatency(latency)"
      :aria-label="`${name} 延迟 ${latency > 0 ? latency + ' 毫秒' : '未测得'}，节点检测`"
      aria-haspopup="dialog"
      aria-controls="node-diagnostics-popover"
      :aria-expanded="diagnosticsAnchor === anchor && Boolean(nodeDiagnostics)"
      @mouseenter="open"
      @mouseleave="scheduleNodeDiagnosticsClose"
      @focus="open"
      @blur="scheduleNodeDiagnosticsClose"
      @click.stop="open"
      @keydown.down.prevent="focusPanel"
      @keydown.esc.stop.prevent="closeNodeDiagnostics"
    >
      <span
        v-if="loading"
        class="loading loading-dots loading-xs"
      />
      <span v-else-if="latency > 0">{{ latency }}</span>
      <BoltIcon
        v-else
        class="size-3"
      />
    </button>
    <span
      class="border-base-content/20 h-2.5 border-l"
      aria-hidden="true"
    />
    <span
      class="text-base-content/65 flex min-w-6 items-center justify-center px-1.5"
      :title="
        download ? `上次手动下载测速：${download.mbps.toFixed(2)} Mbps` : '尚未手动测试下载速度'
      "
      :aria-label="download ? `下载 ${download.mbps.toFixed(2)} Mbps` : '下载速度未测试'"
    >
      <template v-if="download">{{ download.mbps.toFixed(1) }}</template>
      <ChartBarIcon
        v-else
        class="size-3"
      />
    </span>
  </div>
</template>
<script setup lang="ts">
import { getColorForLatency } from '@/helper'
import {
  closeNodeDiagnostics,
  diagnosticsAnchor,
  nodeDiagnostics,
  nodeResultKey,
  nodeResults,
  openNodeDiagnostics,
  scheduleNodeDiagnosticsClose,
} from '@/store/diagnostics'
import { getLatencyByName } from '@/store/proxies'
import { BoltIcon, ChartBarIcon } from '@heroicons/vue/24/outline'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ name: string; groupName?: string; loading?: boolean }>()
const anchor = ref<HTMLButtonElement>()
const latency = computed(() => getLatencyByName(props.name, props.groupName))
const download = computed(() => nodeResults[nodeResultKey(props.name)]?.download)
function open() {
  if (anchor.value) openNodeDiagnostics(props.name, props.groupName, anchor.value)
}
async function focusPanel() {
  open()
  await nextTick()
  document.getElementById('node-diagnostics-popover')?.focus()
}
onBeforeUnmount(() => {
  if (diagnosticsAnchor.value === anchor.value) closeNodeDiagnostics()
})
</script>
