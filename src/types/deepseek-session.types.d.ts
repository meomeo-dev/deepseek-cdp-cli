import type { DeepSeekChatModeFact } from './deepseek-chat-mode.types.js'
import type { DeepSeekSessionCreateObservation } from './deepseek-first-message.types.js'
import type { DeepSeekGenerationObservation } from './deepseek-generation.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'

export type DeepSeekStoredSessionActiveBranchSource =
  | 'first-message'
  | 'reply'
  | 'edit-message'
  | 'regenerate'
  | 'continue'

export type DeepSeekExportBranchSource =
  | 'history_messages'
  | 'stored-session'
  | 'local-materialization'
  | 'mixed'
  | 'unknown'

export type DeepSeekExportTranscriptShape =
  | 'history-recovered'
  | 'history-recovered-in-place'
  | 'active-view-assistant-only'
  | 'synthetic-fallback'
  | 'synthetic-in-place'
  | 'generation-stream-fallback'
  | 'summary-only'
  | 'reply-appended'
  | 'unknown'

export type DeepSeekExportProvenanceWriter =
  | 'first-message'
  | 'reply'
  | 'history_messages'
  | 'edit-message'
  | 'regenerate'
  | 'continue'
  | 'legacy'

export interface DeepSeekStoredBranchExportProvenance {
  branchId: string
  source: DeepSeekExportBranchSource
  transcriptShape: DeepSeekExportTranscriptShape
  transcriptRecoveryStatus: 'recovered' | 'failed' | 'unavailable'
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable' | null
  lastUpdatedBy: DeepSeekExportProvenanceWriter
  updatedAt: string
  sourceBranchId?: string | null | undefined
  sourceMessageId?: string | null | undefined
}

export interface DeepSeekStoredExportProvenance {
  version: 1
  branches: DeepSeekStoredBranchExportProvenance[]
  updatedAt: string
}

export interface DeepSeekCitation {
  id: string
  title: string
  url: string
  snippet?: string | undefined
}

export type DeepSeekSearchStatus = 'searching' | 'results' | 'completed' | 'unknown'

export type DeepSeekSearchReferenceResolution =
  | 'direct-tool-search'
  | 'via-tool-open'
  | 'unresolved'

export interface DeepSeekMessageResponseReference {
  referenceId: string
  referenceType: string
}

export type DeepSeekInlineCitationKind =
  | 'reference-ordinal'
  | 'line-range'
  | 'citation-like-unknown'

export type DeepSeekInlineCitationVerificationStatus =
  | 'verified'
  | 'suspected-generated-citation'
  | 'unverified'

export type DeepSeekInlineCitationResolution =
  | 'response-reference-ordinal'
  | 'no-structured-response-references'
  | 'ordinal-out-of-range'
  | 'unsupported-citation-format'

export interface DeepSeekInlineCitationObservation {
  token: string
  kind: DeepSeekInlineCitationKind
  verificationStatus: DeepSeekInlineCitationVerificationStatus
  resolution: DeepSeekInlineCitationResolution
  ordinal?: number | undefined
  responseReference?: DeepSeekMessageResponseReference | undefined
}

export interface DeepSeekSearchResultReference {
  referenceId: string
  referenceType: string
  resolution: DeepSeekSearchReferenceResolution
  toolSearchFragmentId?: string | undefined
  toolOpenFragmentId?: string | undefined
}

export interface DeepSeekSearchResult {
  id: string
  title: string
  url: string
  query?: string | undefined
  snippet?: string | undefined
  source?: string | undefined
  publishedAt?: string | undefined
  toolSearchFragmentId?: string | undefined
  toolOpenFragmentIds?: string[] | undefined
  responseReferences?: DeepSeekSearchResultReference[] | undefined
}

export interface DeepSeekMessageSearch {
  query: string | null
  status: DeepSeekSearchStatus
  results: DeepSeekSearchResult[]
}

export interface DeepSeekAttachment {
  id: string
  name: string
  mimeType?: string | undefined
  sizeBytes?: number | undefined
  url?: string | undefined
}

export interface DeepSeekMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  text: string
  createdAt: string
  parentId?: string | undefined
  branchId: string
  attachments: DeepSeekAttachment[]
  citations: DeepSeekCitation[]
  responseReferences?: DeepSeekMessageResponseReference[] | undefined
  searches?: DeepSeekMessageSearch[] | undefined
}

export interface DeepSeekBranch {
  id: string
  sessionId: string
  title: string
  createdAt: string
  sourceMessageId?: string | undefined
  messages: DeepSeekMessage[]
}

export interface DeepSeekSession {
  id: string
  agentId: string
  title: string
  createdAt: string
  modeFact?: DeepSeekChatModeFact | undefined
  branches: DeepSeekBranch[]
}

export interface DeepSeekFirstBatchSummary {
  captureMode: 'summary-only' | 'generation-stream'
  userMessageId: string
  assistantMessageId: string
  userPrompt: string
  userPromptPreview: string
  assistantSummary: string
  generationEndpoints: string[]
  completionRequestObserved: boolean
}

export interface DeepSeekStoredSessionOpenAIHistoryBootstrap {
  source: 'openai-http'
  endpoint: '/v1/chat/completions' | '/v1/responses'
  requestId: string | null
  historyItemCount: number
  latestActionableUserTurnIndex: number
  latestTurnFileCount: number
  artifactStageId: string
  artifactFilename: string
  artifactByteSize: number
  importedAt: string
}

export interface DeepSeekStoredSessionCatalogSnapshot {
  version: 1
  title: string
  updatedAt: string
  pinned: boolean
  discoverySource: 'fetch_page'
  syncedAt: string
}

export interface DeepSeekStoredSessionMetadata {
  source: 'first-message'
  requestedUrl: string
  finalUrl: string
  authoritativeAgentId: string
  authoritativeSessionId: string
  sessionCreate: DeepSeekSessionCreateObservation | null
  generationObservations: DeepSeekGenerationObservation[]
  outputTokensUsed: number
  settledAfterMs: number
  firstBatchSummary: DeepSeekFirstBatchSummary
  transcriptRecovery: DeepSeekTranscriptRecovery | null
  lastAssistantTextSource?:
    | 'history_messages'
    | 'generation-stream'
    | 'unavailable'
    | undefined
  modeFact?: DeepSeekChatModeFact | undefined
  exportProvenance?: DeepSeekStoredExportProvenance | undefined
  openaiHistoryBootstrap?: DeepSeekStoredSessionOpenAIHistoryBootstrap | undefined
  lastKnownActiveBranchId?: string | null | undefined
  lastKnownActiveBranchSource?: DeepSeekStoredSessionActiveBranchSource | undefined
  persistedAt: string
}

export interface DeepSeekStoredSession {
  kind: 'deepseek-stored-session'
  version: 1
  session: DeepSeekSession
  metadata: DeepSeekStoredSessionMetadata | null
  catalog?: DeepSeekStoredSessionCatalogSnapshot | undefined
}
