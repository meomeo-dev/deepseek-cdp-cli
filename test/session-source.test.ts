import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { saveStoredSessionToFile } from '../src/infrastructure/deepseek/fileSystemSessionStore.js'
import { resolveDeepSeekSessionSource } from '../src/infrastructure/deepseek/deepSeekSessionSource.js'
import type { DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('resolves a consistent stored session source', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-session-source-'))

  try {
    const sessionFile = join(outputDir, 'session.json')
    await saveStoredSessionToFile(sessionFile, createStoredSession())

    const result = await resolveDeepSeekSessionSource({
      sessionFile,
    })

    assert.equal(result.authoritativeSessionId, 'session-123')
    assert.equal(result.authoritativeAgentId, 'chat')
    assert.equal(result.session.id, 'session-123')
    assert.equal(result.sessionFile, sessionFile)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('rejects an inconsistent stored session source before branch selection', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-session-source-bad-'))

  try {
    const sessionFile = join(outputDir, 'session.json')
    await saveStoredSessionToFile(sessionFile, createStoredSession({
      metadata: {
        source: 'first-message',
        requestedUrl: 'https://chat.deepseek.com/',
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
        authoritativeAgentId: 'chat',
        authoritativeSessionId: 'session-other',
        sessionCreate: null,
        generationObservations: [],
        outputTokensUsed: 0,
        settledAfterMs: 0,
        firstBatchSummary: {
          captureMode: 'summary-only',
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          userPrompt: 'hello',
          userPromptPreview: 'hello',
          assistantSummary: 'summary',
          generationEndpoints: [],
          completionRequestObserved: false,
        },
        transcriptRecovery: null,
        persistedAt: '2026-04-04T00:00:00.000Z',
      },
    }))

    await assert.rejects(
      () =>
        resolveDeepSeekSessionSource({
          sessionFile,
        }),
      /session\.id does not match metadata\.authoritativeSessionId/i,
    )
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

function createStoredSession(
  overrides: Partial<DeepSeekStoredSession> = {},
): DeepSeekStoredSession {
  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Fixture Session',
      createdAt: '2026-04-04T00:00:00.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-123',
          title: 'Main Branch',
          createdAt: '2026-04-04T00:00:00.000Z',
          messages: [],
        },
      ],
    },
    metadata: {
      source: 'first-message',
      requestedUrl: 'https://chat.deepseek.com/',
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
      authoritativeAgentId: 'chat',
      authoritativeSessionId: 'session-123',
      sessionCreate: null,
      generationObservations: [],
      outputTokensUsed: 0,
      settledAfterMs: 0,
      firstBatchSummary: {
        captureMode: 'summary-only',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
        userPrompt: 'hello',
        userPromptPreview: 'hello',
        assistantSummary: 'summary',
        generationEndpoints: [],
        completionRequestObserved: false,
      },
      transcriptRecovery: null,
      persistedAt: '2026-04-04T00:00:00.000Z',
    },
    ...overrides,
  }
}
