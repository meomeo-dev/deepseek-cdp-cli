import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDeepSeekReplyOutputMode } from '../src/application/services/deepSeekReplyOutputMode.js'
import {
  buildDeepSeekRpcBufferedResult,
  buildDeepSeekRpcStreamingResult,
} from '../src/interfaces/rpc/deepSeekRpcOutput.js'
import type { DeepSeekReplyResult } from '../src/types/deepseek-reply.types.js'

void test('RPC buffered result summary includes resolved assistant search artifacts', () => {
  const result = createSearchEnabledReplyResult()
  const rpcResult = buildDeepSeekRpcBufferedResult({
    result,
    outputMode: resolveDeepSeekReplyOutputMode({
      format: 'json',
      jsonShape: 'native',
    }),
  })

  assert.equal(rpcResult.summary.assistantArtifacts.source, 'session-target')
  assert.equal(rpcResult.summary.assistantArtifacts.branchId, 'branch-main')
  assert.equal(rpcResult.summary.assistantArtifacts.messageId, 'message-assistant-1')
  assert.deepEqual(rpcResult.summary.assistantArtifacts.inlineReferenceTokens, ['[reference:0]'])
  assert.deepEqual(rpcResult.summary.assistantArtifacts.responseReferences, [
    {
      referenceId: '4',
      referenceType: 'TOOL_OPEN',
    },
    {
      referenceId: '3',
      referenceType: 'TOOL_SEARCH',
    },
  ])
  assert.equal(
    rpcResult.summary.assistantArtifacts.inlineCitationObservations[0]?.verificationStatus,
    'verified',
  )
  assert.equal(rpcResult.summary.assistantArtifacts.citationCount, 1)
  assert.equal(rpcResult.summary.assistantArtifacts.searchCount, 1)
  assert.equal(
    rpcResult.summary.assistantArtifacts.searches[0]?.query,
    'OpenAI Responses API streaming events data structure official documentation',
  )
})

void test('RPC streaming result carries the same assistant artifact summary and readable citations in finalOutput', () => {
  const result = createSearchEnabledReplyResult()
  const rpcResult = buildDeepSeekRpcStreamingResult({
    result,
    outputMode: resolveDeepSeekReplyOutputMode({
      stream: true,
      format: 'text',
    }),
  })

  assert.equal(rpcResult.summary.assistantArtifacts.searchCount, 1)
  assert.equal(rpcResult.finalOutput.format, 'text')
  if (rpcResult.finalOutput.format !== 'text') {
    throw new Error('Expected text final output envelope.')
  }
  assert.match(rpcResult.finalOutput.text, /Citations:/)
  assert.match(
    rpcResult.finalOutput.text,
    /- \[reference:0\] Exact page \| Agent Streaming Architecture in OpenAI Agents SDK¶ \| https:\/\/adalflow\.sylph\.ai\/design\/agent-streaming\.html/,
  )
  assert.match(
    rpcResult.finalOutput.text,
    /- \[reference:1\] Search result set \| query=OpenAI Responses API streaming events data structure official documentation \| candidates=1/,
  )
  assert.doesNotMatch(rpcResult.finalOutput.text, /Inline References Observed:/)
})

