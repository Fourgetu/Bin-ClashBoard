<template>
  <DialogWrapper
    v-model="connectionDetailModalShow"
    :title="$t('connectionDetails')"
    :box-class="proxyChainStart ? `max-w-256` : `max-w-128`"
  >
    <div class="flex flex-col md:flex-row">
      <div class="md:w-128">
        <div class="mb-2 flex gap-1">
          <button
            class="rounded-full px-3 py-1 text-xs"
            :class="!jsonMode ? 'bg-success/25 text-success' : 'text-base-content/55'"
            @click="jsonMode = false"
          >
            格式化显示
          </button>
          <button
            class="rounded-full px-3 py-1 text-xs"
            :class="jsonMode ? 'bg-success/25 text-success' : 'text-base-content/55'"
            @click="jsonMode = true"
          >
            JSON 数据
          </button>
        </div>
        <VueJsonPretty
          v-if="jsonMode"
          :data="infoConn"
          class="overflow-y-auto"
        >
          <template #renderNodeValue="{ node, defaultValue }">
            <template
              v-if="node.path.startsWith('root.chains') && proxyMap[node.content]?.icon"
            >
              <span
                >"<ProxyIcon
                  :icon="proxyMap[node.content].icon"
                  class="inline-block"
                  :margin="0"
                />{{ node.content }}"
              </span>
            </template>
            <template v-else>
              {{ defaultValue }}
            </template>
          </template>
        </VueJsonPretty>
        <dl
          v-else
          class="space-y-1 text-xs"
        >
          <div
            v-for="row in formattedRows"
            :key="row.label"
            class="flex gap-2"
          >
            <dt class="text-base-content/50 w-20 shrink-0">{{ row.label }}</dt>
            <dd class="min-w-0 flex-1 break-all">{{ row.value || '-' }}</dd>
          </div>
        </dl>
        <div
          class="min-h-12 shrink-0 pt-2 text-sm"
          v-if="destinationIP && !isPrivateIP"
        >
          <template v-if="details">
            <div class="flex flex-wrap items-center gap-1">
              <ArrowRightCircleIcon class="h-4 w-4 shrink-0" />
              <div>
                {{ details?.ip }}
              </div>
              <div>( AS{{ details?.asn }} )</div>
            </div>
            <div class="flex flex-wrap">
              <div
                class="mr-3 flex items-center gap-1"
                v-if="details?.country"
              >
                <MapPinIcon class="h-4 w-4 shrink-0" />
                <template v-if="details?.city && details?.city !== details?.country">
                  {{ details?.city }},
                </template>
                <template v-else-if="details?.region && details?.region !== details?.country">
                  {{ details?.region }},
                </template>
                {{ details?.country }}
              </div>
              <div class="flex items-center gap-1">
                <ServerIcon class="h-4 w-4 shrink-0" />
                {{ details?.organization }}
              </div>
            </div>
          </template>
        </div>
      </div>
      <template v-if="proxyChainStart">
        <div class="divider md:divider-horizontal m-0"></div>
        <div class="md:w-128">
          <div class="flex items-start gap-3">
            <ProxyIcon
              v-if="policyProxy?.icon"
              :icon="policyProxy.icon"
              class="size-8 shrink-0"
              :margin="0"
            />
            <div
              v-else
              class="bg-base-200 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
            >
              {{ policyName.slice(0, 1) }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold">{{ policyName }}</span>
                <span class="text-base-content/45 text-xs">域名穿透</span>
                <span class="text-base-content/45 text-xs">
                  {{ policyProxy?.type || '策略组' }}
                  <template v-if="policyMembers.length"
                    >({{ selectedIndex }}/{{ policyMembers.length }})</template
                  >
                </span>
                <span
                  v-if="policyDelay"
                  class="badge badge-xs ml-auto"
                  >{{ policyDelay }}</span
                >
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-1">
                <template
                  v-for="(chip, index) in chainChips"
                  :key="`${chip.name}-${index}`"
                >
                  <span class="group relative inline-flex">
                    <span
                      class="badge badge-xs gap-1 whitespace-nowrap"
                      :class="chip.tone"
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
                    <span
                      class="bg-base-content text-base-100 pointer-events-none absolute -top-7 left-0 z-20 hidden items-center gap-1 rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap group-hover:inline-flex"
                    >
                      {{ chip.nowName }}
                      <span class="opacity-80">{{
                        chip.nowDelay ? `${chip.nowDelay}ms` : '—'
                      }}</span>
                    </span>
                  </span>
                  <ChevronRightIcon
                    v-if="index < chainChips.length - 1"
                    class="size-3 shrink-0 opacity-30"
                  />
                </template>
              </div>
              <ProxyPreview
                v-if="policyMembers.length"
                :nodes="policyMembers"
                :now="policyProxy?.now"
                :group-name="policyName"
                :force-dots="true"
                @nodeclick="selectMember"
              />
              <p
                v-else
                class="text-base-content/45 mt-3 text-xs"
              >
                代理列表未就绪，暂时只能显示连接链路
              </p>
            </div>
          </div>
          <div class="border-base-content/10 mt-3 border-t pt-3">
            <div class="mb-2 flex items-center gap-2 text-xs">
              <span class="text-base-content/50">节点选择</span>
              <span
                v-if="selectError"
                class="text-error"
                >{{ selectError }}</span
              >
              <span
                v-else-if="selecting"
                class="text-base-content/45"
                >切换中…</span
              >
            </div>
            <ProxyNodeGrid v-if="policyMembers.length">
              <ProxyNodeCard
                v-for="member in policyMembers"
                :key="member"
                :name="member"
                :group-name="policyName"
                :active="member === policyProxy?.now"
                @click.stop="selectMember(member)"
              />
            </ProxyNodeGrid>
            <p
              v-else
              class="text-base-content/45 text-xs"
            >
              代理列表未就绪，暂时只能显示连接链路
            </p>
          </div>
        </div>
      </template>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { getIPInfo, type IPInfo } from '@/api/geoip'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { prettyBytesHelper } from '@/helper/utils'
import { useConnections } from '@/composables/connections'
import ProxyNodeCard from '@/components/proxies/ProxyNodeCard.vue'
import ProxyNodeGrid from '@/components/proxies/ProxyNodeGrid.vue'
import ProxyPreview from '@/components/proxies/ProxyPreview.vue'
import { fetchProxies, getLatencyByName, proxyMap } from '@/store/proxies'
import {
  ArrowRightCircleIcon,
  ChevronRightIcon,
  MapPinIcon,
  ServerIcon,
  ShareIcon,
  SignalIcon,
} from '@heroicons/vue/24/outline'
import * as ipaddr from 'ipaddr.js'
import { last } from 'lodash'
import { computed, ref, watch } from 'vue'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'
import { selectProxyAPI } from '@/api'
import ProxyIcon from '../proxies/ProxyIcon.vue'

const { infoConn, connectionDetailModalShow } = useConnections()
const details = ref<IPInfo | null>(null)
const jsonMode = ref(false)

const formattedRows = computed(() => {
  const conn = infoConn.value
  if (!conn) return []
  const m = conn.metadata
  return [
    { label: '域名', value: m.host || m.sniffHost || '' },
    { label: '目标 IP', value: m.destinationIP },
    { label: '端口', value: m.destinationPort },
    { label: '网络', value: m.network },
    { label: '入站', value: m.inboundName || m.type },
    { label: '来源 IP', value: m.sourceIP },
    { label: '命中规则', value: [conn.rule, conn.rulePayload].filter(Boolean).join(' ') },
    { label: '链路', value: [...(conn.chains || [])].reverse().join(' → ') },
    { label: '开始时间', value: conn.start },
    { label: '上传', value: prettyBytesHelper(conn.upload) },
    { label: '下载', value: prettyBytesHelper(conn.download) },
  ]
})

const destinationIP = computed(() => infoConn.value?.metadata.destinationIP)
const isPrivateIP = computed(() => {
  if (!destinationIP.value || !ipaddr.isValid(destinationIP.value)) {
    return false
  }

  const addr = ipaddr.parse(destinationIP.value)
  const range = addr.range()

  return ['private', 'uniqueLocal', 'loopback', 'linkLocal'].includes(range)
})

const proxyChainStart = computed(() => {
  if (!infoConn.value?.chains || !infoConn.value.chains.length) {
    return null
  }

  return last(infoConn.value.chains)
})

const policyName = computed(() => proxyChainStart.value || '')
const policyProxy = computed(() => (policyName.value ? proxyMap.value[policyName.value] : null))
const policyMembers = computed(() => policyProxy.value?.all || [])
const policyDelay = computed(() => policyProxy.value?.history?.[0]?.delay ?? null)
const selectedIndex = computed(() => {
  const index = policyMembers.value.indexOf(policyProxy.value?.now || '')
  return index < 0 ? 0 : index + 1
})

const selecting = ref(false)
const selectError = ref('')
const selectMember = async (name: string) => {
  if (!policyName.value || selecting.value) return
  if (name === policyProxy.value?.now) return
  selecting.value = true
  selectError.value = ''
  try {
    await selectProxyAPI(policyName.value, name)
    if (proxyMap.value[policyName.value]) {
      proxyMap.value[policyName.value].now = name
    }
    await fetchProxies()
  } catch (cause) {
    selectError.value = cause instanceof Error ? cause.message : '切换节点失败'
  } finally {
    selecting.value = false
  }
}

const GROUP_TYPES = ['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay', 'Compatible']
const chainChips = computed(() => {
  const names = [...(infoConn.value?.chains || [])].reverse()
  return names.map((name, index) => {
    const proxy = proxyMap.value[name]
    const isGroup = !!proxy && GROUP_TYPES.includes(proxy.type)
    const role = index === 0 ? (isGroup ? '策略组' : '出站') : isGroup ? '节点组' : '节点'
    const nowName = (isGroup ? proxy?.now : name) || name
    return {
      name,
      role,
      nowName,
      nowDelay: getLatencyByName(nowName, policyName.value) || '',
      tone:
        role === '策略组'
          ? 'badge-primary badge-soft'
          : role === '节点组'
            ? 'badge-warning badge-soft'
            : 'badge-ghost',
      delay: getLatencyByName(name, policyName.value) || '',
    }
  })
})
/** 与「代理」页一致：独立测速结果在 extra[testUrl]，必须走 getLatencyByName */

watch(
  () => destinationIP.value,
  (newIP) => {
    if (!newIP) {
      return
    }

    if (isPrivateIP.value) {
      details.value = null
      return
    }

    if (details.value?.ip === newIP) {
      return
    }

    details.value = null
    getIPInfo(infoConn.value?.metadata.destinationIP).then((res) => {
      details.value = res
    })
  },
)
</script>

