import type { ReplyDeepSeekMessageInput } from '../application/usecases/replyDeepSeekMessage.js'
import type { ContinueDeepSeekAssistantMessageInput } from '../application/usecases/continueDeepSeekAssistantMessage.js'
import type { EditDeepSeekUserMessageInput } from '../application/usecases/editDeepSeekUserMessage.js'
import type { RegenerateDeepSeekAssistantMessageInput } from '../application/usecases/regenerateDeepSeekAssistantMessage.js'
import type {
  DeepSeekOutputJsonShape,
  DeepSeekResolvedOutputMode,
} from './deepseek-output-modes.types.js'
import type { DeepSeekReplyResult } from './deepseek-reply.types.js'
import type {
  DeepSeekSearchRateLimitOutputMetadata,
  DeepSeekUiObservationStatus,
} from './deepseek-search-rate-limit.types.js'
import type {
  DeepSeekCitation,
  DeepSeekInlineCitationObservation,
  DeepSeekMessageSearch,
  DeepSeekMessageResponseReference,
} from './deepseek-session.types.js'
import type { DeepSeekGenerationStreamEvent } from './deepseek-stream.types.js'

export interface DeepSeekReplyOutputOptionInput {
  stream?: boolean | undefined
  legacyStream?: boolean | undefined
  format?: string | undefined
  jsonShape?: string | undefined
}

export interface DeepSeekReplyRetryOptionInput {
  onRateLimit?: boolean | undefined
  maxRetries?: number | undefined
  cooldownMs?: number | undefined
  countdown?: boolean | undefined
}

export interface DeepSeekResolvedReplyRetryPolicy {
  onRateLimit: boolean
  maxRetries: number
  cooldownMs: number | null
  countdown: boolean
}

export interface DeepSeekReplyRetryAttemptReport {
  attemptNumber: number
  startedAt: string
  finishedAt: string
  finalStatus: 'completed' | 'stopped' | 'failed' | 'unknown'
  finishReason: string | null
  errorCode: string | null
  errorMessage: string | null
  rateLimit: DeepSeekSearchRateLimitOutputMetadata | null
  retryScheduled: boolean
  cooldownMs: number | null
  finalUrl: string | null
  sessionId: string | null
}

export type DeepSeekReplyRetryDeliveryStrategy = 'api-cooldown-replay'

export interface DeepSeekReplyRetryDeliveryBoundary {
  strategy: DeepSeekReplyRetryDeliveryStrategy
  uiRetryControlStatus: DeepSeekUiObservationStatus
  note: string
}

export interface DeepSeekReplyRetryReport {
  policy: DeepSeekResolvedReplyRetryPolicy
  attempts: DeepSeekReplyRetryAttemptReport[]
  totalAttempts: number
  retriedAttempts: number
  exhausted: boolean
  boundary: DeepSeekReplyRetryDeliveryBoundary
}

export type DeepSeekReplyRetryProgressEvent =
  | {
      kind: 'retry.scheduled'
      attemptNumber: number
      nextAttemptNumber: number
      cooldownMs: number
      maxRetries: number
      rateLimit: DeepSeekSearchRateLimitOutputMetadata
    }
  | {
      kind: 'retry.tick'
      attemptNumber: number
      nextAttemptNumber: number
      remainingMs: number
      cooldownMs: number
    }
  | {
      kind: 'retry.peer-wait'
      attemptNumber: number
      nextAttemptNumber: number
      activeSearchAttemptCount: number
    }
  | {
      kind: 'retry.starting'
      attemptNumber: number
      maxRetries: number
    }
  | {
      kind: 'retry.exhausted'
      attemptNumber: number
      maxRetries: number
      rateLimit: DeepSeekSearchRateLimitOutputMetadata
    }

export type DeepSeekReplyAssistantArtifactSource =
  | 'session-target'
  | 'session-text-match'
  | 'session-latest'
  | 'generation-run'
  | 'unresolved'

export interface DeepSeekReplyAssistantArtifactsSummary {
  source: DeepSeekReplyAssistantArtifactSource
  branchId: string | null
  messageId: string | null
  inlineReferenceTokens: string[]
  inlineCitationObservations: DeepSeekInlineCitationObservation[]
  citationCount: number
  searchCount: number
  citations: DeepSeekCitation[]
  responseReferences: DeepSeekMessageResponseReference[]
  searches: DeepSeekMessageSearch[]
}

export interface DeepSeekReplyRetryProgressInput {
  onEvent?: ((event: DeepSeekReplyRetryProgressEvent) => void) | undefined
}

