import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  applyOpenAIHistoryBootstrapMetadataToStoredSession,
  applyTranscriptRecoveryToStoredSession,
  appendReplyTurnToStoredSession,
  buildDeepSeekSessionFilePath,
  createStoredSessionFromFirstMessage,
  overlayLocalAttachmentMetadataOnRecoveredSession,
  resolveDeepSeekSessionStoreDir,
} from '../src/infrastructure/deepseek/deepSeekStoredSession.js'
import {
  deleteStoredSessionFile,
  loadSessionFromFile,
  loadStoredSessionFromFile,
  saveStoredSessionToFile,
} from '../src/infrastructure/deepseek/fileSystemSessionStore.js'
import { mapHistoryMessagesEnvelopeToSession } from '../src/infrastructure/deepseek/historyMessagesMapper.js'
import type { DeepSeekFileUploadBatchResult } from '../src/types/deepseek-file.types.js'
import type { DeepSeekFirstMessageResult } from '../src/types/deepseek-first-message.types.js'
import type { DeepSeekSession } from '../src/types/deepseek-session.types.js'

void test('builds a stored first-message session using the final route as authority', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请总结这次对话并给出后续建议',
    persistedAt: '2026-04-04T00:00:00.000Z',
    result: createFirstMessageResult({
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-final',
      sessionId: 'session-final',
      sessionCreate: {
        sessionId: 'session-create-drifted',
        agentId: 'chat',
        url: 'https://chat.deepseek.com/api/v0/chat_session/create',
        status: 200,
      },
      outputTokensUsed: 36,
    }),
  })

  assert.equal(storedSession.session.id, 'session-final')
  assert.equal(storedSession.session.agentId, 'chat')
  assert.equal(storedSession.session.branches[0]?.messages.length, 2)
  assert.equal(storedSession.metadata?.authoritativeSessionId, 'session-final')
  assert.equal(storedSession.metadata?.sessionCreate?.sessionId, 'session-create-drifted')
  assert.equal(storedSession.metadata?.firstBatchSummary.captureMode, 'generation-stream')
  assert.equal(storedSession.metadata?.transcriptRecovery, null)
  assert.equal(storedSession.metadata?.lastAssistantTextSource, 'generation-stream')
  assert.equal(storedSession.session.modeFact?.sourceLayer, 'stored-session')
  assert.equal(storedSession.session.modeFact?.rawModelType, 'default')
  assert.equal(storedSession.metadata?.modeFact?.rawModelType, 'default')
  assert.equal(storedSession.metadata?.modeFact?.derivedFromLayer, 'canonical-generation-context')
  assert.equal(storedSession.metadata?.exportProvenance?.branches[0]?.branchId, 'branch-main')
  assert.equal(
    storedSession.metadata?.exportProvenance?.branches[0]?.transcriptShape,
    'generation-stream-fallback',
  )
  assert.equal(storedSession.session.branches[0]?.messages[1]?.text, 'fixture assistant text')
})

void test('preserves observed search results and citations on the stored assistant placeholder before transcript recovery', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '先搜索再回答',
    persistedAt: '2026-04-04T00:00:00.000Z',
    result: createFirstMessageResult({
      generationRuns: [
        {
          endpoint: '/api/v0/chat/completion',
          transport: 'sse',
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
          context: {
            runId: 'run-search',
            endpoint: '/api/v0/chat/completion',
            transport: 'sse',
            requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
            agentId: 'chat',
            sessionId: 'session-123',
            branchId: 'branch-main',
            parentMessageId: '1',
            assistantMessageId: '2',
          },
          finalized: {
            status: 'completed',
            finishReason: 'stop',
            outputText: '让我先搜索资料...[reference:0]',
            reasoningText: '',
            reasoningKind: 'unknown',
            citations: [
              {
                id: 'https://example.com/openai-streaming',
                title: 'OpenAI Streaming',
                url: 'https://example.com/openai-streaming',
                snippet: 'streaming summary',
                annotation: {
                  source: 'search',
                },
              },
            ],
            responseReferences: [
              {
                referenceId: '27',
                referenceType: 'TOOL_SEARCH',
              },
            ],
            searches: [
              {
                query: 'openai streaming',
                status: 'completed',
                results: [
                  {
                    id: 'https://example.com/openai-streaming',
                    title: 'OpenAI Streaming',
                    url: 'https://example.com/openai-streaming',
                    snippet: 'streaming summary',
                    source: 'Example',
                  },
                ],
              },
            ],
            usage: null,
            error: null,
            completedAt: '2026-04-04T00:00:01.000Z',
          },
          eventCount: 5,
          unknownObservationCount: 0,
          unknownObservationLabels: [],
        },
      ],
      assistantText: '让我先搜索资料...[reference:0]',
    }),
  })

  const assistantMessage = storedSession.session.branches[0]?.messages[1]
  assert.equal(assistantMessage?.citations[0]?.title, 'OpenAI Streaming')
  assert.deepEqual(assistantMessage?.responseReferences, [
    {
      referenceId: '27',
      referenceType: 'TOOL_SEARCH',
    },
  ])
  assert.equal(assistantMessage?.searches?.length, 1)
  assert.equal(assistantMessage?.searches?.[0]?.query, 'openai streaming')
  assert.equal(
    assistantMessage?.searches?.[0]?.results[0]?.url,
    'https://example.com/openai-streaming',
  )
})

