import { createGenerationRunAccumulator } from './generationRunAccumulator.js'
import {
  buildOpenAIChatCompletionResponse,
  buildOpenAIChatCompletionStreamChunk,
  buildOpenAIChatCompletionTerminalChunk,
  buildOpenAIChatCompletionUsageChunk,
  resolveChatCompletionsAdapterOptions,
} from './openaiChatCompletionsAdapterShared.js'
import type {
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationStreamEvent,
} from '../../types/deepseek-stream.types.js'
import type {
  OpenAIChatCompletionsAdapterOptions,
  OpenAIChatCompletionsStreamAdapter,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionResponse,
} from '../../types/openai-chat-completions.types.js'

interface StreamAdapterState {
  context: DeepSeekGenerationRunContext
  createdAt: string | null
  options: ReturnType<typeof resolveChatCompletionsAdapterOptions>
  accumulator: ReturnType<typeof createGenerationRunAccumulator>
  messageStarted: boolean
  emittedTerminalChunk: boolean
}

export function adaptDeepSeekCompletedToOpenAIChatCompletion(input: {
  context: DeepSeekGenerationRunContext
  result: DeepSeekGenerationCompletedState
  options?: OpenAIChatCompletionsAdapterOptions
}): OpenAIChatCompletionResponse {
  return buildOpenAIChatCompletionResponse({
    context: input.context,
    createdAt: input.options?.createdAt ?? input.result.completedAt,
    options: resolveChatCompletionsAdapterOptions(input.context, input.options),
    result: input.result,
  })
}

export function adaptDeepSeekGenerationEventsToOpenAIChatCompletionsStream(input: {
  context: DeepSeekGenerationRunContext
  events: Iterable<DeepSeekGenerationStreamEvent>
  options?: OpenAIChatCompletionsAdapterOptions
}): OpenAIChatCompletionChunk[] {
  return createOpenAIChatCompletionsStreamAdapter({
    context: input.context,
    ...input.options,
  }).pushMany(input.events)
}

export function createOpenAIChatCompletionsStreamAdapter(input: {
  context: DeepSeekGenerationRunContext
} & OpenAIChatCompletionsAdapterOptions): OpenAIChatCompletionsStreamAdapter {
  const state: StreamAdapterState = {
    context: { ...input.context },
    createdAt: input.createdAt ?? null,
    options: resolveChatCompletionsAdapterOptions(input.context, input),
    accumulator: createGenerationRunAccumulator({
      context: input.context,
      ...(input.createdAt ? { occurredAt: input.createdAt } : {}),
    }),
    messageStarted: false,
    emittedTerminalChunk: false,
  }

  return {
    push(event) {
      return pushCanonicalEvent(state, event)
    },
    pushMany(events) {
      const emitted: OpenAIChatCompletionChunk[] = []
      for (const event of events) {
        emitted.push(...pushCanonicalEvent(state, event))
      }
      return emitted
    },
    snapshot() {
      return buildOpenAIChatCompletionResponse({
        context: state.context,
        createdAt: state.createdAt,
        options: state.options,
        snapshot: state.accumulator.snapshot(),
      })
    },
  }
}

function pushCanonicalEvent(
  state: StreamAdapterState,
  event: DeepSeekGenerationStreamEvent,
): OpenAIChatCompletionChunk[] {
  if (state.createdAt === null) {
    state.createdAt = event.occurredAt
  }

  state.accumulator.push(event)
  state.context = { ...event.context }

  switch (event.kind) {
    case 'text.delta':
      return emitTextDeltaChunks(state, event.delta)
    case 'completed':
      return emitCompletedChunks(state, event.result)
    case 'reasoning.delta':
    case 'search.patch':
    case 'citation.patch':
    case 'usage.update':
    case 'finish':
    case 'stopped':
    case 'error':
      return []
  }
}

function emitTextDeltaChunks(
  state: StreamAdapterState,
  delta: string,
): OpenAIChatCompletionChunk[] {
  const emitted: OpenAIChatCompletionChunk[] = []
  if (!state.messageStarted) {
    emitted.push(
      buildOpenAIChatCompletionStreamChunk({
        completionId: state.options.completionId,
        createdAt: state.createdAt,
        model: state.options.model,
        delta: {
          role: 'assistant',
          content: '',
        },
        finishReason: null,
        ...(state.options.includeUsage ? { usage: null } : {}),
      }),
    )
    state.messageStarted = true
  }

  emitted.push(
      buildOpenAIChatCompletionStreamChunk({
        completionId: state.options.completionId,
        createdAt: state.createdAt,
        model: state.options.model,
        delta: {
          content: delta,
        },
        finishReason: null,
        ...(state.options.includeUsage ? { usage: null } : {}),
      }),
  )

  return emitted
}

function emitCompletedChunks(
  state: StreamAdapterState,
  result: DeepSeekGenerationCompletedState,
): OpenAIChatCompletionChunk[] {
  if (state.emittedTerminalChunk) {
    return []
  }

  const emitted: OpenAIChatCompletionChunk[] = []
  if (!state.messageStarted) {
    emitted.push(
      buildOpenAIChatCompletionStreamChunk({
        completionId: state.options.completionId,
        createdAt: state.createdAt,
        model: state.options.model,
        delta: {
          role: 'assistant',
          content: '',
        },
        finishReason: null,
        ...(state.options.includeUsage ? { usage: null } : {}),
      }),
    )
    state.messageStarted = true

    if (result.outputText) {
      emitted.push(
        buildOpenAIChatCompletionStreamChunk({
          completionId: state.options.completionId,
          createdAt: state.createdAt,
          model: state.options.model,
          delta: {
            content: result.outputText,
          },
          finishReason: null,
          ...(state.options.includeUsage ? { usage: null } : {}),
        }),
      )
    }
  }

  emitted.push(
    buildOpenAIChatCompletionTerminalChunk({
      completionId: state.options.completionId,
      createdAt: state.createdAt ?? result.completedAt,
      model: state.options.model,
      finishReason: result.finishReason,
      includeUsage: state.options.includeUsage,
    }),
  )
  if (state.options.includeUsage) {
    emitted.push(
      buildOpenAIChatCompletionUsageChunk({
        completionId: state.options.completionId,
        createdAt: state.createdAt ?? result.completedAt,
        model: state.options.model,
        usage: result.usage,
      }),
    )
  }
  state.emittedTerminalChunk = true
  return emitted
}
