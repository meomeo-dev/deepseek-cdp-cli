import test from 'node:test'
import assert from 'node:assert/strict'
import { scanTextForSast } from '../scripts/security-sast.mjs'

void test('security sast flags unallowlisted spawn usage', () => {
  const findings = scanTextForSast('src/example.ts', "spawn('rm', ['-rf'])", {
    ignoredPaths: [],
    allowedFindings: [],
  })

  assert.equal(findings.length, 1)
  assert.equal(findings[0]?.ruleId, 'child-process-spawn')
})

void test('security sast respects file-level allowlist', () => {
  const findings = scanTextForSast(
    'scripts/release-preflight.mjs',
    "spawnSync('npm', ['pack'])",
    {
      ignoredPaths: [],
      allowedFindings: [
        {
          ruleId: 'child-process-spawn',
          path: 'scripts/release-preflight.mjs',
        },
      ],
    },
  )

  assert.equal(findings.length, 0)
})
