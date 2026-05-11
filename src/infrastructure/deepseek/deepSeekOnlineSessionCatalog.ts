import { setTimeout as delay } from 'node:timers/promises'
import type { HTTPResponse, Page } from 'puppeteer-core'
import type { WaitUntil } from '../../types/managed-chrome.types.js'
import type {
  DeepSeekOnlineSessionCatalogCapturedExchange,
  DeepSeekOnlineSessionCatalogResult,
  DeepSeekOnlineSessionCatalogSummary,
} from '../../types/deepseek-online-session-catalog.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'

const DEEPSEEK_FETCH_PAGE_ENDPOINT = '/api/v0/chat_session/fetch_page'
const ONLINE_SESSION_CATALOG_OBSERVER_POLL_INTERVAL_MS = 25
const ONLINE_SESSION_CATALOG_OBSERVER_QUIET_WINDOW_MS = 75
const ONLINE_SESSION_CATALOG_MAX_ATTEMPTS = 3
const ONLINE_SESSION_CATALOG_RETRY_DELAY_MS = 1_000

interface NormalizedCatalogCapture {
  capture: DeepSeekOnlineSessionCatalogCapturedExchange
  hasMore: boolean
  sessions: DeepSeekOnlineSessionCatalogSummary[]
}

interface InvalidCatalogCapture {
  capture: DeepSeekOnlineSessionCatalogCapturedExchange
  reason: string
}

export interface DeepSeekOnlineSessionCatalogObserver {
  stop: (timeoutMs?: number) => Promise<DeepSeekOnlineSessionCatalogCapturedExchange[]>
}

