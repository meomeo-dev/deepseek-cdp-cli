import type { DeepSeekParsedGenerationRun } from './deepseek-generation.types.js'
import type { DeepSeekGenerationCapturedExchange } from './deepseek-generation-parser.types.js'

export type DeepSeekUiObservationStatus =
  | 'ui-observation-pending'
  | 'not_observed'

export interface DeepSeekSearchWaitPolicy {
  firstTokenObservationWindowMs: number
  recommendedProbeTimeoutMs: number
  recommendedRateLimitCooldownMs: number
  notes: string[]
}

export interface DeepSeekSearchRateLimitSignal {
  observed: boolean
  apiSignalStatus: 'confirmed' | 'not_observed'
  rawHintMessage: string | null
  rawFinishReason: string | null
  normalizedErrorCode: 'rate_limit_exceeded' | null
  clickBehavior: string | null
  autoResume: boolean | null
  uiRetryControlStatus: DeepSeekUiObservationStatus
}

export interface DeepSeekSearchProbeClassification {
  kind: 'rate_limit' | 'search_success' | 'failed'
  retryable: boolean
  normalizedErrorCode: string | null
  uiRetryControlStatus: DeepSeekSearchRateLimitSignal['uiRetryControlStatus']
  message: string
}

export interface DeepSeekSearchRateLimitOutputMetadata {
  code: 'rate_limit_exceeded'
  message: string
  retryable: boolean
  scope: 'search' | 'general'
  apiSignalStatus: 'confirmed' | 'inferred'
  uiRetryControlStatus: DeepSeekUiObservationStatus
  uiObservationStatus: DeepSeekUiObservationStatus
  recommendedCooldownMs: number | null
  rawFinishReason: string | null
  clickBehavior: 'retry' | null
  note: string
}

export interface DeepSeekSearchProbeClassificationInput {
  run: DeepSeekParsedGenerationRun | null
  exchange: DeepSeekGenerationCapturedExchange | null
}
