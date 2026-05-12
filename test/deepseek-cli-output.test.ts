import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDeepSeekCliOutputChunks,
  createDeepSeekCliRealtimeOutputController,
  createDeepSeekCliRealtimeTextOutputController,
  resolveDeepSeekCliOutputMode,
} from '../src/interfaces/cli/deepSeekCliOutput.js'
import type { DeepSeekReplyResult } from '../src/types/deepseek-reply.types.js'

void test('CLI text output renders buffered assistant text by default', () => {
  const result = createReplyResult({
    assistantText: 'buffered assistant text',
    output: {
      mode: 'buffered',
      canonicalEvents: [],
      canonicalRuns: [],
      finalizedAssistantText: 'buffered assistant text',
    },
  })
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
  })

  assert.deepEqual(chunks, ['buffered assistant text\n'])
})

void test('CLI quiet text output appends a sessionId footer for buffered replies', () => {
  const result = createReplyResult({
    assistantText: 'buffered assistant text',
    output: {
      mode: 'buffered',
      canonicalEvents: [],
      canonicalRuns: [],
      finalizedAssistantText: 'buffered assistant text',
    },
  })
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
    includeSessionHandleFooter: true,
  })

  assert.deepEqual(chunks, ['buffered assistant text\n', '\nsessionId: session-001\n'])
})

void test('CLI text output appends readable citations for search-enabled replies', () => {
  const result = createSearchEnabledReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
  })

  assert.match(chunks.join(''), /让我先搜索资料\.\.\.\[reference:0\]/)
  assert.match(chunks.join(''), /Citations:/)
  assert.match(
    chunks.join(''),
    /- \[reference:0\] Exact page \| Agent Streaming Architecture in OpenAI Agents SDK¶ \| https:\/\/adalflow\.sylph\.ai\/design\/agent-streaming\.html/,
  )
  assert.match(
    chunks.join(''),
    /- \[reference:1\] Search result set \| query=OpenAI Responses API streaming events data structure official documentation \| candidates=1/,
  )
  assert.match(
    chunks.join(''),
    /candidate 1: Agent Streaming Architecture in OpenAI Agents SDK¶ \| https:\/\/adalflow\.sylph\.ai\/design\/agent-streaming\.html/,
  )
  assert.match(
    chunks.join(''),
    /Note: `\[reference:n\]` backed by `TOOL_SEARCH` denotes a search result set, not a single verified webpage\./,
  )
  assert.doesNotMatch(chunks.join(''), /Inline References Observed:/)
  assert.doesNotMatch(chunks.join(''), /Structured Response References:/)
  assert.doesNotMatch(chunks.join(''), /Search Results:/)
})

void test('CLI text output does not repeat the same reference ordinal across multiple candidate source lines', () => {
  const result = createMultiCandidateSearchReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
  })
  const content = chunks.join('')
  const topLevelReferenceOneLines = content.match(/^- \[reference:1\] /gm) ?? []

  assert.equal(topLevelReferenceOneLines.length, 1)
  assert.match(content, /candidate 1: Agent Streaming Architecture in OpenAI Agents SDK¶/)
  assert.match(content, /candidate 2: OpenAI Responses API reference overview/)
})

void test('CLI text output keeps repeated response-reference ordinals resolvable and still distinguishes search from open', () => {
  const result = createRepeatedReferenceReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
  })
  const content = chunks.join('')

  assert.match(content, /- \[reference:0\] Search result set \| query=citation ordering example \| candidates=1/)
  assert.match(content, /- \[reference:1\] Exact page \| Opened Example Page \| https:\/\/example\.com\/open-result/)
  assert.match(content, /- \[reference:2\] Search result set \| query=citation ordering example \| candidates=1/)
  assert.match(content, /- \[reference:3\] Exact page \| Opened Example Page \| https:\/\/example\.com\/open-result/)
  assert.doesNotMatch(content, /Unresolved inline references:/)
  assert.match(
    content,
    /Note: `\[reference:n\]` backed by `TOOL_SEARCH` denotes a search result set, not a single verified webpage\./,
  )
})

