import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'puppeteer-core'
import type { DeepSeekSessionCreateObservation } from '../../types/deepseek-first-message.types.js'
import type {
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeInput,
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekComposerSnapshot } from '../../types/deepseek-controls.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type {
  DeepSeekGenerationSettlement,
  DeepSeekObservedStreamControl,
} from '../../types/deepseek-stream-control.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { waitForDeepSeekHomeEntry } from './deepSeekHomeEntry.js'
import { DEEPSEEK_GENERATION_REQUEST_ENDPOINTS, matchDeepSeekSessionRoute } from './deepSeekApiCatalog.js'
import { ensureDeepSeekComposerMode } from './deepSeekComposerMode.js'
import {
  captureDeepSeekComposerSnapshot,
  waitForStableDeepSeekComposerSnapshot,
} from './deepSeekComposerControls.js'
import {
  clickDeepSeekSendButton,
  clickDeepSeekStopButton,
  focusAndTypeDeepSeekComposer,
  waitForDeepSeekSendButtonEnabled,
  waitForDeepSeekSendButtonMode,
} from './deepSeekComposerInteractions.js'
import {
  extractObservedGenerationObservations,
  observeDeepSeekGenerationResponses,
  parseObservedDeepSeekGenerationRuns,
  summarizeObservedDeepSeekGenerationRuns,
  sumObservedGenerationOutputTokens,
} from './deepSeekGenerationRuntime.js'
import {
  judgeDeepSeekGenerationSettlement,
  observeDeepSeekStreamControlResponses,
  summarizeObservedDeepSeekStreamControls,
} from './deepSeekStreamControlRuntime.js'
import {
  observeDeepSeekSessionCreateResponses,
  selectDeepSeekSessionCreateObservation,
  waitForDeepSeekSessionRoute,
} from './deepSeekSessionTransition.js'

const DEFAULT_GENERATION_START_TIMEOUT_MS = 4_000

export interface PrepareDeepSeekContinueTargetOnPageInput {
  requestedUrl: string
  prompt: string
  timeoutMs: number
  stopAfterMs: number
  entryMode: 'new-session' | 'existing-session'
  composerMode?: DeepSeekComposerModeInput | undefined
  authoritativeChatModeHint?: DeepSeekChatMode | undefined
  expectedSessionId?: string | undefined
  expectedAgentId?: string | undefined
}

export interface PrepareDeepSeekContinueTargetOnPageResult {
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  sessionCreate: DeepSeekSessionCreateObservation | null
  generationObservations: DeepSeekGenerationObservation[]
  generationRuns: DeepSeekObservedGenerationRun[]
  outputTokensUsed: number
  settledAfterMs: number
  requestedComposerMode: DeepSeekComposerModeRequest
  effectiveComposerMode?: DeepSeekComposerModeRequest | undefined
  ignoredComposerToggles?: DeepSeekComposerIgnoredToggle[] | undefined
  composerMode: DeepSeekResolvedComposerMode
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterStopSnapshot: DeepSeekComposerSnapshot
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
  liveSettlement: DeepSeekGenerationSettlement
  streamControls: DeepSeekObservedStreamControl[]
  stopAttempt: {
    generationResponseObserved: boolean
    stopModeObserved: boolean
    stopClickIssued: boolean
    stopAfterMs: number
  }
}

