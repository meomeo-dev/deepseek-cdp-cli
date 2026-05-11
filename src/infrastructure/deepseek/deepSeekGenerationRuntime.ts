import { setTimeout as delay } from 'node:timers/promises'
import type { Protocol } from 'devtools-protocol'
import type { CDPSession, HTTPResponse, Page } from 'puppeteer-core'
import type {
  DeepSeekCapturedGenerationResponse,
  DeepSeekParsedGenerationRun,
  DeepSeekObservedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type { DeepSeekGenerationCapturedExchange } from '../../types/deepseek-generation-parser.types.js'
import { DEEPSEEK_GENERATION_REQUEST_ENDPOINTS } from './deepSeekApiCatalog.js'
import {
  createDeepSeekIncrementalGenerationParser,
  parseDeepSeekGenerationCapturedExchange,
  type DeepSeekGenerationIncrementalParser,
} from './deepSeekGenerationStreamParser.js'
import {
  createDeepSeekGenerationObservation,
  sumDeepSeekObservedOutputTokens,
} from './deepSeekGenerationUsage.js'
import { createGenerationRunAccumulator } from './generationRunAccumulator.js'
import type { DeepSeekGenerationStreamEvent } from '../../types/deepseek-stream.types.js'

const GENERATION_OBSERVER_POLL_INTERVAL_MS = 25
const GENERATION_OBSERVER_QUIET_WINDOW_MS = 75
const GENERATION_OBSERVER_DEFAULT_TIMEOUT_MS = 1_000
const GENERATION_OBSERVER_MAX_POST_DATA_SIZE = 1_048_576

export interface DeepSeekGenerationObserverOptions {
  requireLive?: boolean | undefined
  onIncrementalInput?: ((input: DeepSeekGenerationIncrementalInput) => void) | undefined
  onIncrementalEvent?: ((event: DeepSeekGenerationIncrementalEvent) => void) | undefined
}

export interface DeepSeekGenerationObserver {
  ready: () => Promise<void>
  stop: (timeoutMs?: number) => Promise<DeepSeekCapturedGenerationResponse[]>
  getState: () => DeepSeekGenerationObserverState
}

export interface DeepSeekGenerationObserverState {
  captureCount: number
  pendingCount: number
  sawActivity: boolean
  liveInputCount: number
  unsupportedReason: string | null
}

export interface DeepSeekGenerationIncrementalInput {
  requestId: string
  endpoint: DeepSeekGenerationCapturedExchange['endpoint']
  source: 'buffered' | 'live'
  chunkText: string
  accumulatedBodyText: string
  request: DeepSeekGenerationCapturedExchange['request']
  response: Omit<DeepSeekGenerationCapturedExchange['response'], 'bodyText'>
}

export interface DeepSeekGenerationIncrementalEvent {
  requestId: string
  endpoint: DeepSeekGenerationCapturedExchange['endpoint']
  source: 'buffered' | 'live' | 'finalize'
  event: DeepSeekGenerationStreamEvent
}

interface ObservedGenerationRequestState {
  requestId: string
  endpoint: DeepSeekGenerationCapturedExchange['endpoint']
  requestUrl: string
  requestMethod: string
  requestPostData: string | null
  responseStatus: number | null
  responseContentType: string | null
  bodyText: string
  textDecoder: TextDecoder
  queuedBase64Chunks: string[]
  streamInitPromise: Promise<void> | null
  streamInitSettled: boolean
  liveInputCount: number
  finalized: boolean
  unsupportedReason: string | null
  incrementalParser: DeepSeekGenerationIncrementalParser | null
}

type PageScopedCdpSessionFactory = () => Promise<CDPSession>

export function observeDeepSeekGenerationResponses(
  page: Page,
  options: DeepSeekGenerationObserverOptions = {},
): DeepSeekGenerationObserver {
  const captures: DeepSeekCapturedGenerationResponse[] = []
  const pending = new Set<Promise<void>>()
  const activeRequests = new Map<string, ObservedGenerationRequestState>()
  let stopPromise: Promise<DeepSeekCapturedGenerationResponse[]> | null = null
  let bufferedFallbackListener: ((response: HTTPResponse) => void) | null = null
  let cdpCleanup: (() => Promise<void>) | null = null
  let liveInputCount = 0
  let unsupportedReason: string | null = null
  let fatalLiveCaptureError: Error | null = null
  let mode: 'pending' | 'cdp-live' | 'buffered-fallback' = 'pending'

  const trackPendingTask = (taskFactory: () => Promise<void>): void => {
    const task = taskFactory().finally(() => {
      pending.delete(task)
    })
    pending.add(task)
  }

  const attachBufferedFallback = (): void => {
    if (bufferedFallbackListener) {
      return
    }

    mode = 'buffered-fallback'
    bufferedFallbackListener = response => {
      if (!isDeepSeekGenerationRequestUrl(response.url())) {
        return
      }

      trackPendingTask(async () => {
        const capture = await captureDeepSeekGenerationResponse(response)
        if (capture) {
          captures.push(capture)
        }
      })
    }

    page.on('response', bufferedFallbackListener)
  }

  const markUnsupported = (reason: string): void => {
    if (!unsupportedReason) {
      unsupportedReason = reason
    }
  }

  const createLiveSessionFactory = resolvePageScopedCdpSessionFactory(page)
  const initPromise = initializeGenerationObserver({
    createLiveSessionFactory,
    page,
    captures,
    activeRequests,
    trackPendingTask,
    onIncrementalInput: input => {
      liveInputCount += 1
      options.onIncrementalInput?.(input)
    },
    onIncrementalEvent: event => {
      options.onIncrementalEvent?.(event)
    },
    markUnsupported,
    setFatalLiveCaptureError: error => {
      fatalLiveCaptureError = error
      markUnsupported(error.message)
    },
    attachBufferedFallback,
    setMode: nextMode => {
      mode = nextMode
    },
    setCleanup: cleanup => {
      cdpCleanup = cleanup
    },
  })

  return {
    ready() {
      return assertObserverReady({
        initPromise,
        mode: () => mode,
        requireLive: options.requireLive === true,
        unsupportedReason: () => unsupportedReason,
      })
    },
    stop(timeoutMs) {
      if (stopPromise) {
        return stopPromise
      }

      stopPromise = settleObservedGenerations({
        initPromise,
        page,
        timeoutMs,
        pending,
        captures,
        activeRequests,
        getState: () => ({
          captureCount: captures.length,
          pendingCount: pending.size + activeRequests.size,
          sawActivity:
            captures.length > 0 || pending.size > 0 || activeRequests.size > 0 || liveInputCount > 0,
          liveInputCount,
          unsupportedReason,
        }),
        cleanup: async () => {
          if (bufferedFallbackListener) {
            page.off('response', bufferedFallbackListener)
            bufferedFallbackListener = null
          }
          if (cdpCleanup) {
            await cdpCleanup()
            cdpCleanup = null
          }
        },
        requireLive: options.requireLive === true,
        getMode: () => mode,
        getUnsupportedReason: () => unsupportedReason,
        getFatalLiveCaptureError: () => fatalLiveCaptureError,
      })
      return stopPromise
    },
    getState() {
      return {
        captureCount: captures.length,
        pendingCount: pending.size + activeRequests.size,
        sawActivity:
          captures.length > 0 || pending.size > 0 || activeRequests.size > 0 || liveInputCount > 0,
        liveInputCount,
        unsupportedReason,
      }
    },
  }
}

export function summarizeObservedDeepSeekGenerationRuns(input: {
  captures: DeepSeekCapturedGenerationResponse[]
  routeUrl?: string | null
}): DeepSeekObservedGenerationRun[] {
  return parseObservedDeepSeekGenerationRuns(input).map(parsedRun => ({
    endpoint: parsedRun.endpoint,
    transport: parsedRun.transport,
    routeUrl: parsedRun.routeUrl,
    context: { ...parsedRun.context },
    finalized: parsedRun.finalized,
    eventCount: parsedRun.events.length,
    unknownObservationCount: parsedRun.unknownObservationCount,
    unknownObservationLabels: [...parsedRun.unknownObservationLabels],
  }))
}

export function parseObservedDeepSeekGenerationRuns(input: {
  captures: DeepSeekCapturedGenerationResponse[]
  routeUrl?: string | null
}): DeepSeekParsedGenerationRun[] {
  return input.captures.map(capture => {
    const exchange = input.routeUrl
      ? {
          ...capture.exchange,
          routeUrl: input.routeUrl,
        }
      : capture.exchange
    const parsed = parseDeepSeekGenerationCapturedExchange(exchange)
    const accumulator = createGenerationRunAccumulator({
      context: parsed.context,
    })
    accumulator.pushMany(parsed.events)
    const finalized = accumulator.seal()

    return {
      endpoint: exchange.endpoint,
      transport: parsed.transport,
      routeUrl: exchange.routeUrl ?? null,
      context: { ...parsed.context },
      events: parsed.events.map(event => ({ ...event })),
      finalized,
      unknownObservations: parsed.unknownObservations.map(item => ({
        ...item,
      })),
      unknownObservationCount: parsed.unknownObservations.length,
      unknownObservationLabels: [...new Set(parsed.unknownObservations.map(item => item.label))],
    }
  })
}

export function extractObservedGenerationObservations(
  captures: DeepSeekCapturedGenerationResponse[],
) {
  return captures.map(capture => capture.observation)
}

export function sumObservedGenerationOutputTokens(
  captures: DeepSeekCapturedGenerationResponse[],
): number {
  return sumDeepSeekObservedOutputTokens(extractObservedGenerationObservations(captures))
}

async function initializeGenerationObserver(input: {
  createLiveSessionFactory: PageScopedCdpSessionFactory | null
  page: Page
  captures: DeepSeekCapturedGenerationResponse[]
  activeRequests: Map<string, ObservedGenerationRequestState>
  trackPendingTask: (taskFactory: () => Promise<void>) => void
  onIncrementalInput: (input: DeepSeekGenerationIncrementalInput) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
  markUnsupported: (reason: string) => void
  setFatalLiveCaptureError: (error: Error) => void
  attachBufferedFallback: () => void
  setMode: (mode: 'cdp-live' | 'buffered-fallback') => void
  setCleanup: (cleanup: () => Promise<void>) => void
}): Promise<void> {
  if (!input.createLiveSessionFactory) {
    input.markUnsupported(
      'Page-scoped CDP session is unavailable for this runtime; falling back to buffered response capture.',
    )
    input.attachBufferedFallback()
    return
  }

  try {
    const session = await input.createLiveSessionFactory()
    await session.send('Network.enable', {
      maxPostDataSize: GENERATION_OBSERVER_MAX_POST_DATA_SIZE,
    })
    const cleanup = attachLiveGenerationCapture({
      session,
      captures: input.captures,
      activeRequests: input.activeRequests,
      trackPendingTask: input.trackPendingTask,
      onIncrementalInput: input.onIncrementalInput,
      onIncrementalEvent: input.onIncrementalEvent,
      markUnsupported: input.markUnsupported,
      setFatalLiveCaptureError: input.setFatalLiveCaptureError,
    })
    input.setMode('cdp-live')
    input.setCleanup(cleanup)
  } catch (error) {
    input.markUnsupported(
      `${describeObserverError(error)} Falling back to buffered response capture.`,
    )
    input.attachBufferedFallback()
  }
}

function attachLiveGenerationCapture(input: {
  session: CDPSession
  captures: DeepSeekCapturedGenerationResponse[]
  activeRequests: Map<string, ObservedGenerationRequestState>
  trackPendingTask: (taskFactory: () => Promise<void>) => void
  onIncrementalInput: (input: DeepSeekGenerationIncrementalInput) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
  markUnsupported: (reason: string) => void
  setFatalLiveCaptureError: (error: Error) => void
}): () => Promise<void> {
  const onRequestWillBeSent = (event: Protocol.Network.RequestWillBeSentEvent) => {
    const endpoint = matchDeepSeekGenerationEndpoint(event.request.url)
    if (!endpoint) {
      return
    }

    const requestState = getOrCreateObservedGenerationRequest(
      input.activeRequests,
      event.requestId,
      endpoint,
      event.request.url,
    )
    requestState.requestMethod = event.request.method
    requestState.requestUrl = event.request.url
    requestState.requestPostData =
      typeof event.request.postData === 'string' ? event.request.postData : null
  }

  const onResponseReceived = (event: Protocol.Network.ResponseReceivedEvent) => {
    const endpoint = matchDeepSeekGenerationEndpoint(event.response.url)
    if (!endpoint) {
      return
    }

    const requestState = getOrCreateObservedGenerationRequest(
      input.activeRequests,
      event.requestId,
      endpoint,
      event.response.url,
    )
    requestState.responseStatus = event.response.status
    requestState.responseContentType = readProtocolHeader(event.response.headers, 'content-type')
    ensureObservedGenerationIncrementalParser(requestState)

    if (requestState.streamInitPromise) {
      return
    }

    requestState.streamInitPromise = (async () => {
      try {
        const streamed = await input.session.send('Network.streamResourceContent', {
          requestId: event.requestId,
        })
        if (streamed.bufferedData) {
          appendProtocolChunk({
            requestState,
            base64Chunk: streamed.bufferedData,
            source: 'buffered',
            onIncrementalInput: input.onIncrementalInput,
            onIncrementalEvent: input.onIncrementalEvent,
          })
        }
      } catch (error) {
        const failureReason = `Network.streamResourceContent failed for ${requestState.endpoint}: ${describeObserverError(error)}`
        const recovered = isFinishedLoadingStreamInitError(error)
          ? await recoverObservedGenerationBody({
              session: input.session,
              requestState,
              failureReason,
              onIncrementalInput: input.onIncrementalInput,
              onIncrementalEvent: input.onIncrementalEvent,
            })
          : false
        if (!recovered) {
          const failure = buildUnsupportedLiveCaptureError(failureReason)
          requestState.unsupportedReason = failure.message
          input.markUnsupported(failure.message)
          input.setFatalLiveCaptureError(failure)
        }
      } finally {
        requestState.streamInitSettled = true
        flushQueuedProtocolChunks({
          requestState,
          onIncrementalInput: input.onIncrementalInput,
          onIncrementalEvent: input.onIncrementalEvent,
        })
      }
    })()
    input.trackPendingTask(async () => {
      await requestState.streamInitPromise
    })
  }

  const onDataReceived = (event: Protocol.Network.DataReceivedEvent) => {
    const requestState = input.activeRequests.get(event.requestId)
    if (!requestState || typeof event.data !== 'string' || !event.data) {
      return
    }

    if (!requestState.streamInitSettled) {
      requestState.queuedBase64Chunks.push(event.data)
      return
    }

    appendProtocolChunk({
      requestState,
      base64Chunk: event.data,
      source: 'live',
      onIncrementalInput: input.onIncrementalInput,
      onIncrementalEvent: input.onIncrementalEvent,
    })
  }

  const onLoadingFinished = (event: Protocol.Network.LoadingFinishedEvent) => {
    const requestState = input.activeRequests.get(event.requestId)
    if (!requestState) {
      return
    }

    input.trackPendingTask(async () => {
      await finalizeObservedGenerationRequest({
        requestState,
        captures: input.captures,
        activeRequests: input.activeRequests,
        markUnsupported: input.markUnsupported,
        onIncrementalEvent: input.onIncrementalEvent,
      })
    })
  }

  const onLoadingFailed = (event: Protocol.Network.LoadingFailedEvent) => {
    const requestState = input.activeRequests.get(event.requestId)
    if (!requestState) {
      return
    }

    input.trackPendingTask(async () => {
      await finalizeObservedGenerationRequest({
        requestState,
        captures: input.captures,
        activeRequests: input.activeRequests,
        markUnsupported: input.markUnsupported,
        onIncrementalEvent: input.onIncrementalEvent,
      })
    })
  }

  input.session.on('Network.requestWillBeSent', onRequestWillBeSent)
  input.session.on('Network.responseReceived', onResponseReceived)
  input.session.on('Network.dataReceived', onDataReceived)
  input.session.on('Network.loadingFinished', onLoadingFinished)
  input.session.on('Network.loadingFailed', onLoadingFailed)

  return async () => {
    input.session.off('Network.requestWillBeSent', onRequestWillBeSent)
    input.session.off('Network.responseReceived', onResponseReceived)
    input.session.off('Network.dataReceived', onDataReceived)
    input.session.off('Network.loadingFinished', onLoadingFinished)
    input.session.off('Network.loadingFailed', onLoadingFailed)
    await input.session.detach().catch(() => {})
  }
}

async function finalizeObservedGenerationRequest(input: {
  requestState: ObservedGenerationRequestState
  captures: DeepSeekCapturedGenerationResponse[]
  activeRequests: Map<string, ObservedGenerationRequestState>
  markUnsupported: (reason: string) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
}): Promise<void> {
  const requestState = input.requestState
  if (requestState.finalized) {
    return
  }

  requestState.finalized = true
  if (requestState.streamInitPromise) {
    await requestState.streamInitPromise
  }

  const tail = requestState.textDecoder.decode()
  if (tail) {
    requestState.bodyText += tail
    emitObservedGenerationCanonicalEvents({
      requestState,
      source: 'finalize',
      events:
        requestState.incrementalParser?.pushBodyChunk(tail).events ?? [],
      onIncrementalEvent: input.onIncrementalEvent,
    })
  }

  if (requestState.incrementalParser) {
    const finalized = requestState.incrementalParser.finalize()
    emitObservedGenerationCanonicalEvents({
      requestState,
      source: 'finalize',
      events: finalized.newEvents,
      onIncrementalEvent: input.onIncrementalEvent,
    })
  }

  if (
    requestState.responseContentType?.includes('text/event-stream') &&
    requestState.liveInputCount === 0
  ) {
    requestState.unsupportedReason =
      requestState.unsupportedReason ??
      `Streaming response for ${requestState.endpoint} completed without any live Network.dataReceived payloads.`
    input.markUnsupported(requestState.unsupportedReason)
  }

  const exchange = buildObservedGenerationCapturedExchange(requestState)
  const observation = createDeepSeekGenerationObservation({
    endpoint: exchange.endpoint,
    url: exchange.request.url,
    status: exchange.response.status,
    contentType: exchange.response.contentType,
    payloadText: exchange.response.bodyText,
    requestPostData: exchange.request.postData,
  })

  input.captures.push({
    observation,
    exchange,
  })
  input.activeRequests.delete(requestState.requestId)
}

function getOrCreateObservedGenerationRequest(
  activeRequests: Map<string, ObservedGenerationRequestState>,
  requestId: string,
  endpoint: DeepSeekGenerationCapturedExchange['endpoint'],
  requestUrl: string,
): ObservedGenerationRequestState {
  const existing = activeRequests.get(requestId)
  if (existing) {
    return existing
  }

  const created: ObservedGenerationRequestState = {
    requestId,
    endpoint,
    requestUrl,
    requestMethod: 'POST',
    requestPostData: null,
    responseStatus: null,
    responseContentType: null,
    bodyText: '',
    textDecoder: new TextDecoder(),
    queuedBase64Chunks: [],
    streamInitPromise: null,
    streamInitSettled: false,
    liveInputCount: 0,
    finalized: false,
    unsupportedReason: null,
    incrementalParser: null,
  }
  activeRequests.set(requestId, created)
  return created
}

function flushQueuedProtocolChunks(input: {
  requestState: ObservedGenerationRequestState
  onIncrementalInput: (input: DeepSeekGenerationIncrementalInput) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
}): void {
  if (input.requestState.queuedBase64Chunks.length === 0) {
    return
  }

  const queued = [...input.requestState.queuedBase64Chunks]
  input.requestState.queuedBase64Chunks = []
  for (const chunk of queued) {
    appendProtocolChunk({
      requestState: input.requestState,
      base64Chunk: chunk,
      source: 'live',
      onIncrementalInput: input.onIncrementalInput,
      onIncrementalEvent: input.onIncrementalEvent,
    })
  }
}

function appendProtocolChunk(input: {
  requestState: ObservedGenerationRequestState
  base64Chunk: string
  source: DeepSeekGenerationIncrementalInput['source']
  onIncrementalInput: (input: DeepSeekGenerationIncrementalInput) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
}): void {
  if (!input.base64Chunk) {
    return
  }

  const chunkText = input.requestState.textDecoder.decode(Buffer.from(input.base64Chunk, 'base64'), {
    stream: true,
  })
  appendObservedBodyText({
    requestState: input.requestState,
    chunkText,
    source: input.source,
    onIncrementalInput: input.onIncrementalInput,
    onIncrementalEvent: input.onIncrementalEvent,
  })
}

function appendObservedBodyText(input: {
  requestState: ObservedGenerationRequestState
  chunkText: string
  source: DeepSeekGenerationIncrementalInput['source']
  onIncrementalInput: (input: DeepSeekGenerationIncrementalInput) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
}): void {
  const { chunkText } = input
  if (!chunkText) {
    return
  }

  const incrementalParser = ensureObservedGenerationIncrementalParser(input.requestState)
  input.requestState.bodyText += chunkText
  if (input.source === 'live') {
    input.requestState.liveInputCount += 1
  }
  input.onIncrementalInput({
    requestId: input.requestState.requestId,
    endpoint: input.requestState.endpoint,
    source: input.source,
    chunkText,
    accumulatedBodyText: input.requestState.bodyText,
    request: buildObservedGenerationRequestSnapshot(input.requestState),
    response: buildObservedGenerationResponseSnapshot(input.requestState),
  })

  emitObservedGenerationCanonicalEvents({
    requestState: input.requestState,
    source: input.source,
    events: incrementalParser.pushBodyChunk(chunkText).events,
    onIncrementalEvent: input.onIncrementalEvent,
  })
}

function buildObservedGenerationCapturedExchange(
  requestState: ObservedGenerationRequestState,
): DeepSeekGenerationCapturedExchange {
  return {
    endpoint: requestState.endpoint,
    request: buildObservedGenerationRequestSnapshot(requestState),
    response: {
      ...buildObservedGenerationResponseSnapshot(requestState),
      bodyText: requestState.bodyText,
    },
  }
}

function ensureObservedGenerationIncrementalParser(
  requestState: ObservedGenerationRequestState,
): DeepSeekGenerationIncrementalParser {
  if (requestState.incrementalParser) {
    return requestState.incrementalParser
  }

  requestState.incrementalParser = createDeepSeekIncrementalGenerationParser({
    endpoint: requestState.endpoint,
    request: buildObservedGenerationRequestSnapshot(requestState),
    response: {
      ...buildObservedGenerationResponseSnapshot(requestState),
      bodyText: '',
    },
  })
  return requestState.incrementalParser
}

function buildObservedGenerationRequestSnapshot(
  requestState: ObservedGenerationRequestState,
): DeepSeekGenerationCapturedExchange['request'] {
  return {
    method: requestState.requestMethod,
    url: requestState.requestUrl,
    postData: requestState.requestPostData,
  }
}

function buildObservedGenerationResponseSnapshot(
  requestState: ObservedGenerationRequestState,
): Omit<DeepSeekGenerationCapturedExchange['response'], 'bodyText'> {
  return {
    status: requestState.responseStatus ?? 0,
    contentType: requestState.responseContentType,
  }
}

function emitObservedGenerationCanonicalEvents(input: {
  requestState: ObservedGenerationRequestState
  source: DeepSeekGenerationIncrementalEvent['source']
  events: DeepSeekGenerationStreamEvent[]
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
}): void {
  for (const event of input.events) {
    input.onIncrementalEvent({
      requestId: input.requestState.requestId,
      endpoint: input.requestState.endpoint,
      source: input.source,
      event: { ...event },
    })
  }
}

async function recoverObservedGenerationBody(input: {
  session: CDPSession
  requestState: ObservedGenerationRequestState
  failureReason: string
  onIncrementalInput: (input: DeepSeekGenerationIncrementalInput) => void
  onIncrementalEvent: (event: DeepSeekGenerationIncrementalEvent) => void
}): Promise<boolean> {
  try {
    const responseBody = await input.session.send('Network.getResponseBody', {
      requestId: input.requestState.requestId,
    }) as { body?: unknown; base64Encoded?: unknown }
    if (typeof responseBody.body !== 'string' || responseBody.body.length === 0) {
      return false
    }
    const chunkText =
      responseBody.base64Encoded === true
        ? Buffer.from(responseBody.body, 'base64').toString('utf8')
        : responseBody.body
    input.requestState.queuedBase64Chunks = []
    input.requestState.unsupportedReason = buildUnsupportedLiveCaptureError(
      `${input.failureReason} Recovered the finalized response body via Network.getResponseBody.`,
    ).message
    appendObservedBodyText({
      requestState: input.requestState,
      chunkText,
      source: 'buffered',
      onIncrementalInput: input.onIncrementalInput,
      onIncrementalEvent: input.onIncrementalEvent,
    })
    return true
  } catch {
    return false
  }
}

async function assertObserverReady(input: {
  initPromise: Promise<void>
  mode: () => 'pending' | 'cdp-live' | 'buffered-fallback'
  requireLive: boolean
  unsupportedReason: () => string | null
}): Promise<void> {
  await input.initPromise

  if (!input.requireLive || input.mode() === 'cdp-live') {
    return
  }

  throw buildUnsupportedLiveCaptureError(
    input.unsupportedReason() ??
      'Page-scoped CDP live generation capture is unavailable for this runtime.',
  )
}

async function settleObservedGenerations(input: {
  initPromise: Promise<void>
  page: Page
  timeoutMs?: number | undefined
  pending: Set<Promise<void>>
  captures: DeepSeekCapturedGenerationResponse[]
  activeRequests: Map<string, ObservedGenerationRequestState>
  getState: () => DeepSeekGenerationObserverState
  cleanup: () => Promise<void>
  requireLive: boolean
  getMode: () => 'pending' | 'cdp-live' | 'buffered-fallback'
  getUnsupportedReason: () => string | null
  getFatalLiveCaptureError: () => Error | null
}): Promise<DeepSeekCapturedGenerationResponse[]> {
  const stopStartedAt = Date.now()
  await input.initPromise
  await waitForObservedGenerations({
    getState: input.getState,
    timeoutMs: input.timeoutMs,
  })
  await input.cleanup()

  const pendingTasks = [...input.pending]
  if (pendingTasks.length > 0) {
    const remainingTimeoutMs = resolveGenerationObserverTimeoutRemaining({
      timeoutMs: input.timeoutMs,
      startedAt: stopStartedAt,
    })
    if (remainingTimeoutMs !== null) {
      await Promise.race([
        Promise.allSettled(pendingTasks),
        delay(remainingTimeoutMs),
      ])
    } else {
      await Promise.allSettled(pendingTasks)
    }
  }

  const fatalLiveCaptureError = input.getFatalLiveCaptureError()
  if (fatalLiveCaptureError) {
    throw fatalLiveCaptureError
  }

  if (input.requireLive && input.getMode() !== 'cdp-live') {
    throw buildUnsupportedLiveCaptureError(
      input.getUnsupportedReason() ??
        'Page-scoped CDP live generation capture is unavailable for this runtime.',
    )
  }

  if (input.requireLive && input.getUnsupportedReason()) {
    throw buildUnsupportedLiveCaptureError(input.getUnsupportedReason() as string)
  }

  return input.captures.map(cloneCapturedGenerationResponse)
}

async function waitForObservedGenerations(input: {
  getState: () => DeepSeekGenerationObserverState
  timeoutMs?: number | undefined
}): Promise<void> {
  const timeoutMs =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? input.timeoutMs
      : GENERATION_OBSERVER_DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let state = input.getState()
  let sawActivity = state.sawActivity
  let lastFingerprint = buildGenerationObserverFingerprint(state)
  let lastActivityAt = Date.now()

  while (Date.now() < deadline) {
    state = input.getState()
    const fingerprint = buildGenerationObserverFingerprint(state)
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint
      lastActivityAt = Date.now()
      sawActivity = true
    }

    if (
      sawActivity &&
      state.pendingCount === 0 &&
      Date.now() - lastActivityAt >= GENERATION_OBSERVER_QUIET_WINDOW_MS
    ) {
      return
    }

    await delay(Math.min(GENERATION_OBSERVER_POLL_INTERVAL_MS, deadline - Date.now()))
  }
}