void test('CLI text output summarizes citation-like tokens without structured references as suspected generated citations', () => {
  const result = createHallucinatedCitationReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
  })

  assert.match(
    chunks.join(''),
    /Suspected generated citations without structured DeepSeek backing: \[15†L11-L12\]/,
  )
})

void test('CLI text output renders a rate-limit notice instead of blank output', () => {
  const result = createSearchRateLimitReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({}),
  })

  assert.match(chunks.join(''), /DeepSeek API rate limit reached while Search was enabled\./)
  assert.match(chunks.join(''), /Code: rate_limit_exceeded/)
  assert.match(
    chunks.join(''),
    /API-level retry signal, not a confirmed clickable UI retry button\./,
  )
  assert.match(chunks.join(''), /Recommended cooldown: 60s/)
})

void test('CLI streaming text output appends a final search appendix after assistant deltas', () => {
  const result = createSearchEnabledReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      stream: true,
      format: 'text',
    }),
  })

  assert.equal(chunks[0], '让我先搜索资料...')
  assert.match(chunks.at(-2) ?? '', /Citations:/)
  assert.match(chunks.at(-2) ?? '', /\[reference:0\] Exact page/)
  assert.match(chunks.at(-2) ?? '', /\[reference:1\] Search result set/)
})

void test('CLI realtime text controller writes assistant deltas before final appendix and newline', () => {
  const result = createSearchEnabledReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'text',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeTextOutputController({
    outputMode,
    write: chunk => writes.push(chunk),
  })

  for (const event of result.output.canonicalRuns[0]!.events) {
    controller.onEvent({
      kind: 'generation.event',
      attemptNumber: 1,
      outputMode,
      source: event.kind === 'completed' ? 'finalize' : 'live',
      event,
    })
  }

  assert.deepEqual(writes, ['让我先搜索资料...', '[reference:0]', '\n'])

  controller.writeFinalResult(result)

  assert.equal(
    writes.slice(0, 2).join(''),
    '让我先搜索资料...[reference:0]',
  )
  assert.equal(writes.at(2), '\n')
  assert.match(writes.at(3) ?? '', /Citations:/)
  assert.equal(writes.at(-1), '\n')
})

void test('CLI realtime text controller falls back to final buffered text when no live text delta was observed', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'text',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeTextOutputController({
    outputMode,
    write: chunk => writes.push(chunk),
  })

  controller.writeFinalResult(result)

  assert.deepEqual(writes, ['Hello from DeepSeek', '\n'])
})

void test('CLI realtime text controller separates completed live text from later logs', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'text',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeTextOutputController({
    outputMode,
    write: chunk => writes.push(chunk),
  })

  controller.onEvent({
    kind: 'generation.event',
    attemptNumber: 1,
    outputMode,
    source: 'live',
    event: {
      kind: 'text.delta',
      sequence: 1,
      occurredAt: '2026-04-05T00:00:01.000Z',
      context: result.output.canonicalRuns[0]!.context,
      delta: 'final assistant sentence without newline',
    },
  })
  controller.onEvent({
    kind: 'generation.event',
    attemptNumber: 1,
    outputMode,
    source: 'finalize',
    event: result.output.canonicalRuns[0]!.events.find(
      event => event.kind === 'completed',
    )!,
  })

  assert.equal(writes.join(''), 'final assistant sentence without newline\n')
})

void test('CLI realtime text controller appends a sessionId footer in quiet mode after live text', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'text',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeTextOutputController({
    outputMode,
    includeSessionHandleFooter: true,
    write: chunk => writes.push(chunk),
  })

  for (const event of result.output.canonicalRuns[0]!.events) {
    controller.onEvent({
      kind: 'generation.event',
      attemptNumber: 1,
      outputMode,
      source: event.kind === 'completed' ? 'finalize' : 'live',
      event,
    })
  }

  controller.writeFinalResult(result)

  assert.deepEqual(
    writes,
    ['Hello from DeepSeek', '\n', '\nsessionId: session-001\n'],
  )
})

