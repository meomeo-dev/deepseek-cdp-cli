import assert from 'node:assert/strict'
import test from 'node:test'
import { updateStoredSessionAfterMutation } from '../src/domain/session/sessionMutationPersistence.js'
import type { DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('persists continue mutation metadata including assistant text source', () => {
  const storedSession = createStoredSession()
  const result = updateStoredSessionAfterMutation({
    storedSession,
    materializedSession: storedSession.session,
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
    agentId: 'chat',
    sessionId: 'session-123',
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
      responseStatus: 200,
      recoveredAt: '2026-04-05T09:00:00.000Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
    outputTokensUsed: 321,
    settledAfterMs: 6789,
    activeBranchId: 'branch-main',
    activeBranchSource: 'continue',
    assistantTextSource: 'history_messages',
    mutation: {
      kind: 'continue',
      sourceBranchId: 'branch-main',
      sourceAssistantMessageId: 'message-assistant-1',
      sourceParentMessageId: 'message-user-1',
      materializedBranchId: 'branch-main',
      materializedBranchCreated: false,
      continuedAssistantMessageId: 'message-assistant-1',
      continuationDisposition: 'in-place',
      transcriptShape: 'history-recovered-in-place',
    },
    persistedAt: '2026-04-05T09:00:01.000Z',
  })

  assert.equal(result.metadata?.authoritativeSessionId, 'session-123')
  assert.equal(result.metadata?.outputTokensUsed, 321)
  assert.equal(result.metadata?.settledAfterMs, 6789)
  assert.equal(result.metadata?.transcriptRecovery?.status, 'recovered')
  assert.equal(result.metadata?.lastAssistantTextSource, 'history_messages')
  assert.equal(result.metadata?.lastKnownActiveBranchId, 'branch-main')
  assert.equal(result.metadata?.lastKnownActiveBranchSource, 'continue')
  assert.equal(result.metadata?.exportProvenance?.branches[0]?.branchId, 'branch-main')
  assert.equal(result.metadata?.exportProvenance?.branches[0]?.source, 'history_messages')
  assert.equal(
    result.metadata?.exportProvenance?.branches[0]?.transcriptShape,
    'history-recovered-in-place',
  )
  assert.equal(result.metadata?.persistedAt, '2026-04-05T09:00:01.000Z')
})

void test('preserves vision mode fact through mutation persistence', () => {
  const baseStoredSession = createStoredSession()
  const storedSession: DeepSeekStoredSession = {
    ...baseStoredSession,
    session: {
      ...baseStoredSession.session,
      modeFact: {
        sourceLayer: 'stored-session',
        rawModelType: 'vision',
        resolvedMode: 'vision',
        derivedFromLayer: 'canonical-generation-context',
      },
    },
    metadata: {
      ...baseStoredSession.metadata!,
      modeFact: {
        sourceLayer: 'stored-session',
        rawModelType: 'vision',
        resolvedMode: 'vision',
        derivedFromLayer: 'canonical-generation-context',
      },
    },
  }
  const result = updateStoredSessionAfterMutation({
    ...createMutationInput(),
    storedSession,
    materializedSession: storedSession.session,
  })

  assert.equal(result.session.modeFact?.rawModelType, 'vision')
  assert.equal(result.session.modeFact?.resolvedMode, 'vision')
  assert.equal(result.metadata?.modeFact?.rawModelType, 'vision')
  assert.equal(result.metadata?.modeFact?.resolvedMode, 'vision')
})

void test('leaves metadata null for legacy stored sessions without metadata', () => {
  const storedSession = createStoredSession()
  const result = updateStoredSessionAfterMutation({
    ...createMutationInput(),
    storedSession: {
      ...storedSession,
      metadata: null,
    },
    materializedSession: storedSession.session,
  })

  assert.equal(result.metadata, null)
})

function createMutationInput() {
  return {
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
    agentId: 'chat',
    sessionId: 'session-123',
    transcriptRecovery: {
      source: 'history_messages' as const,
      status: 'failed' as const,
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
      responseStatus: 500,
      recoveredAt: '2026-04-05T09:00:00.000Z',
      attempts: 2,
      branchCount: 0,
      messageCount: 0,
      settled: false,
      errorMessage: 'timeout',
    },
    outputTokensUsed: 0,
    settledAfterMs: 1000,
    activeBranchId: 'branch-main',
    activeBranchSource: 'continue' as const,
    assistantTextSource: 'generation-stream' as const,
    mutation: {
      kind: 'continue' as const,
      sourceBranchId: 'branch-main',
      sourceAssistantMessageId: 'message-assistant-1',
      sourceParentMessageId: 'message-user-1',
      materializedBranchId: 'branch-main',
      materializedBranchCreated: false,
      continuedAssistantMessageId: 'message-assistant-1',
      continuationDisposition: 'in-place' as const,
      transcriptShape: 'history-recovered-in-place' as const,
    },
    persistedAt: '2026-04-05T09:00:01.000Z',
  }
}

function createStoredSession(): DeepSeekStoredSession {
  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Stored Session',
      createdAt: '2026-04-05T08:59:59.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-123',
          title: 'Main Branch',
          createdAt: '2026-04-05T08:59:59.000Z',
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
      outputTokensUsed: 12,
      settledAfterMs: 3456,
      firstBatchSummary: {
        captureMode: 'generation-stream',
        userMessageId: '1',
        assistantMessageId: '2',
        userPrompt: 'hello',
        userPromptPreview: 'hello',
        assistantSummary: 'world',
        generationEndpoints: ['/api/v0/chat/completion'],
        completionRequestObserved: true,
      },
      transcriptRecovery: null,
      lastAssistantTextSource: 'generation-stream',
      lastKnownActiveBranchId: 'branch-main',
      lastKnownActiveBranchSource: 'reply',
      persistedAt: '2026-04-05T08:59:59.000Z',
    },
  }
}
