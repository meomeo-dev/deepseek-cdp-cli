import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runDeepSeekReplyWithRateLimitRetry } from '../src/application/services/deepSeekReplyRateLimitRetry.js'
import { DeepSeekSearchRateLimitCoordinator } from '../src/application/services/deepSeekSearchRateLimitCoordinator.js'
import { resolveDeepSeekReplyOutputMode } from '../src/application/services/deepSeekReplyOutputMode.js'
import type { DeepSeekReplyResult } from '../src/types/deepseek-reply.types.js'

void test('retries a search rate-limit result and preserves attempt history', async () => {
  const attempts: DeepSeekReplyResult[] = [
    createRateLimitReplyResult({ searchEnabled: true }),
    createRateLimitReplyResult({ searchEnabled: true }),
    createCompletedReplyResult(),
  ]
  const progressEvents: string[] = []
  const searchCoordinator = await createSearchCoordinator()

  const result = await runDeepSeekReplyWithRateLimitRetry({
    reply: createReplyInput(),
    outputMode: resolveDeepSeekReplyOutputMode({}),
    retry: {
      onRateLimit: true,
      maxRetries: 2,
      cooldownMs: 0,
    },
    progress: {
      onEvent: event => progressEvents.push(event.kind),
    },
    runAttempt: () => {
      const next = attempts.shift()
      assert.ok(next)
      return Promise.resolve(next)
    },
    searchCoordinator,
  })

  assert.equal(result.retry?.totalAttempts, 3)
  assert.equal(result.retry?.retriedAttempts, 2)
  assert.equal(result.retry?.exhausted, false)
  assert.equal(result.retry?.boundary.strategy, 'api-cooldown-replay')
  assert.equal(result.retry?.boundary.uiRetryControlStatus, 'ui-observation-pending')
  assert.match(result.retry?.boundary.note ?? '', /do not click a confirmed DeepSeek UI retry control/i)
  assert.deepEqual(
    result.retry?.attempts.map(item => item.retryScheduled),
    [true, true, false],
  )
  assert.deepEqual(progressEvents, [
    'retry.scheduled',
    'retry.starting',
    'retry.scheduled',
    'retry.starting',
  ])
})

void test('marks retries as exhausted when rate limit persists beyond max retries', async () => {
  const attempts: DeepSeekReplyResult[] = [
    createRateLimitReplyResult({ searchEnabled: true }),
    createRateLimitReplyResult({ searchEnabled: true }),
  ]
  const searchCoordinator = await createSearchCoordinator()

  const result = await runDeepSeekReplyWithRateLimitRetry({
    reply: createReplyInput(),
    outputMode: resolveDeepSeekReplyOutputMode({}),
    retry: {
      onRateLimit: true,
      maxRetries: 1,
      cooldownMs: 0,
    },
    runAttempt: () => {
      const next = attempts.shift()
      assert.ok(next)
      return Promise.resolve(next)
    },
    searchCoordinator,
  })

  assert.equal(result.retry?.totalAttempts, 2)
  assert.equal(result.retry?.retriedAttempts, 1)
  assert.equal(result.retry?.exhausted, true)
  assert.equal(result.retry?.boundary.strategy, 'api-cooldown-replay')
  assert.equal(result.retry?.attempts.at(-1)?.errorCode, 'rate_limit_exceeded')
  assert.equal(result.retry?.attempts.at(-1)?.retryScheduled, false)
})

void test('general rate-limit replies do not inherit the search cooldown by default', async () => {
  const progressEvents: Array<{ kind: string; cooldownMs?: number }> = []
  const searchCoordinator = await createSearchCoordinator()

  await runDeepSeekReplyWithRateLimitRetry({
    reply: createReplyInput(),
    outputMode: resolveDeepSeekReplyOutputMode({}),
    retry: {
      onRateLimit: true,
      maxRetries: 1,
    },
    progress: {
      onEvent: event => {
        if (event.kind === 'retry.scheduled') {
          progressEvents.push({
            kind: event.kind,
            cooldownMs: event.cooldownMs,
          })
          return
        }
        progressEvents.push({ kind: event.kind })
      },
    },
    runAttempt: () => Promise.resolve(createCompletedReplyResult()),
    searchCoordinator,
  })

  const generalResult = await runDeepSeekReplyWithRateLimitRetry({
    reply: createReplyInput(),
    outputMode: resolveDeepSeekReplyOutputMode({}),
    retry: {
      onRateLimit: true,
      maxRetries: 1,
    },
    progress: {
      onEvent: event => {
        if (event.kind === 'retry.scheduled') {
          progressEvents.push({
            kind: event.kind,
            cooldownMs: event.cooldownMs,
          })
        }
      },
    },
    runAttempt: () =>
      Promise.resolve(createRateLimitReplyResult({ searchEnabled: false })),
    searchCoordinator,
  })

  assert.equal(generalResult.retry?.attempts[0]?.rateLimit?.scope, 'general')
  assert.equal(
    progressEvents.find(item => item.kind === 'retry.scheduled')?.cooldownMs,
    0,
  )
})