void test('CLI native stream-json output emits one canonical event per line', () => {
  const result = createReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      stream: true,
      format: 'stream-json',
      jsonShape: 'native',
    }),
  })
  const firstEvent = JSON.parse(chunks[0] ?? '{}') as { kind?: string }
  const lastEvent = JSON.parse(chunks[1] ?? '{}') as { kind?: string }

  assert.equal(chunks.length, 2)
  assert.equal(firstEvent.kind, 'text.delta')
  assert.equal(lastEvent.kind, 'completed')
})

void test('CLI native json output preserves session-level searches for search-enabled replies', () => {
  const result = createSearchEnabledReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      format: 'json',
      jsonShape: 'native',
    }),
  })
  const payload = JSON.parse(chunks.join('')) as {
    session?: {
      branches?: Array<{
        messages?: Array<{
          id: string
          searches?: Array<{
            query: string | null
            results: Array<{
              title: string
            }>
          }>
        }>
      }>
    }
  }

  assert.equal(
    payload.session?.branches?.[0]?.messages?.[1]?.searches?.[0]?.query,
    'OpenAI Responses API streaming events data structure official documentation',
  )
  assert.equal(
    payload.session?.branches?.[0]?.messages?.[1]?.searches?.[0]?.results?.[0]?.title,
    'Agent Streaming Architecture in OpenAI Agents SDK¶',
  )
})

void test('CLI native json output exposes ignored vision search provenance', () => {
  const result = createReplyResult({
    requestedComposerMode: {
      chatMode: 'vision',
      deepThink: 'on',
      search: 'on',
    },
    effectiveComposerMode: {
      chatMode: 'vision',
      deepThink: 'on',
      search: 'unchanged',
    },
    ignoredComposerToggles: [
      {
        toggle: 'search',
        targetState: 'on',
        reason: 'vision_mode_search_unavailable',
        requestedChatMode: 'vision',
        resolvedChatMode: 'vision',
      },
    ],
    composerMode: {
      chatMode: 'vision',
      deepThink: 'on',
      search: 'unavailable',
    },
  })
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      format: 'json',
      jsonShape: 'native',
    }),
  })
  const payload = JSON.parse(chunks.join('')) as {
    requestedComposerMode?: { search?: string }
    effectiveComposerMode?: { search?: string }
    ignoredComposerToggles?: Array<{ reason?: string; targetState?: string }>
    composerMode?: { search?: string }
  }

  assert.equal(payload.requestedComposerMode?.search, 'on')
  assert.equal(payload.effectiveComposerMode?.search, 'unchanged')
  assert.equal(payload.ignoredComposerToggles?.[0]?.reason, 'vision_mode_search_unavailable')
  assert.equal(payload.ignoredComposerToggles?.[0]?.targetState, 'on')
  assert.equal(payload.composerMode?.search, 'unavailable')
})

void test('CLI native stream-json output emits search and citation patches for search-enabled replies', () => {
  const result = createSearchEnabledReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      stream: true,
      format: 'stream-json',
      jsonShape: 'native',
    }),
  })
  const kinds = chunks.map(chunk => (JSON.parse(chunk) as { kind?: string }).kind)

  assert.ok(kinds.includes('search.patch'))
  assert.ok(kinds.includes('citation.patch'))
  assert.ok(kinds.includes('completed'))
})

