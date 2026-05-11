import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { materializeDeepSeekRegeneratedBranch } from '../src/domain/session/sessionRegenerateBranchMaterialization.js'
import type { DeepSeekSession, DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('materializes a regenerate branch from a real assistant-only active view observation', async () => {
  const observation = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.regenerate.active-view.real.observation.json',
      ),
      'utf8',
    ),
  ) as {
    canonicalContext: {
      parentMessageId: string
      assistantMessageId: string
    }
    observation: {
      recoveredSession: DeepSeekSession
    }
  }
  const storedSession = createStoredSession({
    sessionId: 'dc033641-275a-4fc8-b2ba-610d871d6708',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'dc033641-275a-4fc8-b2ba-610d871d6708',
        title: 'Main Branch',
        createdAt: '2026-04-04T13:00:00.000Z',
        messages: [
          createMessage('1', 'user', '告诉你一个秘密「7764」', '2026-04-04T13:00:00.000Z', 'branch-main'),
          createMessage('2', 'assistant', '你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。', '2026-04-04T13:00:01.000Z', 'branch-main', '1'),
          createMessage('3', 'user', '刚刚到秘密是什么', '2026-04-04T13:00:02.000Z', 'branch-main', '2'),
          createMessage('4', 'assistant', '旧的第四条回答', '2026-04-04T13:00:03.000Z', 'branch-main', '3'),
          createMessage('5', 'user', '刚刚告诉你的秘密是什么', '2026-04-04T13:00:04.000Z', 'branch-main', '4'),
          createMessage('6', 'assistant', '旧的第六条回答', '2026-04-04T13:00:05.000Z', 'branch-main', '5'),
        ],
      },
    ],
  })

  const result = materializeDeepSeekRegeneratedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceAssistantMessageId: '4',
    sourceParentMessageId: observation.canonicalContext.parentMessageId,
    regeneratedAssistantMessageId: observation.canonicalContext.assistantMessageId,
    assistantText: observation.observation.recoveredSession.branches[0]?.messages[0]?.text ?? null,
    recoveredSession: observation.observation.recoveredSession,
  })

  assert.equal(result.materialization.sourceBranchId, 'branch-main')
  assert.equal(result.materialization.sourceAssistantMessageId, '4')
  assert.equal(result.materialization.sourceParentMessageId, '3')
  assert.equal(result.materialization.regeneratedAssistantMessageId, '7')
  assert.equal(result.materialization.materializedBranchId, 'branch-regenerate-4-7')
  assert.equal(result.materialization.materializedBranchCreated, true)
  assert.equal(result.materialization.transcriptShape, 'history-recovered')
  assert.deepEqual(result.materialization.prefixMessageIds, ['1', '2', '3'])
  assert.deepEqual(result.materialization.materializedMessageIds, ['1', '2', '3', '7'])
  assert.equal(result.branch.sourceMessageId, '4')
  assert.deepEqual(result.branch.messages.map(message => message.id), ['1', '2', '3', '7'])
  assert.equal(result.branch.messages[3]?.parentId, '3')
  assert.equal(result.branch.messages[3]?.text, observation.observation.recoveredSession.branches[0]?.messages[0]?.text)
})

void test('keeps the source parent message when timestamps place it after the regenerated assistant', () => {
  const sourceParent = {
    ...createMessage('3', 'user', '第二问含附件', '2026-04-05T00:00:04.000Z', 'branch-main', '2'),
    attachments: [
      {
        id: 'file-parent',
        name: 'parent.txt',
        sizeBytes: 12,
      },
    ],
  }
  const storedSession = createStoredSession({
    sessionId: 'session-regenerate-parent',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-regenerate-parent',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          createMessage('1', 'user', '第一问', '2026-04-05T00:00:00.000Z', 'branch-main'),
          createMessage('2', 'assistant', '第一答', '2026-04-05T00:00:01.000Z', 'branch-main', '1'),
          createMessage('4', 'assistant', '第二答', '2026-04-05T00:00:03.000Z', 'branch-main', '3'),
          sourceParent,
        ],
      },
    ],
  })
  const recoveredSession = {
    ...storedSession.session,
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-regenerate-parent',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          createMessage('5', 'assistant', '第二答重生成', '2026-04-05T00:00:05.000Z', 'branch-main', '3'),
        ],
      },
    ],
  }

  const result = materializeDeepSeekRegeneratedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceAssistantMessageId: '4',
    sourceParentMessageId: '3',
    regeneratedAssistantMessageId: '5',
    assistantText: '第二答重生成',
    recoveredSession,
  })

  const parentMessage = result.branch.messages.find(message => message.id === '3')
  assert.equal(parentMessage?.attachments[0]?.id, 'file-parent')
  assert.deepEqual(result.materialization.prefixMessageIds, ['1', '2', '3'])
  assert.deepEqual(result.materialization.materializedMessageIds, ['1', '2', '3', '5'])
})

void test('materializes a synthetic regenerate branch when history recovery is unavailable', () => {
  const storedSession = createStoredSession({
    sessionId: 'session-regenerate-fallback',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-regenerate-fallback',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          createMessage('1', 'user', '第一问', '2026-04-05T00:00:00.000Z', 'branch-main'),
          createMessage('2', 'assistant', '第一答', '2026-04-05T00:00:01.000Z', 'branch-main', '1'),
          createMessage('3', 'user', '第二问', '2026-04-05T00:00:02.000Z', 'branch-main', '2'),
          createMessage('4', 'assistant', '第二答', '2026-04-05T00:00:03.000Z', 'branch-main', '3'),
          createMessage('5', 'user', '第三问', '2026-04-05T00:00:04.000Z', 'branch-main', '4'),
          createMessage('6', 'assistant', '第三答', '2026-04-05T00:00:05.000Z', 'branch-main', '5'),
        ],
      },
    ],
  })

  const result = materializeDeepSeekRegeneratedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceAssistantMessageId: '4',
    sourceParentMessageId: '3',
    regeneratedAssistantMessageId: '7',
    assistantText: '第二答重生成',
    persistedAt: '2026-04-05T00:00:10.000Z',
  })

  assert.equal(result.materialization.materializedBranchId, 'branch-regenerate-4-7')
  assert.equal(result.materialization.transcriptShape, 'synthetic-fallback')
  assert.deepEqual(result.materialization.prefixMessageIds, ['1', '2', '3'])
  assert.deepEqual(result.branch.messages.map(message => message.id), ['1', '2', '3', '7'])
  assert.equal(result.branch.sourceMessageId, '4')
  assert.equal(result.branch.messages[3]?.text, '第二答重生成')
  assert.equal(result.branch.messages[3]?.parentId, '3')
})

function createStoredSession(input: {
  sessionId: string
  branches: DeepSeekStoredSession['session']['branches']
}): DeepSeekStoredSession {
  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: input.sessionId,
      agentId: 'chat',
      title: 'Stored Session',
      createdAt: input.branches[0]?.createdAt ?? '2026-04-05T00:00:00.000Z',
      branches: input.branches,
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
      persistedAt: '2026-04-05T00:00:00.000Z',
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
