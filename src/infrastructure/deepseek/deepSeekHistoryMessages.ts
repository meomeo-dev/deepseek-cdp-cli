import { setTimeout as delay } from 'node:timers/promises'
import type { HTTPResponse, Page } from 'puppeteer-core'
import type {
  DeepSeekHistoryMessagesCapturedExchange,
  DeepSeekHistoryMessagesRecoveryResult,
} from '../../types/deepseek-history-messages.types.js'
import type { DeepSeekTranscriptRecovery } from '../../types/deepseek-transcript-recovery.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { mapHistoryMessagesEnvelopeToSession } from './historyMessagesMapper.js'

const DEEPSEEK_HISTORY_MESSAGES_ENDPOINT = '/api/v0/chat/history_messages'
const HISTORY_MESSAGES_OBSERVER_POLL_INTERVAL_MS = 25
const HISTORY_MESSAGES_OBSERVER_QUIET_WINDOW_MS = 75
const historyMessagesReplayHeadersByPage = new WeakMap<Page, Record<string, string>>()

export interface DeepSeekHistoryMessagesObserver {
  stop: (timeoutMs?: number) => Promise<DeepSeekHistoryMessagesCapturedExchange[]>
}

export async function recoverDeepSeekSessionFromHistoryMessagesOnPage(
  page: Page,
  input: {
    finalUrl: string
    sessionId: string
    timeoutMs: number
    maxAttempts?: number | undefined
    retryDelayMs?: number | undefined
  },
  logger?: RuntimeLogger,
): Promise<DeepSeekHistoryMessagesRecoveryResult> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3)
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 1_000)
  const deadline = Date.now() + input.timeoutMs
  let attempts = 0
  let lastCapture: DeepSeekHistoryMessagesCapturedExchange | null = null

  while (attempts < maxAttempts && Date.now() < deadline) {
    attempts += 1
    const captures = await captureDeepSeekHistoryMessagesForRecovery(
      page,
      {
        finalUrl: input.finalUrl,
        sessionId: input.sessionId,
        timeoutMs: Math.max(1_000, deadline - Date.now()),
      },
      logger,
    )

    for (const capture of captures) {
      lastCapture = capture

      const recovered = recoverDeepSeekSessionFromHistoryMessagesCapture({
        capture,
        attempts,
      })
      if (recovered.outcome === 'recovered') {
        return recovered
      }

      logger?.debug('history_messages transcript is not settled yet', {
        attempt: attempts,
        sessionId: input.sessionId,
        responseStatus: capture.response.status,
        requestUrl: capture.request.url,
        reason: recovered.recovery.errorMessage ?? 'Unknown history_messages recovery failure.',
      })
    }

    if (attempts < maxAttempts && Date.now() < deadline) {
      await delay(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())))
    }
  }

  if (lastCapture) {
    return recoverDeepSeekSessionFromHistoryMessagesCapture({
      capture: lastCapture,
      attempts,
    })
  }

  return {
    outcome: 'failed',
    capture: null,
    session: null,
    recovery: buildTranscriptRecovery({
      status: 'failed',
      requestUrl: null,
      responseStatus: null,
      attempts,
      session: null,
      settled: false,
      errorMessage: 'Timed out before any history_messages response was captured.',
    }),
  }
}

