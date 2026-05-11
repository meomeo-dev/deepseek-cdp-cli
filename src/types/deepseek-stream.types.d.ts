import type { DeepSeekChatModeFact } from './deepseek-chat-mode.types.js'

export type DeepSeekGenerationEndpoint =
  | '/api/v0/chat/completion'
  | '/api/v0/chat/regenerate'
  | '/api/v0/chat/continue'
  | '/api/v0/chat/edit_message'
  | '/api/v0/chat/resume_stream'

export type DeepSeekGenerationTransport = 'sse' | 'json'

export type DeepSeekGenerationEventKind =
  | 'text.delta'
  | 'reasoning.delta'
  | 'search.patch'
  | 'citation.patch'
  | 'usage.update'
  | 'finish'
  | 'stopped'
  | 'error'
  | 'completed'

export type DeepSeekGenerationPatchMode = 'append' | 'replace'

export type DeepSeekGenerationReasoningKind = 'thinking' | 'summary' | 'unknown'

export type DeepSeekGenerationSearchStatus = 'searching' | 'results' | 'completed'

export type DeepSeekGenerationTerminalStatus = 'completed' | 'stopped' | 'failed'

export type DeepSeekGenerationFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'function_call'
  | 'content_filter'
  | 'stopped'
  | 'error'
  | 'unknown'

export type DeepSeekCitationSource = 'search' | 'document' | 'url' | 'unknown'

export interface DeepSeekGenerationRunContext {
  runId: string
  endpoint: DeepSeekGenerationEndpoint
  transport: DeepSeekGenerationTransport
  requestUrl: string
  routeUrl: string | null
  agentId: string | null
  sessionId: string | null
  branchId: string | null
  parentMessageId: string | null
  assistantMessageId: string | null
  modeFact?: DeepSeekChatModeFact | null | undefined
  requestId?: string
}

export interface DeepSeekGenerationUsageSnapshot {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export interface DeepSeekGenerationSearchResult {
  id: string
  title: string
  url: string
  snippet?: string
  source?: string
  publishedAt?: string
}

export interface DeepSeekGenerationSearchState {
  query: string | null
  status: DeepSeekGenerationSearchStatus
  results: DeepSeekGenerationSearchResult[]
}

export interface DeepSeekGenerationCitationAnnotation {
  source: DeepSeekCitationSource
  startIndex?: number
  endIndex?: number
}

export interface DeepSeekGenerationCitation {
  id: string
  title: string
  url: string
  snippet?: string
  annotation?: DeepSeekGenerationCitationAnnotation
}

export interface DeepSeekGenerationResponseReference {
  referenceId: string
  referenceType: string
}

export interface DeepSeekGenerationErrorDetail {
  code: string | null
  message: string
  retryable: boolean
  cause?: string
}

export interface DeepSeekGenerationEventBase {
  kind: DeepSeekGenerationEventKind
  sequence: number
  occurredAt: string
  context: DeepSeekGenerationRunContext
}

export interface DeepSeekGenerationTextDeltaEvent extends DeepSeekGenerationEventBase {
  kind: 'text.delta'
  delta: string
  accumulatedText?: string
}

export interface DeepSeekGenerationReasoningDeltaEvent extends DeepSeekGenerationEventBase {
  kind: 'reasoning.delta'
  reasoningKind: DeepSeekGenerationReasoningKind
  delta: string
  accumulatedText?: string
}

export interface DeepSeekGenerationSearchPatchEvent extends DeepSeekGenerationEventBase {
  kind: 'search.patch'
  patchMode: DeepSeekGenerationPatchMode
  search: DeepSeekGenerationSearchState
}

export interface DeepSeekGenerationCitationPatchEvent extends DeepSeekGenerationEventBase {
  kind: 'citation.patch'
  patchMode: DeepSeekGenerationPatchMode
  citations: DeepSeekGenerationCitation[]
}

export interface DeepSeekGenerationUsageUpdateEvent extends DeepSeekGenerationEventBase {
  kind: 'usage.update'
  usage: DeepSeekGenerationUsageSnapshot
}

export interface DeepSeekGenerationFinishEvent extends DeepSeekGenerationEventBase {
  kind: 'finish'
  finishReason: DeepSeekGenerationFinishReason
}

export interface DeepSeekGenerationStoppedEvent extends DeepSeekGenerationEventBase {
  kind: 'stopped'
  stopReason: 'user' | 'system' | 'unknown'
}

export interface DeepSeekGenerationErrorEvent extends DeepSeekGenerationEventBase {
  kind: 'error'
  error: DeepSeekGenerationErrorDetail
}

export interface DeepSeekGenerationCompletedState {
  status: DeepSeekGenerationTerminalStatus
  finishReason: DeepSeekGenerationFinishReason
  outputText: string
  reasoningText: string
  reasoningKind: DeepSeekGenerationReasoningKind
  citations: DeepSeekGenerationCitation[]
  responseReferences: DeepSeekGenerationResponseReference[]
  searches: DeepSeekGenerationSearchState[]
  usage: DeepSeekGenerationUsageSnapshot | null
  error: DeepSeekGenerationErrorDetail | null
  completedAt: string
}

export interface DeepSeekGenerationCompletedEvent extends DeepSeekGenerationEventBase {
  kind: 'completed'
  result: DeepSeekGenerationCompletedState
}

export type DeepSeekGenerationStreamEvent =
  | DeepSeekGenerationTextDeltaEvent
  | DeepSeekGenerationReasoningDeltaEvent
  | DeepSeekGenerationSearchPatchEvent
  | DeepSeekGenerationCitationPatchEvent
  | DeepSeekGenerationUsageUpdateEvent
  | DeepSeekGenerationFinishEvent
  | DeepSeekGenerationStoppedEvent
  | DeepSeekGenerationErrorEvent
  | DeepSeekGenerationCompletedEvent
