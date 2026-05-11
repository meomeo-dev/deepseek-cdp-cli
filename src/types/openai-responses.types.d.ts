import type { DeepSeekGenerationStreamEvent } from './deepseek-stream.types.js'

export type OpenAIResponsesOutputTextFormat = {
  type: 'text'
}

export type OpenAIResponsesStatus = 'in_progress' | 'completed' | 'failed' | 'incomplete'

export type OpenAIResponsesErrorCode = string

export interface OpenAIResponsesError {
  code: OpenAIResponsesErrorCode
  message: string
}

export interface OpenAIResponsesIncompleteDetails {
  reason: 'max_output_tokens' | 'content_filter'
}

export interface OpenAIResponsesUsage {
  input_tokens: number
  input_tokens_details: {
    cached_tokens: number
  }
  output_tokens: number
  output_tokens_details: {
    reasoning_tokens: number
  }
  total_tokens: number
}

export interface OpenAIResponsesUrlCitationAnnotation {
  type: 'url_citation'
  url: string
  start_index: number
  end_index: number
  title: string
}

export interface OpenAIResponsesFileCitationAnnotation {
  type: 'file_citation'
  file_id: string
  index: number
  filename: string
}

export type OpenAIResponsesAnnotation =
  | OpenAIResponsesUrlCitationAnnotation
  | OpenAIResponsesFileCitationAnnotation

export interface OpenAIResponsesOutputTextContent {
  type: 'output_text'
  text: string
  annotations: OpenAIResponsesAnnotation[]
  logprobs?: []
}

export interface OpenAIResponsesInputTextContent {
  type: 'input_text'
  text: string
}

export interface OpenAIResponsesInputFileContent {
  type: 'input_file'
  file_id?: string | null
  filename?: string
  file_url?: string
}

export type OpenAIResponsesInputContent =
  | OpenAIResponsesInputTextContent
  | OpenAIResponsesInputFileContent

export interface OpenAIResponsesInputMessageItem {
  id: string
  type: 'message'
  role: 'assistant' | 'developer' | 'system' | 'user'
  content: OpenAIResponsesInputContent[]
  status: 'in_progress' | 'completed' | 'incomplete'
}

export interface OpenAIResponsesReasoningTextContent {
  type: 'reasoning_text'
  text: string
}

export interface OpenAIResponsesSummaryText {
  type: 'summary_text'
  text: string
}

export interface OpenAIResponsesMessageItem {
  id: string
  type: 'message'
  role: 'assistant'
  content: OpenAIResponsesOutputTextContent[]
  status: 'in_progress' | 'completed' | 'incomplete'
}

export interface OpenAIResponsesReasoningItem {
  id: string
  type: 'reasoning'
  summary: OpenAIResponsesSummaryText[]
  content?: OpenAIResponsesReasoningTextContent[]
  status?: 'in_progress' | 'completed' | 'incomplete'
}

export interface OpenAIResponsesWebSearchActionSource {
  type: 'url'
  url: string
}

export interface OpenAIResponsesWebSearchActionSearch {
  type: 'search'
  query: string
  queries?: string[]
  sources?: OpenAIResponsesWebSearchActionSource[]
}

export interface OpenAIResponsesWebSearchCallItem {
  id: string
  type: 'web_search_call'
  status: 'in_progress' | 'searching' | 'completed' | 'failed'
  action: OpenAIResponsesWebSearchActionSearch
}

export type OpenAIResponsesOutputItem =
  | OpenAIResponsesMessageItem
  | OpenAIResponsesReasoningItem
  | OpenAIResponsesWebSearchCallItem

export type OpenAIResponsesItemResource =
  | OpenAIResponsesInputMessageItem
  | OpenAIResponsesOutputItem

export interface OpenAIResponseObject {
  id: string
  object: 'response'
  created_at: number
  completed_at: number | null
  status: OpenAIResponsesStatus
  error: OpenAIResponsesError | null
  incomplete_details: OpenAIResponsesIncompleteDetails | null
  instructions: string | null
  model: string
  output: OpenAIResponsesOutputItem[]
  output_text: string | null
  usage: OpenAIResponsesUsage | null
  previous_response_id: string | null
  store: boolean
  reasoning: null
  background: null
  max_output_tokens: null
  max_tool_calls: null
  text: {
    format: OpenAIResponsesOutputTextFormat
  }
  tools: []
  tool_choice: 'auto'
  truncation: 'disabled'
  parallel_tool_calls: boolean
  conversation: null
  temperature: number | null
  top_p: number | null
  prompt: null
  metadata: Record<string, string>
}

export interface OpenAIResponsesDeletedObject {
  id: string
  object: 'response'
  deleted: boolean
}

export interface OpenAIResponsesItemListObject {
  object: 'list'
  data: OpenAIResponsesItemResource[]
  first_id: string | null
  last_id: string | null
  has_more: boolean
}

export interface OpenAIResponsesAdapterOptions {
  responseId?: string
  model?: string
  createdAt?: string
  instructions?: string | null
  previousResponseId?: string | null
  store?: boolean
  metadata?: Record<string, string>
}

export interface OpenAIResponsesCreatedEvent {
  type: 'response.created'
  response: OpenAIResponseObject
  sequence_number: number
}

export interface OpenAIResponsesInProgressEvent {
  type: 'response.in_progress'
  response: OpenAIResponseObject
  sequence_number: number
}

export interface OpenAIResponsesOutputItemAddedEvent {
  type: 'response.output_item.added'
  output_index: number
  item: OpenAIResponsesOutputItem
  sequence_number: number
}

export interface OpenAIResponsesOutputItemDoneEvent {
  type: 'response.output_item.done'
  output_index: number
  item: OpenAIResponsesOutputItem
  sequence_number: number
}