export function observeDeepSeekHistoryMessagesResponses(
  page: Page,
  input: {
    sessionId: string
  },
): DeepSeekHistoryMessagesObserver {
  const captures: DeepSeekHistoryMessagesCapturedExchange[] = []
  const pending = new Set<Promise<void>>()
  let stopPromise: Promise<DeepSeekHistoryMessagesCapturedExchange[]> | null = null

  const onResponse = (response: HTTPResponse) => {
    if (!isDeepSeekHistoryMessagesResponseUrl(response.url(), input.sessionId)) {
      return
    }
    cacheDeepSeekHistoryMessagesRequestHeadersOnPage(page, response)

    const task = extractDeepSeekHistoryMessagesCaptureFromResponse(response, page.url(), input.sessionId)
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
    stop(timeoutMs = 1_000) {
      if (stopPromise) {
        return stopPromise
      }

      stopPromise = settleObservedDeepSeekHistoryMessagesCaptures({
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

export function recoverDeepSeekSessionFromHistoryMessagesCaptures(input: {
  captures: DeepSeekHistoryMessagesCapturedExchange[]
  attempts: number
}): DeepSeekHistoryMessagesRecoveryResult | null {
  if (input.captures.length === 0) {
    return null
  }

  for (let index = input.captures.length - 1; index >= 0; index -= 1) {
    const recovered = recoverDeepSeekSessionFromHistoryMessagesCapture({
      capture: input.captures[index] as DeepSeekHistoryMessagesCapturedExchange,
      attempts: input.attempts,
    })
    if (recovered.outcome === 'recovered') {
      return recovered
    }
  }

  return recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture: input.captures[input.captures.length - 1] as DeepSeekHistoryMessagesCapturedExchange,
    attempts: input.attempts,
  })
}

export function recoverDeepSeekSessionFromHistoryMessagesCapture(input: {
  capture: DeepSeekHistoryMessagesCapturedExchange
  attempts: number
}): DeepSeekHistoryMessagesRecoveryResult {
  let payload: unknown
  try {
    payload = JSON.parse(input.capture.response.bodyText) as unknown
  } catch (error) {
    return {
      outcome: 'failed',
      capture: input.capture,
      session: null,
      recovery: buildTranscriptRecovery({
        status: 'failed',
        requestUrl: input.capture.request.url,
        responseStatus: input.capture.response.status,
        attempts: input.attempts,
        session: null,
        settled: false,
        errorMessage: error instanceof Error ? error.message : 'Invalid JSON payload.',
      }),
    }
  }

  let session = null
  try {
    session = mapHistoryMessagesEnvelopeToSession(payload)
  } catch (error) {
    return {
      outcome: 'failed',
      capture: input.capture,
      session: null,
      recovery: buildTranscriptRecovery({
        status: 'failed',
        requestUrl: input.capture.request.url,
        responseStatus: input.capture.response.status,
        attempts: input.attempts,
        session: null,
        settled: false,
        errorMessage: error instanceof Error ? error.message : 'Could not map history_messages payload.',
      }),
    }
  }

  const settled = isDeepSeekHistoryMessagesPayloadSettled(payload)
  if (!settled) {
    return {
      outcome: 'failed',
      capture: input.capture,
      session,
      recovery: buildTranscriptRecovery({
        status: 'failed',
        requestUrl: input.capture.request.url,
        responseStatus: input.capture.response.status,
        attempts: input.attempts,
        session,
        settled: false,
        errorMessage: describeDeepSeekHistoryMessagesPayloadUnsettled(payload) ?? undefined,
      }),
    }
  }

  return {
    outcome: 'recovered',
    capture: input.capture,
    session,
    recovery: buildTranscriptRecovery({
      status: 'recovered',
      requestUrl: input.capture.request.url,
      responseStatus: input.capture.response.status,
      attempts: input.attempts,
      session,
      settled: true,
    }),
  }
}

export function isDeepSeekHistoryMessagesPayloadSettled(payload: unknown): boolean {
  return describeDeepSeekHistoryMessagesPayloadUnsettled(payload) === null
}

export function describeDeepSeekHistoryMessagesPayloadUnsettled(
  payload: unknown,
): string | null {
  const rawMessages = extractHistoryMessagesRecords(payload)
  if (rawMessages.length === 0) {
    return 'Could not find any messages in the history_messages payload.'
  }

  const reasons: string[] = []

  rawMessages.forEach((message, index) => {
    const messageLabel = buildHistoryMessageLabel(message, index)
    const status = readOptionalString(message, 'status')?.toUpperCase() ?? ''
    if (status && !isSettledHistoryMessageStatus(status, message)) {
      reasons.push(`${messageLabel} status=${status}`)
    }

    if (message['has_pending_fragment'] === true) {
      reasons.push(`${messageLabel} has_pending_fragment=true`)
    }

    const incompleteMessage = message['incomplete_message']
    if (typeof incompleteMessage === 'string' && incompleteMessage.trim()) {
      reasons.push(`${messageLabel} incomplete_message=${JSON.stringify(incompleteMessage.trim())}`)
    }
    if (incompleteMessage !== null && incompleteMessage !== undefined && typeof incompleteMessage !== 'string') {
      reasons.push(`${messageLabel} incomplete_message_type=${typeof incompleteMessage}`)
    }
  })

  return reasons.length > 0
    ? `history_messages payload is still incomplete: ${reasons.join('; ')}`
    : null
}

async function captureDeepSeekHistoryMessagesForRecovery(
  page: Page,
  input: {
    finalUrl: string
    sessionId: string
    timeoutMs: number
  },
  logger?: RuntimeLogger,
): Promise<DeepSeekHistoryMessagesCapturedExchange[]> {
  const deadline = Date.now() + input.timeoutMs
  const captures: DeepSeekHistoryMessagesCapturedExchange[] = []

  await seedDeepSeekHistoryMessagesRequestHeaders(page, input.sessionId).catch(error => {
    logger?.debug('Could not seed history_messages request headers before direct full fetch', {
      sessionId: input.sessionId,
      reason: error instanceof Error ? error.message : 'Unknown request header seed failure.',
    })
  })

  try {
    captures.push(
      await captureDeepSeekHistoryMessagesViaDirectFetch(page, {
        finalUrl: input.finalUrl,
        sessionId: input.sessionId,
        timeoutMs: input.timeoutMs,
      }),
    )
  } catch (error) {
    logger?.debug('Direct history_messages full fetch failed; falling back to session reload capture', {
      sessionId: input.sessionId,
      reason: error instanceof Error ? error.message : 'Unknown direct history_messages fetch failure.',
    })
  }

  const directRecovery = recoverDeepSeekSessionFromHistoryMessagesCaptures({
    captures,
    attempts: 1,
  })
  if (directRecovery?.outcome === 'recovered') {
    return captures
  }

  captures.push(
    await captureDeepSeekHistoryMessagesViaSessionReload(page, {
      finalUrl: input.finalUrl,
      sessionId: input.sessionId,
      timeoutMs: Math.max(1_000, deadline - Date.now()),
    }),
  )

  return captures
}

async function captureDeepSeekHistoryMessagesViaDirectFetch(
  page: Page,
  input: {
    finalUrl: string
    sessionId: string
    timeoutMs: number
  },
): Promise<DeepSeekHistoryMessagesCapturedExchange> {
  const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs, 15_000))
  const requestPath =
    `${DEEPSEEK_HISTORY_MESSAGES_ENDPOINT}?chat_session_id=${encodeURIComponent(input.sessionId)}`
  const replayHeaders = historyMessagesReplayHeadersByPage.get(page) ?? {}
  const response = await page.evaluate(
    async (path, fetchTimeoutMs, capturedHeaders) => {
      const controller = new AbortController()
      const timeoutHandle = window.setTimeout(() => {
        controller.abort()
      }, fetchTimeoutMs)

      try {
        const headers: Record<string, string> = {
          accept: 'application/json',
        }
        for (const [key, value] of Object.entries(capturedHeaders)) {
          const normalizedKey = key.toLowerCase()
          if (
            normalizedKey === 'authorization' ||
            normalizedKey === 'accept' ||
            normalizedKey.startsWith('x-client-')
          ) {
            headers[key] = value
          }
        }

        const fetchResponse = await fetch(path, {
          method: 'GET',
          credentials: 'include',
          headers,
          cache: 'no-store',
          signal: controller.signal,
        })
        return {
          requestUrl: fetchResponse.url || new URL(path, window.location.href).href,
          status: fetchResponse.status,
          contentType: fetchResponse.headers.get('content-type'),
          bodyText: await fetchResponse.text(),
        }
      } finally {
        window.clearTimeout(timeoutHandle)
      }
    },
    requestPath,
    timeoutMs,
    replayHeaders,
  )

  return {
    endpoint: DEEPSEEK_HISTORY_MESSAGES_ENDPOINT,
    routeUrl: input.finalUrl,
    sessionId: input.sessionId,
    request: {
      method: 'GET',
      url: response.requestUrl,
      postData: null,
    },
    response: {
      status: response.status,
      contentType: response.contentType,
      bodyText: response.bodyText,
    },
  }
}

async function seedDeepSeekHistoryMessagesRequestHeaders(
  page: Page,
  sessionId: string,
): Promise<void> {
  if (historyMessagesReplayHeadersByPage.get(page)?.['authorization']) {
    return
  }

  await page.waitForResponse(
    response => isDeepSeekHistoryMessagesResponseUrl(response.url(), sessionId),
    { timeout: 1_000 },
  ).then(response => {
    cacheDeepSeekHistoryMessagesRequestHeadersOnPage(page, response)
  }).catch(() => {})
}

function cacheDeepSeekHistoryMessagesRequestHeadersOnPage(page: Page, response: HTTPResponse): void {
  const headers = pickDeepSeekHistoryMessagesReplayHeaders(response.request().headers())
  if (Object.keys(headers).length === 0) {
    return
  }

  historyMessagesReplayHeadersByPage.set(page, headers)
}

function pickDeepSeekHistoryMessagesReplayHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const replayHeaders: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey === 'authorization' ||
      normalizedKey === 'accept' ||
      normalizedKey.startsWith('x-client-')
    ) {
      replayHeaders[key] = value
    }
  }

  return replayHeaders
}

