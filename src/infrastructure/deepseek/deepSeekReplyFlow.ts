import { setTimeout as delay } from 'node:timers/promises'
import type { HTTPResponse, Page } from 'puppeteer-core'
import type {
  DeepSeekSessionCreateObservation,
} from '../../types/deepseek-first-message.types.js'
import type {
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeInput,
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type {
  DeepSeekChatModeCapabilityMatrix,
} from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekFileUploadBatchResult } from '../../types/deepseek-file.types.js'
import type {
  DeepSeekCapturedGenerationResponse,
  DeepSeekParsedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type {
  DeepSeekGenerationStreamEvent,
} from '../../types/deepseek-stream.types.js'
import type { DeepSeekComposerSnapshot } from '../../types/deepseek-controls.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { waitForDeepSeekHomeEntry } from './deepSeekHomeEntry.js'
import {
  DEEPSEEK_GENERATION_REQUEST_ENDPOINTS,
  matchDeepSeekSessionRoute,
} from './deepSeekApiCatalog.js'
import { ensureDeepSeekComposerMode } from './deepSeekComposerMode.js'
import {
  uploadDeepSeekComposerFiles,
} from './deepSeekFileUploadRuntime.js'
import {
  buildDeepSeekFileUploadFailureReport,
  createDeepSeekFileUploadError,
} from '../../shared/errors/deepSeekFileUploadError.js'
import {
  createDeepSeekComposerFileInputUnavailableError,
} from '../../shared/errors/deepSeekComposerModeError.js'
import {
  captureDeepSeekComposerSnapshot,
  waitForStableDeepSeekComposerSnapshot,
} from './deepSeekComposerControls.js'
import {
  extractObservedGenerationObservations,
  observeDeepSeekGenerationResponses,
  type DeepSeekGenerationObserverState,
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
import {
  resolveDeepSeekGenerationObservationTimeoutMs,
} from './deepSeekGenerationObservationTimeout.js'

const DEEPSEEK_SUBMIT_CONTROL_TIMEOUT_MS = 15_000
const DEEPSEEK_GENERATION_START_TIMEOUT_MS = 15_000
const DEEPSEEK_GENERATION_START_POLL_INTERVAL_MS = 250

type DeepSeekSubmitFailureSnapshot =
  | DeepSeekComposerSnapshot
  | Pick<DeepSeekComposerSnapshot, 'pageUrl' | 'routeKind' | 'sendOrStopButton'>

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
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterSendSnapshot: DeepSeekComposerSnapshot
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
  const submitControlTimeoutMs = resolveDeepSeekSubmitControlTimeoutMs(
    input.timeoutMs,
  )
  await waitForDeepSeekSubmitButtonReady(page, {
    timeoutMs: submitControlTimeoutMs,
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
  const generationResponseSignal = createDeepSeekGenerationResponseSignal(
    page,
    input.timeoutMs,
  )
  const sessionCreateObserver =
    input.entryMode === 'new-session'
      ? observeDeepSeekSessionCreateResponses(page)
      : null
  try {
    await clickDeepSeekSubmitButton(page, beforeSendSnapshot)
    logger?.info('DeepSeek reply submitted', {
      entryMode: input.entryMode,
    })

    const route =
      input.entryMode === 'new-session'
        ? await waitForDeepSeekSubmitSessionRoute(page, submitControlTimeoutMs)
        : readCurrentSessionRoute(
            page.url(),
            input.expectedSessionId,
            input.expectedAgentId,
          )

    const generationStart = await waitForDeepSeekGenerationStartAfterSubmit({
      page,
      timeoutMs: resolveDeepSeekGenerationStartTimeoutMs(input.timeoutMs),
      getObserverState: () => generationObserver.getState(),
      hasObservedGenerationResponse: () => generationResponseSignal.hasObserved(),
    })
    if (!generationStart.started) {
      throw createDeepSeekSubmitFailureError({
        stage: 'generation-start',
        reason:
          'send was clicked but no generation response or running state was observed',
        snapshot: generationStart.finalSnapshot,
        observerState: generationStart.observerState,
      })
    }

    const generationSettlement = await waitForDeepSeekReplyGenerationSettlement(
      {
        page,
        timeoutMs: input.timeoutMs,
        livenessExtensionMs: timingPolicy.livenessExtensionMs,
        getObserverState: () => generationObserver.getState(),
        hasObservedGenerationResponse: () => generationResponseSignal.hasObserved(),
      },
      logger?.child('generation-liveness'),
    )

    const generationCaptures = await generationObserver.stop(
      resolveDeepSeekGenerationObservationTimeoutMs({
        timeoutMs: input.timeoutMs,
        startedAt,
      }),
    )
    if (generationSettlement.started && !generationSettlement.settled) {
      throw createDeepSeekSubmitFailureError({
        stage: 'generation-settlement',
        reason: 'generation started but did not settle before timeout',
        snapshot: generationSettlement.finalSnapshot ?? undefined,
        observerState: generationObserver.getState(),
      })
    }
    const generationResponse = generationResponseSignal.hasObserved()
      ? await generationResponseSignal.wait()
      : generationCaptures.length === 0
        ? await generationResponseSignal.wait()
        : { observed: false, waitMessage: null }
    if (!generationResponse.observed && generationCaptures.length === 0) {
      throw createDeepSeekSubmitFailureError({
        stage: 'generation-response',
        reason: 'no DeepSeek generation response was captured after submit',
        snapshot: generationSettlement.finalSnapshot ?? undefined,
        observerState: generationObserver.getState(),
        waitMessage: generationResponse.waitMessage,
      })
    }

    const generationObservations =
      extractObservedGenerationObservations(generationCaptures)
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
      ...(composerMode.effectiveMode
        ? { effectiveComposerMode: composerMode.effectiveMode }
        : {}),
      ...(composerMode.ignoredToggles
        ? { ignoredComposerToggles: composerMode.ignoredToggles }
        : {}),
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
    generationResponseSignal.dispose()
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
      'DeepSeek route mismatch: expected session ' +
        `${expectedSessionId}, got ${route.sessionId}.`,
    )
  }

  if (expectedAgentId && route.agentId !== expectedAgentId) {
    throw new Error(
      'DeepSeek route mismatch: expected agent ' +
        `${expectedAgentId}, got ${route.agentId}.`,
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
    (!input.expectedSessionId ||
      currentRoute.sessionId === input.expectedSessionId) &&
    (!input.expectedAgentId || currentRoute.agentId === input.expectedAgentId)

  if (!alreadyOnExpectedRoute) {
    await page.goto(input.requestedUrl, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('body')
  }

  assertCurrentSessionRoute(
    page.url(),
    input.expectedSessionId,
    input.expectedAgentId,
  )
  const snapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: input.timeoutMs,
  })

  if (input.expectedSessionId && input.expectedAgentId) {
    assertSnapshotRoute(snapshot, input.expectedSessionId, input.expectedAgentId)
  }
}

async function waitForDeepSeekSubmitButtonReady(
  page: Page,
  input: {
    timeoutMs: number
  },
): Promise<void> {
  try {
    await waitForDeepSeekSendButtonEnabled(page, {
      timeoutMs: input.timeoutMs,
    })
  } catch (error) {
    throw createDeepSeekSubmitFailureError({
      stage: 'submit-control',
      reason: 'no enabled send button was found before submit',
      snapshot: await captureDeepSeekSubmitSnapshot(page),
      waitMessage: describeDeepSeekReplyFlowError(error),
    })
  }
}

async function clickDeepSeekSubmitButton(
  page: Page,
  beforeSendSnapshot: DeepSeekComposerSnapshot,
): Promise<void> {
  try {
    await clickDeepSeekSendButton(page)
  } catch (error) {
    throw createDeepSeekSubmitFailureError({
      stage: 'submit-click',
      reason: 'the resolved send button could not be clicked',
      snapshot: await captureDeepSeekSubmitSnapshot(page, beforeSendSnapshot),
      waitMessage: describeDeepSeekReplyFlowError(error),
    })
  }
}

async function waitForDeepSeekSubmitSessionRoute(
  page: Page,
  timeoutMs: number,
): Promise<{
  finalUrl: string
  agentId: string
  sessionId: string
}> {
  try {
    return await waitForDeepSeekSessionRoute(page, timeoutMs)
  } catch (error) {
    throw createDeepSeekSubmitFailureError({
      stage: 'session-route',
      reason: 'a new session route was not reached after submit',
      snapshot: await captureDeepSeekSubmitSnapshot(page),
      waitMessage: describeDeepSeekReplyFlowError(error),
    })
  }
}

async function waitForDeepSeekGenerationStartAfterSubmit(input: {
  page: Page
  timeoutMs: number
  getObserverState: () => DeepSeekGenerationObserverState
  hasObservedGenerationResponse: () => boolean
}): Promise<{
  started: boolean
  finalSnapshot?: DeepSeekComposerSnapshot | undefined
  observerState: DeepSeekGenerationObserverState
}> {
  const deadline = Date.now() + Math.max(1, input.timeoutMs)
  let finalSnapshot: DeepSeekComposerSnapshot | undefined
  let observerState = input.getObserverState()

  while (Date.now() <= deadline) {
    finalSnapshot = await captureDeepSeekSubmitSnapshot(input.page)
    observerState = input.getObserverState()
    const sendState = finalSnapshot?.sendOrStopButton.state
    const started =
      sendState === 'stop' ||
      observerState.pendingCount > 0 ||
      observerState.captureCount > 0 ||
      input.hasObservedGenerationResponse()

    if (started) {
      return {
        started: true,
        finalSnapshot,
        observerState,
      }
    }

    await delay(DEEPSEEK_GENERATION_START_POLL_INTERVAL_MS)
  }

  return {
    started: false,
    finalSnapshot,
    observerState,
  }
}

function createDeepSeekGenerationResponseSignal(
  page: Page,
  timeoutMs: number,
): {
  hasObserved: () => boolean
  wait: () => Promise<{
    observed: boolean
    waitMessage: string | null
  }>
  dispose: () => void
} {
  let observed = false
  let settled = false
  let timer: NodeJS.Timeout | null = null
  let resolveWait:
    | ((result: {
        observed: boolean
        waitMessage: string | null
      }) => void)
    | null = null

  const cleanup = () => {
    page.off('response', handleResponse)
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const settle = (result: {
    observed: boolean
    waitMessage: string | null
  }) => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    resolveWait?.(result)
  }
  const handleResponse = (response: HTTPResponse) => {
    if (!isDeepSeekGenerationResponseUrl(response.url())) {
      return
    }
    observed = true
    settle({
      observed: true,
      waitMessage: null,
    })
  }

  const waitPromise = new Promise<{
    observed: boolean
    waitMessage: string | null
  }>(resolve => {
    resolveWait = resolve
  })

  page.on('response', handleResponse)
  timer = setTimeout(() => {
    settle({
      observed: false,
      waitMessage: 'Timed out waiting for a DeepSeek generation response.',
    })
  }, Math.max(1, timeoutMs))

  return {
    hasObserved: () => observed,
    wait: () => waitPromise,
    dispose: () => {
      settle({
        observed,
        waitMessage: observed
          ? null
          : 'DeepSeek generation response wait was disposed.',
      })
    },
  }
}

async function captureDeepSeekSubmitSnapshot(
  page: Page,
  fallback?: DeepSeekComposerSnapshot,
): Promise<DeepSeekComposerSnapshot | undefined> {
  try {
    return await captureDeepSeekComposerSnapshot(page)
  } catch {
    return fallback
  }
}

function createDeepSeekSubmitFailureError(input: {
  stage: string
  reason: string
  snapshot?: DeepSeekSubmitFailureSnapshot | undefined
  observerState?: DeepSeekGenerationObserverState | undefined
  waitMessage?: string | null | undefined
}): Error {
  const details = [
    `stage=${input.stage}`,
    `reason=${input.reason}`,
    describeDeepSeekSubmitSnapshot(input.snapshot),
    describeDeepSeekGenerationObserverState(input.observerState),
    input.waitMessage ? `wait=${input.waitMessage}` : null,
  ].filter((item): item is string => Boolean(item))

  return new Error(
    `DeepSeek generation submit failed. ${details.join(' ')}`,
  )
}

function describeDeepSeekSubmitSnapshot(
  snapshot?: DeepSeekSubmitFailureSnapshot,
): string | null {
  if (!snapshot) {
    return 'snapshot=unavailable'
  }

  const inputDescription =
    'composerInput' in snapshot
      ? describeDeepSeekControl(snapshot.composerInput)
      : 'unavailable'

  return [
    `url=${snapshot.pageUrl}`,
    `route=${snapshot.routeKind}`,
    `input=${inputDescription}`,
    `sendButton=${describeDeepSeekControl(snapshot.sendOrStopButton)}`,
  ].join(' ')
}

function describeDeepSeekControl(
  control: DeepSeekComposerSnapshot['sendOrStopButton'],
): string {
  const label = control.label?.replace(/\s+/g, ' ').trim() || 'none'
  const selector = control.selector ?? 'none'
  const state = control.state ?? 'unknown'
  return [
    '{',
    `found:${String(control.found)},`,
    `state:${state},`,
    `selector:${selector},`,
    `label:${label}`,
    '}',
  ].join('')
}

function describeDeepSeekGenerationObserverState(
  state?: DeepSeekGenerationObserverState,
): string | null {
  if (!state) {
    return null
  }

  return [
    'observer={',
    `captures:${state.captureCount},`,
    `pending:${state.pendingCount},`,
    `activity:${String(state.sawActivity)},`,
    `liveInputs:${state.liveInputCount}`,
    '}',
  ].join('')
}

function resolveDeepSeekSubmitControlTimeoutMs(timeoutMs: number): number {
  return Math.max(
    1_000,
    Math.min(timeoutMs, DEEPSEEK_SUBMIT_CONTROL_TIMEOUT_MS),
  )
}

function resolveDeepSeekGenerationStartTimeoutMs(timeoutMs: number): number {
  return Math.max(
    1_000,
    Math.min(timeoutMs, DEEPSEEK_GENERATION_START_TIMEOUT_MS),
  )
}

function assertCurrentSessionRoute(
  currentUrl: string,
  expectedSessionId?: string,
  expectedAgentId?: string,
): void {
  void readCurrentSessionRoute(currentUrl, expectedSessionId, expectedAgentId)
}

function assertSnapshotRoute(
  snapshot: DeepSeekComposerSnapshot,
  expectedSessionId: string,
  expectedAgentId: string,
): void {
  if (snapshot.routeKind !== 'session') {
    throw new Error(
      `Expected a session route after reply, but resolved ${snapshot.routeKind}.`,
    )
  }

  if (snapshot.sessionId !== expectedSessionId) {
    throw new Error(
      'DeepSeek snapshot mismatch: expected session ' +
        `${expectedSessionId}, got ${snapshot.sessionId ?? 'unknown'}.`,
    )
  }

  if (snapshot.agentId !== expectedAgentId) {
    throw new Error(
      'DeepSeek snapshot mismatch: expected agent ' +
        `${expectedAgentId}, got ${snapshot.agentId ?? 'unknown'}.`,
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
