import type {
  DeepSeekActiveBranchSource,
  DeepSeekBranchLineageFact,
} from './deepseek-message-target.types.js'
import type { DeepSeekBranch, DeepSeekSession, DeepSeekStoredSession } from './deepseek-session.types.js'

export interface DeepSeekSessionBranchSummary {
  branchId: string
  sessionId: string
  title: string
  createdAt: string
  sourceMessageId?: string | undefined
  sourceMessageBranchIds: string[]
  parentBranchId: string | null
  lineageKind: DeepSeekBranchLineageFact['lineageKind']
  lineagePath: string[]
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  attachmentCount: number
  citationCount: number
  firstMessageId: string | null
  lastMessageId: string | null
  lastMessageRole: DeepSeekBranch['messages'][number]['role'] | null
  lastMessageAt: string | null
  previewText: string | null
}

export interface DeepSeekSessionBranchCatalog {
  sessionId: string
  agentId: string
  title: string
  createdAt: string
  branchCount: number
  defaultBranchId: string | null
  activeBranchId: string | null
  activeBranchSource: DeepSeekActiveBranchSource
  branches: DeepSeekSessionBranchSummary[]
}

export interface DeepSeekResolvedSessionSource {
  sessionFile: string
  storedSession: DeepSeekStoredSession
  session: DeepSeekSession
  authoritativeSessionId: string
  authoritativeAgentId: string
  finalUrl: string | null
}

export interface DeepSeekResolvedBranchTarget {
  sessionFile: string
  session: DeepSeekSession
  branch: DeepSeekBranch
  summary: DeepSeekSessionBranchSummary
  catalog: DeepSeekSessionBranchCatalog
}
