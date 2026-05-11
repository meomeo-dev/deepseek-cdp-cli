import type { RequestBudgetSnapshot } from '../shared/rate-limit/requestBudget.js'
import type {
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from './deepseek-composer-mode.types.js'
import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type { DeepSeekFileUploadBatchResult } from './deepseek-file.types.js'
import type { DeepSeekSessionCreateObservation } from './deepseek-first-message.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
  DeepSeekParsedGenerationRun,
} from './deepseek-generation.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'
import type { DeepSeekSession } from './deepseek-session.types.js'
import type { DeepSeekConversationMutation } from './deepseek-message-mutation.types.js'
import type { DeepSeekSearchRateLimitOutputMetadata } from './deepseek-search-rate-limit.types.js'
import type { DeepSeekReplyRetryReport } from './deepseek-reply-output.types.js'

export type DeepSeekReplyEntryMode =
  | 'new-session'
  | 'existing-session'
  | 'message-continue'
  | 'message-edit'
  | 'message-regenerate'

export interface DeepSeekBufferedReplyOutput {
  mode: 'buffered'
  canonicalEvents: []
  canonicalRuns: []
  finalizedAssistantText: string | null
}

export interface DeepSeekStreamingReplyOutput {
  mode: 'stream'
  canonicalEvents: DeepSeekParsedGenerationRun['events'][number][]
  canonicalRuns: DeepSeekParsedGenerationRun[]
  finalizedAssistantText: string | null
}

export type DeepSeekReplyOutput =
  | DeepSeekBufferedReplyOutput
  | DeepSeekStreamingReplyOutput

export interface DeepSeekReplyResult {
  entryMode: DeepSeekReplyEntryMode
  streamRequested: boolean
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  sessionFile: string
  sessionCreate: DeepSeekSessionCreateObservation | null
  completionRequestObserved: boolean
  generationObservations: DeepSeekGenerationObservation[]
  generationRuns: DeepSeekObservedGenerationRun[]
  outputTokensUsed: number
  settledAfterMs: number
  budget: RequestBudgetSnapshot
  requestedComposerMode: DeepSeekComposerModeRequest
  effectiveComposerMode?: DeepSeekComposerModeRequest | undefined
  ignoredComposerToggles?: DeepSeekComposerIgnoredToggle[] | undefined
  composerMode: DeepSeekResolvedComposerMode
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterSendSnapshot: DeepSeekComposerSnapshot
  fileUpload?: DeepSeekFileUploadBatchResult | null
  assistantText: string | null
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  rateLimit?: DeepSeekSearchRateLimitOutputMetadata | null
  retry?: DeepSeekReplyRetryReport | null
  transcriptRecovery: DeepSeekTranscriptRecovery | null
  mutation?: DeepSeekConversationMutation | null
  session: DeepSeekSession
  output: DeepSeekReplyOutput
}
