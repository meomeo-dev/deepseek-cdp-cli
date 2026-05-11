import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'

export function createSearchEnabledOutputDriftFixtureReplyResult(): DeepSeekReplyResult {
  const base = createBaseFixtureReplyResult({
    assistantText: '让我先搜索资料...[reference:0]',
    requestedComposerMode: {
      deepThink: 'on',
      search: 'on',
    },
    composerMode: {
      chatMode: 'instant',
      deepThink: 'on',
      search: 'on',
    },
  })
  const context = base.generationRuns[0]!.context
  const finalized = {
    ...base.generationRuns[0]!.finalized,
    outputText: '让我先搜索资料...[reference:0]',
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
        kind: 'search.patch' as const,
        sequence: 2,
        occurredAt: '2026-04-05T00:00:01.500Z',
        context,
        patchMode: 'append' as const,
        search: finalized.searches[0]!,
      },
      {
        kind: 'citation.patch' as const,
        sequence: 3,
        occurredAt: '2026-04-05T00:00:01.750Z',
        context,
        patchMode: 'append' as const,
        citations: finalized.citations,
      },
      {
        kind: 'text.delta' as const,
        sequence: 4,
        occurredAt: '2026-04-05T00:00:02.000Z',
        context,
        delta: '[reference:0]',
        accumulatedText: '让我先搜索资料...[reference:0]',
      },
      {
        kind: 'completed' as const,
        sequence: 5,
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
    ...base.generationRuns[0]!,
    finalized,
    eventCount: 5,
    unknownObservationCount: 0,
    unknownObservationLabels: [],
  }

  return {
    ...base,
    generationRuns: [observedRun],
    session: {
      ...base.session,
      branches: [
        {
          ...base.session.branches[0]!,
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

export function createHallucinatedCitationOutputDriftFixtureReplyResult(): DeepSeekReplyResult {
  const base = createBaseFixtureReplyResult({
    assistantText: '这里有引用[15†L11-L12]',
    composerMode: {
      chatMode: 'instant',
      deepThink: 'off',
      search: 'off',
    },
  })
  const context = base.generationRuns[0]!.context
  const finalized = {
    ...base.generationRuns[0]!.finalized,
    outputText: '这里有引用[15†L11-L12]',
    responseReferences: [],
  }
  const canonicalRun = {
    ...base.output.canonicalRuns[0]!,
    context,
    events: [
      {
        kind: 'text.delta' as const,
        sequence: 1,
        occurredAt: '2026-04-05T00:00:01.000Z',
        context,
        delta: '这里有引用[15†L11-L12]',
        accumulatedText: '这里有引用[15†L11-L12]',
      },
      {
        kind: 'completed' as const,
        sequence: 2,
        occurredAt: '2026-04-05T00:00:02.000Z',
        context,
        result: finalized,
      },
    ],
    finalized,
  }
  const observedRun = {
    ...base.generationRuns[0]!,
    finalized,
    eventCount: 2,
  }

  return {
    ...base,
    assistantText: '这里有引用[15†L11-L12]',
    generationRuns: [observedRun],
    session: {
      ...base.session,
      branches: [
        {
          ...base.session.branches[0]!,
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
              text: '这里有引用[15†L11-L12]',
              createdAt: '2026-04-05T00:00:02.000Z',
              branchId: 'branch-main',
              parentId: 'message-user-1',
              citations: [],
              responseReferences: [],
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
      finalizedAssistantText: '这里有引用[15†L11-L12]',
    },
  }
}

function createBaseFixtureReplyResult(overrides: Partial<DeepSeekReplyResult> = {}): DeepSeekReplyResult {
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
    modeFact: {
      sourceLayer: 'canonical-generation-context' as const,
      rawModelType: 'default',
      resolvedMode: 'instant' as const,
      derivedFromLayer: 'generation-ready-sse' as const,
    },
  }
  const finalized = {
    status: 'completed' as const,
    finishReason: 'stop' as const,
    outputText: 'Hello from DeepSeek',
    reasoningText: '',
    reasoningKind: 'unknown' as const,
    citations: [],
    responseReferences: [],
    searches: [],
    usage: {
      inputTokens: 1,
      outputTokens: 3,
      totalTokens: 4,
      reasoningTokens: null,
    },
    error: null,
    completedAt: '2026-04-05T00:00:02.000Z',
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
        delta: 'Hello from DeepSeek',
        accumulatedText: 'Hello from DeepSeek',
      },
      {
        kind: 'completed' as const,
        sequence: 2,
        occurredAt: '2026-04-05T00:00:02.000Z',
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
    generationObservations: [
      {
        endpoint: '/api/v0/chat/completion',
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        status: 200,
        contentType: 'text/event-stream',
        outputTokens: 3,
      },
    ],
    generationRuns: [observedRun],
    outputTokensUsed: 3,
    settledAfterMs: 500,
    budget: {
      queriesRemaining: 10,
      tokensRemaining: 1000,
      resetsAt: '2026-04-05T01:00:00.000Z',
    },
    requestedComposerMode: {
      chatMode: 'unchanged',
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
      chatMode: 'instant',
      deepThink: 'off',
      search: 'off',
    },
    beforeSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/',
      routeKind: 'home',
      agentId: null,
      sessionId: null,
      composerInput: { found: true, selector: 'textarea', label: 'Message DeepSeek' },
      sendOrStopButton: { found: true, selector: '#send', label: 'Send', state: 'send' },
      deepThinkToggle: { found: true, selector: '#deepthink', label: 'DeepThink', state: 'off' },
      searchToggle: { found: true, selector: '#search', label: 'Search', state: 'off' },
      fileButton: { found: true, selector: '#file', label: 'File' },
    },
    afterSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-001',
      composerInput: { found: true, selector: 'textarea', label: 'Message DeepSeek' },
      sendOrStopButton: { found: true, selector: '#send', label: 'Send', state: 'send' },
      deepThinkToggle: { found: true, selector: '#deepthink', label: 'DeepThink', state: 'off' },
      searchToggle: { found: true, selector: '#search', label: 'Search', state: 'off' },
      fileButton: { found: true, selector: '#file', label: 'File' },
    },
    fileUpload: null,
    assistantText: 'Hello from DeepSeek',
    assistantTextSource: 'history_messages',
    transcriptRecovery: null,
    session: {
      id: 'session-001',
      agentId: 'chat',
      title: 'Session 001',
      createdAt: '2026-04-05T00:00:00.000Z',
      modeFact: {
        sourceLayer: 'stored-session',
        rawModelType: 'default',
        resolvedMode: 'instant',
        derivedFromLayer: 'canonical-generation-context',
      },
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
              text: 'Hello from DeepSeek',
              createdAt: '2026-04-05T00:00:02.000Z',
              branchId: 'branch-main',
              parentId: 'message-user-1',
              citations: [],
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
      finalizedAssistantText: 'Hello from DeepSeek',
    },
    ...overrides,
  }
}