async function captureDeepSeekHistoryMessagesViaSessionReload(
  page: Page,
  input: {
    finalUrl: string
    sessionId: string
    timeoutMs: number
  },
): Promise<DeepSeekHistoryMessagesCapturedExchange> {
  const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs, 15_000))

  return new Promise<DeepSeekHistoryMessagesCapturedExchange>((resolve, reject) => {
    let finished = false
    let timeoutHandle: NodeJS.Timeout | null = null

    const cleanup = () => {
      finished = true
      page.off('response', onResponse)
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }

    const fail = (error: Error) => {
      if (finished) {
        return
      }
      cleanup()
      reject(error)
    }

    const onResponse = (response: HTTPResponse) => {
      if (!isDeepSeekHistoryMessagesResponseUrl(response.url(), input.sessionId)) {
        return
      }
      cacheDeepSeekHistoryMessagesRequestHeadersOnPage(page, response)

      void (async () => {
        try {
          const bodyText = await response.text()
          if (finished) {
            return
          }

          cleanup()
          resolve({
            endpoint: DEEPSEEK_HISTORY_MESSAGES_ENDPOINT,
            routeUrl: input.finalUrl,
            sessionId: input.sessionId,
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
          })
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Could not read history_messages response body.'))
        }
      })()
    }

    page.on('response', onResponse)
    timeoutHandle = setTimeout(() => {
      fail(new Error(`Timed out waiting for ${DEEPSEEK_HISTORY_MESSAGES_ENDPOINT} for session ${input.sessionId}.`))
    }, timeoutMs)

    const reloadTask =
      page.url() === input.finalUrl
        ? page.reload({
            waitUntil: 'domcontentloaded',
          })
        : page.goto(input.finalUrl, {
            waitUntil: 'domcontentloaded',
          })

    void reloadTask
      .catch(error => {
        fail(error instanceof Error ? error : new Error('Could not reload the DeepSeek session page.'))
      })
  })
}

