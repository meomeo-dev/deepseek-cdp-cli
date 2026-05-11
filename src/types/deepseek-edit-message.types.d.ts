import type {
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeRequest,
  DeepSeekResolvedComposerMode,
} from './deepseek-composer-mode.types.js'
import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
  DeepSeekParsedGenerationRun,
} from './deepseek-generation.types.js'
import type { DeepSeekBranch, DeepSeekSession } from './deepseek-session.types.js'

export interface DeepSeekEditComposerState {
  expectedPrefill: string
  observedPrefill: string
  replacementPrompt: string
}

export interface DeepSeekEditBranchMaterialization {
  kind: 'edit-message'
  sourceBranchId: string
  sourceMessageId: string
  materializedBranchId: string
  materializedBranchCreated: boolean
  replacementMessageId: string | null
  assistantMessageId: string | null
  prefixMessageIds: string[]
  materializedMessageIds: string[]
  transcriptShape: 'history-recovered' | 'synthetic-fallback'
}

export interface DeepSeekEditMessageRunOnPageResult {
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  generationObservations: DeepSeekGenerationObservation[]
  generationRuns: DeepSeekObservedGenerationRun[]
  canonicalGenerationRuns: DeepSeekParsedGenerationRun[]
  outputTokensUsed: number
  settledAfterMs: number
  requestedComposerMode: DeepSeekComposerModeRequest
  effectiveComposerMode?: DeepSeekComposerModeRequest | undefined
  ignoredComposerToggles?: DeepSeekComposerIgnoredToggle[] | undefined
  composerMode: DeepSeekResolvedComposerMode
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterSendSnapshot: DeepSeekComposerSnapshot
  targetMessageId: string
  targetBranchId: string
  composerState: DeepSeekEditComposerState
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
}

export interface DeepSeekMaterializedEditBranchResult {
  session: DeepSeekSession
  branch: DeepSeekBranch
  materialization: DeepSeekEditBranchMaterialization
}