void test('deletes a stored session file idempotently', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-delete-session-file-'))
  try {
    const filePath = join(tempDir, 'session.json')
    await saveStoredSessionToFile(
      filePath,
      createStoredSessionFromFirstMessage({
        prompt: '删除测试',
        persistedAt: '2026-04-05T00:00:00.000Z',
        result: createFirstMessageResult(),
      }),
    )

    assert.equal(await deleteStoredSessionFile(filePath), true)
    assert.equal(await deleteStoredSessionFile(filePath), false)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('preserves observed first-turn message ids and branch id when generation context is available', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请生成一个可继续的回答',
    persistedAt: '2026-04-05T00:00:00.000Z',
    result: createFirstMessageResult({
      generationRuns: [
        {
          endpoint: '/api/v0/chat/completion',
          transport: 'sse',
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
          context: {
            runId: 'run-1',
            endpoint: '/api/v0/chat/completion',
            transport: 'sse',
            requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
            agentId: 'chat',
            sessionId: 'session-123',
            branchId: 'branch-real',
            parentMessageId: 'message-user-real',
            assistantMessageId: 'message-assistant-real',
          },
          finalized: {
            status: 'stopped',
            finishReason: 'stopped',
            outputText: '部分回答',
            reasoningText: '',
            reasoningKind: 'unknown',
            citations: [],
            responseReferences: [],
            searches: [],
            usage: null,
            error: null,
            completedAt: '2026-04-05T00:00:02.000Z',
          },
          eventCount: 3,
          unknownObservationCount: 0,
          unknownObservationLabels: [],
        },
      ],
      assistantText: '部分回答',
    }),
  })

  assert.equal(storedSession.session.branches[0]?.id, 'branch-real')
  assert.equal(storedSession.session.branches[0]?.messages[0]?.id, 'message-user-real')
  assert.equal(storedSession.session.branches[0]?.messages[1]?.id, 'message-assistant-real')
  assert.equal(storedSession.metadata?.firstBatchSummary.userMessageId, 'message-user-real')
  assert.equal(storedSession.metadata?.firstBatchSummary.assistantMessageId, 'message-assistant-real')
  assert.equal(storedSession.metadata?.lastKnownActiveBranchId, 'branch-real')
})

void test('records OpenAI history bootstrap provenance on the stored session metadata without mutating the recovered transcript', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: 'Latest actionable turn',
    persistedAt: '2026-04-16T00:00:00.000Z',
    result: createFirstMessageResult({
      sessionId: 'session-history-bootstrap',
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-history-bootstrap',
    }),
  })

  const updated = applyOpenAIHistoryBootstrapMetadataToStoredSession({
    storedSession,
    requestId: 'req-history-bootstrap',
    endpoint: '/v1/responses',
    historyItemCount: 2,
    latestActionableUserTurnIndex: 2,
    latestTurnFileCount: 1,
    artifact: {
      source: 'history-bootstrap-artifact',
      stageId: 'stage-history-bootstrap',
      stagedFilename: 'openai-responses-history-bootstrap.txt',
      byteSize: 128,
    },
    importedAt: '2026-04-16T00:00:03.000Z',
  })

  assert.equal(updated.session.branches[0]?.messages[0]?.text, 'Latest actionable turn')
  assert.equal(updated.metadata?.openaiHistoryBootstrap?.endpoint, '/v1/responses')
  assert.equal(updated.metadata?.openaiHistoryBootstrap?.requestId, 'req-history-bootstrap')
  assert.equal(updated.metadata?.openaiHistoryBootstrap?.historyItemCount, 2)
  assert.equal(updated.metadata?.openaiHistoryBootstrap?.latestActionableUserTurnIndex, 2)
  assert.equal(updated.metadata?.openaiHistoryBootstrap?.latestTurnFileCount, 1)
  assert.equal(updated.metadata?.openaiHistoryBootstrap?.artifactStageId, 'stage-history-bootstrap')
  assert.equal(
    updated.metadata?.openaiHistoryBootstrap?.artifactFilename,
    'openai-responses-history-bootstrap.txt',
  )
  assert.equal(updated.metadata?.persistedAt, '2026-04-16T00:00:03.000Z')
})

