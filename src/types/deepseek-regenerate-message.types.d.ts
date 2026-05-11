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

export interface DeepSeekRegenerateBranchMaterialization {
  kind: 'regenerate'
  sourceBranchId: string
  sourceAssistantMessageId: string
  sourceParentMessageId: string
  materializedBranchId: string
  materializedBranchCreated: boolean
  regeneratedAssistantMessageId: string | null
  prefixMessageIds: string[]
  materializedMessageIds: string[]
  transcriptShape: 'active-view-assistant-only' | 'history-recovered' | 'synthetic-fallback'
}

export interface DeepSeekRegenerateMessageRunOnPageResult {
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
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
}

export interface DeepSeekMaterializedRegenerateBranchResult {
  session: DeepSeekSession
  branch: DeepSeekBranch
  materialization: DeepSeekRegenerateBranchMaterialization
}
