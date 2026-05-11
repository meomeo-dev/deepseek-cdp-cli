import type { DeepSeekChatModeFact } from './deepseek-chat-mode.types.js'
import type {
  DeepSeekResolvedSessionSource,
  DeepSeekSessionBranchCatalog,
  DeepSeekSessionBranchSummary,
} from './deepseek-branch-catalog.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'
import type {
  DeepSeekAttachment,
  DeepSeekBranch,
  DeepSeekCitation,
  DeepSeekMessageSearch,
  DeepSeekSearchResult,
  DeepSeekSession,
  DeepSeekStoredBranchExportProvenance,
  DeepSeekStoredSession,
} from './deepseek-session.types.js'

export interface DeepSeekSessionExportAuthority {
  sessionFile: string
  sessionId: string
  agentId: string
  finalUrl: string | null
}

export interface DeepSeekSessionExportBranchSnapshot {
  branchId: string
  branch: DeepSeekBranch
  summary: DeepSeekSessionBranchSummary
  provenance: DeepSeekStoredBranchExportProvenance
}

export interface DeepSeekBranchExportSearchEvidence {
  available: boolean
  derivedFrom: 'message-searches' | 'citations' | 'none'
  queryCount: number
  resultCount: number
  searches: DeepSeekMessageSearch[]
  results: DeepSeekSearchResult[]
}

export interface DeepSeekSessionExportBranchDocument {
  branchId: string
  title: string
  createdAt: string
  summary: DeepSeekSessionBranchSummary
  provenance: DeepSeekStoredBranchExportProvenance
  attachments: DeepSeekAttachment[]
  citations: DeepSeekCitation[]
  searchEvidence: DeepSeekBranchExportSearchEvidence
  messages: DeepSeekBranch['messages']
}

export interface DeepSeekSessionBranchExportDocument {
  kind: 'deepseek-session-branch-export'
  version: 1
  exportedAt: string
  authority: DeepSeekSessionExportAuthority
  session: {
    sessionId: string
    agentId: string
    title: string
    createdAt: string
    branchCount: number
    defaultBranchId: string | null
    activeBranchId: string | null
    activeBranchSource: DeepSeekSessionBranchCatalog['activeBranchSource']
    transcriptRecovery: DeepSeekTranscriptRecovery | null
    modeFact: DeepSeekChatModeFact | null
  }
  branch: DeepSeekSessionExportBranchDocument
}

export interface DeepSeekSessionExportBranchIndexEntry {
  branchId: string
  title: string
  createdAt: string
  summary: DeepSeekSessionBranchSummary
  provenance: DeepSeekStoredBranchExportProvenance
}

export interface DeepSeekSessionExportDocument {
  kind: 'deepseek-session-export'
  version: 1
  exportedAt: string
  authority: DeepSeekSessionExportAuthority
  session: {
    sessionId: string
    agentId: string
    title: string
    createdAt: string
    branchCount: number
    defaultBranchId: string | null
    activeBranchId: string | null
    activeBranchSource: DeepSeekSessionBranchCatalog['activeBranchSource']
    transcriptRecovery: DeepSeekTranscriptRecovery | null
    modeFact: DeepSeekChatModeFact | null
    totalMessageCount: number
    totalUserMessageCount: number
    totalAssistantMessageCount: number
    totalAttachmentCount: number
    totalCitationCount: number
  }
  branchIndex: DeepSeekSessionExportBranchIndexEntry[]
  branches: DeepSeekSessionExportBranchDocument[]
}

export interface DeepSeekSessionExportSnapshot {
  authority: DeepSeekSessionExportAuthority
  storedSession: DeepSeekStoredSession
  session: DeepSeekSession
  catalog: DeepSeekSessionBranchCatalog
  transcriptRecovery: DeepSeekTranscriptRecovery | null
  branches: DeepSeekSessionExportBranchSnapshot[]
}

export interface BuildDeepSeekSessionExportSnapshotInput {
  source: DeepSeekResolvedSessionSource
}