void test('applies a recovered canonical transcript onto a stored first-message session', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请总结这次对话并给出后续建议',
    persistedAt: '2026-04-04T00:00:00.000Z',
    result: createFirstMessageResult(),
  })

  const upgraded = applyTranscriptRecoveryToStoredSession({
    storedSession,
    recoveredSession: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Recovered Session',
      createdAt: '2026-04-04T00:00:00.000Z',
      modeFact: {
        sourceLayer: 'history-messages-mapped-session',
        rawModelType: 'expert',
        resolvedMode: 'expert',
        derivedFromLayer: 'history-messages-raw',
      },
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-123',
          title: 'Main Branch',
          createdAt: '2026-04-04T00:00:00.000Z',
          messages: [
            {
              id: '1',
              role: 'user',
              text: '请总结这次对话并给出后续建议',
              createdAt: '2026-04-04T00:00:00.000Z',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
            {
              id: '2',
              role: 'assistant',
              text: '这是权威 transcript。',
              createdAt: '2026-04-04T00:00:01.000Z',
              parentId: '1',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
          ],
        },
      ],
    },
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
      responseStatus: 200,
      recoveredAt: '2026-04-04T00:00:02.000Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
  })

  assert.equal(upgraded.session.title, 'Recovered Session')
  assert.equal(upgraded.session.modeFact?.sourceLayer, 'stored-session')
  assert.equal(upgraded.session.modeFact?.rawModelType, 'expert')
  assert.equal(upgraded.session.modeFact?.derivedFromLayer, 'history-messages-mapped-session')
  assert.equal(upgraded.metadata?.modeFact?.rawModelType, 'expert')
  assert.deepEqual(
    upgraded.session.branches[0]?.messages.map(message => message.id),
    ['1', '2'],
  )
  assert.equal(upgraded.session.branches[0]?.messages[1]?.text, '这是权威 transcript。')
  assert.equal(upgraded.metadata?.firstBatchSummary.captureMode, 'generation-stream')
  assert.equal(upgraded.metadata?.transcriptRecovery?.status, 'recovered')
  assert.equal(upgraded.metadata?.exportProvenance?.branches[0]?.source, 'history_messages')
  assert.equal(
    upgraded.metadata?.exportProvenance?.branches[0]?.transcriptShape,
    'history-recovered',
  )
})

void test('merges a later partial history_messages recovery onto the existing branch transcript', () => {
  const firstStoredSession = applyTranscriptRecoveryToStoredSession({
    storedSession: createStoredSessionFromFirstMessage({
      prompt: '第一轮问题',
      persistedAt: '2026-04-04T00:00:00.000Z',
      result: createFirstMessageResult({
        assistantText: '第一轮回答',
      }),
    }),
    recoveredSession: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Recovered Session',
      createdAt: '2026-04-04T00:00:00.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-123',
          title: 'Recovered Branch',
          createdAt: '2026-04-04T00:00:00.000Z',
          messages: [
            {
              id: '1',
              role: 'user',
              text: '第一轮问题',
              createdAt: '2026-04-04T00:00:00.000Z',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
            {
              id: '2',
              role: 'assistant',
              text: '第一轮回答',
              createdAt: '2026-04-04T00:00:01.000Z',
              parentId: '1',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
          ],
        },
      ],
    },
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
      responseStatus: 200,
      recoveredAt: '2026-04-04T00:00:02.000Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
  })

  const upgraded = applyTranscriptRecoveryToStoredSession({
    storedSession: firstStoredSession,
    recoveredSession: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Recovered Session',
      createdAt: '2026-04-04T00:00:00.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-123',
          title: '第二轮问题',
          createdAt: '2026-04-04T00:00:00.000Z',
          messages: [
            {
              id: '3',
              role: 'user',
              text: '第二轮问题',
              createdAt: '2026-04-04T00:00:03.000Z',
              parentId: '2',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
            {
              id: '4',
              role: 'assistant',
              text: '第二轮回答',
              createdAt: '2026-04-04T00:00:04.000Z',
              parentId: '3',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
          ],
        },
      ],
    },
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123&cache_version=2',
      responseStatus: 200,
      recoveredAt: '2026-04-04T00:00:05.000Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
  })

  assert.equal(upgraded.session.branches[0]?.title, 'Recovered Branch')
  assert.deepEqual(
    upgraded.session.branches[0]?.messages.map(message => message.id),
    ['1', '2', '3', '4'],
  )
})

