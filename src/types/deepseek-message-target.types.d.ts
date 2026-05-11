import type {
  DeepSeekBranch,
  DeepSeekMessage,
  DeepSeekSession,
} from './deepseek-session.types.js'
import type {
  DeepSeekSessionBranchCatalog,
  DeepSeekSessionBranchSummary,
} from './deepseek-branch-catalog.types.js'

export type DeepSeekActiveBranchSource = 'page' | 'stored-session' | 'unavailable'

export type DeepSeekBranchLineageKind = 'root' | 'fork' | 'unresolved'

export interface DeepSeekBranchLineageFact {
  branchId: string
  sourceMessageId: string | null
  sourceMessageBranchIds: string[]
  parentBranchId: string | null
  lineageKind: DeepSeekBranchLineageKind
  lineagePath: string[]
}

export interface DeepSeekSessionMessageTargetContext {
  sessionId: string
  defaultBranchId: string | null
  activeBranchId: string | null
  activeBranchSource: DeepSeekActiveBranchSource
  catalog: DeepSeekSessionBranchCatalog
  lineage: DeepSeekBranchLineageFact[]
}

export type DeepSeekMessageTargetResolutionSource =
  | 'explicit-branch'
  | 'explicit-message'
  | 'active-branch'
  | 'default-branch'

export interface DeepSeekResolvedMessageTarget {
  sessionFile: string
  session: DeepSeekSession
  context: DeepSeekSessionMessageTargetContext
  resolvedBranchId: string
  resolutionSource: DeepSeekMessageTargetResolutionSource
  branch: DeepSeekBranch
  branchSummary: DeepSeekSessionBranchSummary
  branchLineage: DeepSeekBranchLineageFact
  messageId: string | null
  message: DeepSeekMessage | null
  candidateBranchIds: string[]
}
