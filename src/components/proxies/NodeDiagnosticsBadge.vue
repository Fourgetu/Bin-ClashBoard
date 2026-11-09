<template>
  <div
    class="bg-base-100 text-base-content ml-1 flex h-5 shrink-0 items-center rounded-full text-xs tabular-nums"
    @click.stop
  >
    <button
      ref="anchor"
      type="button"
      class="flex h-full min-w-8 items-center justify-center rounded-full px-1.5 outline-offset-2"
      :class="getColorForLatency(latency)"
      :aria-label="`${name} 延迟 ${latency > 0 ? latency + ' 毫秒' : '未测得'}，节点检测`"
      aria-haspopup="dialog"
      aria-controls="node-diagnostics-popover"
      :aria-expanded="diagnosticsAnchor === anchor && Boolean(nodeDiagnostics)"
      title="悬停查看详情，点击重新检测延迟"
      @mouseenter="open"
      @mouseleave="scheduleNodeDiagnosticsClose"
      @focus="open"
      @blur="scheduleNodeDiagnosticsClose"
      @click.stop="refreshLatency"
      @keydown.down.prevent="focusPanel"
      @keydown.esc.stop.prevent="closeNodeDiagnostics"
    >
      <span
        v-if="loading || testingLatency"
        class="loading loading-dots loading-xs"
      />
      <span v-else-if="latency > 0">{{ latency }}</span>
      <BoltIcon
        v-else
        class="size-3"
      />
    </button>
  </div>
</template>
<script setup lang="ts">
import { getColorForLatency } from '@/helper'
import {
  checkNode,
  closeNodeDiagnostics,
  diagnosticsAnchor,
  isNodeLatencyPending,
  nodeDiagnostics,
  openNodeDiagnostics,
  scheduleNodeDiagnosticsClose,
} from '@/store/diagnostics'
import { getLatencyByName } from '@/store/proxies'
import { BoltIcon } from '@heroicons/vue/24/outline'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ name: string; groupName?: string; loading?: boolean }>()
const anchor = ref<HTMLButtonElement>()
const latency = computed(() => getLatencyByName(props.name, props.groupName))
const testingLatency = computed(() => isNodeLatencyPending(props.name))
function open() {
  if (anchor.value) openNodeDiagnostics(props.name, props.groupName, anchor.value)
}
function refreshLatency() {
  open()
  void checkNode(props.name, props.groupName, 'latency', true)
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
