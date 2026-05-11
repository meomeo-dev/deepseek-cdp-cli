import { setTimeout as delay } from 'node:timers/promises'
import type { HTTPResponse, Page } from 'puppeteer-core'
import { createGenerationRunAccumulator } from './generationRunAccumulator.js'
import { parseDeepSeekGenerationCapturedExchange } from './deepSeekGenerationStreamParser.js'
import type { DeepSeekParsedGenerationRun } from '../../types/deepseek-generation.types.js'
import type { DeepSeekGenerationCapturedExchange } from '../../types/deepseek-generation-parser.types.js'
import type { DeepSeekHistoryMessagesCapturedExchange } from '../../types/deepseek-history-messages.types.js'
import type { DeepSeekGenerationErrorDetail } from '../../types/deepseek-stream.types.js'
import type {
  DeepSeekGenerationSettlement,
  DeepSeekObservedStreamControl,
  DeepSeekResumableCandidate,
  DeepSeekResumeStreamObservation,
  DeepSeekStopStreamObservation,
  DeepSeekStreamControlCapturedExchange,
  DeepSeekStreamControlEndpoint,
  DeepSeekStreamControlSettlementInput,
} from '../../types/deepseek-stream-control.types.js'

const STREAM_CONTROL_ENDPOINTS = new Set<DeepSeekStreamControlEndpoint>([
  '/api/v0/chat/stop_stream',
  '/api/v0/chat/resume_stream',
])
const STREAM_CONTROL_OBSERVER_POLL_INTERVAL_MS = 25
const STREAM_CONTROL_OBSERVER_QUIET_WINDOW_MS = 75
const STREAM_CONTROL_OBSERVER_DEFAULT_TIMEOUT_MS = 1_000

export interface DeepSeekStreamControlObserver {
  stop: (timeoutMs?: number) => Promise<DeepSeekStreamControlCapturedExchange[]>
}

export function observeDeepSeekStreamControlResponses(page: Page): DeepSeekStreamControlObserver {
  const captures: DeepSeekStreamControlCapturedExchange[] = []
  const pending = new Set<Promise<void>>()
  let stopPromise: Promise<DeepSeekStreamControlCapturedExchange[]> | null = null

  const onResponse = (response: HTTPResponse) => {
    if (!isDeepSeekStreamControlUrl(response.url())) {
      return
    }

    const task = captureDeepSeekStreamControlResponse(response)
      .then(capture => {
        if (capture) {
          captures.push(capture)
        }
      })
      .finally(() => {
        pending.delete(task)
      })

    pending.add(task)
  }

  page.on('response', onResponse)

  return {
    stop(timeoutMs) {
      if (stopPromise) {
        return stopPromise
      }

      stopPromise = settleObservedStreamControls({
        page,
        onResponse,
        pending,
        captures,
        timeoutMs,
      })
      return stopPromise
    },
  }
}

export function summarizeObservedDeepSeekStreamControls(input: {
  captures: DeepSeekStreamControlCapturedExchange[]
  routeUrl?: string | null
}): DeepSeekObservedStreamControl[] {
  return input.captures.map(capture =>
    input.routeUrl === undefined
      ? summarizeDeepSeekStreamControlCapture({
          capture,
        })
      : summarizeDeepSeekStreamControlCapture({
          capture,
          routeUrl: input.routeUrl,
        }),
  )
}

export function summarizeDeepSeekStreamControlCapture(input: {
  capture: DeepSeekStreamControlCapturedExchange
  routeUrl?: string | null
}): DeepSeekObservedStreamControl {
  const routeUrl = input.routeUrl ?? input.capture.routeUrl ?? null

  if (input.capture.endpoint === '/api/v0/chat/stop_stream') {
    return summarizeStopStreamCapture(input.capture, routeUrl)
  }

  return summarizeResumeStreamCapture(input.capture, routeUrl)
}

export function inferDeepSeekResumableCandidateFromHistoryCapture(
  capture: DeepSeekHistoryMessagesCapturedExchange | null | undefined,
): DeepSeekResumableCandidate | null {
  if (!capture) {
    return null
  }

  const payload = parseJsonIfPossible(capture.response.bodyText)
  if (!isRecord(payload)) {
    return null
  }

  const messages = extractHistoryMessageRecords(payload)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || readOptionalString(message, 'role')?.toUpperCase() !== 'ASSISTANT') {
      continue
    }

    if (!isHistoryMessageResumable(message)) {
      continue
    }

    const assistantMessageId =
      stringifyNullableNumber(message['message_id']) ??
      readOptionalString(message, 'message_id') ??
      readOptionalString(message, 'id')
    if (!assistantMessageId) {
      continue
    }

    return {
      sessionId: capture.sessionId,
      assistantMessageId,
      status: readOptionalString(message, 'status')?.toUpperCase() ?? 'UNKNOWN',
      source: 'history_messages',
    }
  }

  return null
}

