import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDeepSeekReplyOutputMode } from '../src/application/services/deepSeekReplyOutputMode.js'
import {
  createDeepSeekInteractiveOutputWriter,
  createDeepSeekInteractiveRealtimeOutputController,
  writeDeepSeekInteractiveReplyOutput,
} from '../src/interfaces/interactive/deepSeekInteractiveReplyOutput.js'
import type { DeepSeekReplyResult } from '../src/types/deepseek-reply.types.js'
import type { DeepSeekSearchRateLimitOutputMetadata } from '../src/types/deepseek-search-rate-limit.types.js'

void test('interactive buffered reply output flushes countdown retry status before final text', () => {
  const result = createReplyResult()
  const writes: string[] = []
  const writer = createDeepSeekInteractiveOutputWriter({
    write: chunk => writes.push(chunk),
    isTTY: true,
  })

  writer.createRetryNoticeHandler()({
    kind: 'retry.scheduled',
    attemptNumber: 1,
    nextAttemptNumber: 2,
    cooldownMs: 5_000,
    maxRetries: 1,
    rateLimit: createRateLimitMetadata(),
  })

  writeDeepSeekInteractiveReplyOutput({
    result,
    outputMode: resolveDeepSeekReplyOutputMode({
      format: 'text',
    }),
    write: chunk => writer.writeReplyChunk(chunk),
  })

  assert.match(writes[0] ?? '', /^\r\[api-rate-limit-retry\]/)
  assert.equal(writes[1], '\n')
  assert.deepEqual(writes.slice(2), ['Hello from DeepSeek\n'])
})

void test('interactive realtime text controller separates retry countdown from live assistant text', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekReplyOutputMode({
    stream: true,
    format: 'text',
  })
  const writes: string[] = []
  const writer = createDeepSeekInteractiveOutputWriter({
    write: chunk => writes.push(chunk),
    isTTY: true,
  })
  const controller = createDeepSeekInteractiveRealtimeOutputController({
    outputMode,
    outputWriter: writer,
  })

  controller.onEvent({
    kind: 'retry.progress',
    attemptNumber: 1,
    outputMode,
    progress: {
      kind: 'retry.scheduled',
      attemptNumber: 1,
      nextAttemptNumber: 2,
      cooldownMs: 5_000,
      maxRetries: 1,
      rateLimit: createRateLimitMetadata(),
    },
  })
  controller.onEvent({
    kind: 'generation.event',
    attemptNumber: 1,
    outputMode,
    source: 'live',
    event: result.output.canonicalRuns[0]!.events[0]!,
  })
  controller.writeFinalResult(result)

  assert.match(writes[0] ?? '', /^\r\[api-rate-limit-retry\]/)
  assert.equal(writes[1], '\n')
  assert.equal(writes[2], 'Hello from DeepSeek')
  assert.equal(writes.at(-1), '\n')
})

void test('interactive realtime native stream-json controller flushes retry status before NDJSON frames', () => {
  const result = createReplyResult()
  const outputMode = resolveDeepSeekReplyOutputMode({
    stream: true,
    format: 'stream-json',
    jsonShape: 'native',
  })
  const writes: string[] = []
  const writer = createDeepSeekInteractiveOutputWriter({
    write: chunk => writes.push(chunk),
    isTTY: true,
  })
  const controller = createDeepSeekInteractiveRealtimeOutputController({
    outputMode,
    outputWriter: writer,
  })

  controller.onEvent({
    kind: 'retry.progress',
    attemptNumber: 1,
    outputMode,
    progress: {
      kind: 'retry.scheduled',
      attemptNumber: 1,
      nextAttemptNumber: 2,
      cooldownMs: 5_000,
      maxRetries: 1,
      rateLimit: createRateLimitMetadata(),
    },
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

  assert.match(writes[0] ?? '', /^\r\[api-rate-limit-retry\]/)
  assert.equal(writes[1], '\n')
  assert.deepEqual(
    writes.slice(2).map(chunk => (JSON.parse(chunk) as { kind?: string }).kind),
    ['text.delta', 'completed'],
  )
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

function createRateLimitMetadata(): DeepSeekSearchRateLimitOutputMetadata {
  return {
    code: 'rate_limit_exceeded',
    message: 'Messages too frequent. Try again later.',
    retryable: true,
    scope: 'search',
    apiSignalStatus: 'confirmed',
    uiRetryControlStatus: 'ui-observation-pending',
    uiObservationStatus: 'ui-observation-pending',
    recommendedCooldownMs: 60_000,
    rawFinishReason: 'error',
    clickBehavior: null,
    note: 'API-level rate limit signal.',
  }
}
