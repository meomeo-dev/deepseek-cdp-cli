import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listDeepSeekSessions } from '../src/application/usecases/listDeepSeekSessions.js'
import { saveStoredSessionToFile } from '../src/infrastructure/deepseek/fileSystemSessionStore.js'
import {
  isDeepSeekSessionCatalogError,
} from '../src/shared/errors/deepSeekSessionCatalogError.js'
import type { DeepSeekSession, DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('returns an empty catalog when the session store directory does not exist', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-sessions-missing-'))
  try {
    const missingDir = join(tempDir, 'missing-sessions')
    const result = await listDeepSeekSessions({
      sessionStoreDir: missingDir,
    })

    assert.equal(result.sessionStoreDir, missingDir)
    assert.equal(result.scannedFileCount, 0)
    assert.equal(result.validSessionCount, 0)
    assert.equal(result.matchedSessionCount, 0)
    assert.equal(result.returnedSessionCount, 0)
    assert.equal(result.truncated, false)
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(result.sessions, [])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('returns an empty catalog when the session store exists but has no top-level json files', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-sessions-empty-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(join(sessionStoreDir, 'openai-http', 'response-handles'), { recursive: true })
    await writeFile(
      join(sessionStoreDir, 'openai-http', 'response-handles', 'resp_123.json'),
      '{}\n',
      'utf8',
    )
    await writeFile(join(sessionStoreDir, 'notes.txt'), 'ignore\n', 'utf8')

    const result = await listDeepSeekSessions({
      sessionStoreDir,
    })

    assert.equal(result.sessionStoreDir, sessionStoreDir)
    assert.equal(result.scannedFileCount, 0)
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(result.sessions, [])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('sorts sessions by persistedAt descending, filters by query, and truncates by limit', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-sessions-order-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-alpha.json'),
      createStoredSession({
        sessionId: 'session-alpha',
        title: 'Alpha Session',
        userPromptPreview: 'alpha topic',
        createdAt: '2026-04-04T00:00:00.000Z',
        persistedAt: '2026-04-06T00:00:00.000Z',
      }),
    )
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-beta.json'),
      createStoredSession({
        sessionId: 'session-beta',
        title: 'Beta Session',
        userPromptPreview: 'beta topic',
        createdAt: '2026-04-04T00:00:00.000Z',
        persistedAt: '2026-04-08T00:00:00.000Z',
      }),
    )
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-legacy.json'),
      {
        kind: 'deepseek-stored-session',
        version: 1,
        session: createLegacySession({
          id: 'session-legacy',
          title: 'Legacy Session',
          createdAt: '2026-04-05T00:00:00.000Z',
        }),
        metadata: null,
      },
    )

    const filtered = await listDeepSeekSessions({
      sessionStoreDir,
      query: 'session',
      limit: 2,
    })

    assert.equal(filtered.scannedFileCount, 3)
    assert.equal(filtered.validSessionCount, 3)
    assert.equal(filtered.matchedSessionCount, 3)
    assert.equal(filtered.returnedSessionCount, 2)
    assert.equal(filtered.truncated, true)
    assert.deepEqual(
      filtered.sessions.map(session => session.sessionId),
      ['session-beta', 'session-alpha'],
    )

    const legacyOnly = await listDeepSeekSessions({
      sessionStoreDir,
      query: '联网搜索',
    })
    assert.equal(legacyOnly.matchedSessionCount, 1)
    assert.deepEqual(
      legacyOnly.sessions.map(session => session.sessionId),
      ['session-legacy'],
    )
    assert.equal(legacyOnly.sessions[0]?.metadataSource, 'legacy-session')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('lists catalog-only placeholder sessions and orders them by catalog updatedAt', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-sessions-catalog-only-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-catalog.json'),
      {
        kind: 'deepseek-stored-session',
        version: 1,
        session: {
          id: 'session-catalog',
          agentId: 'chat',
          title: 'Catalog Session',
          createdAt: '2026-04-05T00:00:00.000Z',
          branches: [],
        },
        metadata: null,
        catalog: {
          version: 1,
          title: 'Catalog Session',
          updatedAt: '2026-04-09T00:00:00.000Z',
          pinned: false,
          discoverySource: 'fetch_page',
          syncedAt: '2026-04-09T00:00:10.000Z',
        },
      },
    )
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-older.json'),
      createStoredSession({
        sessionId: 'session-older',
        title: 'Older Session',
        userPromptPreview: 'older preview',
        persistedAt: '2026-04-06T00:00:00.000Z',
      }),
    )

    const result = await listDeepSeekSessions({
      sessionStoreDir,
    })

    assert.deepEqual(
      result.sessions.map(session => session.sessionId),
      ['session-catalog', 'session-older'],
    )
    assert.equal(result.sessions[0]?.metadataSource, 'catalog-only-session')
    assert.equal(result.sessions[0]?.branchCount, 0)
    assert.equal(result.sessions[0]?.messageCount, 0)
    assert.equal(
      result.sessions[0]?.finalUrl,
      'https://chat.deepseek.com/a/chat/s/session-catalog',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('returns partial results with warnings when valid and invalid top-level session files coexist', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-sessions-partial-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-good.json'),
      createStoredSession({
        sessionId: 'session-good',
        title: 'Good Session',
        userPromptPreview: 'good preview',
      }),
    )
    await writeFile(join(sessionStoreDir, 'session-bad.json'), '{not-valid-json}\n', 'utf8')
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-inconsistent.json'),
      createStoredSession({
        sessionId: 'session-inconsistent',
        title: 'Inconsistent Session',
        userPromptPreview: 'inconsistent preview',
        metadataAuthoritativeSessionId: 'session-other',
      }),
    )

    const result = await listDeepSeekSessions({
      sessionStoreDir,
    })

    assert.equal(result.scannedFileCount, 3)
    assert.equal(result.validSessionCount, 1)
    assert.equal(result.matchedSessionCount, 1)
    assert.equal(result.returnedSessionCount, 1)
    assert.equal(result.truncated, false)
    assert.deepEqual(
      result.sessions.map(session => session.sessionId),
      ['session-good'],
    )
    assert.equal(result.warnings.length, 2)
    assert.deepEqual(
      result.warnings.map(warning => warning.code).sort(),
      ['session_file_inconsistent', 'session_file_load_failed'],
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('fails closed when all top-level session candidates are invalid', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-sessions-all-invalid-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await mkdir(sessionStoreDir, { recursive: true })
    await writeFile(join(sessionStoreDir, 'session-bad.json'), '{not-valid-json}\n', 'utf8')
    await saveStoredSessionToFile(
      join(sessionStoreDir, 'session-inconsistent.json'),
      createStoredSession({
        sessionId: 'session-inconsistent',
        title: 'Inconsistent Session',
        userPromptPreview: 'inconsistent preview',
        metadataAuthoritativeSessionId: 'session-other',
      }),
    )

    await assert.rejects(
      () => listDeepSeekSessions({ sessionStoreDir }),
      error => {
        assert.equal(isDeepSeekSessionCatalogError(error), true)
        if (!isDeepSeekSessionCatalogError(error)) {
          return false
        }
        assert.equal(error.catalog.scannedFileCount, 2)
        assert.equal(error.catalog.validSessionCount, 0)
        assert.equal(error.catalog.matchedSessionCount, 0)
        assert.equal(error.catalog.returnedSessionCount, 0)
        assert.equal(error.catalog.warnings.length, 2)
        assert.match(error.message, /failed closed/i)
        return true
      },
    )
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

function createLegacySession(
  overrides: Partial<DeepSeekSession> = {},
): DeepSeekSession {
  return {
    id: 'session-legacy',
    agentId: 'chat',
    title: 'Legacy Session',
    createdAt: '2026-04-05T00:00:00.000Z',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-legacy',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          {
            id: 'legacy-user-1',
            role: 'user',
            text: '请总结附件并联网搜索补充。',
            createdAt: '2026-04-05T00:00:00.000Z',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
    ...overrides,
  }
}
