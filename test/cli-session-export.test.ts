import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

function runCli(args: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
  })
}

void test('exports a complete session through the CLI command when branchId is omitted', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'deepseek-cdp-cli-cli-export-full-'))

  try {
    const outputFile = join(outputDir, 'session.json')
    const result = runCli([
      'export-session',
      '--session-file',
      'test/fixtures/sample-history-messages.json',
      '--format',
      'json',
      '--output',
      outputFile,
    ])

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout) as {
      sessionId: string
      exportScope: string
      branchId: string | null
    }
    const document = JSON.parse(readFileSync(outputFile, 'utf8')) as {
      kind: string
      session: { branchCount: number }
      branches: Array<{ branchId: string }>
    }

    assert.equal(summary.sessionId, 'session-history-001')
    assert.equal(summary.exportScope, 'session')
    assert.equal(summary.branchId, null)
    assert.equal(document.kind, 'deepseek-session-export')
    assert.equal(document.session.branchCount, 2)
    assert.deepEqual(
      document.branches.map(branch => branch.branchId),
      ['branch-main', 'branch-alt'],
    )
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

void test('exports a single branch through the CLI command when branchId is provided', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'deepseek-cdp-cli-cli-export-branch-'))

  try {
    const outputFile = join(outputDir, 'branch.json')
    const result = runCli([
      'export-session',
      '--session-file',
      'test/fixtures/sample-history-messages.json',
      '--branch-id',
      'branch-alt',
      '--format',
      'json',
      '--output',
      outputFile,
    ])

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout) as {
      exportScope: string
      branchId: string | null
    }
    const document = JSON.parse(readFileSync(outputFile, 'utf8')) as {
      kind: string
      branch: { branchId: string }
    }

    assert.equal(summary.exportScope, 'branch')
    assert.equal(summary.branchId, 'branch-alt')
    assert.equal(document.kind, 'deepseek-session-branch-export')
    assert.equal(document.branch.branchId, 'branch-alt')
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

void test('exports a single branch through the CLI command in text format', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'deepseek-cdp-cli-cli-export-branch-text-'))

  try {
    const outputFile = join(outputDir, 'branch.txt')
    const result = runCli([
      'export-session',
      '--session-file',
      'test/fixtures/sample-history-messages.json',
      '--branch-id',
      'branch-main',
      '--format',
      'text',
      '--output',
      outputFile,
    ])

    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout) as {
      exportScope: string
      branchId: string | null
      format: string
    }
    const content = readFileSync(outputFile, 'utf8')

    assert.equal(summary.exportScope, 'branch')
    assert.equal(summary.branchId, 'branch-main')
    assert.equal(summary.format, 'text')
    assert.match(content, /Branch: Main Branch \(branch-main\)/)
    assert.match(content, /Assistant:\n这是基于 history_messages 的总结。/)
    assert.match(
      content,
      /Citations:\n- \[citation\] Example Search Result \| https:\/\/example\.com\/result/,
    )
    assert.doesNotMatch(content, /DeepSeek Session Branch Export/)
    assert.doesNotMatch(content, /Search Evidence/)
    assert.doesNotMatch(content, /^## /m)
    assert.doesNotMatch(content, /\[[^\]]+\]\(https?:\/\//)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})