void test('preserves a previously recovered transcript status when a later recovery attempt fails', () => {
  const storedSession = applyTranscriptRecoveryToStoredSession({
    storedSession: createStoredSessionFromFirstMessage({
      prompt: 'hello',
      persistedAt: '2026-04-04T00:00:00.000Z',
      result: createFirstMessageResult(),
    }),
    recoveredSession: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Recovered Session',
      createdAt: '2026-04-04T00:00:00.000Z',
      branches: [],
    },
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
      responseStatus: 200,
      recoveredAt: '2026-04-04T00:00:02.000Z',
      attempts: 1,
      branchCount: 0,
      messageCount: 0,
      settled: true,
    },
  })

  const upgraded = applyTranscriptRecoveryToStoredSession({
    storedSession,
    transcriptRecovery: {
      source: 'history_messages',
      status: 'failed',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123&cache_version=2',
      responseStatus: 200,
      recoveredAt: '2026-04-04T00:00:03.000Z',
      attempts: 3,
      branchCount: 0,
      messageCount: 0,
      settled: false,
      errorMessage: 'Could not find any messages in the history_messages payload.',
    },
  })

  assert.equal(upgraded.metadata?.transcriptRecovery?.status, 'recovered')
  assert.equal(
    upgraded.metadata?.transcriptRecovery?.requestUrl,
    'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
  )
})

void test('appends a synthetic reply turn when live transcript recovery is unavailable', () => {
  const storedSession = applyTranscriptRecoveryToStoredSession({
    storedSession: createStoredSessionFromFirstMessage({
      prompt: '第一轮问题',
      persistedAt: '2026-04-04T00:00:00.000Z',
      result: createFirstMessageResult(),
    }),
    recoveredSession: {
      id: 'session-123',
      agentId: 'chat',
      title: 'Recovered Session',
      createdAt: '2026-04-04T00:00:00.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-123',
          title: 'Recovered Branch',
          createdAt: '2026-04-04T00:00:00.000Z',
          messages: [
            {
              id: '1',
              role: 'user',
              text: '第一轮问题',
              createdAt: '2026-04-04T00:00:00.000Z',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
            {
              id: '2',
              role: 'assistant',
              text: '第一轮回答',
              createdAt: '2026-04-04T00:00:01.000Z',
              parentId: '1',
              branchId: 'branch-main',
              attachments: [],
              citations: [],
            },
          ],
        },
      ],
    },
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-123',
      responseStatus: 200,
      recoveredAt: '2026-04-04T00:00:02.000Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
  })

  const upgraded = appendReplyTurnToStoredSession({
    storedSession,
    prompt: '第二轮问题',
    persistedAt: '2026-04-04T00:00:03.000Z',
    result: {
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
      agentId: 'chat',
      sessionId: 'session-123',
      generationObservations: [
        {
          endpoint: '/api/v0/chat/completion',
          url: 'https://chat.deepseek.com/api/v0/chat/completion',
          status: 200,
          contentType: 'text/event-stream',
          outputTokens: 12,
        },
      ],
      generationRuns: [
        {
          endpoint: '/api/v0/chat/completion',
          transport: 'sse',
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
          context: {
            runId: 'run-456',
            endpoint: '/api/v0/chat/completion',
            transport: 'sse',
            requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
            agentId: 'chat',
            sessionId: 'session-123',
            branchId: null,
            parentMessageId: '3',
            assistantMessageId: '4',
          },
          finalized: {
            status: 'completed',
            finishReason: 'stop',
            outputText: '第二轮回答',
            reasoningText: '',
            reasoningKind: 'unknown',
            citations: [],
            responseReferences: [],
            searches: [],
            usage: {
              inputTokens: null,
              outputTokens: 12,
              totalTokens: null,
              reasoningTokens: null,
            },
            error: null,
            completedAt: '2026-04-04T00:00:04.000Z',
          },
          eventCount: 4,
          unknownObservationCount: 0,
          unknownObservationLabels: [],
        },
      ],
      fileUpload: null,
      assistantText: '第二轮回答',
      assistantTextSource: 'generation-stream',
    },
  })

  assert.deepEqual(
    upgraded.session.branches[0]?.messages.map(message => message.id),
    ['1', '2', '3', '4'],
  )
  assert.equal(upgraded.metadata?.lastAssistantTextSource, 'generation-stream')
  assert.equal(upgraded.session.branches[0]?.messages[2]?.parentId, '2')
  assert.equal(upgraded.session.branches[0]?.messages[3]?.text, '第二轮回答')
})

