import { DEEPSEEK_SEARCH_RECOMMENDED_RATE_LIMIT_COOLDOWN_MS } from './deepSeekSearchRateLimitAudit.js'
import type {
  DeepSeekObservedGenerationRun,
  DeepSeekParsedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekSearchRateLimitOutputMetadata } from '../../types/deepseek-search-rate-limit.types.js'

const RATE_LIMIT_RETRY_CLOSE_LABEL = 'rate_limit_retry_close'

export function resolveDeepSeekReplyRateLimitMetadata(
  result: DeepSeekReplyResult,
): DeepSeekSearchRateLimitOutputMetadata | null {
  if (result.rateLimit !== undefined) {
    return result.rateLimit
  }

  const rateLimitedRun = selectRateLimitedRun(result)
  if (!rateLimitedRun) {
    return null
  }

  const searchEnabled =
    result.requestedComposerMode.search === 'on' || result.composerMode.search === 'on'
  const uiObservationStatus = rateLimitedRun.unknownObservationLabels.includes(
    RATE_LIMIT_RETRY_CLOSE_LABEL,
  )
    ? 'ui-observation-pending'
    : 'not_observed'
  const apiSignalStatus =
    rateLimitedRun.finalized.error?.cause === 'rate_limit_reached' ||
    uiObservationStatus === 'ui-observation-pending'
      ? 'confirmed'
      : 'inferred'

  return {
    code: 'rate_limit_exceeded',
    message:
      rateLimitedRun.finalized.error?.message ??
      'DeepSeek returned a rate-limit error for this generation.',
    retryable: rateLimitedRun.finalized.error?.retryable ?? true,
    scope: searchEnabled ? 'search' : 'general',
    apiSignalStatus,
    uiRetryControlStatus: uiObservationStatus,
    uiObservationStatus,
    recommendedCooldownMs: searchEnabled
      ? DEEPSEEK_SEARCH_RECOMMENDED_RATE_LIMIT_COOLDOWN_MS
      : null,
    rawFinishReason: rateLimitedRun.finalized.error?.cause ?? null,
    clickBehavior:
      uiObservationStatus === 'ui-observation-pending' ? 'retry' : null,
    note:
      'This is an API-level retry signal, not a confirmed clickable UI retry button.',
  }
}

export function attachDeepSeekReplyRateLimitMetadata(
  result: DeepSeekReplyResult,
): DeepSeekReplyResult & {
  rateLimit: DeepSeekSearchRateLimitOutputMetadata | null
} {
  return {
    ...result,
    rateLimit: resolveDeepSeekReplyRateLimitMetadata(result),
  }
}

export function buildDeepSeekRateLimitTextNotice(
  rateLimit: DeepSeekSearchRateLimitOutputMetadata,
): string {
  const lines = [
    rateLimit.scope === 'search'
      ? 'DeepSeek API rate limit reached while Search was enabled.'
      : 'DeepSeek API rate limit reached.',
    `Code: ${rateLimit.code}`,
    `Message: ${rateLimit.message}`,
    `Retryable: ${rateLimit.retryable ? 'yes' : 'no'}`,
    `API signal status: ${rateLimit.apiSignalStatus}`,
    `UI retry control status: ${rateLimit.uiObservationStatus}`,
  ]

  if (rateLimit.recommendedCooldownMs !== null) {
    lines.push(
      `Recommended cooldown: ${Math.ceil(rateLimit.recommendedCooldownMs / 1000)}s`,
    )
  }

  lines.push(rateLimit.note)
  return lines.join('\n')
}

function selectRateLimitedRun(
  result: DeepSeekReplyResult,
): Pick<
  DeepSeekObservedGenerationRun | DeepSeekParsedGenerationRun,
  'finalized' | 'unknownObservationLabels'
> | null {
  const parsedRun =
    result.output.mode === 'stream'
      ? result.output.canonicalRuns.findLast(
          run => run.finalized.error?.code === 'rate_limit_exceeded',
        ) ?? null
      : null
  if (parsedRun) {
    return parsedRun
  }

  return (
    result.generationRuns.findLast(
      run => run.finalized.error?.code === 'rate_limit_exceeded',
    ) ?? null
  )
}
