import type { HTTPResponse } from 'puppeteer-core'
import type { DeepSeekGenerationObservation } from '../../types/deepseek-generation.types.js'
import { DEEPSEEK_GENERATION_REQUEST_ENDPOINTS } from './deepSeekApiCatalog.js'

export async function extractDeepSeekGenerationObservationFromResponse(
  response: HTTPResponse,
): Promise<DeepSeekGenerationObservation | null> {
  const endpoint = matchDeepSeekGenerationEndpoint(response.url())
  if (!endpoint) {
    return null
  }

  const contentType = response.headers()['content-type'] ?? null
  let text = ''
  try {
    text = await response.text()
  } catch {
    text = ''
  }
  const requestPostData = (() => {
    try {
      return response.request().postData() ?? null
    } catch {
      return null
    }
  })()

  return createDeepSeekGenerationObservation({
    endpoint,
    url: response.url(),
    status: response.status(),
    contentType,
    payloadText: text,
    requestPostData,
  })
}

export function createDeepSeekGenerationObservation(input: {
  endpoint: string
  url: string
  status: number
  contentType: string | null
  payloadText: string
  requestPostData?: string | null | undefined
}): DeepSeekGenerationObservation {
  const requestEvidence = extractDeepSeekGenerationRequestEvidence(input.requestPostData)
  return {
    endpoint: input.endpoint,
    url: input.url,
    status: input.status,
    contentType: input.contentType,
    outputTokens: extractDeepSeekOutputTokensFromPayloadText(input.payloadText, input.contentType),
    ...(requestEvidence.requestModelType
      ? { requestModelType: requestEvidence.requestModelType }
      : {}),
    ...(requestEvidence.requestRefFileIds
      ? { requestRefFileIds: requestEvidence.requestRefFileIds }
      : {}),
  }
}

export function extractDeepSeekOutputTokensFromPayloadText(
  payloadText: string,
  contentType: string | null,
): number | null {
  const trimmed = payloadText.trim()
  if (!trimmed) {
    return null
  }

  if (contentType?.includes('text/event-stream')) {
    return extractDeepSeekOutputTokensFromSse(trimmed)
  }

  try {
    return extractDeepSeekOutputTokensFromJson(JSON.parse(trimmed))
  } catch {
    return null
  }
}

export function extractDeepSeekOutputTokensFromSse(sseText: string): number | null {
  let maxObserved: number | null = null

  for (const chunk of sseText.split('\n\n')) {
    const dataLines = chunk
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trim())
      .filter(Boolean)

    for (const dataLine of dataLines) {
      try {
        const parsed: unknown = JSON.parse(dataLine)
        const observed = extractDeepSeekOutputTokensFromJson(parsed)
        if (observed !== null) {
          maxObserved = maxObserved === null ? observed : Math.max(maxObserved, observed)
        }
      } catch {
        continue
      }
    }
  }

  return maxObserved
}

export function extractDeepSeekOutputTokensFromJson(payload: unknown): number | null {
  const candidates: number[] = []
  collectTokenCandidates(payload, candidates)
  if (candidates.length === 0) {
    return null
  }
  return Math.max(...candidates)
}

export function sumDeepSeekObservedOutputTokens(
  observations: DeepSeekGenerationObservation[],
): number {
  return observations.reduce((total, observation) => total + Math.max(0, observation.outputTokens ?? 0), 0)
}

function extractDeepSeekGenerationRequestEvidence(
  requestPostData: string | null | undefined,
): {
  requestModelType?: string | undefined
  requestRefFileIds?: string[] | undefined
} {
  const requestPayload = parseJsonIfPossible(requestPostData)
  if (!isRecord(requestPayload)) {
    return {}
  }

  const requestModelType = readOptionalString(requestPayload['model_type'])
  const hasRefFileIds = Object.prototype.hasOwnProperty.call(requestPayload, 'ref_file_ids')
  const requestRefFileIds = hasRefFileIds
    ? readStringArray(requestPayload['ref_file_ids'])
    : null

  return {
    ...(requestModelType ? { requestModelType } : {}),
    ...(requestRefFileIds ? { requestRefFileIds } : {}),
  }
}

function collectTokenCandidates(value: unknown, target: number[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTokenCandidates(item, target)
    }
    return
  }

  if (!isRecord(value)) {
    return
  }

  if (
    value['p'] === 'accumulated_token_usage' &&
    typeof value['v'] === 'number' &&
    Number.isFinite(value['v'])
  ) {
    target.push(Math.floor(value['v']))
  }

  for (const [key, nested] of Object.entries(value)) {
    if (
      ['accumulated_token_usage', 'completion_tokens', 'output_tokens'].includes(key) &&
      typeof nested === 'number' &&
      Number.isFinite(nested)
    ) {
      target.push(Math.floor(nested))
    }

    collectTokenCandidates(nested, target)
  }
}

function matchDeepSeekGenerationEndpoint(url: string): string | null {
  try {
    const parsedUrl = new URL(url)
    return DEEPSEEK_GENERATION_REQUEST_ENDPOINTS.has(parsedUrl.pathname)
      ? parsedUrl.pathname
      : null
  } catch {
    return null
  }
}

function parseJsonIfPossible(value: string | null | undefined): unknown {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
