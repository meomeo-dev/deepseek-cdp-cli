import { setTimeout as delay } from 'node:timers/promises'
import { resolveDeepSeekReplyRateLimitMetadata } from '../../domain/search/deepSeekSearchRateLimitOutput.js'
import { buildDeepSeekReplyRetryDeliveryBoundary } from '../../domain/search/deepSeekReplyRetryBoundary.js'
import {
  DeepSeekSearchRateLimitCoordinator,
  type DeepSeekSearchRateLimitLeaseHandle,
} from './deepSeekSearchRateLimitCoordinator.js'
import type { ReplyDeepSeekMessageInput } from '../usecases/replyDeepSeekMessage.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import {
  normalizeDeepSeekComposerModeRequest,
  resolveDeepSeekEffectiveComposerModeRequest,
} from '../../infrastructure/deepseek/deepSeekComposerMode.js'
import type {
  DeepSeekReplyLiveDeliveryInput,
  DeepSeekReplyLiveEvent,
  DeepSeekReplyRetryAttemptReport,
  DeepSeekReplyRetryOptionInput,
  DeepSeekReplyRetryProgressEvent,
  DeepSeekReplyRetryProgressInput,
  DeepSeekResolvedReplyRetryPolicy,
} from '../../types/deepseek-reply-output.types.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'

export function resolveDeepSeekReplyRetryPolicy(
  input: DeepSeekReplyRetryOptionInput | undefined,
): DeepSeekResolvedReplyRetryPolicy {
  return {
    onRateLimit: input?.onRateLimit === true,
    maxRetries: normalizeNonNegativeInteger(input?.maxRetries, 0),
    cooldownMs: normalizeOptionalNonNegativeInteger(input?.cooldownMs),
    countdown: input?.countdown !== false,
  }
}

export async function runDeepSeekReplyWithRateLimitRetry(input: {
  reply: ReplyDeepSeekMessageInput
  outputMode: DeepSeekResolvedOutputMode
  retry: DeepSeekReplyRetryOptionInput | undefined
  progress?: DeepSeekReplyRetryProgressInput | undefined
  live?: DeepSeekReplyLiveDeliveryInput | undefined
  runAttempt: (reply: ReplyDeepSeekMessageInput) => Promise<DeepSeekReplyResult>
  sleep?: ((ms: number) => Promise<void>) | undefined
  searchCoordinator?: DeepSeekSearchRateLimitCoordinator | undefined
}): Promise<DeepSeekReplyResult> {
  const policy = resolveDeepSeekReplyRetryPolicy(input.retry)
  const attempts: DeepSeekReplyRetryAttemptReport[] = []
  const sleep = input.sleep ?? delay
  const searchCoordinator = input.searchCoordinator ?? new DeepSeekSearchRateLimitCoordinator()
  let searchLease: DeepSeekSearchRateLimitLeaseHandle | null =
    isExplicitSearchRequest(input.reply)
      ? await searchCoordinator.openLease()
      : null
  let attemptNumber = 1

  try {
    while (true) {
      emitLiveEvent(input.live, {
        kind: 'attempt.started',
        attemptNumber,
        outputMode: input.outputMode,
      })
      const startedAt = new Date().toISOString()
      const result = await input.runAttempt({
        ...input.reply,
        stream: input.outputMode.stream,
        onCanonicalGenerationEvent: item => {
          emitLiveEvent(input.live, {
            kind: 'generation.event',
            attemptNumber,
            outputMode: input.outputMode,
            source: item.source,
            event: item.event,
          })
        },
      })
      const finishedAt = new Date().toISOString()
      const rateLimit = resolveDeepSeekReplyRateLimitMetadata(result)
      const attemptReport = createAttemptReport({
        attemptNumber,
        startedAt,
        finishedAt,
        result,
        rateLimit,
        retryScheduled: false,
        cooldownMs: null,
      })
      const willRetry = shouldRetryRateLimit(policy, rateLimit, attemptNumber)
      emitLiveEvent(input.live, {
        kind: 'attempt.completed',
        attemptNumber,
        outputMode: input.outputMode,
        result,
        willRetry,
      })

      if (!willRetry) {
        if (policy.onRateLimit && rateLimit !== null && attemptNumber > policy.maxRetries) {
          emitProgressEvent({
            progress: input.progress,
            live: input.live,
            outputMode: input.outputMode,
            event: {
            kind: 'retry.exhausted',
            attemptNumber,
            maxRetries: policy.maxRetries,
            rateLimit,
            },
          })
        }
        attempts.push(attemptReport)
        return {
          ...result,
          retry: policy.onRateLimit
            ? {
                policy,
                attempts,
                totalAttempts: attempts.length,
                retriedAttempts: attempts.filter(item => item.retryScheduled).length,
                exhausted: rateLimit !== null && attemptNumber > policy.maxRetries,
                boundary: buildDeepSeekReplyRetryDeliveryBoundary({
                  attempts,
                }),
              }
            : null,
        }
      }

      const cooldownMs = policy.cooldownMs ?? rateLimit.recommendedCooldownMs ?? 0
      attempts.push({
        ...attemptReport,
        retryScheduled: true,
        cooldownMs,
      })
      emitProgressEvent({
        progress: input.progress,
        live: input.live,
        outputMode: input.outputMode,
        event: {
        kind: 'retry.scheduled',
        attemptNumber,
        nextAttemptNumber: attemptNumber + 1,
        cooldownMs,
        maxRetries: policy.maxRetries,
        rateLimit,
        },
      })

      if (rateLimit.scope === 'search' && searchLease === null) {
        searchLease = await searchCoordinator.openLease({
          attemptNumber: attemptNumber + 1,
          initialPhase: 'cooldown',
        })
      }

      if (searchLease && rateLimit.scope === 'search') {
        await searchLease.waitForRetryTurn({
          attemptNumber,
          nextAttemptNumber: attemptNumber + 1,
          cooldownMs,
          progress: policy.countdown
            ? {
                onEvent: event => {
                  emitProgressEvent({
                    progress: input.progress,
                    live: input.live,
                    outputMode: input.outputMode,
                    event,
                  })
                },
              }
            : undefined,
        })
      } else if (cooldownMs > 0) {
        await waitForRetryCooldown({
          attemptNumber,
          nextAttemptNumber: attemptNumber + 1,
          cooldownMs,
          countdown: policy.countdown,
          progress: policy.countdown
            ? {
                onEvent: event => {
                  emitProgressEvent({
                    progress: input.progress,
                    live: input.live,
                    outputMode: input.outputMode,
                    event,
                  })
                },
              }
            : undefined,
          sleep,
        })
      }

      attemptNumber += 1
      emitProgressEvent({
        progress: input.progress,
        live: input.live,
        outputMode: input.outputMode,
        event: {
        kind: 'retry.starting',
        attemptNumber,
        maxRetries: policy.maxRetries,
        },
      })
    }
  } finally {
    await searchLease?.close().catch(() => {})
  }
}

