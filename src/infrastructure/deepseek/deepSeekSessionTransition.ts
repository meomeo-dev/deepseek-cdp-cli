import type { HTTPResponse, Page } from 'puppeteer-core'
import type { DeepSeekSessionCreateObservation } from '../../types/deepseek-first-message.types.js'
import { matchDeepSeekSessionRoute } from './deepSeekApiCatalog.js'

export interface DeepSeekSessionCreateObserver {
  stop: () => Promise<DeepSeekSessionCreateObservation[]>
}

export async function waitForDeepSeekSessionRoute(
  page: Page,
  timeoutMs: number,
): Promise<{
  finalUrl: string
  agentId: string
  sessionId: string
}> {
  try {
    await page.waitForFunction(
      () => /^\/a\/[^/]+\/s\/[^/]+$/.test(window.location.pathname.replace(/\/+$/, '')),
      { timeout: timeoutMs },
    )
  } catch (error) {
    const currentUrl = readDeepSeekPageUrl(page)
    if (page.isClosed()) {
      throw new Error(
        `DeepSeek page closed while waiting for the post-submit session route. Last known url: ${currentUrl}.`,
      )
    }

    const detail = error instanceof Error ? error.message : 'Unknown waitForFunction failure.'
    throw new Error(
      `Timed out waiting for DeepSeek to reach a session route after submit. Last known url: ${currentUrl}. ${detail}`,
    )
  }

  const finalUrl = page.url()
  const match = matchDeepSeekSessionRoute(finalUrl)
  if (match.routeKind !== 'session' || !match.agentId || !match.sessionId) {
    throw new Error(`DeepSeek navigated, but the final URL is not a session route: ${finalUrl}`)
  }

  return {
    finalUrl,
    agentId: match.agentId,
    sessionId: match.sessionId,
  }
}

function readDeepSeekPageUrl(page: Page): string {
  try {
    return page.url()
  } catch {
    return 'unknown'
  }
}

export function observeDeepSeekSessionCreateResponses(
  page: Page,
): DeepSeekSessionCreateObserver {
  const observations: DeepSeekSessionCreateObservation[] = []
  const pending = new Set<Promise<void>>()

  const onResponse = (response: HTTPResponse) => {
    if (!response.url().includes('/api/v0/chat_session/create')) {
      return
    }

    const task = extractDeepSeekSessionCreateObservationFromResponse(response)
      .then(observation => {
        if (observation) {
          observations.push(observation)
        }
      })
      .finally(() => {
        pending.delete(task)
      })

    pending.add(task)
  }

  page.on('response', onResponse)

  return {
    stop: async () => {
      page.off('response', onResponse)
      await Promise.allSettled([...pending])
      return [...observations]
    },
  }
}

export function selectDeepSeekSessionCreateObservation(
  observations: DeepSeekSessionCreateObservation[],
  routeSessionId: string,
): DeepSeekSessionCreateObservation | null {
  return (
    observations.findLast(
      observation => observation.sessionId === routeSessionId,
    ) ?? null
  )
}

export async function extractDeepSeekSessionCreateObservationFromResponse(
  response: HTTPResponse,
): Promise<DeepSeekSessionCreateObservation | null> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }

  return extractDeepSeekSessionCreateObservation(
    payload,
    response.url(),
    response.status(),
  )
}

export function extractDeepSeekSessionCreateObservation(
  payload: unknown,
  responseUrl: string,
  status: number,
): DeepSeekSessionCreateObservation | null {
  if (!isRecord(payload)) {
    return null
  }

  const chatSession = readRecord(
    readRecord(readRecord(readRecord(payload, 'data'), 'biz_data'), 'chat_session'),
  )
  if (!chatSession) {
    return null
  }

  return {
    sessionId: readString(chatSession, 'id'),
    agentId: readString(chatSession, 'agent'),
    url: responseUrl,
    status,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(
  value: Record<string, unknown> | null,
  key?: string,
): Record<string, unknown> | null {
  if (!value) {
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
