import type {
  DeepSeekReplyRetryAttemptReport,
  DeepSeekReplyRetryDeliveryBoundary,
} from '../../types/deepseek-reply-output.types.js'
import type { DeepSeekUiObservationStatus } from '../../types/deepseek-search-rate-limit.types.js'

export const DEEPSEEK_REPLY_RETRY_DELIVERY_STRATEGY = 'api-cooldown-replay'

export function buildDeepSeekReplyRetryDeliveryBoundary(input: {
  attempts?: DeepSeekReplyRetryAttemptReport[] | undefined
  uiRetryControlStatus?: DeepSeekUiObservationStatus | undefined
} = {}): DeepSeekReplyRetryDeliveryBoundary {
  return {
    strategy: DEEPSEEK_REPLY_RETRY_DELIVERY_STRATEGY,
    uiRetryControlStatus: resolveDeepSeekReplyRetryUiObservationStatus(input),
    note:
      'Automatic retries replay the controlled browser send flow after cooldown. They do not click a confirmed DeepSeek UI retry control.',
  }
}

function resolveDeepSeekReplyRetryUiObservationStatus(input: {
  attempts?: DeepSeekReplyRetryAttemptReport[] | undefined
  uiRetryControlStatus?: DeepSeekUiObservationStatus | undefined
}): DeepSeekUiObservationStatus {
  for (const attempt of input.attempts ?? []) {
    const observedStatus = attempt.rateLimit?.uiObservationStatus
    if (observedStatus === 'ui-observation-pending') {
      return observedStatus
    }
  }

  for (const attempt of input.attempts ?? []) {
    const observedStatus = attempt.rateLimit?.uiObservationStatus
    if (observedStatus === 'not_observed') {
      return observedStatus
    }
  }

  return input.uiRetryControlStatus ?? 'ui-observation-pending'
}
