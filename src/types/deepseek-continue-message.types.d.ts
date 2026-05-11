import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
  DeepSeekParsedGenerationRun,
} from './deepseek-generation.types.js'
import type { DeepSeekBranch, DeepSeekSession } from './deepseek-session.types.js'

export interface DeepSeekContinueBranchMaterialization {
  kind: 'continue'
  sourceBranchId: string
  sourceAssistantMessageId: string
  sourceParentMessageId: string | null
  materializedBranchId: string
  materializedBranchCreated: boolean
  continuedAssistantMessageId: string | null
  continuationDisposition: 'in-place'
  transcriptShape: 'history-recovered-in-place' | 'synthetic-in-place'
}

export interface DeepSeekContinueMessageRunOnPageResult {
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  generationObservations: DeepSeekGenerationObservation[]
  generationRuns: DeepSeekObservedGenerationRun[]
  canonicalGenerationRuns: DeepSeekParsedGenerationRun[]
  outputTokensUsed: number
  settledAfterMs: number
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterSendSnapshot: DeepSeekComposerSnapshot
  targetMessageId: string
  targetBranchId: string
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
}

export interface DeepSeekMaterializedContinueBranchResult {
  session: DeepSeekSession
  branch: DeepSeekBranch
  materialization: DeepSeekContinueBranchMaterialization
}