export interface OpenAIResponsesContentPartAddedEvent {
  type: 'response.content_part.added'
  item_id: string
  output_index: number
  content_index: number
  part: OpenAIResponsesOutputTextContent | OpenAIResponsesReasoningTextContent
  sequence_number: number
}

export interface OpenAIResponsesContentPartDoneEvent {
  type: 'response.content_part.done'
  item_id: string
  output_index: number
  content_index: number
  part: OpenAIResponsesOutputTextContent | OpenAIResponsesReasoningTextContent
  sequence_number: number
}

export interface OpenAIResponsesOutputTextDeltaEvent {
  type: 'response.output_text.delta'
  item_id: string
  output_index: number
  content_index: number
  delta: string
  logprobs: []
  sequence_number: number
}

export interface OpenAIResponsesOutputTextDoneEvent {
  type: 'response.output_text.done'
  item_id: string
  output_index: number
  content_index: number
  text: string
  logprobs: []
  sequence_number: number
}

export interface OpenAIResponsesReasoningTextDeltaEvent {
  type: 'response.reasoning_text.delta'
  item_id: string
  output_index: number
  content_index: number
  delta: string
  sequence_number: number
}

export interface OpenAIResponsesReasoningTextDoneEvent {
  type: 'response.reasoning_text.done'
  item_id: string
  output_index: number
  content_index: number
  text: string
  sequence_number: number
}

export interface OpenAIResponsesReasoningSummaryPartAddedEvent {
  type: 'response.reasoning_summary_part.added'
  item_id: string
  output_index: number
  summary_index: number
  part: OpenAIResponsesSummaryText
  sequence_number: number
}

export interface OpenAIResponsesReasoningSummaryPartDoneEvent {
  type: 'response.reasoning_summary_part.done'
  item_id: string
  output_index: number
  summary_index: number
  part: OpenAIResponsesSummaryText
  sequence_number: number
}

export interface OpenAIResponsesReasoningSummaryTextDeltaEvent {
  type: 'response.reasoning_summary_text.delta'
  item_id: string
  output_index: number
  summary_index: number
  delta: string
  sequence_number: number
}

export interface OpenAIResponsesReasoningSummaryTextDoneEvent {
  type: 'response.reasoning_summary_text.done'
  item_id: string
  output_index: number
  summary_index: number
  text: string
  sequence_number: number
}

export interface OpenAIResponsesWebSearchCallInProgressEvent {
  type: 'response.web_search_call.in_progress'
  output_index: number
  item_id: string
  sequence_number: number
}

export interface OpenAIResponsesWebSearchCallSearchingEvent {
  type: 'response.web_search_call.searching'
  output_index: number
  item_id: string
  sequence_number: number
}

export interface OpenAIResponsesWebSearchCallCompletedEvent {
  type: 'response.web_search_call.completed'
  output_index: number
  item_id: string
  sequence_number: number
}

export interface OpenAIResponsesOutputTextAnnotationAddedEvent {
  type: 'response.output_text.annotation.added'
  item_id: string
  output_index: number
  content_index: number
  annotation_index: number
  annotation: OpenAIResponsesAnnotation
  sequence_number: number
}

export interface OpenAIResponsesErrorEvent {
  type: 'error'
  code: string | null
  message: string
  param: null
  sequence_number: number
}

export interface OpenAIResponsesCompletedEvent {
  type: 'response.completed'
  response: OpenAIResponseObject
  sequence_number: number
}

export interface OpenAIResponsesFailedEvent {
  type: 'response.failed'
  response: OpenAIResponseObject
  sequence_number: number
}

export interface OpenAIResponsesIncompleteEvent {
  type: 'response.incomplete'
  response: OpenAIResponseObject
  sequence_number: number
}

export interface OpenAIResponsesStreamFailure {
  code: string
  message: string
}

export type OpenAIResponsesStreamEvent =
  | OpenAIResponsesCreatedEvent
  | OpenAIResponsesInProgressEvent
  | OpenAIResponsesOutputItemAddedEvent
  | OpenAIResponsesContentPartAddedEvent
  | OpenAIResponsesOutputTextDeltaEvent
  | OpenAIResponsesReasoningTextDeltaEvent
  | OpenAIResponsesReasoningSummaryPartAddedEvent
  | OpenAIResponsesReasoningSummaryTextDeltaEvent
  | OpenAIResponsesWebSearchCallInProgressEvent
  | OpenAIResponsesWebSearchCallSearchingEvent
  | OpenAIResponsesWebSearchCallCompletedEvent
  | OpenAIResponsesOutputTextAnnotationAddedEvent
  | OpenAIResponsesErrorEvent
  | OpenAIResponsesOutputTextDoneEvent
  | OpenAIResponsesContentPartDoneEvent
  | OpenAIResponsesReasoningTextDoneEvent
  | OpenAIResponsesReasoningSummaryPartDoneEvent
  | OpenAIResponsesReasoningSummaryTextDoneEvent
  | OpenAIResponsesOutputItemDoneEvent
  | OpenAIResponsesCompletedEvent
  | OpenAIResponsesFailedEvent
  | OpenAIResponsesIncompleteEvent

export interface OpenAIResponsesStreamAdapter {
  push: (event: DeepSeekGenerationStreamEvent) => OpenAIResponsesStreamEvent[]
  pushMany: (events: Iterable<DeepSeekGenerationStreamEvent>) => OpenAIResponsesStreamEvent[]
  fail: (error: OpenAIResponsesStreamFailure) => OpenAIResponsesStreamEvent[]
  snapshot: () => OpenAIResponseObject
}