void test('CLI realtime native stream-json controller writes canonical events before the final result', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'stream-json',
    jsonShape: 'native',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeOutputController({
    outputMode,
    write: chunk => writes.push(chunk),
  })

  for (const event of result.output.canonicalRuns[0]!.events) {
    controller.onEvent({
      kind: 'generation.event',
      attemptNumber: 1,
      outputMode,
      source: event.kind === 'completed' ? 'finalize' : 'live',
      event,
    })
  }

  assert.deepEqual(
    writes.map(chunk => (JSON.parse(chunk) as { kind?: string }).kind),
    ['text.delta', 'completed'],
  )

  controller.writeFinalResult(result)

  assert.deepEqual(
    writes.map(chunk => (JSON.parse(chunk) as { kind?: string }).kind),
    ['text.delta', 'completed'],
  )
})

void test('CLI realtime native stream-json controller appends terminal rate-limit metadata once', () => {
  const result = createSearchRateLimitReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'stream-json',
    jsonShape: 'native',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeOutputController({
    outputMode,
    write: chunk => writes.push(chunk),
  })

  for (const event of result.output.canonicalRuns[0]!.events) {
    controller.onEvent({
      kind: 'generation.event',
      attemptNumber: 1,
      outputMode,
      source: event.kind === 'completed' ? 'finalize' : 'live',
      event,
    })
  }
  controller.writeFinalResult(result)

  const frames = writes.map(chunk => JSON.parse(chunk) as { kind?: string; rateLimit?: { code?: string } })
  assert.deepEqual(
    frames.map(frame => frame.kind),
    ['error', 'completed', 'reply.rate_limit'],
  )
  assert.equal(frames.at(-1)?.rateLimit?.code, 'rate_limit_exceeded')
})

void test('CLI realtime OpenAI chat stream controller emits incremental chunks', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekCliOutputMode({
    stream: true,
    format: 'stream-json',
    jsonShape: 'openai-chat-completions',
  })
  const writes: string[] = []
  const controller = createDeepSeekCliRealtimeOutputController({
    outputMode,
    write: chunk => writes.push(chunk),
  })

  for (const event of result.output.canonicalRuns[0]!.events) {
    controller.onEvent({
      kind: 'generation.event',
      attemptNumber: 1,
      outputMode,
      source: event.kind === 'completed' ? 'finalize' : 'live',
      event,
    })
  }
  controller.writeFinalResult(result)

  const frames = writes.map(chunk => JSON.parse(chunk) as {
    object?: string
    choices?: Array<{ delta?: { role?: string; content?: string | null }; finish_reason?: string | null }>
  })
  assert.equal(frames[0]?.object, 'chat.completion.chunk')
  assert.equal(frames[0]?.choices?.[0]?.delta?.role, 'assistant')
  assert.equal(frames[1]?.choices?.[0]?.delta?.content, 'Hello from DeepSeek')
  assert.equal(frames.at(-1)?.choices?.[0]?.finish_reason, 'stop')
})

void test('CLI native json output includes derived rate-limit metadata', () => {
  const result = createSearchRateLimitReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      format: 'json',
      jsonShape: 'native',
    }),
  })
  const payload = JSON.parse(chunks.join('')) as {
    rateLimit?: {
      code: string
      retryable: boolean
      uiObservationStatus: string
      recommendedCooldownMs: number | null
    }
  }

  assert.equal(payload.rateLimit?.code, 'rate_limit_exceeded')
  assert.equal(payload.rateLimit?.retryable, true)
  assert.equal(payload.rateLimit?.uiObservationStatus, 'ui-observation-pending')
  assert.equal(payload.rateLimit?.recommendedCooldownMs, 60_000)
})

void test('CLI native stream-json output emits a terminal rate-limit metadata frame', () => {
  const result = createSearchRateLimitReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      stream: true,
      format: 'stream-json',
      jsonShape: 'native',
    }),
  })
  const metadataChunk = JSON.parse(chunks.at(-1) ?? '{}') as {
    kind?: string
    rateLimit?: { code?: string; uiObservationStatus?: string }
  }

  assert.equal(metadataChunk.kind, 'reply.rate_limit')
  assert.equal(metadataChunk.rateLimit?.code, 'rate_limit_exceeded')
  assert.equal(metadataChunk.rateLimit?.uiObservationStatus, 'ui-observation-pending')
})

