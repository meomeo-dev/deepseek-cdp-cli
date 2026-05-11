import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
} from './deepseek-generation.types.js'
import type { RequestBudgetSnapshot } from '../shared/rate-limit/requestBudget.js'
import type {
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from './deepseek-composer-mode.types.js'
import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type { DeepSeekFileUploadBatchResult } from './deepseek-file.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'

export interface DeepSeekSessionCreateObservation {
  sessionId: string | null
  agentId: string | null
  url: string
  status: number
}

export interface DeepSeekFirstMessageResult {
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
  transcriptRecovery?: DeepSeekTranscriptRecovery | null
}
