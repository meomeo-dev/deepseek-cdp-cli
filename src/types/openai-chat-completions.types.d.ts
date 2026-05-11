import type { DeepSeekGenerationStreamEvent } from './deepseek-stream.types.js'

export type OpenAIChatCompletionFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'function_call'

export interface OpenAIChatCompletionUrlCitationAnnotation {
  type: 'url_citation'
  url_citation: {
    start_index: number
    end_index: number
    url: string
    title: string
  }
}

export interface OpenAIChatCompletionResponseMessage {
  role: 'assistant'
  content: string | null
  refusal: string | null
  annotations: OpenAIChatCompletionUrlCitationAnnotation[]
}

export interface OpenAIChatCompletionChoice {
  index: number
  message: OpenAIChatCompletionResponseMessage
  logprobs: null
  finish_reason: OpenAIChatCompletionFinishReason
}

export interface OpenAIChatCompletionUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: {
    cached_tokens: number
    audio_tokens: number
  }
  completion_tokens_details?: {
    reasoning_tokens: number
    audio_tokens: number
    accepted_prediction_tokens: number
    rejected_prediction_tokens: number
  }
}

export interface OpenAIChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  metadata: Record<string, string>
  choices: OpenAIChatCompletionChoice[]
  usage?: OpenAIChatCompletionUsage
}

export interface OpenAIChatCompletionDeletedObject {
  id: string
  object: 'chat.completion.deleted'
  deleted: boolean
}

export interface OpenAIChatCompletionListObject {
  object: 'list'
  data: OpenAIChatCompletionResponse[]
  first_id: string | null
  last_id: string | null
  has_more: boolean
}

export interface OpenAIChatCompletionStoredMessage {
  id: string
  role: 'assistant' | 'developer' | 'system' | 'user'
  content: string
  name: null
  content_parts: null
}

export interface OpenAIChatCompletionMessageListObject {
  object: 'list'
  data: OpenAIChatCompletionStoredMessage[]
  first_id: string | null
  last_id: string | null
  has_more: boolean
}

export interface OpenAIChatCompletionChunkDelta {
  role?: 'assistant'
  content?: string | null
  refusal?: string | null
}

export interface OpenAIChatCompletionChunkChoice {
  index: number
  delta: OpenAIChatCompletionChunkDelta
  logprobs: null
  finish_reason: OpenAIChatCompletionFinishReason | null
}

export interface OpenAIChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: OpenAIChatCompletionChunkChoice[]
  usage?: OpenAIChatCompletionUsage | null
}

export interface OpenAIChatCompletionsAdapterOptions {
  completionId?: string
  model?: string
  createdAt?: string
  metadata?: Record<string, string>
  includeUsage?: boolean
}

export interface OpenAIChatCompletionsStreamAdapter {
  push: (event: DeepSeekGenerationStreamEvent) => OpenAIChatCompletionChunk[]
  pushMany: (events: Iterable<DeepSeekGenerationStreamEvent>) => OpenAIChatCompletionChunk[]
  snapshot: () => OpenAIChatCompletionResponse
}
