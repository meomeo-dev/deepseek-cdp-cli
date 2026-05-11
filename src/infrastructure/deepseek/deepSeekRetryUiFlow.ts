import type { Page } from 'puppeteer-core'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { DeepSeekRetryUiRunOnPageResult } from '../../types/deepseek-retry-ui.types.js'
import {
  captureDeepSeekComposerSnapshot,
  waitForStableDeepSeekComposerSnapshot,
} from './deepSeekComposerControls.js'
import {
  captureDeepSeekMessageActionSnapshot,
  clickDeepSeekMessageAction,
} from './deepSeekMessageActionControls.js'
import {
  extractObservedGenerationObservations,
  observeDeepSeekGenerationResponses,
  parseObservedDeepSeekGenerationRuns,
  summarizeObservedDeepSeekGenerationRuns,
  sumObservedGenerationOutputTokens,
} from './deepSeekGenerationRuntime.js'
import { resolveDeepSeekGenerationObservationTimeoutMs } from './deepSeekGenerationObservationTimeout.js'
import {
  DEEPSEEK_GENERATION_REQUEST_ENDPOINTS,
  matchDeepSeekSessionRoute,
} from './deepSeekApiCatalog.js'

export interface RunDeepSeekRetryUiOnPageInput {
  requestedUrl: string
  targetMessageId: string
  timeoutMs: number
  expectedSessionId?: string | undefined
  expectedAgentId?: string | undefined
}

export async function runDeepSeekRetryUiOnPage(
  page: Page,
  input: RunDeepSeekRetryUiOnPageInput,
  logger?: RuntimeLogger,
): Promise<DeepSeekRetryUiRunOnPageResult> {
  const startedAt = Date.now()
  assertCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)

  const beforeSendSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: Math.min(input.timeoutMs, 5_000),
  })
  assertSnapshotRoute(beforeSendSnapshot, input.expectedSessionId, input.expectedAgentId)
  const beforeActionSnapshot = await captureDeepSeekMessageActionSnapshot(page)

  const generationObserver = observeDeepSeekGenerationResponses(page)
  await generationObserver.ready()
  let generationResponseWaitMessage: string | null = null
  const generationResponsePromise = page
    .waitForResponse(
      response => isDeepSeekGenerationResponseUrl(response.url()),
      {
        timeout: input.timeoutMs,
      },
    )
    .catch(error => {
      generationResponseWaitMessage = describeRetryUiFlowError(error)
      return null
    })

  try {
    const resolvedControl = await clickDeepSeekMessageAction(page, {
      messageId: input.targetMessageId,
      action: 'retry',
      timeoutMs: input.timeoutMs,
    })

    logger?.info('DeepSeek UI retry action clicked', {
      targetMessageId: input.targetMessageId,
      controlIndex: resolvedControl.controlIndex,
      controlKind: resolvedControl.controlKind,
      label: resolvedControl.tooltipLabel ?? resolvedControl.label,
    })

    const generationResponse = await generationResponsePromise
    const generationCaptures = await generationObserver.stop(
      resolveDeepSeekGenerationObservationTimeoutMs({
        timeoutMs: input.timeoutMs,
        startedAt,
      }),
    )
    if (!generationResponse && generationCaptures.length === 0) {
      const waitDetail =
        generationResponseWaitMessage === null
          ? ''
          : ` Last wait error: ${String(generationResponseWaitMessage)}`
      throw new Error(
        `Timed out waiting for a DeepSeek generation response after clicking UI retry.${waitDetail}`,
      )
    }

    const route = readCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)
    const generationObservations = extractObservedGenerationObservations(generationCaptures)
    const generationRuns = summarizeObservedDeepSeekGenerationRuns({
      captures: generationCaptures,
      routeUrl: route.finalUrl,
    })
    const canonicalGenerationRuns = parseObservedDeepSeekGenerationRuns({
      captures: generationCaptures,
      routeUrl: route.finalUrl,
    })
    const afterSendSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
      timeoutMs: Math.min(input.timeoutMs, 5_000),
    }).catch(() => captureDeepSeekComposerSnapshot(page))
    assertSnapshotRoute(afterSendSnapshot, input.expectedSessionId, input.expectedAgentId)

    return {
      requestedUrl: input.requestedUrl,
      finalUrl: route.finalUrl,
      agentId: route.agentId,
      sessionId: route.sessionId,
      targetMessageId: input.targetMessageId,
      beforeSendSnapshot,
      afterSendSnapshot,
      beforeActionSnapshot,
      resolvedControl,
      generationObservations,
      generationRuns,
      canonicalGenerationRuns,
      outputTokensUsed: sumObservedGenerationOutputTokens(generationCaptures),
      settledAfterMs: Date.now() - startedAt,
      assistantText: selectAssistantTextFromGenerationRuns(generationRuns),
      assistantTextSource: generationRuns.some(run => run.finalized.outputText.trim())
        ? 'generation-stream'
        : 'unavailable',
    }
  } finally {
    await generationObserver.stop(0)
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

function assertSnapshotRoute(
  snapshot: Awaited<ReturnType<typeof waitForStableDeepSeekComposerSnapshot>>,
  expectedSessionId?: string,
  expectedAgentId?: string,
): void {
  if (!expectedSessionId || !expectedAgentId) {
    return
  }

  if (snapshot.routeKind !== 'session') {
    throw new Error(`Expected a session route after UI retry, but resolved ${snapshot.routeKind}.`)
  }

  if (snapshot.sessionId !== expectedSessionId) {
    throw new Error(
      `DeepSeek snapshot mismatch: expected session ${expectedSessionId}, got ${snapshot.sessionId ?? 'unknown'}.`,
    )
  }

  if (snapshot.agentId !== expectedAgentId) {
    throw new Error(
      `DeepSeek snapshot mismatch: expected agent ${expectedAgentId}, got ${snapshot.agentId ?? 'unknown'}.`,
    )
  }
}

function isDeepSeekGenerationResponseUrl(url: string): boolean {
  try {
    return DEEPSEEK_GENERATION_REQUEST_ENDPOINTS.has(new URL(url).pathname)
  } catch {
    return false
  }
}

function selectAssistantTextFromGenerationRuns(
  generationRuns: ReturnType<typeof summarizeObservedDeepSeekGenerationRuns>,
): string | null {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const candidate = generationRuns[index]?.finalized.outputText.trim()
    if (candidate) {
      return candidate
    }
  }

  return null
}

function describeRetryUiFlowError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Unknown DeepSeek UI retry wait failure.'
}
