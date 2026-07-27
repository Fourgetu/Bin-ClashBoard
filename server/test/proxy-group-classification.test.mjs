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
