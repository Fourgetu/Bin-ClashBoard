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
  const directRulePolicyGroups = [
    ...new Set(
      [...ruleProxyNames]
        .map((name) => String(name || '').trim())
        .filter((name) => groupNameSet.has(name)),
    ),
  ]
  const referencedGroupNames = new Set<string>()
  const getChildGroupNames = (name: string) =>
    (groupMembers[name] || []).filter((memberName) => groupNameSet.has(memberName))
  const hasDescendantGroup = (
    rootName: string,
    targetName: string,
    visited = new Set<string>(),
  ): boolean => {
    if (rootName === targetName || visited.has(rootName)) {
      return false
    }

    visited.add(rootName)

    return getChildGroupNames(rootName).some(
      (memberName) =>
        memberName === targetName || hasDescendantGroup(memberName, targetName, visited),
    )
  }

  uniqueGroupNames.forEach((name) => {
    getChildGroupNames(name).forEach((memberName) => {
      referencedGroupNames.add(memberName)
    })
  })

  const fallbackPolicyGroups = new Set(
    uniqueGroupNames.filter((name) => !referencedGroupNames.has(name)),
  )
  const topLevelRulePolicyGroups = directRulePolicyGroups.filter(
    (name) =>
      !directRulePolicyGroups.some(
        (candidate) => candidate !== name && hasDescendantGroup(candidate, name),
      ),
  )
  const policyGroupNames =
    topLevelRulePolicyGroups.length > 0 ? new Set(topLevelRulePolicyGroups) : fallbackPolicyGroups

  return {
    policyGroups: uniqueGroupNames.filter((name) => policyGroupNames.has(name)),
    nodeGroups: uniqueGroupNames.filter((name) => !policyGroupNames.has(name)),
  }
}
