import type { RequestBudgetSnapshot } from '../shared/rate-limit/requestBudget.js'
import type {
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from './deepseek-composer-mode.types.js'
import type { DeepSeekContinuePreflightResult } from './deepseek-continue-preflight.types.js'
import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type { DeepSeekSessionCreateObservation } from './deepseek-first-message.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
} from './deepseek-generation.types.js'
import type { DeepSeekSession } from './deepseek-session.types.js'
import type {
  DeepSeekGenerationSettlement,
  DeepSeekObservedStreamControl,
} from './deepseek-stream-control.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'

export type DeepSeekContinueTargetEntryMode = 'new-session' | 'existing-session'

export interface DeepSeekContinueTargetStopAttempt {
  generationResponseObserved: boolean
  stopModeObserved: boolean
  stopClickIssued: boolean
  stopAfterMs: number
}

export interface DeepSeekPreparedContinueTarget {
  branchId: string | null
  activeBranchId: string | null
  messageId: string | null
  parentMessageId: string | null
  assistantText: string | null
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  status:
    | 'resumable'
    | 'stopped'
    | 'completed'
    | 'failed'
    | 'auto-resumed'
    | 'unknown'
  continueCommand: string | null
}

export interface DeepSeekPrepareContinueTargetResult {
  entryMode: DeepSeekContinueTargetEntryMode
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  sessionFile: string
  sessionCreate: DeepSeekSessionCreateObservation | null
  budget: RequestBudgetSnapshot
  outputTokensUsed: number
  settledAfterMs: number
  requestedComposerMode: DeepSeekComposerModeRequest
  composerMode: DeepSeekResolvedComposerMode
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterStopSnapshot: DeepSeekComposerSnapshot
  generationObservations: DeepSeekGenerationObservation[]
  generationRuns: DeepSeekObservedGenerationRun[]
  streamControls: DeepSeekObservedStreamControl[]
  liveSettlement: DeepSeekGenerationSettlement
  preflight: DeepSeekContinuePreflightResult
  stopAttempt: DeepSeekContinueTargetStopAttempt
  transcriptRecovery: DeepSeekTranscriptRecovery | null
  target: DeepSeekPreparedContinueTarget
  session: DeepSeekSession
}
