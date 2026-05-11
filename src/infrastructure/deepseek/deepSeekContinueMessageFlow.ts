import type { Page } from 'puppeteer-core'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { DeepSeekContinueMessageRunOnPageResult } from '../../types/deepseek-continue-message.types.js'
import type { DeepSeekGenerationStreamEvent } from '../../types/deepseek-stream.types.js'
import {
  captureDeepSeekComposerSnapshot,
  waitForStableDeepSeekComposerSnapshot,
} from './deepSeekComposerControls.js'
import {
  extractObservedGenerationObservations,
  observeDeepSeekGenerationResponses,
  parseObservedDeepSeekGenerationRuns,
  summarizeObservedDeepSeekGenerationRuns,
  sumObservedGenerationOutputTokens,
} from './deepSeekGenerationRuntime.js'
import { resolveDeepSeekGenerationObservationTimeoutMs } from './deepSeekGenerationObservationTimeout.js'
import { clickDeepSeekMessageAction } from './deepSeekMessageActionControls.js'
import { matchDeepSeekSessionRoute } from './deepSeekApiCatalog.js'

const CONTINUE_ENDPOINT = '/api/v0/chat/continue'

export interface RunDeepSeekContinueMessageOnPageInput {
  requestedUrl: string
  targetMessageId: string
  targetBranchId: string
  timeoutMs: number
  expectedSessionId?: string | undefined
  expectedAgentId?: string | undefined
  onCanonicalGenerationEvent?: ((input: {
    source: 'buffered' | 'live' | 'finalize'
    event: DeepSeekGenerationStreamEvent
  }) => void) | undefined
}

export async function runDeepSeekContinueMessageOnPage(
  page: Page,
  input: RunDeepSeekContinueMessageOnPageInput,
  logger?: RuntimeLogger,
): Promise<DeepSeekContinueMessageRunOnPageResult> {
  const startedAt = Date.now()
  assertCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)

  const beforeSendSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: Math.min(input.timeoutMs, 5_000),
  })
  assertSnapshotRoute(beforeSendSnapshot, input.expectedSessionId, input.expectedAgentId)

  const generationObserver = observeDeepSeekGenerationResponses(page, {
    onIncrementalEvent: item => {
      input.onCanonicalGenerationEvent?.({
        source: item.source,
        event: item.event,
      })
    },
  })
  await generationObserver.ready()
  let continueResponseWaitMessage: string | null = null
  const continueResponsePromise = page
    .waitForResponse(
      response => isDeepSeekContinueResponseUrl(response.url()),
      {
        timeout: input.timeoutMs,
      },
    )
    .catch(error => {
      continueResponseWaitMessage = describeContinueFlowError(error)
      return null
    })

  try {
    const resolvedControl = await clickDeepSeekMessageAction(page, {
      messageId: input.targetMessageId,
      action: 'continue',
      timeoutMs: input.timeoutMs,
    })
    if (resolvedControl.controlKind !== 'inline-button') {
      throw new Error(
        `DeepSeek Continue control for message ${input.targetMessageId} resolved to ${resolvedControl.controlKind ?? 'unknown'}, expected inline-button.`,
      )
    }

    logger?.info('DeepSeek continue action clicked', {
      targetMessageId: input.targetMessageId,
      targetBranchId: input.targetBranchId,
      controlIndex: resolvedControl.controlIndex,
      controlKind: resolvedControl.controlKind,
    })

    const continueResponse = await continueResponsePromise
    const generationCaptures = await generationObserver.stop(
      resolveDeepSeekGenerationObservationTimeoutMs({
        timeoutMs: input.timeoutMs,
        startedAt,
      }),
    )
    if (!continueResponse && generationCaptures.length === 0) {
      const continueWaitDetail =
        continueResponseWaitMessage === null
          ? ''
          : ` Last wait error: ${String(continueResponseWaitMessage)}`
      throw new Error(
        `Timed out waiting for a DeepSeek continue response after click.${continueWaitDetail}`,
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
      generationObservations,
      generationRuns,
      canonicalGenerationRuns,
      outputTokensUsed: sumObservedGenerationOutputTokens(generationCaptures),
      settledAfterMs: Date.now() - startedAt,
      beforeSendSnapshot,
      afterSendSnapshot,
      targetMessageId: input.targetMessageId,
      targetBranchId: input.targetBranchId,
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
    throw new Error(`Expected a session route after continue, but resolved ${snapshot.routeKind}.`)
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

function isDeepSeekContinueResponseUrl(url: string): boolean {
  try {
    return new URL(url).pathname === CONTINUE_ENDPOINT
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

function describeContinueFlowError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Unknown DeepSeek continue wait failure.'
}
