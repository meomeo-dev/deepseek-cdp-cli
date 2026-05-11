import test from 'node:test'
import assert from 'node:assert/strict'

const { scanTextForSecrets } = (await import('../scripts/security-secrets.mjs')) as {
  scanTextForSecrets: (
    relativePath: string,
    content: string,
    config: {
      ignoredPaths: string[]
      allowedMatches: Array<{
        ruleId: string
        path: string
        matchContains?: string
      }>
    },
  ) => Array<{
    ruleId: string
  }>
}

void test('security secrets flags token-like material', () => {
  const findings = scanTextForSecrets(
    'README.md',
    'token=ghp_123456789012345678901234567890123456',
    {
      ignoredPaths: [],
      allowedMatches: [],
    },
  )

  assert.equal(findings.length, 1)
  assert.equal(findings[0]?.ruleId, 'github-token')
})

void test('security secrets respects allowlist entries', () => {
  const findings = scanTextForSecrets(
    'docs/example.md',
    'token=ghp_123456789012345678901234567890123456',
    {
      ignoredPaths: [],
      allowedMatches: [
        {
          ruleId: 'github-token',
          path: 'docs/**',
          matchContains: 'ghp_1234',
        },
      ],
    },
  )

  assert.equal(findings.length, 0)
})