function createSearchEnabledReplyResult(): DeepSeekReplyResult {
  const context = {
    runId: 'run-001',
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    branchId: 'branch-main',
    parentMessageId: 'message-user-1',
    assistantMessageId: 'message-assistant-1',
  }
  const finalized = {
    status: 'completed' as const,
    finishReason: 'stop' as const,
    outputText: '让我先搜索资料...[reference:0]',
    reasoningText: '',
    reasoningKind: 'unknown' as const,
    citations: [
      {
        id: 'https://adalflow.sylph.ai/design/agent-streaming.html',
        title: 'Agent Streaming Architecture in OpenAI Agents SDK¶',
        url: 'https://adalflow.sylph.ai/design/agent-streaming.html',
        snippet: 'A deep dive into streaming architecture.',
        annotation: {
          source: 'search' as const,
        },
      },
    ],
    responseReferences: [
      {
        referenceId: '4',
        referenceType: 'TOOL_OPEN',
      },
      {
        referenceId: '3',
        referenceType: 'TOOL_SEARCH',
      },
    ],
    searches: [
      {
        query: 'OpenAI Responses API streaming events data structure official documentation',
        status: 'completed' as const,
        results: [
          {
            id: 'https://adalflow.sylph.ai/design/agent-streaming.html',
            title: 'Agent Streaming Architecture in OpenAI Agents SDK¶',
            url: 'https://adalflow.sylph.ai/design/agent-streaming.html',
            snippet: 'A deep dive into streaming architecture.',
            source: 'Sylph AI',
          },
        ],
      },
    ],
    usage: {
      inputTokens: 1,
      outputTokens: 9,
      totalTokens: 10,
      reasoningTokens: null,
    },
    error: null,
    completedAt: '2026-04-05T00:00:03.000Z',
  }
  const canonicalRun = {
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    context,
    events: [
      {
        kind: 'text.delta' as const,
        sequence: 1,
        occurredAt: '2026-04-05T00:00:01.000Z',
        context,
        delta: '让我先搜索资料...',
        accumulatedText: '让我先搜索资料...',
      },
      {
        kind: 'completed' as const,
        sequence: 2,
        occurredAt: '2026-04-05T00:00:03.000Z',
        context,
        result: finalized,
      },
    ],
    finalized,
    unknownObservations: [],
    unknownObservationCount: 0,
    unknownObservationLabels: [],
  }
  const observedRun = {
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    context,
    finalized,
    eventCount: 2,
    unknownObservationCount: 0,
    unknownObservationLabels: [],
  }

  return {
    entryMode: 'new-session',
    streamRequested: true,
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    sessionFile: '/tmp/session-001.json',
    sessionCreate: {
      sessionId: 'session-001',
      agentId: 'chat',
      url: 'https://chat.deepseek.com/api/v0/chat_session/create',
      status: 200,
    },
    completionRequestObserved: true,
    generationObservations: [],
    generationRuns: [observedRun],
    outputTokensUsed: 9,
    settledAfterMs: 500,
    budget: {
      queriesRemaining: 10,
      tokensRemaining: 1000,
      resetsAt: '2026-04-05T01:00:00.000Z',
    },
    requestedComposerMode: {
      deepThink: 'on',
      search: 'on',
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
      composerInput: { found: true, selector: 'textarea', label: 'Message DeepSeek' },
      sendOrStopButton: { found: true, selector: '#send', label: 'Send', state: 'send' },
      deepThinkToggle: { found: true, selector: '#deepthink', label: 'DeepThink', state: 'on' },
      searchToggle: { found: true, selector: '#search', label: 'Search', state: 'on' },
      fileButton: { found: true, selector: '#file', label: 'File' },
    },
    afterSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-001',
      composerInput: { found: true, selector: 'textarea', label: 'Message DeepSeek' },
      sendOrStopButton: { found: true, selector: '#send', label: 'Send', state: 'send' },
      deepThinkToggle: { found: true, selector: '#deepthink', label: 'DeepThink', state: 'on' },
      searchToggle: { found: true, selector: '#search', label: 'Search', state: 'on' },
      fileButton: { found: true, selector: '#file', label: 'File' },
    },
    fileUpload: null,
    assistantText: '让我先搜索资料...[reference:0]',
    assistantTextSource: 'history_messages',
    transcriptRecovery: null,
    session: {
      id: 'session-001',
      agentId: 'chat',
      title: 'Session 001',
      createdAt: '2026-04-05T00:00:00.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-001',
          title: 'Main Branch',
          createdAt: '2026-04-05T00:00:00.000Z',
          messages: [
            {
              id: 'message-user-1',
              role: 'user',
              text: 'hello',
              createdAt: '2026-04-05T00:00:00.000Z',
              branchId: 'branch-main',
              citations: [],
              attachments: [],
            },
            {
              id: 'message-assistant-1',
              role: 'assistant',
              text: '让我先搜索资料...[reference:0]',
              createdAt: '2026-04-05T00:00:02.000Z',
              branchId: 'branch-main',
              parentId: 'message-user-1',
              citations: [
                {
                  id: 'https://adalflow.sylph.ai/design/agent-streaming.html',
                  title: 'Agent Streaming Architecture in OpenAI Agents SDK¶',
                  url: 'https://adalflow.sylph.ai/design/agent-streaming.html',
                  snippet: 'A deep dive into streaming architecture.',
                },
              ],
              responseReferences: [
                {
                  referenceId: '4',
                  referenceType: 'TOOL_OPEN',
                },
                {
                  referenceId: '3',
                  referenceType: 'TOOL_SEARCH',
                },
              ],
              searches: [
                {
                  query: 'OpenAI Responses API streaming events data structure official documentation',
                  status: 'completed',
                  results: [
                    {
                      id: 'https://adalflow.sylph.ai/design/agent-streaming.html',
                      title: 'Agent Streaming Architecture in OpenAI Agents SDK¶',
                      url: 'https://adalflow.sylph.ai/design/agent-streaming.html',
                      snippet: 'A deep dive into streaming architecture.',
                      source: 'Sylph AI',
                      toolSearchFragmentId: '3',
                      toolOpenFragmentIds: ['4'],
                      responseReferences: [
                        {
                          referenceId: '3',
                          referenceType: 'TOOL_SEARCH',
                          resolution: 'direct-tool-search',
                          toolSearchFragmentId: '3',
                        },
                        {
                          referenceId: '4',
                          referenceType: 'TOOL_OPEN',
                          resolution: 'via-tool-open',
                          toolSearchFragmentId: '3',
                          toolOpenFragmentId: '4',
                        },
                      ],
                    },
                  ],
                },
              ],
              attachments: [],
            },
          ],
        },
      ],
    },
    output: {
      mode: 'stream',
      canonicalEvents: canonicalRun.events,
      canonicalRuns: [canonicalRun],
      finalizedAssistantText: '让我先搜索资料...[reference:0]',
    },
  }
}