void test('CLI native json output preserves API retry boundary after a successful retry chain', () => {
  const result = createSuccessfulRetriedReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      format: 'json',
      jsonShape: 'native',
    }),
  })
  const payload = JSON.parse(chunks.join('')) as {
    retry?: {
      boundary?: {
        strategy?: string
        uiRetryControlStatus?: string
        note?: string
      }
    } | null
  }

  assert.equal(payload.retry?.boundary?.strategy, 'api-cooldown-replay')
  assert.equal(payload.retry?.boundary?.uiRetryControlStatus, 'ui-observation-pending')
  assert.match(payload.retry?.boundary?.note ?? '', /do not click a confirmed DeepSeek UI retry control/i)
})

void test('CLI buffered openai responses output adapts the finalized run', () => {
  const result = createReplyResult({
    output: {
      mode: 'buffered',
      canonicalEvents: [],
      canonicalRuns: [],
      finalizedAssistantText: 'Hello from DeepSeek',
    },
  })
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      format: 'json',
      jsonShape: 'openai-responses',
    }),
  })
  const payload = JSON.parse(chunks.join('')) as {
    object: string
    status: string
    output_text: string | null
  }

  assert.equal(payload.object, 'response')
  assert.equal(payload.status, 'completed')
  assert.equal(payload.output_text, 'Hello from DeepSeek')
})

void test('CLI stream-json output can emit OpenAI chat completion chunks', () => {
  const result = createReplyResult()
  const chunks = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      stream: true,
      format: 'stream-json',
      jsonShape: 'openai-chat-completions',
    }),
  })
  const firstChunk = JSON.parse(chunks[0] ?? '{}') as {
    object: string
  }
  const lastChunk = JSON.parse(chunks.at(-1) ?? '{}') as {
    choices?: Array<{ finish_reason: string | null }>
  }

  assert.equal(firstChunk.object, 'chat.completion.chunk')
  assert.equal(lastChunk.choices?.[0]?.finish_reason, 'stop')
})

