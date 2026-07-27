import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyProxyGroups } from '../../src/helper/proxyGroupClassification.ts'

test('rule-targeted service groups stay in the policy tab', () => {
  const result = classifyProxyGroups({
    groupNames: ['GitHub', 'YouTube', 'Hong Kong Manual'],
    groupMembers: {
      GitHub: ['Hong Kong Manual', 'HK 01'],
      YouTube: ['Hong Kong Manual', 'HK 01'],
      'Hong Kong Manual': ['HK 01', 'HK 02'],
    },
    ruleProxyNames: ['GitHub', 'YouTube'],
  })

  assert.deepEqual(result.policyGroups, ['GitHub', 'YouTube'])
  assert.deepEqual(result.nodeGroups, ['Hong Kong Manual'])
})

test('nested node groups stay in the node tab even when rules target them', () => {
  const result = classifyProxyGroups({
    groupNames: ['AI Services', 'Google', 'Home Broadband', 'MESL', 'Relay'],
    groupMembers: {
      'AI Services': ['Home Broadband', 'Relay'],
      Google: ['Home Broadband', 'Relay'],
      'Home Broadband': ['MESL', 'Relay'],
      MESL: ['Home 01', 'Home 02'],
      Relay: ['Relay 01', 'Relay 02'],
    },
    ruleProxyNames: ['AI Services', 'Google', 'Home Broadband'],
  })

  assert.deepEqual(result.policyGroups, ['AI Services', 'Google'])
  assert.deepEqual(result.nodeGroups, ['Home Broadband', 'MESL', 'Relay'])
})

test('top-level groups remain policy groups before rules are available', () => {
  const result = classifyProxyGroups({
    groupNames: ['Main Policy', 'Hong Kong Manual', 'US Manual'],
    groupMembers: {
      'Main Policy': ['Hong Kong Manual', 'US Manual'],
      'Hong Kong Manual': ['HK 01'],
      'US Manual': ['US 01'],
    },
    ruleProxyNames: [],
  })

  assert.deepEqual(result.policyGroups, ['Main Policy'])
  assert.deepEqual(result.nodeGroups, ['Hong Kong Manual', 'US Manual'])
})