async function extractDeepSeekHistoryMessagesCaptureFromResponse(
  response: HTTPResponse,
  routeUrl: string | null,
  sessionId: string,
): Promise<DeepSeekHistoryMessagesCapturedExchange | null> {
  let bodyText: string
  try {
    bodyText = await response.text()
  } catch {
    return null
  }

  return {
    endpoint: DEEPSEEK_HISTORY_MESSAGES_ENDPOINT,
    routeUrl,
    sessionId,
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

async function settleObservedDeepSeekHistoryMessagesCaptures(input: {
  page: Page
  onResponse: (response: HTTPResponse) => void
  pending: Set<Promise<void>>
  captures: DeepSeekHistoryMessagesCapturedExchange[]
  timeoutMs: number
}): Promise<DeepSeekHistoryMessagesCapturedExchange[]> {
  const deadline = Date.now() + Math.max(250, input.timeoutMs)
  let sawActivity = input.captures.length > 0 || input.pending.size > 0
  let quietStartedAt = sawActivity ? Date.now() : 0
  let lastFingerprint = buildObserverFingerprint(input.captures.length, input.pending.size)

  while (Date.now() < deadline) {
    const fingerprint = buildObserverFingerprint(input.captures.length, input.pending.size)
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint
      sawActivity = true
      quietStartedAt = Date.now()
    } else if (sawActivity && input.pending.size === 0) {
      if (quietStartedAt === 0) {
        quietStartedAt = Date.now()
      }
      if (Date.now() - quietStartedAt >= HISTORY_MESSAGES_OBSERVER_QUIET_WINDOW_MS) {
        break
      }
    }

    await delay(HISTORY_MESSAGES_OBSERVER_POLL_INTERVAL_MS)
  }

  input.page.off('response', input.onResponse)
  if (input.pending.size > 0) {
    await Promise.allSettled([...input.pending])
  }

  return input.captures.map(capture => ({
    endpoint: capture.endpoint,
    routeUrl: capture.routeUrl,
    sessionId: capture.sessionId,
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
  }))
}

function buildObserverFingerprint(captureCount: number, pendingCount: number): string {
  return `${captureCount}:${pendingCount}`
}

function isDeepSeekHistoryMessagesResponseUrl(url: string, sessionId: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return (
      parsedUrl.pathname === DEEPSEEK_HISTORY_MESSAGES_ENDPOINT &&
      parsedUrl.searchParams.get('chat_session_id') === sessionId
    )
  } catch {
    return false
  }
}