void test('falls back to summary-only when generation stream text is unavailable', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请总结这次对话并给出后续建议',
    persistedAt: '2026-04-04T00:00:00.000Z',
    result: createFirstMessageResult({
      assistantText: null,
      assistantTextSource: 'unavailable',
      generationRuns: [],
    }),
  })

  assert.equal(storedSession.metadata?.firstBatchSummary.captureMode, 'summary-only')
  assert.equal(storedSession.metadata?.lastAssistantTextSource, 'unavailable')
  assert.match(storedSession.session.branches[0]?.messages[1]?.text ?? '', /history_messages/i)
})

void test('preserves mounted uploaded attachments on the placeholder user message before transcript recovery', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请阅读附件后总结',
    persistedAt: '2026-04-04T00:00:00.000Z',
    result: createFirstMessageResult({
      fileUpload: {
        fileInput: {
          found: true,
          selector: 'input[type="file"]',
          accept: '.pdf',
          acceptedExtensions: ['.pdf'],
          multiple: true,
          hidden: true,
        },
        requestedPaths: ['/tmp/brief.pdf'],
        acceptedPaths: ['/tmp/brief.pdf'],
        problems: [],
        files: [
          {
            path: '/tmp/brief.pdf',
            fileName: 'brief.pdf',
            extension: '.pdf',
            sizeBytes: 128,
            acceptedByPreflight: true,
            uploaded: true,
            settled: true,
            mounted: true,
            fileId: 'file-brief',
            serverStatus: 'SUCCESS',
            previewable: true,
            tokenUsage: 3,
            previewUrl: 'https://files.example/brief.pdf',
            errorCode: null,
            errorMessage: null,
            upload: null,
            fetched: null,
            preview: null,
            problems: [],
          },
        ],
        fetches: [],
        settled: true,
        blockingIssues: false,
      },
    }),
  })

  assert.deepEqual(storedSession.session.branches[0]?.messages[0]?.attachments, [
    {
      id: 'file-brief',
      name: 'brief.pdf',
      sizeBytes: 128,
      url: 'https://files.example/brief.pdf',
    },
  ])
})

void test('preserves richer local attachment metadata when real first-message history recovery omits preview url', async () => {
  const recoveredSession = await loadHistoryFixtureSession(
    'history-messages.attachments.first-message.real.fixture.json',
  )

  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请阅读附件后，只回复：attachment history probe ok。',
    persistedAt: '2026-04-06T02:19:42.000Z',
    result: createFirstMessageResult({
      sessionId: 'session-attachment-redacted',
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-attachment-redacted',
      generationRuns: [],
      fileUpload: {
        fileInput: {
          found: true,
          selector: 'input[type="file"]',
          accept: '.md',
          acceptedExtensions: ['.md'],
          multiple: true,
          hidden: true,
        },
        requestedPaths: ['./README.md'],
        acceptedPaths: ['./README.md'],
        problems: [],
        files: [
          {
            path: './README.md',
            fileName: 'README.md',
            extension: '.md',
            sizeBytes: 4676,
            acceptedByPreflight: true,
            uploaded: true,
            settled: true,
            mounted: true,
            fileId: 'file-attachment-first-redacted',
            serverStatus: 'SUCCESS',
            previewable: true,
            tokenUsage: 1391,
            previewUrl: 'https://files.example/README.md',
            errorCode: null,
            errorMessage: null,
            upload: null,
            fetched: null,
            preview: null,
            problems: [],
          },
        ],
        fetches: [],
        settled: true,
        blockingIssues: false,
      },
    }),
  })

  const upgraded = applyTranscriptRecoveryToStoredSession({
    storedSession,
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-attachment-redacted',
      responseStatus: 200,
      recoveredAt: '2026-04-06T02:19:42.950Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
    recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
      localSession: storedSession.session,
      recoveredSession,
    }),
  })

  assert.equal(upgraded.session.branches[0]?.messages[0]?.id, '1')
  assert.equal(upgraded.session.branches[0]?.messages[0]?.attachments[0]?.name, 'README.md')
  assert.equal(
    upgraded.session.branches[0]?.messages[0]?.attachments[0]?.url,
    'https://files.example/README.md',
  )
})

