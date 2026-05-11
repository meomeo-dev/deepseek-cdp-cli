import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { materializeDeepSeekEditedBranch } from '../src/domain/session/sessionEditBranchMaterialization.js'
import { mapHistoryMessagesEnvelopeToSession } from '../src/infrastructure/deepseek/historyMessagesMapper.js'
import type { DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('materializes a synthetic branch from a real edit_message history_messages active view', async () => {
  const capture = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.edit-message.real.fixture.json',
      ),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }
  const recoveredSession = mapHistoryMessagesEnvelopeToSession(
    JSON.parse(capture.response.bodyText) as unknown,
  )
  const storedSession = createStoredSession({
    sessionId: 'session-redacted',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-redacted',
        title: 'Main Branch',
        createdAt: '2026-04-05T05:54:20.807Z',
        messages: [
          {
            id: '1',
            role: 'user',
            text: 'B39安全清空审计：只回答甲',
            createdAt: '2026-04-05T05:54:20.807Z',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: '2',
            role: 'assistant',
            text: '甲',
            createdAt: '2026-04-05T05:54:20.809Z',
            parentId: '1',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
  })

  const result = materializeDeepSeekEditedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceMessageId: '1',
    replacementMessageId: '3',
    assistantMessageId: '4',
    replacementPrompt: 'B39安全清空审计：只回答乙',
    assistantText: '乙',
    recoveredSession,
  })

  assert.equal(result.materialization.sourceBranchId, 'branch-main')
  assert.equal(result.materialization.sourceMessageId, '1')
  assert.equal(result.materialization.materializedBranchId, 'branch-edit-1-3')
  assert.equal(result.materialization.materializedBranchCreated, true)
  assert.deepEqual(result.materialization.prefixMessageIds, [])
  assert.deepEqual(result.materialization.materializedMessageIds, ['3', '4'])
  assert.equal(result.session.branches.length, 2)
  assert.deepEqual(
    result.session.branches.find(branch => branch.id === 'branch-main')?.messages.map(message => message.id),
    ['1', '2'],
  )
  assert.equal(result.branch.sourceMessageId, '1')
  assert.deepEqual(result.branch.messages.map(message => message.id), ['3', '4'])
  assert.equal(result.branch.messages[0]?.branchId, 'branch-edit-1-3')
  assert.equal(result.branch.messages[1]?.text, '乙')
})

void test('preserves source user attachments on recovered edited replacement messages', () => {
  const storedSession = createStoredSession({
    sessionId: 'session-edit-attachment',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-edit-attachment',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          {
            id: '1',
            role: 'user',
            text: '请阅读附件后回答',
            createdAt: '2026-04-05T00:00:00.000Z',
            branchId: 'branch-main',
            attachments: [
              {
                id: 'file-source',
                name: 'README.md',
                url: 'https://files.example/README.md',
              },
            ],
            citations: [],
          },
          {
            id: '2',
            role: 'assistant',
            text: '已阅读',
            createdAt: '2026-04-05T00:00:01.000Z',
            parentId: '1',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
  })
  const recoveredSession = {
    ...storedSession.session,
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-edit-attachment',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          {
            id: '3',
            role: 'user' as const,
            text: '请重新阅读附件后回答',
            createdAt: '2026-04-05T00:00:02.000Z',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: '4',
            role: 'assistant' as const,
            text: '已重新阅读',
            createdAt: '2026-04-05T00:00:03.000Z',
            parentId: '3',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
  }

  const result = materializeDeepSeekEditedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceMessageId: '1',
    replacementMessageId: '3',
    assistantMessageId: '4',
    replacementPrompt: '请重新阅读附件后回答',
    assistantText: '已重新阅读',
    recoveredSession,
  })

  assert.equal(result.branch.messages[0]?.id, '3')
  assert.equal(result.branch.messages[0]?.attachments[0]?.id, 'file-source')
  assert.equal(result.branch.messages[0]?.attachments[0]?.url, 'https://files.example/README.md')
  assert.equal(result.branch.messages[1]?.attachments.length, 0)
})

void test('materializes a placeholder edited branch when history_messages recovery is unavailable', () => {
  const storedSession = createStoredSession({
    sessionId: 'session-edit-fallback',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-edit-fallback',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          {
            id: '1',
            role: 'user',
            text: '第一问',
            createdAt: '2026-04-05T00:00:00.000Z',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: '2',
            role: 'assistant',
            text: '第一答',
            createdAt: '2026-04-05T00:00:01.000Z',
            parentId: '1',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: '3',
            role: 'user',
            text: '第二问',
            createdAt: '2026-04-05T00:00:02.000Z',
            parentId: '2',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: '4',
            role: 'assistant',
            text: '第二答',
            createdAt: '2026-04-05T00:00:03.000Z',
            parentId: '3',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          }
        ]
      }
    ]
  })

  const result = materializeDeepSeekEditedBranch({
    storedSession,
    sourceBranchId: 'branch-main',
    sourceMessageId: '3',
    replacementMessageId: '5',
    assistantMessageId: '6',
    replacementPrompt: '第二问改写',
    assistantText: '第二答改写',
    persistedAt: '2026-04-05T00:00:10.000Z',
  })

  assert.equal(result.materialization.materializedBranchId, 'branch-edit-3-5')
  assert.deepEqual(result.materialization.prefixMessageIds, ['1', '2'])
  assert.deepEqual(result.branch.messages.map(message => message.id), ['1', '2', '5', '6'])
  assert.equal(result.branch.sourceMessageId, '3')
  assert.equal(result.branch.messages[2]?.text, '第二问改写')
  assert.equal(result.branch.messages[3]?.parentId, '5')
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
