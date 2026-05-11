import { createHash } from 'node:crypto'
import type { DeepSeekGenerationAccumulatorSnapshot } from '../../types/deepseek-accumulator.types.js'
import type {
  DeepSeekGenerationCitation,
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationFinishReason,
  DeepSeekGenerationRunContext,
} from '../../types/deepseek-stream.types.js'
import type {
  OpenAIChatCompletionsAdapterOptions,
  OpenAIChatCompletionChoice,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionChunkChoice,
  OpenAIChatCompletionFinishReason,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionResponseMessage,
  OpenAIChatCompletionUrlCitationAnnotation,
  OpenAIChatCompletionUsage,
} from '../../types/openai-chat-completions.types.js'

export interface ResolvedChatCompletionsAdapterOptions {
  completionId: string
  model: string
  metadata: Record<string, string>
  includeUsage: boolean
}

export function resolveChatCompletionsAdapterOptions(
  context: DeepSeekGenerationRunContext,
  options: OpenAIChatCompletionsAdapterOptions | undefined,
): ResolvedChatCompletionsAdapterOptions {
  return {
    completionId: options?.completionId ?? buildStableCompletionId(context.runId),
    model: options?.model ?? 'deepseek-chat-browser',
    metadata: options?.metadata ? { ...options.metadata } : {},
    includeUsage: options?.includeUsage ?? false,
  }
}

export function buildOpenAIChatCompletionResponse(input: {
  context: DeepSeekGenerationRunContext
  createdAt: string | null
  options: ResolvedChatCompletionsAdapterOptions
  result?: DeepSeekGenerationCompletedState
  snapshot?: DeepSeekGenerationAccumulatorSnapshot
}): OpenAIChatCompletionResponse {
  const source = materializeSource(input.result, input.snapshot, input.createdAt)

  const response: OpenAIChatCompletionResponse = {
    id: input.options.completionId,
    object: 'chat.completion',
    created: isoToUnixSeconds(input.createdAt),
    model: input.options.model,
    metadata: input.options.metadata,
    choices: [
      buildOpenAIChatCompletionChoice({
        content: source.outputText || null,
        citations: source.citations,
        finishReason: source.finishReason,
      }),
    ],
  }

  const usage = buildOpenAIChatCompletionUsage(source.usage)
  if (usage) {
    response.usage = usage
  }

  return response
}

export function buildOpenAIChatCompletionChoice(input: {
  content: string | null
  citations: DeepSeekGenerationCitation[]
  finishReason: DeepSeekGenerationFinishReason
}): OpenAIChatCompletionChoice {
  return {
    index: 0,
    message: buildOpenAIChatCompletionMessage(input.content, input.citations),
    logprobs: null,
    finish_reason: mapToOpenAIChatCompletionFinishReason(input.finishReason),
  }
}

export function buildOpenAIChatCompletionStreamChunk(input: {
  completionId: string
  createdAt: string | null
  model: string
  delta: OpenAIChatCompletionChunkChoice['delta']
  finishReason: OpenAIChatCompletionFinishReason | null
  usage?: OpenAIChatCompletionUsage | null
}): OpenAIChatCompletionChunk {
  const chunk: OpenAIChatCompletionChunk = {
    id: input.completionId,
    object: 'chat.completion.chunk',
    created: isoToUnixSeconds(input.createdAt),
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.delta,
        logprobs: null,
        finish_reason: input.finishReason,
      },
    ],
  }

  if (input.usage !== undefined) {
    chunk.usage = input.usage
  }

  return chunk
}

export function buildOpenAIChatCompletionTerminalChunk(input: {
  completionId: string
  createdAt: string | null
  model: string
  finishReason: DeepSeekGenerationFinishReason
  includeUsage: boolean
}): OpenAIChatCompletionChunk {
  return buildOpenAIChatCompletionStreamChunk({
    completionId: input.completionId,
    createdAt: input.createdAt,
    model: input.model,
    delta: {},
    finishReason: mapToOpenAIChatCompletionFinishReason(input.finishReason),
    ...(input.includeUsage ? { usage: null } : {}),
  })
}

