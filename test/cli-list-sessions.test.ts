import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveStoredSessionToFile } from '../src/infrastructure/deepseek/fileSystemSessionStore.js'
import type { DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

void test('list-sessions text mode prints the human-readable catalog and sends warnings to stderr', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cli-list-sessions-text-'))

  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-alpha.json'),
      createStoredSession({
        sessionId: 'session-alpha',
        title: 'Alpha Session',
        userPromptPreview: 'alpha topic',
        createdAt: '2026-04-10T00:00:00.000Z',
        persistedAt: '2026-04-10T00:01:00.000Z',
      }),
    )
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-beta.json'),
      createStoredSession({
        sessionId: 'session-beta',
        title: 'Beta Session',
        userPromptPreview: 'beta topic',
        createdAt: '2026-04-11T00:00:00.000Z',
        persistedAt: '2026-04-11T00:01:00.000Z',
      }),
    )
    await writeFile(join(sessionStoreDir, 'session-bad.json'), '{not-valid-json}\n', 'utf8')

    const result = runCli([
      'list-sessions',
      '--session-store-dir',
      sessionStoreDir,
      '--query',
      'session',
      '--limit',
      '1',
    ])

    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      new RegExp(`Showing 1 of 2 matched stored session\\(s\\) under ${escapeRegExp(sessionStoreDir)}\\.`),
    )
    assert.match(result.stdout, /query: session/)
    assert.match(result.stdout, /limit: 1/)
    assert.match(result.stdout, /sessionId: session-beta/)
    assert.match(result.stdout, /title: Beta Session/)
    assert.match(result.stdout, /persistedAt: 2026-04-11T00:01:00\.000Z/)
    assert.match(result.stdout, /createdAt: 2026-04-11T00:00:00\.000Z/)
    assert.match(result.stdout, /userPromptPreview: beta topic/)
    assert.match(
      result.stdout,
      new RegExp(`sessionFile: ${escapeRegExp(join(sessionStoreDir, 'session-beta.json'))}`),
    )
    assert.doesNotMatch(result.stdout, /session-alpha/)
    assert.doesNotMatch(result.stdout, /session_file_load_failed/)
    assert.match(result.stderr, /list-sessions warnings \(1\):/)
    assert.match(result.stderr, /warning \[session_file_load_failed\]/)
    assert.match(
      result.stderr,
      new RegExp(escapeRegExp(join(sessionStoreDir, 'session-bad.json'))),
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('list-sessions json mode prints the authoritative envelope and keeps warnings in payload', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cli-list-sessions-json-'))

  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-budget.json'),
      createStoredSession({
        sessionId: 'session-budget',
        title: 'Budget Session',
        userPromptPreview: 'budget topic',
        createdAt: '2026-04-12T00:00:00.000Z',
        persistedAt: '2026-04-12T00:01:00.000Z',
      }),
    )
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-inconsistent.json'),
      createStoredSession({
        sessionId: 'session-inconsistent',
        title: 'Inconsistent Session',
        userPromptPreview: 'broken session',
        metadataAuthoritativeSessionId: 'session-other',
      }),
    )

    const result = runCli([
      'list-sessions',
      '--session-store-dir',
      sessionStoreDir,
      '--query',
      'budget',
      '--limit',
      '5',
      '--format',
      'json',
    ])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const output = JSON.parse(result.stdout) as {
      sessionStoreDir: string
      query: string | null
      limit: number | null
      scannedFileCount: number
      validSessionCount: number
      matchedSessionCount: number
      returnedSessionCount: number
      truncated: boolean
      warnings: Array<{ code: string; sessionFile?: string; message: string }>
      sessions: Array<{ sessionId: string; title: string; sessionFile: string }>
    }

    assert.deepEqual(Object.keys(output).sort(), [
      'limit',
      'matchedSessionCount',
      'query',
      'returnedSessionCount',
      'scannedFileCount',
      'sessionStoreDir',
      'sessions',
      'truncated',
      'validSessionCount',
      'warnings',
    ])
    assert.equal(output.sessionStoreDir, sessionStoreDir)
    assert.equal(output.query, 'budget')
    assert.equal(output.limit, 5)
    assert.equal(output.scannedFileCount, 2)
    assert.equal(output.validSessionCount, 1)
    assert.equal(output.matchedSessionCount, 1)
    assert.equal(output.returnedSessionCount, 1)
    assert.equal(output.truncated, false)
    assert.equal(output.sessions.length, 1)
    assert.equal(output.sessions[0]?.sessionId, 'session-budget')
    assert.equal(output.sessions[0]?.title, 'Budget Session')
    assert.equal(output.warnings.length, 1)
    assert.equal(output.warnings[0]?.code, 'session_file_inconsistent')
    assert.equal(output.warnings[0]?.sessionFile, join(sessionStoreDir, 'session-inconsistent.json'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('list-sessions fails closed through the CLI when every top-level candidate is invalid', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cli-list-sessions-all-invalid-'))

  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await writeFile(join(sessionStoreDir, 'session-bad.json'), '{not-valid-json}\n', 'utf8')
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-inconsistent.json'),
      createStoredSession({
        sessionId: 'session-inconsistent',
        title: 'Inconsistent Session',
        userPromptPreview: 'broken session',
        metadataAuthoritativeSessionId: 'session-other',
      }),
    )

    const result = runCli([
      'list-sessions',
      '--session-store-dir',
      sessionStoreDir,
      '--format',
      'json',
    ])

    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /failed closed/i)
    assert.match(result.stderr, /session-bad\.json/)
    assert.match(result.stderr, /session-inconsistent\.json/)
    assert.doesNotMatch(result.stderr, /No stored sessions found/i)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

function createStoredSession(input: {
  sessionId: string
  title: string
  userPromptPreview: string
  createdAt?: string | undefined
  persistedAt?: string | undefined
  metadataAuthoritativeSessionId?: string | undefined
}): DeepSeekStoredSession {
  const createdAt = input.createdAt ?? '2026-04-04T00:00:00.000Z'
  const persistedAt = input.persistedAt ?? createdAt

  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: input.sessionId,
      agentId: 'chat',
      title: input.title,
      createdAt,
      branches: [
        {
          id: 'branch-main',
          sessionId: input.sessionId,
          title: 'Main Branch',
          createdAt,
          messages: [
            {
              id: `${input.sessionId}-user-1`,
              role: 'user',
              text: input.userPromptPreview,
              createdAt,
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
          ],
        },
      ],
    },
    metadata: {
      source: 'first-message',
      requestedUrl: 'https://chat.deepseek.com/',
      finalUrl: `https://chat.deepseek.com/a/chat/s/${input.sessionId}`,
      authoritativeAgentId: 'chat',
      authoritativeSessionId: input.metadataAuthoritativeSessionId ?? input.sessionId,
      sessionCreate: null,
      generationObservations: [],
      outputTokensUsed: 0,
      settledAfterMs: 0,
      firstBatchSummary: {
        captureMode: 'summary-only',
        userMessageId: `${input.sessionId}-user-1`,
        assistantMessageId: `${input.sessionId}-assistant-1`,
        userPrompt: input.userPromptPreview,
        userPromptPreview: input.userPromptPreview,
        assistantSummary: 'summary',
        generationEndpoints: [],
        completionRequestObserved: false,
      },
      transcriptRecovery: null,
      persistedAt,
    },
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