export function judgeDeepSeekGenerationSettlement(
  input: DeepSeekStreamControlSettlementInput,
): DeepSeekGenerationSettlement {
  const generationRuns = [...(input.generationRuns ?? [])]
  const streamControls = [...(input.streamControls ?? [])]
  const stopAck = findLatestStopAck(streamControls)
  const resumeRuns: DeepSeekParsedGenerationRun[] = streamControls.flatMap(control =>
    control.endpoint === '/api/v0/chat/resume_stream' && control.run !== null ? [control.run] : [],
  )
  const terminalRuns = [...generationRuns, ...resumeRuns]
  const latestCompletedRun = findLatestRunWithStatus(terminalRuns, 'completed')
  if (latestCompletedRun && isStopAwareCompletedRun(latestCompletedRun, stopAck)) {
    return {
      status: 'stopped',
      source: stopAck ? 'stop_stream' : latestCompletedRun.endpoint === '/api/v0/chat/resume_stream'
        ? 'resume_stream'
        : 'generation',
      sessionId: stopAck?.sessionId ?? latestCompletedRun.context.sessionId,
      assistantMessageId:
        stopAck?.messageId ?? latestCompletedRun.context.assistantMessageId,
      finalized: cloneFinalized(latestCompletedRun.finalized),
      stopAcknowledged: Boolean(stopAck),
      resumable: null,
      error: cloneError(latestCompletedRun.finalized.error),
    }
  }

  const latestStoppedRun = findLatestRunWithStatus(terminalRuns, 'stopped')
  if (latestStoppedRun || stopAck) {
    return {
      status: 'stopped',
      source: stopAck ? 'stop_stream' : latestStoppedRun?.endpoint === '/api/v0/chat/resume_stream'
        ? 'resume_stream'
        : 'generation',
      sessionId: stopAck?.sessionId ?? latestStoppedRun?.context.sessionId ?? null,
      assistantMessageId:
        stopAck?.messageId ?? latestStoppedRun?.context.assistantMessageId ?? null,
      finalized: latestStoppedRun ? cloneFinalized(latestStoppedRun.finalized) : null,
      stopAcknowledged: Boolean(stopAck),
      resumable: null,
      error: latestStoppedRun ? cloneError(latestStoppedRun.finalized.error) : null,
    }
  }

  if (latestCompletedRun) {
    return {
      status: 'completed',
      source:
        latestCompletedRun.endpoint === '/api/v0/chat/resume_stream'
          ? 'resume_stream'
          : 'generation',
      sessionId: latestCompletedRun.context.sessionId,
      assistantMessageId: latestCompletedRun.context.assistantMessageId,
      finalized: cloneFinalized(latestCompletedRun.finalized),
      stopAcknowledged: hasStopAck(streamControls),
      resumable: null,
      error: cloneError(latestCompletedRun.finalized.error),
    }
  }

  const latestFailedRun = findLatestRunWithStatus(terminalRuns, 'failed')
  if (latestFailedRun) {
    return {
      status: 'failed',
      source:
        latestFailedRun.endpoint === '/api/v0/chat/resume_stream'
          ? 'resume_stream'
          : 'generation',
      sessionId: latestFailedRun.context.sessionId,
      assistantMessageId: latestFailedRun.context.assistantMessageId,
      finalized: cloneFinalized(latestFailedRun.finalized),
      stopAcknowledged: hasStopAck(streamControls),
      resumable: null,
      error: cloneError(latestFailedRun.finalized.error),
    }
  }

  const resumable =
    cloneResumableCandidate(input.resumableCandidate) ??
    inferDeepSeekResumableCandidateFromHistoryCapture(input.historyCapture)
  if (resumable) {
    return {
      status: 'resumable',
      source: resumable.source,
      sessionId: resumable.sessionId,
      assistantMessageId: resumable.assistantMessageId,
      finalized: null,
      stopAcknowledged: hasStopAck(streamControls),
      resumable: {
        ...resumable,
      },
      error: null,
    }
  }

  return {
    status: 'failed',
    source: 'generation',
    sessionId: null,
    assistantMessageId: null,
    finalized: null,
    stopAcknowledged: hasStopAck(streamControls),
    resumable: null,
    error: {
      code: null,
      message: 'No authoritative DeepSeek generation terminal signal was observed.',
      retryable: true,
    },
  }
}

