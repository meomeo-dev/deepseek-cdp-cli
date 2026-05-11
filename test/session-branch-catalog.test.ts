import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { resolveDeepSeekSessionBranchTarget } from '../src/domain/session/sessionBranchCatalog.js'
import { listDeepSeekSessionBranches } from '../src/application/usecases/listDeepSeekSessionBranches.js'
import { loadSessionFromFile } from '../src/infrastructure/deepseek/fileSystemSessionStore.js'

void test('lists a stable DeepSeek branch catalog from a history_messages-derived session', async () => {
  const result = await listDeepSeekSessionBranches({
    sessionFile: join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
  })

  assert.equal(result.authoritativeSessionId, 'session-history-001')
  assert.equal(result.catalog.branchCount, 2)
  assert.equal(result.catalog.defaultBranchId, 'branch-main')
  assert.equal(result.catalog.activeBranchId, null)
  assert.equal(result.catalog.activeBranchSource, 'unavailable')
  assert.equal(result.catalog.branches[0]?.branchId, 'branch-main')
  assert.equal(result.catalog.branches[0]?.messageCount, 2)
  assert.equal(result.catalog.branches[0]?.previewText, '请总结附件并给出引用。')
  assert.equal(result.catalog.branches[0]?.lineageKind, 'root')
  assert.equal(result.catalog.branches[1]?.branchId, 'branch-alt')
  assert.equal(result.catalog.branches[1]?.sourceMessageId, 'user-2')
  assert.equal(result.catalog.branches[1]?.parentBranchId, null)
  assert.equal(result.catalog.branches[1]?.lineageKind, 'unresolved')
  assert.equal(result.catalog.branches[1]?.lastMessageRole, 'assistant')
})

void test('branch resolver fails with the available branch ids when a branch is missing', async () => {
  const session = await loadSessionFromFile(join(process.cwd(), 'test/fixtures/sample-history-messages.json'))

  assert.throws(
    () =>
      resolveDeepSeekSessionBranchTarget({
        session,
        branchId: 'branch-missing',
        sessionFile: 'fixture.json',
      }),
    /Available branches: branch-main, branch-alt/i,
  )
})

void test('branch listing resolves a stored session by sessionId and sessionStoreDir', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-branch-catalog-'))

  try {
    const sessionStoreDir = join(outputDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await copyFile(
      join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      join(sessionStoreDir, 'session-history-001.json'),
    )

    const result = await listDeepSeekSessionBranches({
      sessionId: 'session-history-001',
      sessionStoreDir,
    })

    assert.equal(result.sessionFile, join(sessionStoreDir, 'session-history-001.json'))
    assert.equal(result.catalog.branchCount, 2)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})