void test('vision replies ignore search for search retry coordination', async () => {
  class CountingSearchCoordinator extends DeepSeekSearchRateLimitCoordinator {
    public leaseCount = 0

    public override async openLease(
      input: Parameters<DeepSeekSearchRateLimitCoordinator['openLease']>[0] = {},
    ): ReturnType<DeepSeekSearchRateLimitCoordinator['openLease']> {
      this.leaseCount += 1
      return super.openLease(input)
    }
  }

  const searchCoordinator = new CountingSearchCoordinator()

  await runDeepSeekReplyWithRateLimitRetry({
    reply: {
      ...createReplyInput(),
      composerMode: {
        chatMode: 'vision',
        deepThink: 'on',
        search: 'on',
      },
    },
    outputMode: resolveDeepSeekReplyOutputMode({}),
    retry: {
      onRateLimit: true,
      maxRetries: 1,
    },
    runAttempt: () => Promise.resolve(createCompletedReplyResult()),
    searchCoordinator,
  })

  assert.equal(searchCoordinator.leaseCount, 0)
})

void test('live delivery emits attempt, generation, and retry progress events without waiting for the final result', async () => {
  const liveEvents: Array<{ kind: string; attemptNumber: number; willRetry?: boolean; source?: string; eventKind?: string }> = []
  const outputMode = resolveDeepSeekReplyOutputMode({
    stream: true,
    format: 'text',
  })
  const attempts: DeepSeekReplyResult[] = [
    createRateLimitReplyResult({ searchEnabled: true }),
    createStreamingCompletedReplyResult(),
  ]

  const result = await runDeepSeekReplyWithRateLimitRetry({
    reply: createReplyInput(),
    outputMode,
    retry: {
      onRateLimit: true,
      maxRetries: 1,
      cooldownMs: 0,
    },
    live: {
      onEvent: event => {
        switch (event.kind) {
          case 'attempt.started':
            liveEvents.push({
              kind: event.kind,
              attemptNumber: event.attemptNumber,
            })
            return
          case 'generation.event':
            liveEvents.push({
              kind: event.kind,
              attemptNumber: event.attemptNumber,
              source: event.source,
              eventKind: event.event.kind,
            })
            return
          case 'attempt.completed':
            liveEvents.push({
              kind: event.kind,
              attemptNumber: event.attemptNumber,
              willRetry: event.willRetry,
            })
            return
          case 'retry.progress':
            liveEvents.push({
              kind: event.progress.kind,
              attemptNumber: event.attemptNumber,
            })
            return
        }
      },
    },
    runAttempt: reply => {
      if (attempts.length === 2) {
        reply.onCanonicalGenerationEvent?.({
          source: 'live',
          event: createRateLimitCanonicalRun().events[0]!,
        })
      } else {
        const successRun = createStreamingCompletedReplyResult().output.canonicalRuns[0]!
        for (const event of successRun.events) {
          reply.onCanonicalGenerationEvent?.({
            source: event.kind === 'completed' ? 'finalize' : 'live',
            event,
          })
        }
      }

      const next = attempts.shift()
      assert.ok(next)
      return Promise.resolve(next)
    },
  })

  assert.equal(result.retry?.totalAttempts, 2)
  assert.deepEqual(
    liveEvents.map(event => [
      event.kind,
      event.attemptNumber,
      event.eventKind ?? null,
      event.willRetry ?? null,
    ]),
    [
      ['attempt.started', 1, null, null],
      ['generation.event', 1, 'error', null],
      ['attempt.completed', 1, null, true],
      ['retry.scheduled', 1, null, null],
      ['retry.starting', 2, null, null],
      ['attempt.started', 2, null, null],
      ['generation.event', 2, 'text.delta', null],
      ['generation.event', 2, 'completed', null],
      ['attempt.completed', 2, null, false],
    ],
  )
  assert.equal(liveEvents.find(event => event.eventKind === 'completed')?.source, 'finalize')
})