async function settleObservedStreamControls(input: {
  page: Page
  onResponse: (response: HTTPResponse) => void
  pending: Set<Promise<void>>
  captures: DeepSeekStreamControlCapturedExchange[]
  timeoutMs?: number | undefined
}): Promise<DeepSeekStreamControlCapturedExchange[]> {
  const stopStartedAt = Date.now()
  await waitForObservedStreamControlResponses(input)
  input.page.off('response', input.onResponse)

  const pendingTasks = [...input.pending]
  if (pendingTasks.length > 0) {
    const remainingTimeoutMs = resolveObserverTimeoutRemaining({
      timeoutMs: input.timeoutMs,
      startedAt: stopStartedAt,
    })
    if (remainingTimeoutMs !== null) {
      await Promise.race([Promise.allSettled(pendingTasks), delay(remainingTimeoutMs)])
    } else {
      await Promise.allSettled(pendingTasks)
    }
  }

  return input.captures.map(cloneStreamControlCapture)
}

async function waitForObservedStreamControlResponses(input: {
  page: Page
  onResponse: (response: HTTPResponse) => void
  pending: Set<Promise<void>>
  captures: DeepSeekStreamControlCapturedExchange[]
  timeoutMs?: number | undefined
}): Promise<void> {
  const timeoutMs =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? input.timeoutMs
      : STREAM_CONTROL_OBSERVER_DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let sawActivity = input.captures.length > 0 || input.pending.size > 0
  let lastFingerprint = buildObserverFingerprint(input.captures.length, input.pending.size)
  let lastActivityAt = Date.now()

  while (Date.now() < deadline) {
    const fingerprint = buildObserverFingerprint(input.captures.length, input.pending.size)
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint
      lastActivityAt = Date.now()
      sawActivity = true
    }

    if (
      sawActivity &&
      input.pending.size === 0 &&
      Date.now() - lastActivityAt >= STREAM_CONTROL_OBSERVER_QUIET_WINDOW_MS
    ) {
      return
    }

    await delay(Math.min(STREAM_CONTROL_OBSERVER_POLL_INTERVAL_MS, deadline - Date.now()))
  }
}

async function captureDeepSeekStreamControlResponse(
  response: HTTPResponse,
): Promise<DeepSeekStreamControlCapturedExchange | null> {
  const endpoint = matchDeepSeekStreamControlEndpoint(response.url())
  if (!endpoint) {
    return null
  }

  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch {
    bodyText = ''
  }

  return {
    endpoint,
    request: {
      method: response.request().method(),
      url: response.request().url(),
      postData: response.request().postData() ?? null,
    },
    response: {
      status: response.status(),
      contentType: response.headers()['content-type'] ?? null,
      bodyText,
    },
  }
}

function summarizeStopStreamCapture(
  capture: DeepSeekStreamControlCapturedExchange,
  routeUrl: string | null,
): DeepSeekStopStreamObservation {
  const requestPayload = parseJsonIfPossible(capture.request.postData)
  const requestRecord = isRecord(requestPayload) ? requestPayload : null
  const responsePayload = parseJsonIfPossible(capture.response.bodyText)
  const responseRecord = isRecord(responsePayload) ? responsePayload : null
  const responseData = readRecord(readRecord(responseRecord, 'data'), 'biz_data')
  const responseContainer = readRecord(responseRecord, 'data')
  const code = readPrimitiveString(responseRecord?.['code'])
  const bizCode = readPrimitiveString(responseContainer?.['biz_code'])
  const acknowledged =
    capture.response.status >= 200 &&
    capture.response.status < 300 &&
    (code === null || code === '0') &&
    (bizCode === null || bizCode === '0') &&
    (responseData === null || responseData === undefined || isRecord(responseData))

  return {
    endpoint: '/api/v0/chat/stop_stream',
    transport: 'json',
    routeUrl,
    requestUrl: capture.request.url,
    status: capture.response.status,
    sessionId: readOptionalString(requestRecord, 'chat_session_id'),
    messageId:
      stringifyNullableNumber(requestRecord?.['message_id']) ??
      readOptionalString(requestRecord, 'message_id'),
    acknowledged,
    error: acknowledged
      ? null
      : {
          code: bizCode ?? code,
          message:
            readOptionalString(responseContainer, 'biz_msg') ??
            readOptionalString(responseRecord, 'msg') ??
            'DeepSeek stop_stream failed.',
          retryable: capture.response.status >= 500 || capture.response.status === 429,
        },
  }
}