export function observeDeepSeekOnlineSessionCatalogResponses(
  page: Page,
): DeepSeekOnlineSessionCatalogObserver {
  const captures: DeepSeekOnlineSessionCatalogCapturedExchange[] = []
  const pending = new Set<Promise<void>>()
  let stopPromise: Promise<DeepSeekOnlineSessionCatalogCapturedExchange[]> | null = null

  const onResponse = (response: HTTPResponse) => {
    if (!isDeepSeekFetchPageResponseUrl(response.url())) {
      return
    }

    const task = extractDeepSeekOnlineSessionCatalogCaptureFromResponse(response, page.url())
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

      stopPromise = settleObservedDeepSeekOnlineSessionCatalogCaptures({
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

export async function discoverDeepSeekOnlineSessionCatalogOnPage(
  page: Page,
  input: {
    requestedUrl: string
    timeoutMs: number
    waitUntil: WaitUntil
  },
  logger?: RuntimeLogger,
): Promise<DeepSeekOnlineSessionCatalogResult> {
  const deadline = Date.now() + input.timeoutMs
  let attempts = 0
  let lastError: Error | null = null

  while (attempts < ONLINE_SESSION_CATALOG_MAX_ATTEMPTS && Date.now() < deadline) {
    attempts += 1
    const observer = observeDeepSeekOnlineSessionCatalogResponses(page)

    try {
      const navigationTimeoutMs = Math.max(1_000, deadline - Date.now())
      page.setDefaultNavigationTimeout(navigationTimeoutMs)
      page.setDefaultTimeout(navigationTimeoutMs)

      if (page.url() === input.requestedUrl) {
        await page.reload({
          waitUntil: input.waitUntil,
        })
      } else {
        await page.goto(input.requestedUrl, {
          waitUntil: input.waitUntil,
        })
      }
      await page.waitForSelector('body')

      const captures = await observer.stop(Math.max(1_000, Math.min(navigationTimeoutMs, 5_000)))
      const result = normalizeDeepSeekOnlineSessionCatalogCaptures(captures)

      logger?.info('Discovered DeepSeek online session catalog', {
        discoveredCount: result.sessions.length,
        hasMore: result.hasMore,
        partial: result.partial,
        captureCount: result.captures.length,
        attempts,
      })

      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      logger?.debug('fetch_page catalog capture attempt failed', {
        attempts,
        errorMessage: lastError.message,
      })

      try {
        await observer.stop(250)
      } catch {
        // Ignore observer cleanup failures while surfacing the original error.
      }

      if (attempts < ONLINE_SESSION_CATALOG_MAX_ATTEMPTS && Date.now() < deadline) {
        await delay(
          Math.min(
            ONLINE_SESSION_CATALOG_RETRY_DELAY_MS,
            Math.max(0, deadline - Date.now()),
          ),
        )
        continue
      }

      throw lastError
    }
  }

  throw lastError ?? new Error(`Timed out discovering ${DEEPSEEK_FETCH_PAGE_ENDPOINT}.`)
}

export async function extractDeepSeekOnlineSessionCatalogCaptureFromResponse(
  response: HTTPResponse,
  routeUrl?: string | null,
): Promise<DeepSeekOnlineSessionCatalogCapturedExchange | null> {
  let bodyText: string
  try {
    bodyText = await response.text()
  } catch {
    return null
  }

  return {
    endpoint: DEEPSEEK_FETCH_PAGE_ENDPOINT,
    routeUrl: routeUrl ?? null,
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

export function normalizeDeepSeekOnlineSessionCatalogCaptures(
  captures: DeepSeekOnlineSessionCatalogCapturedExchange[],
): DeepSeekOnlineSessionCatalogResult {
  if (captures.length === 0) {
    throw new Error(
      `Did not capture any ${DEEPSEEK_FETCH_PAGE_ENDPOINT} response in the authenticated browser context.`,
    )
  }

  const normalizedCaptures: NormalizedCatalogCapture[] = []
  const invalidCaptures: InvalidCatalogCapture[] = []

  for (const capture of captures) {
    const normalized = tryNormalizeDeepSeekOnlineSessionCatalogCapture(capture)
    if (normalized) {
      normalizedCaptures.push(normalized)
    } else {
      invalidCaptures.push({
        capture,
        reason: readDeepSeekOnlineSessionCatalogNormalizationFailure(capture),
      })
    }
  }

  if (normalizedCaptures.length === 0) {
    const latestInvalid = invalidCaptures.at(-1)
    throw new Error(
      latestInvalid
        ? [
            `Did not capture a valid ${DEEPSEEK_FETCH_PAGE_ENDPOINT} payload in the authenticated browser context.`,
            `Last invalid response: status=${latestInvalid.capture.response.status}, url=${latestInvalid.capture.request.url}.`,
            latestInvalid.reason,
          ].join(' ')
        : `Did not capture a valid ${DEEPSEEK_FETCH_PAGE_ENDPOINT} payload in the authenticated browser context.`,
    )
  }

  const authoritative = normalizedCaptures.at(-1) as NormalizedCatalogCapture
  const sessionsById = new Map<string, DeepSeekOnlineSessionCatalogSummary>()

  for (const capture of normalizedCaptures) {
    for (const session of capture.sessions) {
      sessionsById.set(session.sessionId, session)
    }
  }

  const sessions = [...sessionsById.values()].sort(compareDeepSeekOnlineSessionCatalogSummaries)
  const warnings = authoritative.hasMore
    ? [
      {
        code: 'pagination_incomplete' as const,
        message:
          'The browser-observed chat_session/fetch_page catalog reported has_more=true, so this sync only covers the currently observed page.',
        requestUrl: authoritative.capture.request.url,
      },
    ]
    : []

  return {
    authoritativeCapture: authoritative.capture,
    captures: normalizedCaptures.map(item => cloneDeepSeekOnlineSessionCatalogCapture(item.capture)),
    hasMore: authoritative.hasMore,
    partial: authoritative.hasMore,
    warnings,
    sessions,
  }
}

function normalizeDeepSeekOnlineSessionCatalogCapture(
  capture: DeepSeekOnlineSessionCatalogCapturedExchange,
): NormalizedCatalogCapture {
  let payload: unknown
  try {
    payload = JSON.parse(capture.response.bodyText) as unknown
  } catch (error) {
    throw new Error(
      `${DEEPSEEK_FETCH_PAGE_ENDPOINT} returned invalid JSON: ${error instanceof Error ? error.message : 'Unknown parse failure.'}`,
    )
  }

  const bizData = readRecord(readRecord(readRecord(payload, 'data'), 'biz_data'))
  if (!bizData) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} payload is missing data.biz_data.`)
  }

  const rawSessions = bizData['chat_sessions']
  if (!Array.isArray(rawSessions)) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} payload is missing biz_data.chat_sessions.`)
  }

  const hasMore = readBoolean(bizData, 'has_more')
  if (hasMore === null) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} payload is missing biz_data.has_more.`)
  }

  return {
    capture,
    hasMore,
    sessions: rawSessions.map((session, index) =>
      normalizeDeepSeekOnlineSessionCatalogSession(session, index),
    ),
  }
}

function tryNormalizeDeepSeekOnlineSessionCatalogCapture(
  capture: DeepSeekOnlineSessionCatalogCapturedExchange,
): NormalizedCatalogCapture | null {
  try {
    return normalizeDeepSeekOnlineSessionCatalogCapture(capture)
  } catch {
    return null
  }
}

function readDeepSeekOnlineSessionCatalogNormalizationFailure(
  capture: DeepSeekOnlineSessionCatalogCapturedExchange,
): string {
  try {
    normalizeDeepSeekOnlineSessionCatalogCapture(capture)
    return 'Unexpectedly succeeded.'
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown normalization failure.'
  }
}

function normalizeDeepSeekOnlineSessionCatalogSession(
  value: unknown,
  index: number,
): DeepSeekOnlineSessionCatalogSummary {
  if (!isRecord(value)) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} chat_sessions[${index}] is not an object.`)
  }

  const sessionId = readString(value, 'id')
  if (!sessionId) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} chat_sessions[${index}] is missing id.`)
  }

  const title = readString(value, 'title')
  if (!title) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} chat_sessions[${index}] is missing title.`)
  }

  const pinned = readBoolean(value, 'pinned')
  if (pinned === null) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} chat_sessions[${index}] is missing pinned.`)
  }

  const updatedAtSeconds = readNumber(value, 'updated_at')
  if (updatedAtSeconds === null) {
    throw new Error(`${DEEPSEEK_FETCH_PAGE_ENDPOINT} chat_sessions[${index}] is missing updated_at.`)
  }

  const updatedAt = new Date(updatedAtSeconds * 1_000).toISOString()
  if (updatedAt === 'Invalid Date') {
    throw new Error(
      `${DEEPSEEK_FETCH_PAGE_ENDPOINT} chat_sessions[${index}] has an invalid updated_at value.`,
    )
  }

  return {
    sessionId,
    title,
    updatedAt,
    pinned,
    routeUrl: null,
    discoverySource: 'fetch_page',
  }
}

async function settleObservedDeepSeekOnlineSessionCatalogCaptures(input: {
  page: Page
  onResponse: (response: HTTPResponse) => void
  pending: Set<Promise<void>>
  captures: DeepSeekOnlineSessionCatalogCapturedExchange[]
  timeoutMs: number
}): Promise<DeepSeekOnlineSessionCatalogCapturedExchange[]> {
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
      if (Date.now() - quietStartedAt >= ONLINE_SESSION_CATALOG_OBSERVER_QUIET_WINDOW_MS) {
        break
      }
    }

    await delay(ONLINE_SESSION_CATALOG_OBSERVER_POLL_INTERVAL_MS)
  }

  input.page.off('response', input.onResponse)
  if (input.pending.size > 0) {
    await Promise.allSettled([...input.pending])
  }

  return input.captures.map(cloneDeepSeekOnlineSessionCatalogCapture)
}

function buildObserverFingerprint(captureCount: number, pendingCount: number): string {
  return `${captureCount}:${pendingCount}`
}

function compareDeepSeekOnlineSessionCatalogSummaries(
  left: DeepSeekOnlineSessionCatalogSummary,
  right: DeepSeekOnlineSessionCatalogSummary,
): number {
  const updatedAtDiff = compareIsoTimestampsDesc(left.updatedAt, right.updatedAt)
  if (updatedAtDiff !== 0) {
    return updatedAtDiff
  }

  return left.sessionId.localeCompare(right.sessionId)
}

function compareIsoTimestampsDesc(left: string, right: string): number {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }

  if (Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return -1
  }

  if (!Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return 1
  }

  return right.localeCompare(left)
}

function cloneDeepSeekOnlineSessionCatalogCapture(
  capture: DeepSeekOnlineSessionCatalogCapturedExchange,
): DeepSeekOnlineSessionCatalogCapturedExchange {
  return {
    endpoint: capture.endpoint,
    routeUrl: capture.routeUrl,
    request: {
      ...capture.request,
    },
    response: {
      ...capture.response,
    },
  }
}

function isDeepSeekFetchPageResponseUrl(url: string): boolean {
  return url.includes(DEEPSEEK_FETCH_PAGE_ENDPOINT)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(
  value: unknown,
  key?: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null
  }

  if (!key) {
    return value
  }

  const next = value[key]
  return isRecord(next) ? next : null
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate : null
}

function readBoolean(value: Record<string, unknown>, key: string): boolean | null {
  const candidate = value[key]
  return typeof candidate === 'boolean' ? candidate : null
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}