void test('preserves vision image upload evidence when history recovery omits attachments', () => {
  const storedSession = createStoredSessionFromFirstMessage({
    prompt: '请描述这张图片。',
    persistedAt: '2026-04-29T10:40:42.000Z',
    result: createFirstMessageResult({
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
      sessionId: 'session-vision',
      sessionCreate: {
        sessionId: 'session-vision',
        agentId: 'chat',
        url: 'https://chat.deepseek.com/api/v0/chat_session/create',
        status: 200,
      },
      generationObservations: [
        {
          endpoint: '/api/v0/chat/completion',
          url: 'https://chat.deepseek.com/api/v0/chat/completion',
          status: 200,
          contentType: 'text/event-stream',
          outputTokens: 7,
          requestModelType: 'vision',
          requestRefFileIds: ['file-vision-image'],
        },
      ],
      generationRuns: [createVisionGenerationRun()],
      requestedComposerMode: {
        chatMode: 'vision',
        deepThink: 'unchanged',
        search: 'unchanged',
      },
      composerMode: {
        chatMode: 'vision',
        deepThink: 'on',
        search: 'unavailable',
      },
      fileUpload: createVisionImageUploadBatch(),
      assistantText: '这是一张白色矩形图片。',
    }),
  })

  const upgraded = applyTranscriptRecoveryToStoredSession({
    storedSession,
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-vision',
      responseStatus: 200,
      recoveredAt: '2026-04-29T10:40:43.000Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
    recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
      localSession: storedSession.session,
      recoveredSession: createVisionRecoveredSessionWithoutAttachments(),
    }),
  })

  const userMessage = upgraded.session.branches[0]?.messages.find(message => message.role === 'user')

  assert.equal(upgraded.session.modeFact?.rawModelType, 'vision')
  assert.equal(upgraded.session.modeFact?.resolvedMode, 'vision')
  assert.equal(upgraded.metadata?.generationObservations[0]?.requestModelType, 'vision')
  assert.deepEqual(upgraded.metadata?.generationObservations[0]?.requestRefFileIds, [
    'file-vision-image',
  ])
  assert.equal(userMessage?.attachments[0]?.id, 'file-vision-image')
  assert.equal(userMessage?.attachments[0]?.name, 'vision-white-rect.png')
  assert.equal(userMessage?.attachments[0]?.url, 'https://files.example/vision-white-rect.png')
})

void test('preserves richer local attachment metadata across MERGE history recovery for reply turns', async () => {
  const baseStoredSession = applyTranscriptRecoveryToStoredSession({
    storedSession: createStoredSessionFromFirstMessage({
      prompt: '请阅读附件后，只回复：attachment history probe ok。',
      persistedAt: '2026-04-06T02:19:42.000Z',
      result: createFirstMessageResult({
        sessionId: 'session-attachment-redacted',
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-attachment-redacted',
        generationRuns: [],
      }),
    }),
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-attachment-redacted',
      responseStatus: 200,
      recoveredAt: '2026-04-06T02:19:42.950Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
    recoveredSession: await loadHistoryFixtureSession(
      'history-messages.attachments.first-message.real.fixture.json',
    ),
  })

  const replyOverlaySession = appendReplyTurnToStoredSession({
    storedSession: baseStoredSession,
    prompt: '再次阅读附件后，只回复：attachment reply ok。',
    result: {
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-attachment-redacted',
      agentId: 'chat',
      sessionId: 'session-attachment-redacted',
      generationObservations: [],
      generationRuns: [],
      fileUpload: {
        fileInput: {
          found: true,
          selector: 'input[type="file"]',
          accept: '.md',
          acceptedExtensions: ['.md'],
          multiple: true,
          hidden: true,
        },
        requestedPaths: ['./README.md'],
        acceptedPaths: ['./README.md'],
        problems: [],
        files: [
          {
            path: './README.md',
            fileName: 'README.md',
            extension: '.md',
            sizeBytes: 4676,
            acceptedByPreflight: true,
            uploaded: true,
            settled: true,
            mounted: true,
            fileId: 'file-attachment-reply-redacted',
            serverStatus: 'SUCCESS',
            previewable: true,
            tokenUsage: 1391,
            previewUrl: 'https://files.example/reply-README.md',
            errorCode: null,
            errorMessage: null,
            upload: null,
            fetched: null,
            preview: null,
            problems: [],
          },
        ],
        fetches: [],
        settled: true,
        blockingIssues: false,
      },
      assistantText: 'attachment reply ok',
      assistantTextSource: 'generation-stream',
    },
    persistedAt: '2026-04-06T02:21:10.955Z',
  })

  const upgraded = applyTranscriptRecoveryToStoredSession({
    storedSession: baseStoredSession,
    transcriptRecovery: {
      source: 'history_messages',
      status: 'recovered',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-attachment-redacted&cache_version=2&cache_reset_at=1775442058',
      responseStatus: 200,
      recoveredAt: '2026-04-06T02:21:10.955Z',
      attempts: 1,
      branchCount: 1,
      messageCount: 2,
      settled: true,
    },
    recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
      localSession: replyOverlaySession.session,
      recoveredSession: await loadHistoryFixtureSession(
        'history-messages.attachments.reply.real.fixture.json',
      ),
    }),
  })

  assert.deepEqual(
    upgraded.session.branches[0]?.messages.map(message => message.id),
    ['1', '2', '3', '4'],
  )
  assert.equal(upgraded.session.branches[0]?.messages[2]?.attachments[0]?.id, 'file-attachment-reply-redacted')
  assert.equal(
    upgraded.session.branches[0]?.messages[2]?.attachments[0]?.url,
    'https://files.example/reply-README.md',
  )
})