export type DeepSeekReplyLiveEvent =
  | {
      kind: 'attempt.started'
      attemptNumber: number
      outputMode: DeepSeekResolvedOutputMode
    }
  | {
      kind: 'generation.event'
      attemptNumber: number
      outputMode: DeepSeekResolvedOutputMode
      source: 'buffered' | 'live' | 'finalize'
      event: DeepSeekGenerationStreamEvent
    }
  | {
      kind: 'attempt.completed'
      attemptNumber: number
      outputMode: DeepSeekResolvedOutputMode
      result: DeepSeekReplyResult
      willRetry: boolean
    }
  | {
      kind: 'retry.progress'
      attemptNumber: number
      outputMode: DeepSeekResolvedOutputMode
      progress: DeepSeekReplyRetryProgressEvent
    }

export interface DeepSeekReplyLiveDeliveryInput {
  onEvent?: ((event: DeepSeekReplyLiveEvent) => void) | undefined
}

export interface DeepSeekReplyExecutionInput {
  reply: ReplyDeepSeekMessageInput
  output?: DeepSeekReplyOutputOptionInput | undefined
  retry?: DeepSeekReplyRetryOptionInput | undefined
  progress?: DeepSeekReplyRetryProgressInput | undefined
  live?: DeepSeekReplyLiveDeliveryInput | undefined
}

export interface DeepSeekEditMessageExecutionInput {
  edit: EditDeepSeekUserMessageInput
  output?: DeepSeekReplyOutputOptionInput | undefined
  live?: DeepSeekReplyLiveDeliveryInput | undefined
}

export interface DeepSeekContinueMessageExecutionInput {
  continue: ContinueDeepSeekAssistantMessageInput
  output?: DeepSeekReplyOutputOptionInput | undefined
  live?: DeepSeekReplyLiveDeliveryInput | undefined
}

export interface DeepSeekRegenerateMessageExecutionInput {
  regenerate: RegenerateDeepSeekAssistantMessageInput
  output?: DeepSeekReplyOutputOptionInput | undefined
  live?: DeepSeekReplyLiveDeliveryInput | undefined
}

export interface DeepSeekReplyExecutionResult {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
}

export interface DeepSeekBufferedTextOutput {
  format: 'text'
  text: string
}

export interface DeepSeekBufferedJsonOutput {
  format: 'json'
  jsonShape: DeepSeekOutputJsonShape
  data: unknown
}

export type DeepSeekBufferedReplyOutput =
  | DeepSeekBufferedTextOutput
  | DeepSeekBufferedJsonOutput

export interface DeepSeekStreamingTextOutputChunk {
  format: 'text'
  delta: string
}

export interface DeepSeekStreamingJsonOutputChunk {
  format: 'stream-json'
  jsonShape: DeepSeekOutputJsonShape
  data: unknown
}

export type DeepSeekStreamingReplyOutputChunk =
  | DeepSeekStreamingTextOutputChunk
  | DeepSeekStreamingJsonOutputChunk

export interface DeepSeekReplyOutputSummary {
  entryMode: DeepSeekReplyResult['entryMode']
  requestedUrl: DeepSeekReplyResult['requestedUrl']
  finalUrl: DeepSeekReplyResult['finalUrl']
  agentId: DeepSeekReplyResult['agentId']
  sessionId: DeepSeekReplyResult['sessionId']
  sessionFile: DeepSeekReplyResult['sessionFile']
  assistantText: DeepSeekReplyResult['assistantText']
  assistantTextSource: DeepSeekReplyResult['assistantTextSource']
  outputTokensUsed: DeepSeekReplyResult['outputTokensUsed']
  settledAfterMs: DeepSeekReplyResult['settledAfterMs']
  budget: DeepSeekReplyResult['budget']
  requestedComposerMode: DeepSeekReplyResult['requestedComposerMode']
  effectiveComposerMode?: DeepSeekReplyResult['effectiveComposerMode']
  ignoredComposerToggles?: DeepSeekReplyResult['ignoredComposerToggles']
  composerMode: DeepSeekReplyResult['composerMode']
  fileUpload?: DeepSeekReplyResult['fileUpload']
  rateLimit: DeepSeekSearchRateLimitOutputMetadata | null
  retry: DeepSeekReplyRetryReport | null
  transcriptRecovery: DeepSeekReplyResult['transcriptRecovery']
  assistantArtifacts: DeepSeekReplyAssistantArtifactsSummary
}
