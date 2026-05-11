import type {
  DeepSeekSearchProbeClassification,
  DeepSeekSearchProbeClassificationInput,
  DeepSeekSearchRateLimitSignal,
  DeepSeekSearchWaitPolicy,
} from '../../types/deepseek-search-rate-limit.types.js'
import { parseJsonIfPossible, readOptionalString, splitSseMessages, isRecord } from '../../infrastructure/deepseek/deepSeekGenerationParserPrimitives.js'

export const DEEPSEEK_SEARCH_FIRST_TOKEN_OBSERVATION_WINDOW_MS = 60_000
export const DEEPSEEK_SEARCH_MINIMUM_PROBE_TIMEOUT_MS = 90_000
export const DEEPSEEK_SEARCH_RECOMMENDED_RATE_LIMIT_COOLDOWN_MS = 60_000

export function resolveDeepSeekSearchWaitPolicy(
  timeoutMs?: number | null,
): DeepSeekSearchWaitPolicy {
  const requestedTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0

  return {
    firstTokenObservationWindowMs: DEEPSEEK_SEARCH_FIRST_TOKEN_OBSERVATION_WINDOW_MS,
    recommendedProbeTimeoutMs: Math.max(
      DEEPSEEK_SEARCH_MINIMUM_PROBE_TIMEOUT_MS,
      requestedTimeoutMs,
    ),
    recommendedRateLimitCooldownMs: DEEPSEEK_SEARCH_RECOMMENDED_RATE_LIMIT_COOLDOWN_MS,
    notes: [
      '首词等待窗口基于已观察到的 5-60s 深搜首响范围，属于客户端保守等待策略，不代表服务端 SLA。',
      'probe timeout 对搜索链路设置为至少 90s，避免把长尾深搜直接误判成普通 reply timeout。',
      'rate-limit cooldown 采用本地 60s 安全退避策略；该值是客户端 guardrail，不是 DeepSeek 明示的 retry-after 契约。',
    ],
  }
}

export function extractDeepSeekSearchRateLimitSignalFromExchange(
  exchange: DeepSeekSearchProbeClassificationInput['exchange'],
): DeepSeekSearchRateLimitSignal {
  if (
    !exchange ||
    !exchange.response.contentType?.includes('text/event-stream') ||
    !exchange.endpoint.startsWith('/api/v0/chat/')
  ) {
    return buildEmptySignal()
  }

  let rawHintMessage: string | null = null
  let rawFinishReason: string | null = null
  let clickBehavior: string | null = null
  let autoResume: boolean | null = null

  for (const message of splitSseMessages(exchange.response.bodyText)) {
    const payload = parseJsonIfPossible(message.dataText)
    if (!isRecord(payload)) {
      continue
    }

    if (message.event === 'hint') {
      rawHintMessage = readOptionalString(payload, 'content')
      rawFinishReason = readOptionalString(payload, 'finish_reason')
      continue
    }

    if (message.event === 'close') {
      clickBehavior = readOptionalString(payload, 'click_behavior')
      autoResume =
        typeof payload['auto_resume'] === 'boolean' ? payload['auto_resume'] : null
    }
  }

  const observed =
    rawFinishReason === 'rate_limit_reached' ||
    (rawHintMessage?.toLowerCase().includes('too frequent') ?? false)

  if (!observed) {
    return {
      observed: false,
      apiSignalStatus: 'not_observed',
      rawHintMessage,
      rawFinishReason,
      normalizedErrorCode: null,
      clickBehavior,
      autoResume,
      uiRetryControlStatus: 'not_observed',
    }
  }

  return {
    observed: true,
    apiSignalStatus: 'confirmed',
    rawHintMessage,
    rawFinishReason,
    normalizedErrorCode: 'rate_limit_exceeded',
    clickBehavior,
    autoResume,
    uiRetryControlStatus:
      clickBehavior === 'retry' ? 'ui-observation-pending' : 'not_observed',
  }
}

export function classifyDeepSeekSearchProbeAttempt(
  input: DeepSeekSearchProbeClassificationInput,
): DeepSeekSearchProbeClassification {
  const signal = extractDeepSeekSearchRateLimitSignalFromExchange(input.exchange)
  if (signal.observed) {
    return {
      kind: 'rate_limit',
      retryable: true,
      normalizedErrorCode: signal.normalizedErrorCode,
      uiRetryControlStatus: signal.uiRetryControlStatus,
      message:
        signal.rawHintMessage ?? 'DeepSeek search generation was rate limited by the service.',
    }
  }

  if (input.run?.finalized.status === 'completed') {
    return {
      kind: 'search_success',
      retryable: false,
      normalizedErrorCode: null,
      uiRetryControlStatus: 'not_observed',
      message: 'DeepSeek search generation completed without a confirmed rate-limit signal.',
    }
  }

  if (input.run?.finalized.error) {
    return {
      kind: 'failed',
      retryable: input.run.finalized.error.retryable,
      normalizedErrorCode: input.run.finalized.error.code,
      uiRetryControlStatus: 'not_observed',
      message: input.run.finalized.error.message,
    }
  }

  return {
    kind: 'failed',
    retryable: true,
    normalizedErrorCode: null,
    uiRetryControlStatus: 'not_observed',
    message: 'DeepSeek search probe ended without a completed run or confirmed rate-limit signal.',
  }
}

function buildEmptySignal(): DeepSeekSearchRateLimitSignal {
  return {
    observed: false,
    apiSignalStatus: 'not_observed',
    rawHintMessage: null,
    rawFinishReason: null,
    normalizedErrorCode: null,
    clickBehavior: null,
    autoResume: null,
    uiRetryControlStatus: 'not_observed',
  }
}