export function buildOpenAIChatCompletionUsageChunk(input: {
  completionId: string
  createdAt: string | null
  model: string
  usage: DeepSeekGenerationCompletedState['usage']
}): OpenAIChatCompletionChunk {
  return {
    id: input.completionId,
    object: 'chat.completion.chunk',
    created: isoToUnixSeconds(input.createdAt),
    model: input.model,
    choices: [],
    usage: buildOpenAIChatCompletionUsage(input.usage),
  }
}

export function buildOpenAIChatCompletionMessage(
  content: string | null,
  citations: DeepSeekGenerationCitation[],
): OpenAIChatCompletionResponseMessage {
  return {
    role: 'assistant',
    content,
    refusal: null,
    annotations: mapCitationsToChatCompletionAnnotations(citations, content ?? ''),
  }
}

export function mapCitationsToChatCompletionAnnotations(
  citations: DeepSeekGenerationCitation[],
  outputText: string,
): OpenAIChatCompletionUrlCitationAnnotation[] {
  return citations.flatMap(citation => {
    const annotation = mapCitationToChatCompletionAnnotation(citation, outputText)
    return annotation ? [annotation] : []
  })
}

export function buildOpenAIChatCompletionUsage(
  usage: DeepSeekGenerationCompletedState['usage'],
): OpenAIChatCompletionUsage | null {
  if (!usage) {
    return null
  }

  const promptTokens = Math.max(0, usage.inputTokens ?? 0)
  const completionTokens = Math.max(0, usage.outputTokens ?? 0)
  const totalTokens =
    usage.totalTokens !== null && usage.totalTokens !== undefined
      ? Math.max(0, usage.totalTokens)
      : promptTokens + completionTokens

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: Math.max(0, usage.reasoningTokens ?? 0),
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  }
}

export function mapToOpenAIChatCompletionFinishReason(
  reason: DeepSeekGenerationFinishReason,
): OpenAIChatCompletionFinishReason {
  switch (reason) {
    case 'length':
      return 'length'
    case 'tool_calls':
      return 'tool_calls'
    case 'content_filter':
      return 'content_filter'
    case 'function_call':
      return 'function_call'
    case 'stop':
    case 'stopped':
    case 'error':
    case 'unknown':
    default:
      return 'stop'
  }
}

function materializeSource(
  result: DeepSeekGenerationCompletedState | undefined,
  snapshot: DeepSeekGenerationAccumulatorSnapshot | undefined,
  createdAt: string | null,
): DeepSeekGenerationCompletedState {
  if (result) {
    return result
  }

  if (!snapshot) {
    return {
      status: 'completed',
      finishReason: 'stop',
      outputText: '',
      reasoningText: '',
      reasoningKind: 'unknown',
      citations: [],
      responseReferences: [],
      searches: [],
      usage: null,
      error: null,
      completedAt: createdAt ?? new Date(0).toISOString(),
    }
  }

  return {
    status: snapshot.status === 'running' ? 'completed' : snapshot.status,
    finishReason: snapshot.finishReason,
    outputText: snapshot.outputText,
    reasoningText: snapshot.reasoningText,
    reasoningKind: snapshot.reasoningKind,
    citations: snapshot.citations,
    responseReferences: snapshot.responseReferences,
    searches: snapshot.searches,
    usage: snapshot.usage,
    error: snapshot.error,
    completedAt: snapshot.completedAt ?? snapshot.lastOccurredAt ?? createdAt ?? new Date(0).toISOString(),
  }
}

function mapCitationToChatCompletionAnnotation(
  citation: DeepSeekGenerationCitation,
  outputText: string,
): OpenAIChatCompletionUrlCitationAnnotation | null {
  const startIndex = citation.annotation?.startIndex
  const endIndex = citation.annotation?.endIndex
  if (
    !citation.url ||
    typeof startIndex !== 'number' ||
    typeof endIndex !== 'number' ||
    startIndex < 0 ||
    endIndex > outputText.length
  ) {
    return null
  }

  return {
    type: 'url_citation',
    url_citation: {
      start_index: startIndex,
      end_index: endIndex,
      url: citation.url,
      title: citation.title,
    },
  }
}

function buildStableCompletionId(seed: string): string {
  return `chatcmpl_${createHash('sha1').update(seed).digest('hex').slice(0, 24)}`
}

function isoToUnixSeconds(value: string | null): number {
  if (!value) {
    return 0
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return 0
  }
  return Math.max(0, Math.floor(timestamp / 1000))
}
