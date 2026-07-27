type ProxyGroupClassificationInput = {
  groupNames: string[]
  groupMembers: Record<string, readonly string[]>
  ruleProxyNames: Iterable<string>
}

export const classifyProxyGroups = ({
  groupNames,
  groupMembers,
  ruleProxyNames,
}: ProxyGroupClassificationInput) => {
  const uniqueGroupNames = [...new Set(groupNames)]
  const groupNameSet = new Set(uniqueGroupNames)
  const directRulePolicyGroups = new Set(
    [...ruleProxyNames]
      .map((name) => String(name || '').trim())
      .filter((name) => groupNameSet.has(name)),
  )
  const referencedGroupNames = new Set<string>()

  uniqueGroupNames.forEach((name) => {
    ;(groupMembers[name] || []).forEach((memberName) => {
      if (groupNameSet.has(memberName)) {
        referencedGroupNames.add(memberName)
      }
    })
  })

  const fallbackPolicyGroups = new Set(
    uniqueGroupNames.filter((name) => !referencedGroupNames.has(name)),
  )
  const policyGroupNames =
    directRulePolicyGroups.size > 0 ? directRulePolicyGroups : fallbackPolicyGroups

  return {
    policyGroups: uniqueGroupNames.filter((name) => policyGroupNames.has(name)),
    nodeGroups: uniqueGroupNames.filter((name) => !policyGroupNames.has(name)),
  }
}
