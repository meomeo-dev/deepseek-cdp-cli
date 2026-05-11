import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'puppeteer-core'
import { resolveDeepSeekSearchWaitPolicy } from '../../domain/search/deepSeekSearchRateLimitAudit.js'
import type { DeepSeekComposerModeInput } from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekComposerSnapshot } from '../../types/deepseek-controls.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { captureDeepSeekComposerSnapshot } from './deepSeekComposerControls.js'
import {
  normalizeDeepSeekComposerModeRequest,
  resolveDeepSeekEffectiveComposerModeRequest,
} from './deepSeekComposerMode.js'
import type { DeepSeekGenerationObserverState } from './deepSeekGenerationRuntime.js'

const DEEPSEEK_DEEPTHINK_MINIMUM_REPLY_TIMEOUT_MS = 60_000
const DEEPSEEK_DEEPTHINK_HISTORY_RECOVERY_TIMEOUT_MS = 45_000
const DEEPSEEK_SEARCH_HISTORY_RECOVERY_TIMEOUT_MS = 60_000
const DEEPSEEK_REPLY_GENERATION_POLL_INTERVAL_MS = 250
const DEEPSEEK_REPLY_LONG_RUNNING_EXTENSION_MS = 60_000

export interface DeepSeekReplyTimingPolicy {
  executionTimeoutMs: number
  historyRecoveryTimeoutMs: number
  historyRecoveryMaxAttempts: number
  historyRecoveryRetryDelayMs: number
  livenessExtensionMs: number
  longRunning: boolean
}

export interface DeepSeekReplyGenerationSettlementResult {
  started: boolean
  settled: boolean
  extended: boolean
  finalSnapshot: Pick<DeepSeekComposerSnapshot, 'pageUrl' | 'routeKind' | 'sendOrStopButton'> | null
  reason:
    | 'not-observed'
    | 'settled'
    | 'timeout-waiting-for-settlement'
}

export function resolveDeepSeekReplyTimingPolicy(input: {
  timeoutMs: number
  composerMode?: DeepSeekComposerModeInput | undefined
}): DeepSeekReplyTimingPolicy {
  const requestedTimeoutMs = Math.max(1_000, Math.floor(input.timeoutMs))
  const effectiveComposerMode = resolveDeepSeekEffectiveComposerModeRequest(
    normalizeDeepSeekComposerModeRequest(input.composerMode),
  )
  const searchEnabled = effectiveComposerMode.search === 'on'
  const deepThinkEnabled = effectiveComposerMode.deepThink === 'on'

  if (searchEnabled) {
    const searchPolicy = resolveDeepSeekSearchWaitPolicy(requestedTimeoutMs)
    return {
      executionTimeoutMs: Math.max(
        requestedTimeoutMs,
        searchPolicy.recommendedProbeTimeoutMs,
      ),
      historyRecoveryTimeoutMs: Math.max(
        30_000,
        Math.min(
          searchPolicy.recommendedProbeTimeoutMs,
          DEEPSEEK_SEARCH_HISTORY_RECOVERY_TIMEOUT_MS,
        ),
      ),
      historyRecoveryMaxAttempts: 4,
      historyRecoveryRetryDelayMs: 1_500,
      livenessExtensionMs: DEEPSEEK_REPLY_LONG_RUNNING_EXTENSION_MS,
      longRunning: true,
    }
  }

  if (deepThinkEnabled) {
    return {
      executionTimeoutMs: Math.max(
        requestedTimeoutMs,
        DEEPSEEK_DEEPTHINK_MINIMUM_REPLY_TIMEOUT_MS,
      ),
      historyRecoveryTimeoutMs: Math.max(
        20_000,
        Math.min(
          Math.max(requestedTimeoutMs, DEEPSEEK_DEEPTHINK_MINIMUM_REPLY_TIMEOUT_MS),
          DEEPSEEK_DEEPTHINK_HISTORY_RECOVERY_TIMEOUT_MS,
        ),
      ),
      historyRecoveryMaxAttempts: 4,
      historyRecoveryRetryDelayMs: 1_250,
      livenessExtensionMs: 30_000,
      longRunning: true,
    }
  }

  return {
    executionTimeoutMs: requestedTimeoutMs,
    historyRecoveryTimeoutMs: Math.max(15_000, Math.min(requestedTimeoutMs, 30_000)),
    historyRecoveryMaxAttempts: 3,
    historyRecoveryRetryDelayMs: 1_000,
    livenessExtensionMs: 0,
    longRunning: false,
  }
}

export async function waitForDeepSeekReplyGenerationSettlement(input: {
  page: Page
  timeoutMs: number
  livenessExtensionMs?: number | undefined
  getObserverState: () => DeepSeekGenerationObserverState
  hasObservedGenerationResponse: () => boolean
  captureSnapshot?: (() => Promise<Pick<DeepSeekComposerSnapshot, 'pageUrl' | 'routeKind' | 'sendOrStopButton'>>) | undefined
  now?: (() => number) | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
}, logger?: RuntimeLogger): Promise<DeepSeekReplyGenerationSettlementResult> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? delay
  const captureSnapshot = input.captureSnapshot ?? (() => captureDeepSeekComposerSnapshot(input.page))
  const baseDeadline = now() + Math.max(1_000, Math.floor(input.timeoutMs))
  let deadline = baseDeadline
  let extended = false
  let started = false
  let finalSnapshot: Pick<
    DeepSeekComposerSnapshot,
    'pageUrl' | 'routeKind' | 'sendOrStopButton'
  > | null = null

  while (now() <= deadline) {
    const snapshot = await captureSnapshot()
    finalSnapshot = snapshot
    const observerState = input.getObserverState()
    const sendState = snapshot.sendOrStopButton.state
    const generationRunning =
      sendState === 'stop' || observerState.pendingCount > 0 || input.hasObservedGenerationResponse()

    if (generationRunning) {
      started = true
    }

    if (
      started &&
      sendState === 'send' &&
      observerState.pendingCount === 0 &&
      (observerState.captureCount > 0 || input.hasObservedGenerationResponse())
    ) {
      return {
        started: true,
        settled: true,
        extended,
        finalSnapshot,
        reason: 'settled',
      }
    }

    if (
      started &&
      !extended &&
      input.livenessExtensionMs &&
      input.livenessExtensionMs > 0 &&
      now() >= baseDeadline &&
      (sendState === 'stop' || observerState.pendingCount > 0)
    ) {
      deadline = now() + input.livenessExtensionMs
      extended = true
      logger?.info('Extended DeepSeek reply generation settlement wait', {
        baseTimeoutMs: input.timeoutMs,
        extendedByMs: input.livenessExtensionMs,
        sendState,
        pendingGenerationResponses: observerState.pendingCount,
      })
    }

    await sleep(DEEPSEEK_REPLY_GENERATION_POLL_INTERVAL_MS)
  }

  return {
    started,
    settled: false,
    extended,
    finalSnapshot,
    reason: started ? 'timeout-waiting-for-settlement' : 'not-observed',
  }
}