function extractHistoryMessagesRecords(payload: unknown): Array<Record<string, unknown>> {
  if (!isRecord(payload)) {
    return []
  }

  const candidates: unknown[] = [
    readRecord(readRecord(payload, 'data'), 'biz_data')?.['chat_messages'],
    readRecord(payload, 'data')?.['chat_messages'],
    readRecord(payload, 'data')?.['messages'],
    readRecord(payload, 'data')?.['history_messages'],
    payload['chat_messages'],
    payload['messages'],
    payload['history_messages'],
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord)
    }
  }

  return []
}

function buildHistoryMessageLabel(
  message: Record<string, unknown>,
  index: number,
): string {
  const rawId = message['message_id'] ?? message['id']
  const id =
    readOptionalString(message, 'message_id') ??
    readOptionalString(message, 'id') ??
    (typeof rawId === 'number' || typeof rawId === 'bigint'
      ? String(rawId)
      : index + 1)
  const role = readOptionalString(message, 'role') ?? 'unknown'
  return `message ${id} (${role})`
}

function buildTranscriptRecovery(input: {
  status: DeepSeekTranscriptRecovery['status']
  requestUrl: string | null
  responseStatus: number | null
  attempts: number
  session: DeepSeekHistoryMessagesRecoveryResult['session']
  settled: boolean
  errorMessage?: string | undefined
}): DeepSeekTranscriptRecovery {
  const branchCount = input.session?.branches.length ?? 0
  const messageCount =
    input.session?.branches.reduce((total, branch) => total + branch.messages.length, 0) ?? 0

  return {
    source: 'history_messages',
    status: input.status,
    requestUrl: input.requestUrl,
    responseStatus: input.responseStatus,
    recoveredAt: new Date().toISOString(),
    attempts: input.attempts,
    branchCount,
    messageCount,
    settled: input.settled,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  }
}

function readRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const nested = value?.[key]
  return isRecord(nested) ? nested : undefined
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSettledHistoryMessageStatus(status: string, message: Record<string, unknown>): boolean {
  if (status === 'FINISHED' || status === 'SUCCESS') {
    return true
  }

  if (status !== 'INCOMPLETE') {
    return false
  }

  if (message['has_pending_fragment'] === true) {
    return false
  }

  const incompleteMessage = message['incomplete_message']
  return (
    incompleteMessage === null ||
    incompleteMessage === undefined ||
    (typeof incompleteMessage === 'string' && incompleteMessage.trim() === '')
  )
}