function shouldRetryRateLimit(
  policy: DeepSeekResolvedReplyRetryPolicy,
  rateLimit: ReturnType<typeof resolveDeepSeekReplyRateLimitMetadata>,
  attemptNumber: number,
): rateLimit is NonNullable<typeof rateLimit> {
  if (!policy.onRateLimit || !rateLimit || !rateLimit.retryable) {
    return false
  }

  return attemptNumber <= policy.maxRetries
}

async function waitForRetryCooldown(input: {
  attemptNumber: number
  nextAttemptNumber: number
  cooldownMs: number
  countdown: boolean
  progress?: DeepSeekReplyRetryProgressInput | undefined
  sleep: (ms: number) => Promise<void>
}): Promise<void> {
  if (!input.countdown) {
    await input.sleep(input.cooldownMs)
    return
  }

  let remainingMs = input.cooldownMs
  while (remainingMs > 0) {
    input.progress?.onEvent?.({
      kind: 'retry.tick',
      attemptNumber: input.attemptNumber,
      nextAttemptNumber: input.nextAttemptNumber,
      remainingMs,
      cooldownMs: input.cooldownMs,
    })
    const nextSleepMs = Math.min(1_000, remainingMs)
    await input.sleep(nextSleepMs)
    remainingMs = Math.max(0, remainingMs - nextSleepMs)
  }
}

function createAttemptReport(input: {
  attemptNumber: number
  startedAt: string
  finishedAt: string
  result: DeepSeekReplyResult
  rateLimit: ReturnType<typeof resolveDeepSeekReplyRateLimitMetadata>
  retryScheduled: boolean
  cooldownMs: number | null
}): DeepSeekReplyRetryAttemptReport {
  const finalized = selectFinalizedState(input.result)
  return {
    attemptNumber: input.attemptNumber,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    finalStatus: finalized?.status ?? 'unknown',
    finishReason: finalized?.finishReason ?? null,
    errorCode: finalized?.error?.code ?? null,
    errorMessage: finalized?.error?.message ?? null,
    rateLimit: input.rateLimit,
    retryScheduled: input.retryScheduled,
    cooldownMs: input.cooldownMs,
    finalUrl: input.result.finalUrl ?? null,
    sessionId: input.result.sessionId ?? null,
  }
}

function selectFinalizedState(result: DeepSeekReplyResult) {
  if (result.output.mode === 'stream') {
    return result.output.canonicalRuns.at(-1)?.finalized ?? null
  }

  return result.generationRuns.at(-1)?.finalized ?? null
}

function emitProgressEvent(input: {
  progress: DeepSeekReplyRetryProgressInput | undefined
  live: DeepSeekReplyLiveDeliveryInput | undefined
  outputMode: DeepSeekResolvedOutputMode
  event: DeepSeekReplyRetryProgressEvent
}): void {
  input.progress?.onEvent?.(input.event)
  emitLiveEvent(input.live, {
    kind: 'retry.progress',
    attemptNumber: input.event.attemptNumber,
    outputMode: input.outputMode,
    progress: input.event,
  })
}

function emitLiveEvent(
  live: DeepSeekReplyLiveDeliveryInput | undefined,
  event: DeepSeekReplyLiveEvent,
): void {
  live?.onEvent?.(event)
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.floor(value))
}

function normalizeOptionalNonNegativeInteger(
  value: number | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.max(0, Math.floor(value))
}

function isExplicitSearchRequest(input: ReplyDeepSeekMessageInput): boolean {
  return resolveDeepSeekEffectiveComposerModeRequest(
    normalizeDeepSeekComposerModeRequest(input.composerMode),
  ).search === 'on'
}
