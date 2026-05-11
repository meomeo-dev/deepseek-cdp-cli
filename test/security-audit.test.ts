import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeAuditReport } from '../scripts/security-audit.mjs'

void test('security audit passes without high or critical vulnerabilities', () => {
  const summary = summarizeAuditReport(
    {
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 1,
          high: 0,
          critical: 0,
          total: 1,
        },
      },
    },
    'high',
  )

  assert.equal(summary.pass, true)
  assert.equal(summary.blockingCount, 0)
})

void test('security audit blocks high severity runtime vulnerabilities', () => {
  const summary = summarizeAuditReport(
    {
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 1,
          moderate: 0,
          high: 2,
          critical: 1,
          total: 4,
        },
      },
    },
    'high',
  )

  assert.equal(summary.pass, false)
  assert.equal(summary.blockingCount, 3)
})
