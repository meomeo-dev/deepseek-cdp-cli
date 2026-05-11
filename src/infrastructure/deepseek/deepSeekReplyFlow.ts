import type { Page } from 'puppeteer-core'
import type { DeepSeekSessionCreateObservation } from '../../types/deepseek-first-message.types.js'
import type {
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeInput,
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekChatModeCapabilityMatrix } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekFileUploadBatchResult } from '../../types/deepseek-file.types.js'
import type {
  DeepSeekCapturedGenerationResponse,
  DeepSeekParsedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type { DeepSeekGenerationStreamEvent } from '../../types/deepseek-stream.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { waitForDeepSeekHomeEntry } from './deepSeekHomeEntry.js'
import { matchDeepSeekSessionRoute, DEEPSEEK_GENERATION_REQUEST_ENDPOINTS } from './deepSeekApiCatalog.js'
import { ensureDeepSeekComposerMode } from './deepSeekComposerMode.js'
import {
  uploadDeepSeekComposerFiles,
} from './deepSeekFileUploadRuntime.js'
import {
  buildDeepSeekFileUploadFailureReport,
  createDeepSeekFileUploadError,
} from '../../shared/errors/deepSeekFileUploadError.js'
import { createDeepSeekComposerFileInputUnavailableError } from '../../shared/errors/deepSeekComposerModeError.js'
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
import {
  clickDeepSeekSendButton,
  focusAndTypeDeepSeekComposer,
  waitForDeepSeekSendButtonEnabled,
} from './deepSeekComposerInteractions.js'
import {
  resolveDeepSeekReplyTimingPolicy,
  waitForDeepSeekReplyGenerationSettlement,
} from './deepSeekReplyGenerationLiveness.js'
import {
  observeDeepSeekSessionCreateResponses,
  selectDeepSeekSessionCreateObservation,
  waitForDeepSeekSessionRoute,
} from './deepSeekSessionTransition.js'
import { resolveDeepSeekGenerationObservationTimeoutMs } from './deepSeekGenerationObservationTimeout.js'

export interface RunDeepSeekReplyOnPageInput {
  requestedUrl: string
  prompt: string
  filePaths?: string[] | undefined
  timeoutMs: number
  entryMode: 'new-session' | 'existing-session'
  composerMode?: DeepSeekComposerModeInput | undefined
  authoritativeChatModeHint?: DeepSeekChatMode | undefined
  expectedSessionId?: string | undefined
  expectedAgentId?: string | undefined
  onCanonicalGenerationEvent?: ((input: {
    source: 'buffered' | 'live' | 'finalize'
    event: DeepSeekGenerationStreamEvent
  }) => void) | undefined
}

export interface DeepSeekReplyRunOnPageResult {
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  sessionCreate: DeepSeekSessionCreateObservation | null
  completionRequestObserved: boolean
  generationCaptures: DeepSeekCapturedGenerationResponse[]
  generationObservations: ReturnType<typeof extractObservedGenerationObservations>
  generationRuns: ReturnType<typeof summarizeObservedDeepSeekGenerationRuns>
  canonicalGenerationRuns: DeepSeekParsedGenerationRun[]
  outputTokensUsed: number
  settledAfterMs: number
  requestedComposerMode: DeepSeekComposerModeRequest
  effectiveComposerMode?: DeepSeekComposerModeRequest | undefined
  ignoredComposerToggles?: DeepSeekComposerIgnoredToggle[] | undefined
  composerMode: DeepSeekResolvedComposerMode
  beforeSendSnapshot: Awaited<ReturnType<typeof waitForStableDeepSeekComposerSnapshot>>
  afterSendSnapshot: Awaited<ReturnType<typeof waitForStableDeepSeekComposerSnapshot>>
  fileUpload: DeepSeekFileUploadBatchResult | null
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
}

export async function runDeepSeekReplyOnPage(
  page: Page,
  input: RunDeepSeekReplyOnPageInput,
  logger?: RuntimeLogger,
): Promise<DeepSeekReplyRunOnPageResult> {
  const startedAt = Date.now()
  const timingPolicy = resolveDeepSeekReplyTimingPolicy({
    timeoutMs: input.timeoutMs,
    composerMode: input.composerMode,
  })

  if (input.entryMode === 'new-session') {
    await waitForDeepSeekHomeEntry(page, {
      requestedUrl: input.requestedUrl,
      timeoutMs: input.timeoutMs,
    })
  } else {
    await ensureExistingSessionEntryOnPage(page, {
      requestedUrl: input.requestedUrl,
      timeoutMs: input.timeoutMs,
      expectedSessionId: input.expectedSessionId,
      expectedAgentId: input.expectedAgentId,
    })
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
  assertReplyModeCapabilities({
    filePaths: input.filePaths,
    requestedMode: composerMode.requestedMode,
    resolvedMode: composerMode.resolvedMode,
    pageUrl: composerMode.settledModeSurface.pageUrl,
    capabilityMatrix: composerMode.capabilityMatrix,
    fileInputAvailable: composerMode.capabilityMatrix.fileInput,
  })
  const fileUpload = await uploadDeepSeekComposerFiles(
    page,
    {
      filePaths: input.filePaths ?? [],
      timeoutMs: Math.min(input.timeoutMs, 30_000),
      allowSettledUnverifiedMount: composerMode.resolvedMode.chatMode === 'vision',
    },
    logger?.child('file-upload'),
  )
  if (fileUpload?.blockingIssues) {
    logger?.error('DeepSeek file upload failed before submit', {
      attachmentFailure: buildDeepSeekFileUploadFailureReport(fileUpload),
    })
    throw createDeepSeekFileUploadError(fileUpload)
  }
  logger?.debug('DeepSeek reply flow entering composer typing stage', {
    hasFileUpload: Boolean(fileUpload),
    acceptedFileCount: fileUpload?.acceptedPaths.length ?? 0,
  })
  await focusAndTypeDeepSeekComposer(page, input.prompt)
  logger?.debug('DeepSeek reply flow typed prompt into composer', {
    promptLength: input.prompt.length,
  })
  await waitForDeepSeekSendButtonEnabled(page, {
    timeoutMs: input.timeoutMs,
  })
  logger?.debug('DeepSeek reply flow detected enabled send button')

  const beforeSendSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: Math.min(input.timeoutMs, 5_000),
  })
  logger?.debug('DeepSeek reply flow captured pre-submit snapshot', {
    routeKind: beforeSendSnapshot.routeKind,
    sendButtonState: beforeSendSnapshot.sendOrStopButton.state,
  })

  const generationObserver = observeDeepSeekGenerationResponses(page, {
    onIncrementalEvent: item => {
      input.onCanonicalGenerationEvent?.({
        source: item.source,
        event: item.event,
      })
    },
  })
  await generationObserver.ready()
  const sessionCreateObserver =
    input.entryMode === 'new-session'
      ? observeDeepSeekSessionCreateResponses(page)
      : null
  let generationResponseWaitMessage: string | null = null
  let generationResponseObserved = false
  const generationResponsePromise = page
    .waitForResponse(
      response => isDeepSeekGenerationResponseUrl(response.url()),
      {
        timeout: input.timeoutMs,
      },
    )
    .then(response => {
      generationResponseObserved = true
      return response
    })
    .catch(error => {
      generationResponseWaitMessage = describeDeepSeekReplyFlowError(error)
      return null
    })
  try {
    await clickDeepSeekSendButton(page)
    logger?.info('DeepSeek reply submitted', {
      entryMode: input.entryMode,
    })

    const route =
      input.entryMode === 'new-session'
        ? await waitForDeepSeekSessionRoute(page, input.timeoutMs)
        : readCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)

    const generationSettlement = await waitForDeepSeekReplyGenerationSettlement(
      {
        page,
        timeoutMs: input.timeoutMs,
        livenessExtensionMs: timingPolicy.livenessExtensionMs,
        getObserverState: () => generationObserver.getState(),
        hasObservedGenerationResponse: () => generationResponseObserved,
      },
      logger?.child('generation-liveness'),
    )

    const generationResponse = await generationResponsePromise
    const generationCaptures = await generationObserver.stop(
      resolveDeepSeekGenerationObservationTimeoutMs({
        timeoutMs: input.timeoutMs,
        startedAt,
      }),
    )
    if (generationSettlement.started && !generationSettlement.settled) {
      throw new Error(
        `DeepSeek generation did not settle before timeout. Last composer state: ${generationSettlement.finalSnapshot?.sendOrStopButton.state ?? 'unknown'}.`,
      )
    }
    if (!generationResponse && generationCaptures.length === 0) {
      const generationWaitDetail =
        generationResponseWaitMessage === null
          ? ''
          : ` Last wait error: ${String(generationResponseWaitMessage)}`
      throw new Error(
        `Timed out waiting for a DeepSeek generation response after submit.${generationWaitDetail}`,
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

    const afterSendSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
      timeoutMs: Math.min(input.timeoutMs, 5_000),
    }).catch(() => captureDeepSeekComposerSnapshot(page))
    if (input.entryMode === 'existing-session') {
      assertSnapshotRoute(afterSendSnapshot, route.sessionId, route.agentId)
    }

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
      completionRequestObserved: generationObservations.some(
        observation => observation.endpoint === '/api/v0/chat/completion',
      ),
      generationCaptures,
      generationObservations,
      generationRuns,
      canonicalGenerationRuns,
      outputTokensUsed: sumObservedGenerationOutputTokens(generationCaptures),
      settledAfterMs: Date.now() - startedAt,
      requestedComposerMode: composerMode.requestedMode,
      ...(composerMode.effectiveMode ? { effectiveComposerMode: composerMode.effectiveMode } : {}),
      ...(composerMode.ignoredToggles ? { ignoredComposerToggles: composerMode.ignoredToggles } : {}),
      composerMode: composerMode.resolvedMode,
      beforeSendSnapshot,
      afterSendSnapshot,
      fileUpload,
      assistantText: selectAssistantTextFromGenerationRuns(generationRuns),
      assistantTextSource: generationRuns.some(run => run.finalized.outputText.trim())
        ? 'generation-stream'
        : 'unavailable',
    }
  } finally {
    await generationObserver.stop(0)
    if (sessionCreateObserver) {
      await sessionCreateObserver.stop().catch(() => [])
    }
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

async function ensureExistingSessionEntryOnPage(
  page: Page,
  input: {
    requestedUrl: string
    timeoutMs: number
    expectedSessionId?: string | undefined
    expectedAgentId?: string | undefined
  },
): Promise<void> {
  const currentRoute = matchDeepSeekSessionRoute(page.url())
  const alreadyOnExpectedRoute =
    currentRoute.routeKind === 'session' &&
    (!input.expectedSessionId || currentRoute.sessionId === input.expectedSessionId) &&
    (!input.expectedAgentId || currentRoute.agentId === input.expectedAgentId)

  if (!alreadyOnExpectedRoute) {
    await page.goto(input.requestedUrl, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('body')
  }

  assertCurrentSessionRoute(page.url(), input.expectedSessionId, input.expectedAgentId)
  const snapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: input.timeoutMs,
  })

  if (input.expectedSessionId && input.expectedAgentId) {
    assertSnapshotRoute(snapshot, input.expectedSessionId, input.expectedAgentId)
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
  expectedSessionId: string,
  expectedAgentId: string,
): void {
  if (snapshot.routeKind !== 'session') {
    throw new Error(`Expected a session route after reply, but resolved ${snapshot.routeKind}.`)
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
    const parsedUrl = new URL(url)
    return DEEPSEEK_GENERATION_REQUEST_ENDPOINTS.has(parsedUrl.pathname)
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

function describeDeepSeekReplyFlowError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Unknown DeepSeek generation wait failure.'
}

function assertReplyModeCapabilities(input: {
  filePaths?: string[] | undefined
  requestedMode: DeepSeekComposerModeRequest
  resolvedMode: DeepSeekResolvedComposerMode
  pageUrl: string
  capabilityMatrix: DeepSeekChatModeCapabilityMatrix
  fileInputAvailable: boolean
}): void {
  const requestedFileCount = input.filePaths?.length ?? 0
  if (requestedFileCount === 0 || input.fileInputAvailable) {
    return
  }

  const requestedChatMode = input.requestedMode.chatMode ?? 'unchanged'
  const resolvedChatMode = input.resolvedMode.chatMode ?? 'unavailable'
  throw createDeepSeekComposerFileInputUnavailableError({
    requestedChatMode,
    resolvedChatMode,
    requestedFileCount,
    pageUrl: input.pageUrl,
    capabilityMatrix: input.capabilityMatrix,
  })
}
