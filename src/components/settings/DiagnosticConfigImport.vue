<template>
  <details
    class="border-base-content/10 border-t pt-3"
    @keydown.enter.stop
  >
    <summary class="cursor-pointer text-sm font-medium">节点检测配置（桌面客户端）</summary>
    <div class="mt-3 flex flex-col gap-3 text-xs">
      <p class="text-base-content/65">
        导入 Clash Mi 等客户端当前使用的 Clash / Mihomo
        YAML，只用于此后端的节点信息、风险和手动下载检测。 电脑 Docker 部署同样适用，无需
        SSH。选择一次主配置并点击导入，面板会读取其中的 HTTP / HTTPS
        订阅。配置保存在当前面板的数据目录，订阅更新后需重新导入。
      </p>
      <p
        v-if="disabled"
        class="text-warning"
      >
        后端地址有未保存的修改，请先保存并重新打开编辑窗口。
      </p>
      <p
        v-if="status?.configured"
        :class="status.stale ? 'text-warning' : 'text-success'"
      >
        {{
          status.stale
            ? '后端地址已变化，请重新导入或移除配置'
            : `已导入 ${status.nodeCount} 个节点`
        }}
        <span
          v-if="status.updatedAt"
          class="text-base-content/55"
        >
          · {{ new Date(status.updatedAt).toLocaleString() }}</span
        >
      </p>
      <p
        v-else-if="status"
        class="text-base-content/55"
      >
        尚未导入。选择该客户端的配置文件即可；已配置的 SSH / 服务端来源仍可使用。
      </p>
      <label class="flex flex-col gap-1">
        <span>配置或订阅 YAML 文件</span>
        <input
          class="file-input file-input-sm w-full"
          type="file"
          accept=".yaml,.yml,.json"
          :disabled="locked"
          @change="readFile($event)"
        />
      </label>
      <details>
        <summary class="text-base-content/65 cursor-pointer">或粘贴 YAML 配置</summary>
        <textarea
          v-model="configText"
          class="textarea mt-2 w-full font-mono text-xs"
          rows="5"
          aria-label="节点检测 YAML 配置"
          placeholder="proxies: ..."
          spellcheck="false"
          :disabled="locked"
        ></textarea>
      </details>
      <p
        v-if="fileName"
        class="text-base-content/65"
      >
        已选择：{{ fileName }}
      </p>
      <p
        v-if="preview"
        class="text-base-content/65"
      >
        检测到 {{ preview.providers.length }} 个订阅，其中
        {{
          preview.providers.filter((provider) => provider.needsFile && provider.canDownload).length
        }}
        个将在点击导入后读取。仅有本地路径的订阅需要补充节点缓存。
      </p>
      <template v-if="missingProviders.length">
        <label
          v-for="provider in missingProviders"
          :key="provider.name"
          class="flex flex-col gap-1"
        >
          <span>订阅「{{ provider.name }}」的节点缓存 YAML</span>
          <span class="text-warning">{{ provider.reason }}</span>
          <input
            class="file-input file-input-sm w-full"
            type="file"
            accept=".yaml,.yml,.json"
            :disabled="locked"
            @change="readFile($event, provider.name)"
          />
          <span
            v-if="providerFileNames[provider.name]"
            class="text-base-content/65"
          >
            已选择：{{ providerFileNames[provider.name] }}
          </span>
        </label>
        <p class="text-base-content/55">
          仅需补充上面未能读取的订阅，也可直接重试导入。请选择各自包含实际节点的缓存文件，不要重复选择主配置。配置和订阅合计最多
          6 MB。
        </p>
      </template>
      <p
        v-if="message"
        role="status"
        :class="failed ? 'text-error' : 'text-success'"
      >
        {{ message }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm"
          :disabled="locked || !configText.trim()"
          @click="checkConfig"
        >
          检查配置
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="locked || !ready"
          @click="importConfig"
        >
          {{
            busy === 'import'
              ? '正在读取订阅并导入…'
              : missingProviders.length
                ? '重新尝试导入'
                : '导入到此后端'
          }}
        </button>
        <button
          v-if="status?.configured"
          type="button"
          class="btn btn-sm"
          :disabled="locked"
          @click="removeConfig"
        >
          移除检测配置
        </button>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { fetchServerApi } from '@/store/auth'
import { clearBackendDiagnostics } from '@/store/diagnostics'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ backendUuid: string; disabled?: boolean }>()
type Status = {
  configured: boolean
  stale?: boolean
  nodeCount?: number
  updatedAt?: string
  matchedCount?: number
}
type Preview = { providers: { name: string; needsFile: boolean; canDownload: boolean }[] }
type ProviderFailure = { name: string; reason: string }
const status = ref<Status | null>(null)
const preview = ref<Preview | null>(null)
const missingProviders = ref<ProviderFailure[]>([])
const configText = ref('')
const providerFiles = ref<Record<string, string>>({})
const providerFileNames = ref<Record<string, string>>({})
const fileName = ref('')
const message = ref('')
const failed = ref(false)
const busy = ref('')
const abort = new AbortController()
const locked = computed(() => props.disabled || Boolean(busy.value))
const ready = computed(() => Boolean(configText.value.trim()))
watch(
  configText,
  () => {
    preview.value = null
    missingProviders.value = []
    providerFiles.value = {}
    providerFileNames.value = {}
    fileName.value = ''
    message.value = ''
  },
  { flush: 'sync' },
)
onUnmounted(() => abort.abort())

async function request<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetchServerApi(`/api/diagnostics/config/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, backendUuid: props.backendUuid }),
    signal: abort.signal,
  })
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('请更新面板 Node 后端后使用配置导入')
  const data = await response.json()
  if (!response.ok) {
    if (action === 'import') missingProviders.value = data.providers || []
    throw new Error(data.message || `操作失败：HTTP ${response.status}`)
  }
  return data
}
async function perform(action: string, operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = action
  message.value = ''
  failed.value = false
  try {
    await operation()
  } catch (error) {
    if (!abort.signal.aborted) {
      failed.value = true
      message.value = error instanceof Error ? error.message : '操作失败'
    }
  } finally {
    busy.value = ''
  }
}
onMounted(() => {
  void perform('status', async () => {
    status.value = await request<Status>('status')
  })
})
async function readFile(event: Event, providerName?: string) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await perform('file', async () => {
    if (file.size > 6 * 1024 * 1024) throw new Error('文件不能超过 6 MB')
    const text = await file.text()
    if (providerName !== undefined) {
      providerFiles.value = { ...providerFiles.value, [providerName]: text }
      providerFileNames.value = { ...providerFileNames.value, [providerName]: file.name }
    } else {
      configText.value = text
      fileName.value = file.name
    }
  })
  input.value = ''
}
function checkConfig() {
  void perform('preview', async () => {
    preview.value = await request<Preview>('preview', { configText: configText.value })
  })
}
function importConfig() {
  void perform('import', async () => {
    const result = await request<Status>('import', {
      configText: configText.value,
      providerFiles: providerFiles.value,
    })
    status.value = result
    await clearBackendDiagnostics(props.backendUuid)
    configText.value = ''
    fileName.value = ''
    preview.value = null
    providerFiles.value = {}
    message.value = `已保存 ${result.nodeCount} 个节点，其中 ${result.matchedCount} 个名称与此后端匹配。现在可回到节点卡片查询。`
  })
}
function removeConfig() {
  void perform('remove', async () => {
    status.value = await request<Status>('remove')
    await clearBackendDiagnostics(props.backendUuid)
    message.value = '已移除检测配置；客户端节点和订阅未修改。'
  })
}
</script>
