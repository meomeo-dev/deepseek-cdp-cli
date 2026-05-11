import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveMutationAssistantTextSource,
  resolveMutationTranscriptRecovery,
} from '../src/domain/session/sessionMutationRecovery.js'
import type { DeepSeekSession } from '../src/types/deepseek-session.types.js'
import type { DeepSeekTranscriptRecovery } from '../src/types/deepseek-transcript-recovery.types.js'

void test('mutation transcript recovery preserves a previous recovered status when the next recovery failed', () => {
  const previous = createTranscriptRecovery({
    status: 'recovered',
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
    recoveredAt: '2026-04-05T00:00:01.000Z',
    settled: true,
  })
  const next = createTranscriptRecovery({
    status: 'failed',
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123&cache_version=2',
    recoveredAt: '2026-04-05T00:00:02.000Z',
    settled: false,
    errorMessage: 'Could not find any messages in the history_messages payload.',
  })

  const merged = resolveMutationTranscriptRecovery({
    previous,
    next,
  })

  assert.equal(merged.status, 'recovered')
  assert.equal(merged.requestUrl, previous.requestUrl)
})

void test('mutation transcript recovery accepts the new recovery when a recovered session was provided', () => {
  const previous = createTranscriptRecovery({
    status: 'recovered',
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
    recoveredAt: '2026-04-05T00:00:01.000Z',
    settled: true,
  })
  const next = createTranscriptRecovery({
    status: 'failed',
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123&cache_version=2',
    recoveredAt: '2026-04-05T00:00:02.000Z',
    settled: false,
    errorMessage: 'history_messages payload is still incomplete.',
  })

  const merged = resolveMutationTranscriptRecovery({
    previous,
    next,
    recoveredSession: createRecoveredSession(['message-assistant-2']),
  })

  assert.equal(merged.status, 'failed')
  assert.equal(merged.requestUrl, next.requestUrl)
})

void test('assistant text source only upgrades to history_messages when the recovered session contains the target assistant message', () => {
  assert.equal(
    resolveMutationAssistantTextSource({
      recoveredSession: createRecoveredSession(['message-assistant-2']),
      assistantMessageId: 'message-assistant-2',
      fallback: 'generation-stream',
    }),
    'history_messages',
  )

  assert.equal(
    resolveMutationAssistantTextSource({
      recoveredSession: createRecoveredSession(['message-assistant-1']),
      assistantMessageId: 'message-assistant-2',
      fallback: 'generation-stream',
    }),
    'generation-stream',
  )
})

function createTranscriptRecovery(input: {
  status: DeepSeekTranscriptRecovery['status']
  requestUrl: string
  recoveredAt: string
  settled: boolean
  errorMessage?: string | undefined
}): DeepSeekTranscriptRecovery {
  return {
    source: 'history_messages',
    status: input.status,
    requestUrl: input.requestUrl,
    responseStatus: 200,
    recoveredAt: input.recoveredAt,
    attempts: 1,
    branchCount: 1,
    messageCount: input.status === 'recovered' ? 2 : 0,
    settled: input.settled,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  }
}

function createRecoveredSession(messageIds: string[]): DeepSeekSession {
  return {
    id: 'session-123',
    agentId: 'chat',
    title: 'Recovered Session',
    createdAt: '2026-04-05T00:00:00.000Z',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-123',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: messageIds.map((messageId, index) => ({
          id: messageId,
          role: 'assistant',
          text: `assistant-${index + 1}`,
          createdAt: `2026-04-05T00:00:0${index}.000Z`,
          branchId: 'branch-main',
          attachments: [],
          citations: [],
        })),
      },
    ],
  }
}