function summarizeResumeStreamCapture(
  capture: DeepSeekStreamControlCapturedExchange,
  routeUrl: string | null,
): DeepSeekResumeStreamObservation {
  const requestPayload = parseJsonIfPossible(capture.request.postData)
  const requestRecord = isRecord(requestPayload) ? requestPayload : null
  const run = parseResumeStreamRun(capture, routeUrl)
  const transport = run?.transport ?? inferTransport(capture.response.contentType)
  const error = !run && capture.response.status >= 400
    ? parseNonStreamError(capture.response)
    : run?.finalized.error ?? null

  return {
    endpoint: '/api/v0/chat/resume_stream',
    transport,
    routeUrl,
    requestUrl: capture.request.url,
    status: capture.response.status,
    sessionId: readOptionalString(requestRecord, 'chat_session_id'),
    messageId:
      stringifyNullableNumber(requestRecord?.['message_id']) ??
      readOptionalString(requestRecord, 'message_id'),
    run,
    acknowledged:
      capture.response.status >= 200 &&
      capture.response.status < 300 &&
      transport === 'sse',
    error: cloneError(error),
  }
}

function parseResumeStreamRun(
  capture: DeepSeekStreamControlCapturedExchange,
  routeUrl: string | null,
): DeepSeekParsedGenerationRun | null {
  const exchange: DeepSeekGenerationCapturedExchange = {
    endpoint: '/api/v0/chat/resume_stream',
    routeUrl,
    request: {
      method: capture.request.method,
      url: capture.request.url,
      postData: capture.request.postData,
    },
    response: {
      status: capture.response.status,
      contentType: capture.response.contentType,
      bodyText: capture.response.bodyText,
    },
  }
  const parsed = parseDeepSeekGenerationCapturedExchange(exchange)
  if (parsed.transport !== 'sse' && capture.response.status >= 200 && capture.response.status < 300) {
    return null
  }

  const accumulator = createGenerationRunAccumulator({
    context: parsed.context,
  })
  accumulator.pushMany(parsed.events)
  const finalized = accumulator.seal()

  return {
    endpoint: exchange.endpoint,
    transport: parsed.transport,
    routeUrl,
    context: { ...parsed.context },
    events: parsed.events.map(event => ({ ...event })),
    finalized,
    unknownObservations: parsed.unknownObservations.map(observation => ({
      ...observation,
    })),
    unknownObservationCount: parsed.unknownObservations.length,
    unknownObservationLabels: [...new Set(parsed.unknownObservations.map(item => item.label))],
  }
}

function parseNonStreamError(response: {
  status: number
  bodyText: string
}): DeepSeekGenerationErrorDetail | null {
  const payload = parseJsonIfPossible(response.bodyText)
  if (!isRecord(payload)) {
    return null
  }

  const data = readRecord(payload, 'data')
  return {
    code: readPrimitiveString(data?.['biz_code']) ?? readPrimitiveString(payload['code']),
    message:
      readOptionalString(data, 'biz_msg') ??
      readOptionalString(payload, 'msg') ??
      'DeepSeek resume_stream failed.',
    retryable: response.status >= 500 || response.status === 429,
  }
}

function extractHistoryMessageRecords(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const containers: unknown[] = [
    readRecord(readRecord(payload, 'data'), 'biz_data')?.['chat_messages'],
    readRecord(payload, 'data')?.['chat_messages'],
    readRecord(payload, 'chat_messages')?.['items'],
    payload['chat_messages'],
    readRecord(readRecord(payload, 'data'), 'biz_data')?.['messages'],
    readRecord(payload, 'data')?.['messages'],
    payload['messages'],
  ]

  for (const candidate of containers) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord)
    }
  }

  return []
}

function isHistoryMessageResumable(message: Record<string, unknown>): boolean {
  const status = readOptionalString(message, 'status')?.toUpperCase() ?? ''
  if (status && !['FINISHED', 'SUCCESS'].includes(status)) {
    return true
  }

  if (message['has_pending_fragment'] === true) {
    return true
  }

  const incompleteMessage = message['incomplete_message']
  return typeof incompleteMessage === 'string' ? incompleteMessage.trim().length > 0 : false
}