async function captureDeepSeekGenerationResponse(
  response: HTTPResponse,
): Promise<DeepSeekCapturedGenerationResponse | null> {
  const endpoint = matchDeepSeekGenerationEndpoint(response.url())
  if (!endpoint) {
    return null
  }
  const exchange = await extractDeepSeekGenerationCapturedExchange(response, endpoint)
  const observation = createDeepSeekGenerationObservation({
    endpoint,
    url: exchange.request.url,
    status: exchange.response.status,
    contentType: exchange.response.contentType,
    payloadText: exchange.response.bodyText,
    requestPostData: exchange.request.postData,
  })
  return {
    observation,
    exchange,
  }
}

async function extractDeepSeekGenerationCapturedExchange(
  response: HTTPResponse,
  endpoint: DeepSeekGenerationCapturedExchange['endpoint'],
): Promise<DeepSeekGenerationCapturedExchange> {
  const request = response.request()
  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch {
    bodyText = ''
  }

  return {
    endpoint,
    request: {
      method: request.method(),
      url: request.url(),
      postData: request.postData() ?? null,
    },
    response: {
      status: response.status(),
      contentType: response.headers()['content-type'] ?? null,
      bodyText,
    },
  }
}

function resolvePageScopedCdpSessionFactory(page: Page): PageScopedCdpSessionFactory | null {
  const pageWithTarget = page as unknown as {
    target?: (() => { createCDPSession?: (() => Promise<CDPSession>) | undefined }) | undefined
    context?: (() => { newCDPSession?: ((page: unknown) => Promise<CDPSession>) | undefined }) | undefined
  }

  const target = typeof pageWithTarget.target === 'function' ? pageWithTarget.target() : null
  if (target && typeof target.createCDPSession === 'function') {
    const createTargetSession = target.createCDPSession.bind(target)
    return () => createTargetSession()
  }

  const context = typeof pageWithTarget.context === 'function' ? pageWithTarget.context() : null
  if (context && typeof context.newCDPSession === 'function') {
    const createContextSession = context.newCDPSession.bind(context)
    return () => createContextSession(page)
  }

  return null
}

