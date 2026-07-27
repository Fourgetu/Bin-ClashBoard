import { isSingBox } from '@/api'
import { GLOBAL, PROXY_TAB_TYPE } from '@/constant'
import { isHiddenGroup } from '@/helper'
import { getDomainGroupNames, getDomainGroupRuleSetOptions } from '@/helper/proxyDomainGroups'
import { classifyProxyGroups } from '@/helper/proxyGroupClassification'
import { fetchServerApi } from '@/store/auth'
import { configs } from '@/store/config'
import { proxiesTabShow, proxyGroupList, proxyMap, proxyProviederList } from '@/store/proxies'
import { rules } from '@/store/rules'
import { customGlobalNode, displayGlobalByMode, manageHiddenGroup } from '@/store/settings'
import { isEmpty } from 'lodash'
import { computed, ref } from 'vue'

const filterGroups = (all: string[]) => {
  if (manageHiddenGroup.value) {
    return all
  }

  return all.filter((name) => !isHiddenGroup(name))
}

const getRenderGroups = () => {
  if (isEmpty(proxyMap.value)) {
    return []
  }

  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    return proxyProviederList.value.map((group) => group.name)
  }

  const currentGroups = getCurrentProxyGroups()

  if (proxiesTabShow.value === PROXY_TAB_TYPE.POLICY) {
    return currentGroups.filter((name) => isPolicyGroup(name))
  }

  if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) {
    return currentGroups.filter((name) => !isPolicyGroup(name))
  }

  if (proxiesTabShow.value === PROXY_TAB_TYPE.DOMAIN) {
    return []
  }

  return currentGroups
}

const getCurrentProxyGroups = () => {
  if (displayGlobalByMode.value) {
    if (configs.value?.mode.toUpperCase() === GLOBAL) {
      return [
        isSingBox.value && proxyMap.value[customGlobalNode.value] ? customGlobalNode.value : GLOBAL,
      ]
    }

    return filterGroups(proxyGroupList.value)
  }

  return filterGroups([...proxyGroupList.value, GLOBAL])
}

const getChildGroupNames = (name: string, currentGroupSet: Set<string>) => {
  const proxyGroup = proxyMap.value[name]

  if (!proxyGroup?.all?.length) {
    return []
  }

  return proxyGroup.all.filter((member) => currentGroupSet.has(member))
}

const proxyGroupClassification = computed(() => {
  const groupNames = getCurrentProxyGroups()

  return classifyProxyGroups({
    groupNames,
    groupMembers: Object.fromEntries(
      groupNames.map((name) => [name, proxyMap.value[name]?.all || []]),
    ),
    ruleProxyNames: rules.value.map((rule) => rule.proxy),
  })
})

const isPolicyGroup = (name: string) => {
  return proxyGroupClassification.value.policyGroups.includes(name)
}

export const disableProxiesPageScroll = ref(false)
export const isProxiesPageMounted = ref(false)
export const domainGroupSelectedName = ref('')
export const domainGroupSelectedProvider = ref('')
export const domainGroupSearch = ref('')
export const domainRuleConfigChanged = ref(false)
export const domainRulesReloadRevision = ref(0)
export const customDomainGroupsEnabled = ref(false)
export const policyGroups = computed(() => proxyGroupClassification.value.policyGroups)
export const domainGroups = computed(() =>
  getDomainGroupNames(rules.value, policyGroups.value, customDomainGroupsEnabled.value),
)
export const domainGroupProviderNames = computed(() =>
  getDomainGroupRuleSetOptions(domainGroupSelectedName.value, rules.value),
)
export const nodeGroups = computed(() => proxyGroupClassification.value.nodeGroups)
export const selectableProxyGroups = computed(() => getCurrentProxyGroups())
export const nodeGroupBlocks = computed(() => {
  const groups = nodeGroups.value
  const groupSet = new Set(groups)
  const referenced = new Set<string>()

  groups.forEach((name) => {
    getChildGroupNames(name, groupSet).forEach((childName) => {
      referenced.add(childName)
    })
  })

  const assigned = new Set<string>()
  const blocks: string[][] = []

  const appendBlock = (rootName: string) => {
    if (assigned.has(rootName) || !groupSet.has(rootName)) {
      return
    }

    const block: string[] = []
    const visited = new Set<string>()

    const walk = (name: string) => {
      if (visited.has(name) || assigned.has(name) || !groupSet.has(name)) {
        return
      }

      visited.add(name)
      assigned.add(name)
      block.push(name)

      getChildGroupNames(name, groupSet).forEach((childName) => {
        walk(childName)
      })
    }

    walk(rootName)

    if (block.length > 0) {
      blocks.push(block)
    }
  }

  groups
    .filter((name) => !referenced.has(name))
    .forEach((name) => {
      appendBlock(name)
    })

  groups.forEach((name) => {
    appendBlock(name)
  })

  return blocks
})
export const renderGroups = computed(() => {
  const groups = getRenderGroups()

  if (isProxiesPageMounted.value) {
    return groups
  }

  return groups.slice(0, 16)
})

export const fetchCustomDomainGroupsStatus = async () => {
  customDomainGroupsEnabled.value = false

  try {
    const response = await fetchServerApi('/api/proxy-domain-custom-sections')

    if (!response.ok) {
      return
    }

    const data = (await response.json().catch(() => null)) as { enabled?: boolean } | null
    customDomainGroupsEnabled.value = Boolean(data?.enabled)
  } catch {
    // The feature is unavailable without the optional OpenWrt rule source.
  }
}