function hasStopAck(streamControls: DeepSeekObservedStreamControl[]): boolean {
  return streamControls.some(
    (control): control is DeepSeekStopStreamObservation =>
      control.endpoint === '/api/v0/chat/stop_stream' && control.acknowledged,
  )
}

function findLatestStopAck(
  streamControls: DeepSeekObservedStreamControl[],
): DeepSeekStopStreamObservation | null {
  for (let index = streamControls.length - 1; index >= 0; index -= 1) {
    const candidate = streamControls[index]
    if (candidate?.endpoint === '/api/v0/chat/stop_stream' && candidate.acknowledged) {
      return candidate
    }
  }

  return null
}

function findLatestRunWithStatus(
  runs: DeepSeekParsedGenerationRun[],
  status: DeepSeekParsedGenerationRun['finalized']['status'],
): DeepSeekParsedGenerationRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index]?.finalized.status === status) {
      return runs[index] ?? null
    }
  }

  return null
}

function isStopAwareCompletedRun(
  run: DeepSeekParsedGenerationRun | null,
  stopAck: DeepSeekStopStreamObservation | null,
): boolean {
  if (!run || !stopAck) {
    return false
  }

  if (run.finalized.status !== 'completed' || run.finalized.finishReason !== 'stop') {
    return false
  }

  if (stopAck.sessionId && run.context.sessionId && stopAck.sessionId !== run.context.sessionId) {
    return false
  }

  if (
    stopAck.messageId &&
    run.context.assistantMessageId &&
    stopAck.messageId !== run.context.assistantMessageId
  ) {
    return false
  }

  return true
}

function isDeepSeekStreamControlUrl(url: string): boolean {
  return matchDeepSeekStreamControlEndpoint(url) !== null
}

function matchDeepSeekStreamControlEndpoint(url: string): DeepSeekStreamControlEndpoint | null {
  try {
    const parsedUrl = new URL(url)
    return STREAM_CONTROL_ENDPOINTS.has(parsedUrl.pathname as DeepSeekStreamControlEndpoint)
      ? (parsedUrl.pathname as DeepSeekStreamControlEndpoint)
      : null
  } catch {
    return null
  }
}

function inferTransport(contentType: string | null): 'json' | 'sse' {
  return contentType?.includes('text/event-stream') ? 'sse' : 'json'
}

function buildObserverFingerprint(captureCount: number, pendingCount: number): string {
  return `${captureCount}:${pendingCount}`
}

function resolveObserverTimeoutRemaining(input: {
  timeoutMs: number | undefined
  startedAt: number
}): number | null {
  if (typeof input.timeoutMs !== 'number' || input.timeoutMs <= 0) {
    return null
  }

  return Math.max(input.timeoutMs - (Date.now() - input.startedAt), 0)
}

function parseJsonIfPossible(value: string | null | undefined): unknown {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function readOptionalString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!record) {
    return null
  }

  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readPrimitiveString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function readRecord(
  record: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!record) {
    return null
  }

  return isRecord(record[key]) ? record[key] : null
}

function stringifyNullableNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneStreamControlCapture(
  capture: DeepSeekStreamControlCapturedExchange,
): DeepSeekStreamControlCapturedExchange {
  return {
    endpoint: capture.endpoint,
    routeUrl: capture.routeUrl ?? null,
    request: {
      ...capture.request,
    },
    response: {
      ...capture.response,
    },
  }
}

function cloneFinalized(
  finalized: DeepSeekParsedGenerationRun['finalized'] | null,
): DeepSeekParsedGenerationRun['finalized'] | null {
  if (!finalized) {
    return null
  }

  return {
    ...finalized,
    citations: finalized.citations.map(citation => ({
      ...citation,
      ...(citation.annotation ? { annotation: { ...citation.annotation } } : {}),
    })),
    searches: finalized.searches.map(search => ({
      ...search,
      results: search.results.map(result => ({ ...result })),
    })),
    usage: finalized.usage ? { ...finalized.usage } : null,
    error: cloneError(finalized.error),
  }
}

function cloneError(error: DeepSeekGenerationErrorDetail | null): DeepSeekGenerationErrorDetail | null {
  return error ? { ...error } : null
}

function cloneResumableCandidate(
  candidate: DeepSeekResumableCandidate | null | undefined,
): DeepSeekResumableCandidate | null {
  return candidate
    ? {
        sessionId: candidate.sessionId,
        assistantMessageId: candidate.assistantMessageId,
        status: candidate.status,
        source: candidate.source,
      }
    : null
}