void test('stored session files round-trip while remaining compatible with loadSessionFromFile', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-stored-session-'))

  try {
    const storedSession = createStoredSessionFromFirstMessage({
      prompt: 'hello from fixture',
      persistedAt: '2026-04-04T00:00:00.000Z',
      result: createFirstMessageResult({
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
        sessionId: 'session-123',
        outputTokensUsed: 7,
      }),
    })
    const filePath = buildDeepSeekSessionFilePath('session-123', outputDir)

    await saveStoredSessionToFile(filePath, storedSession)

    const loadedStoredSession = await loadStoredSessionFromFile(filePath)
    const loadedSession = await loadSessionFromFile(filePath)

    assert.equal(loadedStoredSession.kind, 'deepseek-stored-session')
    assert.equal(loadedStoredSession.metadata?.finalUrl, 'https://chat.deepseek.com/a/chat/s/session-123')
    assert.equal(loadedSession.id, 'session-123')
    assert.equal(loadedSession.branches[0]?.messages[0]?.text, 'hello from fixture')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('loadStoredSessionFromFile wraps legacy session files without metadata', async () => {
  const storedSession = await loadStoredSessionFromFile(
    join(process.cwd(), 'test/fixtures/sample-session.json'),
  )

  assert.equal(storedSession.kind, 'deepseek-stored-session')
  assert.equal(storedSession.session.id, 'session-001')
  assert.equal(storedSession.metadata, null)
})

void test('resolves the default session store inside the current working tree', () => {
  const resolvedDir = resolveDeepSeekSessionStoreDir(undefined, '/tmp/deepseek-cdp-cli')

  assert.equal(resolvedDir, '/tmp/deepseek-cdp-cli/.deepseek-cdp-cli/sessions')
})

function createVisionGenerationRun(): Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'>['generationRuns'][number] {
  return {
    endpoint: '/api/v0/chat/completion',
    transport: 'sse',
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
    context: {
      runId: 'run-vision',
      endpoint: '/api/v0/chat/completion',
      transport: 'sse',
      requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
      routeUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
      agentId: 'chat',
      sessionId: 'session-vision',
      branchId: 'branch-main',
      parentMessageId: '1',
      assistantMessageId: '2',
      modeFact: {
        sourceLayer: 'canonical-generation-context',
        rawModelType: 'vision',
        resolvedMode: 'vision',
        derivedFromLayer: 'request-payload',
      },
    },
    finalized: {
      status: 'completed',
      finishReason: 'stop',
      outputText: '这是一张白色矩形图片。',
      reasoningText: '',
      reasoningKind: 'unknown',
      citations: [],
      responseReferences: [],
      searches: [],
      usage: {
        inputTokens: null,
        outputTokens: 7,
        totalTokens: null,
        reasoningTokens: null,
      },
      error: null,
      completedAt: '2026-04-29T10:40:43.000Z',
    },
    eventCount: 3,
    unknownObservationCount: 0,
    unknownObservationLabels: [],
  }
}

function createVisionImageUploadBatch(): DeepSeekFileUploadBatchResult {
  return {
    fileInput: {
      found: true,
      selector: 'input[type="file"]',
      accept: '.png,.jpg,.jpeg,.webp',
      acceptedExtensions: ['.jpeg', '.jpg', '.png', '.webp'],
      multiple: true,
      hidden: true,
    },
    requestedPaths: ['/tmp/vision-white-rect.png'],
    acceptedPaths: ['/tmp/vision-white-rect.png'],
    problems: [],
    files: [
      {
        path: '/tmp/vision-white-rect.png',
        fileName: 'vision-white-rect.png',
        extension: '.png',
        sizeBytes: 96,
        acceptedByPreflight: true,
        uploaded: true,
        settled: true,
        mounted: true,
        fileId: 'file-vision-image',
        serverStatus: 'SUCCESS',
        previewable: true,
        tokenUsage: 4,
        previewUrl: 'https://files.example/vision-white-rect.png',
        errorCode: null,
        errorMessage: null,
        upload: null,
        fetched: null,
        preview: null,
        problems: [],
      },
    ],
    fetches: [],
    settled: true,
    blockingIssues: false,
  }
}

function createVisionRecoveredSessionWithoutAttachments(): DeepSeekSession {
  return {
    id: 'session-vision',
    agentId: 'chat',
    title: 'Vision recovered session',
    createdAt: '2026-04-29T10:40:42.000Z',
    modeFact: {
      sourceLayer: 'history-messages-mapped-session',
      rawModelType: 'vision',
      resolvedMode: 'vision',
      derivedFromLayer: 'history-messages-raw',
    },
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-vision',
        title: 'Vision recovered branch',
        createdAt: '2026-04-29T10:40:42.000Z',
        messages: [
          {
            id: 'history-user-vision',
            role: 'user',
            text: '请描述 history 中的这张图片。',
            createdAt: '2026-04-29T10:40:42.000Z',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: 'history-assistant-vision',
            role: 'assistant',
            text: '这是一张白色矩形图片。',
            createdAt: '2026-04-29T10:40:43.000Z',
            parentId: 'history-user-vision',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
  }
}

function createFirstMessageResult(
  overrides: Partial<Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'>> = {},
): Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'> {
  return {
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
    agentId: 'chat',
    sessionId: 'session-123',
    sessionCreate: {
      sessionId: 'session-123',
      agentId: 'chat',
      url: 'https://chat.deepseek.com/api/v0/chat_session/create',
      status: 200,
    },
    completionRequestObserved: true,
    generationObservations: [
      {
        endpoint: '/api/v0/chat/completion',
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        status: 200,
        contentType: 'application/json',
        outputTokens: 7,
      },
    ],
    generationRuns: [
      {
        endpoint: '/api/v0/chat/completion',
        transport: 'json',
        routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
        context: {
          runId: 'run-123',
          endpoint: '/api/v0/chat/completion',
          transport: 'json',
          requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
          agentId: 'chat',
          sessionId: 'session-123',
          branchId: null,
          parentMessageId: null,
          assistantMessageId: '2',
          modeFact: {
            sourceLayer: 'canonical-generation-context',
            rawModelType: 'default',
            resolvedMode: 'instant',
            derivedFromLayer: 'generation-ready-sse',
          },
        },
        finalized: {
          status: 'completed',
          finishReason: 'stop',
          outputText: 'fixture assistant text',
          reasoningText: '',
          reasoningKind: 'unknown',
          citations: [],
          responseReferences: [],
          searches: [],
          usage: {
            inputTokens: null,
            outputTokens: 7,
            totalTokens: null,
            reasoningTokens: null,
          },
          error: null,
          completedAt: '2026-04-04T00:00:01.000Z',
        },
        eventCount: 3,
        unknownObservationCount: 0,
        unknownObservationLabels: [],
      },
    ],
    outputTokensUsed: 7,
    settledAfterMs: 1_250,
    requestedComposerMode: {
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
      deepThink: 'on',
      search: 'on',
    },
    beforeSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/',
      routeKind: 'home',
      agentId: null,
      sessionId: null,
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: '#send',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'Search',
        state: 'on',
      },
      fileButton: {
        found: true,
        selector: '[role="button"]',
        label: 'File',
      },
    },
    afterSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-123',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-123',
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: '#send',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'Search',
        state: 'on',
      },
      fileButton: {
        found: true,
        selector: '[role="button"]',
        label: 'File',
      },
    },
    assistantText: 'fixture assistant text',
    assistantTextSource: 'generation-stream',
    ...overrides,
  }
}

async function loadHistoryFixtureSession(fileName: string) {
  const fixture = JSON.parse(
    await readFile(
      join(process.cwd(), 'test/fixtures/deepseek-history-messages', fileName),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }

  return mapHistoryMessagesEnvelopeToSession(JSON.parse(fixture.response.bodyText) as unknown)
}
