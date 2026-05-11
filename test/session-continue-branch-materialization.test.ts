import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { materializeDeepSeekContinuedBranch } from '../src/domain/session/sessionContinueBranchMaterialization.js'
import type { DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('materializes an explicit continue in place from a real settled history observation', async () => {
  const observation = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.continue.in-place.real.observation.json',
      ),
      'utf8',
    ),
  ) as {
    canonicalContext: {
      sourceParentMessageId: string
      sourceAssistantMessageId: string
      continuedAssistantMessageId: string
    }
    confirmedConclusion: {
      continuationDisposition: 'in-place'
      materializedBranchId: string
    }
  }

  const storedSession = createStoredSession({
    sessionId: 'session-redacted',
    assistantText: 'Stopped我们只需要输出数字',
  })
  const recoveredSession = {
    id: 'session-redacted',
    agentId: 'chat',
    title: 'Number List 1 to 800',
    createdAt: '2026-04-05T08:45:24.000Z',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-redacted',
        title: '请只输出从1到800的编号列表，每行一个数字，不要解释，不要总结。',
        createdAt: '2026-04-05T08:45:24.000Z',
        messages: [
          createMessage(
            '1',
            'user',
            '请只输出从1到800的编号列表，每行一个数字，不要解释，不要总结。',
            '2026-04-05T08:45:24.000Z',
            'branch-main',
          ),
          createMessage(
            '2',
            'assistant',
            '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
            '2026-04-05T08:45:25.000Z',
            'branch-main',
            '1',
          ),
        ],
      },
    ],
  }

  const result = materializeDeepSeekContinuedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceAssistantMessageId: observation.canonicalContext.sourceAssistantMessageId,
    sourceParentMessageId: observation.canonicalContext.sourceParentMessageId,
    continuedAssistantMessageId: observation.canonicalContext.continuedAssistantMessageId,
    assistantText: null,
    recoveredSession,
  })

  assert.equal(result.materialization.kind, 'continue')
  assert.equal(result.materialization.sourceBranchId, 'branch-main')
  assert.equal(result.materialization.sourceAssistantMessageId, '2')
  assert.equal(result.materialization.sourceParentMessageId, '1')
  assert.equal(result.materialization.continuedAssistantMessageId, '2')
  assert.equal(
    result.materialization.continuationDisposition,
    observation.confirmedConclusion.continuationDisposition,
  )
  assert.equal(
    result.materialization.materializedBranchId,
    observation.confirmedConclusion.materializedBranchId,
  )
  assert.equal(result.materialization.materializedBranchCreated, false)
  assert.equal(result.materialization.transcriptShape, 'history-recovered-in-place')
  assert.equal(result.session.branches.length, 1)
  assert.deepEqual(result.branch.messages.map(message => message.id), ['1', '2'])
  assert.equal(result.branch.messages[1]?.text, '1\n2\n3\n4\n5\n6\n7\n8\n9\n10')
})

void test('materializes an explicit continue as a synthetic in-place overlay when settled history is unavailable', () => {
  const storedSession = createStoredSession({
    sessionId: 'session-continue-fallback',
    assistantText: 'Stopped partial text',
  })

  const result = materializeDeepSeekContinuedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceAssistantMessageId: '2',
    sourceParentMessageId: '1',
    continuedAssistantMessageId: '2',
    assistantText: 'Completed through stream fallback',
  })

  assert.equal(result.materialization.materializedBranchId, 'branch-main')
  assert.equal(result.materialization.materializedBranchCreated, false)
  assert.equal(result.materialization.transcriptShape, 'synthetic-in-place')
  assert.equal(result.materialization.continuationDisposition, 'in-place')
  assert.equal(result.branch.messages[1]?.id, '2')
  assert.equal(result.branch.messages[1]?.text, 'Completed through stream fallback')
})

void test('fails closed when continue recovery suggests a different assistant message id', () => {
  const storedSession = createStoredSession({
    sessionId: 'session-continue-drift',
    assistantText: 'Stopped partial text',
  })

  assert.throws(
    () =>
      materializeDeepSeekContinuedBranch({
        storedSession,
        sourceBranchId: 'branch-main',
        sourceAssistantMessageId: '2',
        sourceParentMessageId: '1',
        continuedAssistantMessageId: '7',
        assistantText: 'unexpected',
      }),
    /continue attribution drifted/i,
  )
})

function createStoredSession(input: {
  sessionId: string
  assistantText: string
}): DeepSeekStoredSession {
  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: input.sessionId,
      agentId: 'chat',
      title: 'Stored Session',
      createdAt: '2026-04-05T08:45:24.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: input.sessionId,
          title: 'Main Branch',
          createdAt: '2026-04-05T08:45:24.000Z',
          messages: [
            createMessage(
              '1',
              'user',
              '请只输出从1到800的编号列表，每行一个数字，不要解释，不要总结。',
              '2026-04-05T08:45:24.000Z',
              'branch-main',
            ),
            createMessage(
              '2',
              'assistant',
              input.assistantText,
              '2026-04-05T08:45:25.000Z',
              'branch-main',
              '1',
            ),
          ],
        },
      ],
    },
    metadata: {
      source: 'first-message',
      requestedUrl: 'https://chat.deepseek.com/',
      finalUrl: `https://chat.deepseek.com/a/chat/s/${input.sessionId}`,
      authoritativeAgentId: 'chat',
      authoritativeSessionId: input.sessionId,
      sessionCreate: null,
      generationObservations: [],
      outputTokensUsed: 0,
      settledAfterMs: 0,
      firstBatchSummary: {
        captureMode: 'generation-stream',
        userMessageId: '1',
        assistantMessageId: '2',
        userPrompt: 'seed',
        userPromptPreview: 'seed',
        assistantSummary: 'seed',
        generationEndpoints: ['/api/v0/chat/completion'],
        completionRequestObserved: true,
      },
      transcriptRecovery: null,
      lastKnownActiveBranchId: 'branch-main',
      lastKnownActiveBranchSource: 'reply',
      persistedAt: '2026-04-05T08:45:24.000Z',
    },
  }
}

function createMessage(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  createdAt: string,
  branchId: string,
  parentId?: string,
) {
  return {
    id,
    role,
    text,
    createdAt,
    ...(parentId ? { parentId } : {}),
    branchId,
    attachments: [],
    citations: [],
  }
}
