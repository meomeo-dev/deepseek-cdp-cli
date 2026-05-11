import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
  DeepSeekParsedGenerationRun,
} from './deepseek-generation.types.js'
import type {
  DeepSeekMessageActionControlKind,
  DeepSeekMessageActionControlMatch,
  DeepSeekMessageActionSnapshot,
} from './deepseek-message-actions.types.js'

export type DeepSeekUiRetryObservationPath =
  | 'page-visible'
  | 'message-action-snapshot'
  | 'message-overflow-menu'
  | 'reopen-page-visible'
  | 'reopen-message-action-snapshot'
  | 'reopen-message-overflow-menu'

export interface DeepSeekUiRetryHintSnapshot {
  text: string
  selector: string
}

export interface DeepSeekUiRetryVisibleControlCandidate {
  selector: string
  tagName: string
  role: string | null
  className: string | null
  label: string | null
  text: string | null
  ariaLabel: string | null
  title: string | null
  testId: string | null
  controlKind: DeepSeekMessageActionControlKind
  observationPath: DeepSeekUiRetryObservationPath
}

export interface DeepSeekUiRetryMessageActionMatch {
  messageId: string
  role: 'user' | 'assistant' | 'unknown'
  textPreview: string | null
  control: DeepSeekMessageActionControlMatch
  observationPath: Extract<
    DeepSeekUiRetryObservationPath,
    'message-action-snapshot' | 'reopen-message-action-snapshot'
  >
}

export interface DeepSeekUiRetryAuditStep {
  observationPath: DeepSeekUiRetryObservationPath
  observed: boolean
  hintCount: number
  pageCandidateCount: number
  messageActionMatchCount: number
  notes: string[]
}

export interface DeepSeekUiRetryAuditResult {
  pageUrl: string
  targetMessageId: string | null
  observed: boolean
  unresolvedReason: string | null
  visibleHints: DeepSeekUiRetryHintSnapshot[]
  pageCandidates: DeepSeekUiRetryVisibleControlCandidate[]
  messageActionSnapshot: DeepSeekMessageActionSnapshot | null
  messageActionMatches: DeepSeekUiRetryMessageActionMatch[]
  steps: DeepSeekUiRetryAuditStep[]
}

export interface DeepSeekResolvedRetryUiTarget {
  messageId: string | null
  source: 'message-action-match' | 'canonical-generation' | 'missing'
}

export interface DeepSeekRetryUiRunOnPageResult {
  requestedUrl: string
  finalUrl: string
  agentId: string
  sessionId: string
  targetMessageId: string
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterSendSnapshot: DeepSeekComposerSnapshot
  beforeActionSnapshot: DeepSeekMessageActionSnapshot
  resolvedControl: DeepSeekMessageActionControlMatch
  generationObservations: DeepSeekGenerationObservation[]
  generationRuns: DeepSeekObservedGenerationRun[]
  canonicalGenerationRuns: DeepSeekParsedGenerationRun[]
  outputTokensUsed: number
  settledAfterMs: number
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
}