export async function prepareDeepSeekContinueTargetOnPage(
  page: Page,
  input: PrepareDeepSeekContinueTargetOnPageInput,
  logger?: RuntimeLogger,
): Promise<PrepareDeepSeekContinueTargetOnPageResult> {
  const startedAt = Date.now()

  if (input.entryMode === 'new-session') {
    await waitForDeepSeekHomeEntry(page, {
      requestedUrl: input.requestedUrl,
      timeoutMs: input.timeoutMs,
    })
  } else {
    assertCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)
  }

  const composerMode = await ensureDeepSeekComposerMode(
    page,
    {
      requestedMode: input.composerMode,
      ...(input.authoritativeChatModeHint
        ? { authoritativeChatModeHint: input.authoritativeChatModeHint }
        : {}),
      timeoutMs: input.timeoutMs,
    },
    logger?.child('composer-mode'),
  )

  await focusAndTypeDeepSeekComposer(page, input.prompt)
  await waitForDeepSeekSendButtonEnabled(page, {
    timeoutMs: input.timeoutMs,
  })

  const beforeSendSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: Math.min(input.timeoutMs, 5_000),
  })

  const generationObserver = observeDeepSeekGenerationResponses(page)
  await generationObserver.ready()
  const streamControlObserver = observeDeepSeekStreamControlResponses(page)
  const sessionCreateObserver =
    input.entryMode === 'new-session'
      ? observeDeepSeekSessionCreateResponses(page)
      : null
  const generationResponsePromise = page
    .waitForResponse(
      response => isDeepSeekGenerationResponseUrl(response.url()),
      {
        timeout: Math.min(input.timeoutMs, DEFAULT_GENERATION_START_TIMEOUT_MS),
      },
    )
    .then(() => true)
    .catch(() => false)
  const stopModePromise = waitForDeepSeekSendButtonMode(page, {
    mode: 'stop',
    timeoutMs: Math.min(input.timeoutMs, 5_000),
  })
    .then(() => true)
    .catch(() => false)

  try {
    await clickDeepSeekSendButton(page)
    logger?.info('DeepSeek continue-target helper submitted a prompt', {
      entryMode: input.entryMode,
      stopAfterMs: input.stopAfterMs,
    })

    const route =
      input.entryMode === 'new-session'
        ? await waitForDeepSeekSessionRoute(page, input.timeoutMs)
        : readCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)

    const [generationResponseObserved, stopModeObserved] = await Promise.all([
      generationResponsePromise,
      stopModePromise,
    ])

    let stopClickIssued = false
    if (stopModeObserved) {
      await delay(Math.max(0, input.stopAfterMs))
      try {
        await clickDeepSeekStopButton(page)
        stopClickIssued = true
        logger?.info('DeepSeek continue-target helper clicked stop', {
          sessionId: route.sessionId,
          agentId: route.agentId,
        })
      } catch (error) {
        logger?.debug('DeepSeek continue-target helper could not click stop', {
          error: error instanceof Error ? error.message : 'Unknown stop click failure.',
        })
      }
    }

    const generationCaptures = await generationObserver.stop(
      Math.max(1_000, Math.min(input.timeoutMs, 10_000)),
    )
    const streamControlCaptures = await streamControlObserver.stop(
      Math.max(1_000, Math.min(input.timeoutMs, 10_000)),
    )
    if (!generationResponseObserved && generationCaptures.length === 0) {
      throw new Error(
        'Timed out waiting for DeepSeek generation to start before attempting stop.',
      )
    }

    const generationObservations = extractObservedGenerationObservations(generationCaptures)
    const generationRuns = summarizeObservedDeepSeekGenerationRuns({
      captures: generationCaptures,
      routeUrl: route.finalUrl,
    })
    const canonicalGenerationRuns = parseObservedDeepSeekGenerationRuns({
      captures: generationCaptures,
      routeUrl: route.finalUrl,
    })
    const streamControls = summarizeObservedDeepSeekStreamControls({
      captures: streamControlCaptures,
      routeUrl: route.finalUrl,
    })
    const liveSettlement = judgeDeepSeekGenerationSettlement({
      generationRuns: canonicalGenerationRuns,
      streamControls,
    })

    const afterStopSnapshot = await captureAfterStopSnapshot(page, input.timeoutMs)

    return {
      requestedUrl: input.requestedUrl,
      finalUrl: route.finalUrl,
      agentId: route.agentId,
      sessionId: route.sessionId,
      sessionCreate: sessionCreateObserver
        ? selectDeepSeekSessionCreateObservation(
            await sessionCreateObserver.stop(),
            route.sessionId,
          )
        : null,
      generationObservations,
      generationRuns,
      outputTokensUsed: sumObservedGenerationOutputTokens(generationCaptures),
      settledAfterMs: Date.now() - startedAt,
      requestedComposerMode: composerMode.requestedMode,
      ...(composerMode.effectiveMode ? { effectiveComposerMode: composerMode.effectiveMode } : {}),
      ...(composerMode.ignoredToggles ? { ignoredComposerToggles: composerMode.ignoredToggles } : {}),
      composerMode: composerMode.resolvedMode,
      beforeSendSnapshot,
      afterStopSnapshot,
      assistantText: selectAssistantTextFromGenerationRuns(generationRuns),
      assistantTextSource: generationRuns.some(run => run.finalized.outputText.trim())
        ? 'generation-stream'
        : 'unavailable',
      liveSettlement,
      streamControls,
      stopAttempt: {
        generationResponseObserved,
        stopModeObserved,
        stopClickIssued,
        stopAfterMs: Math.max(0, input.stopAfterMs),
      },
    }
  } finally {
    await generationObserver.stop(0)
    await streamControlObserver.stop(0)
    if (sessionCreateObserver) {
      await sessionCreateObserver.stop().catch(() => [])
    }
  }
}

async function captureAfterStopSnapshot(
  page: Page,
  timeoutMs: number,
): Promise<DeepSeekComposerSnapshot> {
  try {
    await waitForDeepSeekSendButtonMode(page, {
      mode: 'send',
      timeoutMs: Math.min(timeoutMs, 5_000),
    })
    return await waitForStableDeepSeekComposerSnapshot(page, {
      timeoutMs: Math.min(timeoutMs, 5_000),
    })
  } catch {
    return captureDeepSeekComposerSnapshot(page)
  }
}

function readCurrentSessionRoute(
  currentUrl: string,
  expectedSessionId?: string,
  expectedAgentId?: string,
): {
  finalUrl: string
  agentId: string
  sessionId: string
} {
  const route = matchDeepSeekSessionRoute(currentUrl)
  if (route.routeKind !== 'session' || !route.agentId || !route.sessionId) {
    throw new Error(`DeepSeek is not currently on a session route: ${currentUrl}`)
  }

  if (expectedSessionId && route.sessionId !== expectedSessionId) {
    throw new Error(
      `DeepSeek route mismatch: expected session ${expectedSessionId}, got ${route.sessionId}.`,
    )
  }

  if (expectedAgentId && route.agentId !== expectedAgentId) {
    throw new Error(
      `DeepSeek route mismatch: expected agent ${expectedAgentId}, got ${route.agentId}.`,
    )
  }

  return {
    finalUrl: currentUrl,
    agentId: route.agentId,
    sessionId: route.sessionId,
  }
}

function assertCurrentSessionRoute(
  currentUrl: string,
  expectedSessionId?: string,
  expectedAgentId?: string,
): void {
  void readCurrentSessionRoute(currentUrl, expectedSessionId, expectedAgentId)
}

function isDeepSeekGenerationResponseUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return DEEPSEEK_GENERATION_REQUEST_ENDPOINTS.has(parsedUrl.pathname)
  } catch {
    return false
  }
}

function selectAssistantTextFromGenerationRuns(
  generationRuns: DeepSeekObservedGenerationRun[],
): string | null {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const candidate = generationRuns[index]?.finalized.outputText.trim()
    if (candidate) {
      return candidate
    }
  }

  return null
}