function createReplyResult(overrides: Partial<DeepSeekReplyResult> = {}): DeepSeekReplyResult {
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
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
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
    assistantTextSource: 'generation-stream',
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
          messages: [],
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

function createSearchRateLimitReplyResult(): DeepSeekReplyResult {
  const base = createReplyResult({
    assistantText: null,
    outputTokensUsed: 0,
    requestedComposerMode: {
      deepThink: 'on',
      search: 'on',
    },
    composerMode: {
      deepThink: 'on',
      search: 'on',
    },
  })
  const context = base.generationRuns[0]?.context
  assert.ok(context)
  const finalized = {
    ...base.generationRuns[0]!.finalized,
    status: 'failed' as const,
    finishReason: 'error' as const,
    outputText: '',
    searches: [],
    citations: [],
    usage: null,
    error: {
      code: 'rate_limit_exceeded',
      message: 'Messages too frequent. Try again later.',
      retryable: true,
      cause: 'rate_limit_reached',
    },
  }

  const canonicalRun = {
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    context,
    events: [
      {
        kind: 'error' as const,
        sequence: 1,
        occurredAt: '2026-04-05T00:00:01.000Z',
        context,
        error: {
          code: 'rate_limit_exceeded',
          message: 'Messages too frequent. Try again later.',
          retryable: true,
          cause: 'rate_limit_reached',
        },
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
    unknownObservationCount: 1,
    unknownObservationLabels: ['rate_limit_retry_close'],
  }
  const observedRun = {
    ...base.generationRuns[0]!,
    finalized,
    eventCount: 2,
    unknownObservationCount: 1,
    unknownObservationLabels: ['rate_limit_retry_close'],
  }

  return {
    ...base,
    generationRuns: [observedRun],
    output: {
      mode: 'stream',
      canonicalEvents: canonicalRun.events,
      canonicalRuns: [canonicalRun],
      finalizedAssistantText: null,
    },
  }
}

function createSearchEnabledReplyResult(): DeepSeekReplyResult {
  const base = createReplyResult({
    assistantText: '让我先搜索资料...[reference:0]',
    requestedComposerMode: {
      deepThink: 'on',
      search: 'on',
    },
    composerMode: {
      deepThink: 'on',
      search: 'on',
    },
  })
  const context = base.generationRuns[0]?.context
  assert.ok(context)
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

function createRepeatedReferenceReplyResult(): DeepSeekReplyResult {
  const base = createReplyResult({
    assistantText:
      '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
    requestedComposerMode: {
      deepThink: 'on',
      search: 'on',
    },
    composerMode: {
      deepThink: 'on',
      search: 'on',
    },
  })
  const context = base.generationRuns[0]?.context
  assert.ok(context)
  const finalized = {
    ...base.generationRuns[0]!.finalized,
    outputText:
      '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
    citations: [
      {
        id: 'https://example.com/open-result',
        title: 'Opened Example Page',
        url: 'https://example.com/open-result',
        snippet: 'opened page snippet',
        annotation: {
          source: 'search' as const,
        },
      },
    ],
    responseReferences: [
      {
        referenceId: '7',
        referenceType: 'TOOL_SEARCH',
      },
      {
        referenceId: '8',
        referenceType: 'TOOL_OPEN',
      },
      {
        referenceId: '7',
        referenceType: 'TOOL_SEARCH',
      },
      {
        referenceId: '8',
        referenceType: 'TOOL_OPEN',
      },
    ],
    searches: [
      {
        query: 'citation ordering example',
        status: 'completed' as const,
        results: [
          {
            id: 'https://example.com/open-result',
            title: 'Opened Example Page',
            url: 'https://example.com/open-result',
            snippet: 'opened page snippet',
            source: 'Example',
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
        delta: '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
        accumulatedText:
          '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
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
    ...base.generationRuns[0]!,
    finalized,
    eventCount: 2,
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
              text: '检查 citation 顺序',
              createdAt: '2026-04-05T00:00:00.000Z',
              branchId: 'branch-main',
              citations: [],
              attachments: [],
            },
            {
              id: 'message-assistant-1',
              role: 'assistant',
              text:
                '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
              createdAt: '2026-04-05T00:00:02.000Z',
              branchId: 'branch-main',
              parentId: 'message-user-1',
              citations: [
                {
                  id: 'https://example.com/open-result',
                  title: 'Opened Example Page',
                  url: 'https://example.com/open-result',
                  snippet: 'opened page snippet',
                },
              ],
              responseReferences: [
                {
                  referenceId: '7',
                  referenceType: 'TOOL_SEARCH',
                },
                {
                  referenceId: '8',
                  referenceType: 'TOOL_OPEN',
                },
                {
                  referenceId: '7',
                  referenceType: 'TOOL_SEARCH',
                },
                {
                  referenceId: '8',
                  referenceType: 'TOOL_OPEN',
                },
              ],
              searches: [
                {
                  query: 'citation ordering example',
                  status: 'completed',
                  results: [
                    {
                      id: 'https://example.com/open-result',
                      title: 'Opened Example Page',
                      url: 'https://example.com/open-result',
                      snippet: 'opened page snippet',
                      source: 'Example',
                      toolSearchFragmentId: '7',
                      toolOpenFragmentIds: ['8'],
                      responseReferences: [
                        {
                          referenceId: '7',
                          referenceType: 'TOOL_SEARCH',
                          resolution: 'direct-tool-search',
                          toolSearchFragmentId: '7',
                        },
                        {
                          referenceId: '8',
                          referenceType: 'TOOL_OPEN',
                          resolution: 'via-tool-open',
                          toolSearchFragmentId: '7',
                          toolOpenFragmentId: '8',
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
      finalizedAssistantText:
        '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
    },
  }
}

function createMultiCandidateSearchReplyResult(): DeepSeekReplyResult {
  const result = createSearchEnabledReplyResult()
  const assistantMessage = result.session.branches[0]?.messages[1]
  const search = assistantMessage?.searches?.[0]
  if (!assistantMessage || !search) {
    throw new Error('Expected the search-enabled fixture to expose an assistant search result.')
  }

  search.results.push({
    id: 'https://platform.openai.com/docs/api-reference/responses',
    title: 'OpenAI Responses API reference overview',
    url: 'https://platform.openai.com/docs/api-reference/responses',
    snippet: 'Structured responses API reference overview.',
    source: 'OpenAI Platform Docs',
    toolSearchFragmentId: '3',
    responseReferences: [
      {
        referenceId: '3',
        referenceType: 'TOOL_SEARCH',
        resolution: 'direct-tool-search',
        toolSearchFragmentId: '3',
      },
    ],
  })

  const canonicalSearch = result.output.canonicalRuns[0]?.finalized.searches?.[0]
  if (canonicalSearch) {
    canonicalSearch.results.push({
      id: 'https://platform.openai.com/docs/api-reference/responses',
      title: 'OpenAI Responses API reference overview',
      url: 'https://platform.openai.com/docs/api-reference/responses',
      snippet: 'Structured responses API reference overview.',
      source: 'OpenAI Platform Docs',
    })
  }

  return result
}

function createHallucinatedCitationReplyResult(): DeepSeekReplyResult {
  const base = createReplyResult({
    assistantText: '这里有引用[15†L11-L12]',
  })
  const context = base.generationRuns[0]?.context
  assert.ok(context)
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

function createSuccessfulRetriedReplyResult(): DeepSeekReplyResult {
  const base = createReplyResult()

  return {
    ...base,
    retry: {
      policy: {
        onRateLimit: true,
        maxRetries: 2,
        cooldownMs: null,
        countdown: true,
      },
      attempts: [
        {
          attemptNumber: 1,
          startedAt: '2026-04-05T00:00:01.000Z',
          finishedAt: '2026-04-05T00:00:02.000Z',
          finalStatus: 'failed',
          finishReason: 'error',
          errorCode: 'rate_limit_exceeded',
          errorMessage: 'Messages too frequent. Try again later.',
          rateLimit: {
            code: 'rate_limit_exceeded',
            message: 'Messages too frequent. Try again later.',
            retryable: true,
            scope: 'search',
            apiSignalStatus: 'confirmed',
            uiRetryControlStatus: 'ui-observation-pending',
            uiObservationStatus: 'ui-observation-pending',
            recommendedCooldownMs: 60_000,
            rawFinishReason: 'rate_limit_reached',
            clickBehavior: 'retry',
            note:
              'This is an API-level retry signal, not a confirmed clickable UI retry button.',
          },
          retryScheduled: true,
          cooldownMs: 60_000,
          finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
          sessionId: 'session-001',
        },
        {
          attemptNumber: 2,
          startedAt: '2026-04-05T00:01:02.000Z',
          finishedAt: '2026-04-05T00:01:03.000Z',
          finalStatus: 'completed',
          finishReason: 'stop',
          errorCode: null,
          errorMessage: null,
          rateLimit: null,
          retryScheduled: false,
          cooldownMs: null,
          finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
          sessionId: 'session-001',
        },
      ],
      totalAttempts: 2,
      retriedAttempts: 1,
      exhausted: false,
      boundary: {
        strategy: 'api-cooldown-replay',
        uiRetryControlStatus: 'ui-observation-pending',
        note:
          'Automatic retries replay the controlled browser send flow after cooldown. They do not click a confirmed DeepSeek UI retry control.',
      },
    },
  }
}