function createReplyInput() {
  return {
    cdpUrl: 'http://127.0.0.1:9222',
    timeoutMs: 30_000,
    cloneChromeProfile: false,
    headless: false,
    keepTempChromeProfile: false,
    prompt: 'hello',
    waitUntil: 'domcontentloaded' as const,
  }
}

async function createSearchCoordinator(): Promise<DeepSeekSearchRateLimitCoordinator> {
  const cwd = await mkdtemp(join(tmpdir(), 'deepseek-rate-limit-retry-'))
  return new DeepSeekSearchRateLimitCoordinator({
    cwd,
  })
}

function createCompletedReplyResult(): DeepSeekReplyResult {
  return createBaseReplyResult({
    requestedComposerMode: {
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
      deepThink: 'off',
      search: 'off',
    },
  })
}

function createStreamingCompletedReplyResult(): DeepSeekReplyResult {
  const base = createCompletedReplyResult()
  const context = base.generationRuns[0]!.context
  const finalized = base.generationRuns[0]!.finalized

  return createBaseReplyResult({
    ...base,
    streamRequested: true,
    output: {
      mode: 'stream',
      canonicalEvents: [
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
      canonicalRuns: [
        {
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
        },
      ],
      finalizedAssistantText: 'Hello from DeepSeek',
    },
  })
}

function createRateLimitReplyResult(input: { searchEnabled: boolean }): DeepSeekReplyResult {
  return createBaseReplyResult({
    assistantText: null,
    outputTokensUsed: 0,
    requestedComposerMode: {
      deepThink: input.searchEnabled ? 'on' : 'unchanged',
      search: input.searchEnabled ? 'on' : 'unchanged',
    },
    composerMode: {
      deepThink: input.searchEnabled ? 'on' : 'off',
      search: input.searchEnabled ? 'on' : 'off',
    },
    generationRuns: [
      {
        ...createBaseReplyResult().generationRuns[0]!,
        finalized: createFailedFinalizedState(),
        eventCount: 2,
        unknownObservationCount: 1,
        unknownObservationLabels: ['rate_limit_retry_close'],
      },
    ],
    output: {
      mode: 'stream',
      canonicalEvents: createRateLimitCanonicalRun().events,
      canonicalRuns: [createRateLimitCanonicalRun()],
      finalizedAssistantText: null,
    },
  })
}

function createBaseReplyResult(
  overrides: Partial<DeepSeekReplyResult> = {},
): DeepSeekReplyResult {
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
    streamRequested: false,
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    sessionFile: '/tmp/session-001.json',
    sessionCreate: null,
    completionRequestObserved: true,
    generationObservations: [],
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
    assistantText: 'Hello from DeepSeek',
    assistantTextSource: 'generation-stream',
    transcriptRecovery: null,
    session: {
      id: 'session-001',
      agentId: 'chat',
      title: 'Session 001',
      createdAt: '2026-04-05T00:00:00.000Z',
      branches: [],
    },
    output: {
      mode: 'buffered',
      canonicalEvents: [],
      canonicalRuns: [],
      finalizedAssistantText: 'Hello from DeepSeek',
    },
    ...overrides,
  }
}

function createFailedFinalizedState() {
  return {
    status: 'failed' as const,
    finishReason: 'error' as const,
    outputText: '',
    reasoningText: '',
    reasoningKind: 'unknown' as const,
    citations: [],
    responseReferences: [],
    searches: [],
    usage: null,
    error: {
      code: 'rate_limit_exceeded',
      message: 'Messages too frequent. Try again later.',
      retryable: true,
      cause: 'rate_limit_reached',
    },
    completedAt: '2026-04-05T00:00:02.000Z',
  }
}

function createRateLimitCanonicalRun() {
  const base = createBaseReplyResult()
  const context = base.generationRuns[0]!.context
  const finalized = createFailedFinalizedState()
  return {
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
}