function isDeepSeekGenerationRequestUrl(url: string): boolean {
  return matchDeepSeekGenerationEndpoint(url) !== null
}

function matchDeepSeekGenerationEndpoint(
  url: string,
): DeepSeekGenerationCapturedExchange['endpoint'] | null {
  try {
    const parsedUrl = new URL(url)
    return DEEPSEEK_GENERATION_REQUEST_ENDPOINTS.has(parsedUrl.pathname)
      ? parsedUrl.pathname as DeepSeekGenerationCapturedExchange['endpoint']
      : null
  } catch {
    return null
  }
}

function cloneCapturedGenerationResponse(
  capture: DeepSeekCapturedGenerationResponse,
): DeepSeekCapturedGenerationResponse {
  return {
    observation: {
      ...capture.observation,
    },
    exchange: {
      ...capture.exchange,
      request: {
        ...capture.exchange.request,
      },
      response: {
        ...capture.exchange.response,
      },
    },
  }
}

function buildGenerationObserverFingerprint(state: DeepSeekGenerationObserverState): string {
  return [
    state.captureCount,
    state.pendingCount,
    state.liveInputCount,
    state.unsupportedReason ?? '',
  ].join(':')
}

function resolveGenerationObserverTimeoutRemaining(input: {
  timeoutMs: number | undefined
  startedAt: number
}): number | null {
  if (typeof input.timeoutMs !== 'number' || input.timeoutMs <= 0) {
    return null
  }

  return Math.max(input.timeoutMs - (Date.now() - input.startedAt), 0)
}

function readProtocolHeader(
  headers: Protocol.Network.Headers,
  targetName: string,
): string | null {
  const normalizedTarget = targetName.toLowerCase()
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== normalizedTarget) {
      continue
    }
    return typeof value === 'string' ? value : String(value)
  }
  return null
}

function buildUnsupportedLiveCaptureError(reason: string): Error {
  return new Error(
    `DeepSeek generation live capture is unavailable: ${reason}`,
  )
}

function isFinishedLoadingStreamInitError(error: unknown): boolean {
  const message = describeObserverError(error)
  return message.includes('Request with the provided ID has already finished loading')
}

function describeObserverError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Unknown observer failure.'
}
