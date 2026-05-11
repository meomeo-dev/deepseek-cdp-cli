import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildDeepSeekStreamingReplyOutputChunks } from '../../application/services/deepSeekReplyOutputOrchestrator.js'
import { createOpenAIChatCompletionsStreamAdapter } from '../../infrastructure/deepseek/openaiChatCompletionsAdapter.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'
import type { DeepSeekReplyLiveEvent } from '../../types/deepseek-reply-output.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekGenerationCompletedEvent } from '../../types/deepseek-stream.types.js'
import type { OpenAICompatibleModelAlias } from '../../types/openai-http-service.types.js'
import type { OpenAIChatCompletionChunk } from '../../types/openai-chat-completions.types.js'
import {
  applyEventStreamResponseHeaders,
  writeSseDataFrame,
} from './httpHeaders.js'

export interface OpenAIChatCompletionsSseController {
  hasStarted: () => boolean
  onEvent: (event: DeepSeekReplyLiveEvent) => void
  finish: (result: DeepSeekReplyResult) => void
  abort: () => void
}

export function createOpenAIChatCompletionsSseController(input: {
  response: ServerResponse<IncomingMessage>
  model: OpenAICompatibleModelAlias
  outputMode: DeepSeekResolvedOutputMode
  includeUsage: boolean
}): OpenAIChatCompletionsSseController {
  let streamStarted = false
  let liveChunkWritten = false
  let terminalChunkWritten = false
  let activeAttemptNumber: number | null = null
  let streamAdapter: ReturnType<typeof createOpenAIChatCompletionsStreamAdapter> | null = null

  return {
    hasStarted() {
      return streamStarted
    },
    onEvent(event) {
      if (event.kind === 'attempt.started') {
        resetAttemptState(event.attemptNumber)
        return
      }

      if (event.kind !== 'generation.event') {
        return
      }

      const chunks = ensureStreamAdapter(event.attemptNumber, event.event.context).push(event.event)
      writeChatCompletionChunks(chunks)
    },
    finish(result) {
      const terminalChunks = resolveTerminalChunks(result)
      writeChatCompletionChunks(terminalChunks)
      if (!streamStarted) {
        startStream()
      }
      writeSseDataFrame(input.response, '[DONE]')
      input.response.end()
    },
    abort() {
      if (!input.response.writableEnded) {
        input.response.end()
      }
    },
  }

  function resetAttemptState(attemptNumber: number): void {
    activeAttemptNumber = attemptNumber
    streamAdapter = null
    terminalChunkWritten = false
  }

  function ensureStreamAdapter(
    attemptNumber: number,
    context: Parameters<typeof createOpenAIChatCompletionsStreamAdapter>[0]['context'],
  ) {
    if (activeAttemptNumber !== attemptNumber || streamAdapter === null) {
      activeAttemptNumber = attemptNumber
      streamAdapter = createOpenAIChatCompletionsStreamAdapter({
        context,
        model: input.model,
        includeUsage: input.includeUsage,
      })
      terminalChunkWritten = false
    }

    return streamAdapter
  }

  function writeChatCompletionChunks(chunks: OpenAIChatCompletionChunk[]): void {
    if (chunks.length === 0) {
      return
    }

    startStream()
    liveChunkWritten = true
    for (const chunk of chunks) {
      if (chunk.choices.some(choice => choice.finish_reason !== null)) {
        terminalChunkWritten = true
      }
      writeSseDataFrame(input.response, JSON.stringify(chunk))
    }
  }

  function startStream(): void {
    if (streamStarted) {
      return
    }

    applyEventStreamResponseHeaders(input.response)
    input.response.flushHeaders()
    streamStarted = true
  }

  function resolveTerminalChunks(result: DeepSeekReplyResult): OpenAIChatCompletionChunk[] {
    if (!liveChunkWritten) {
      return buildDeepSeekStreamingReplyOutputChunks({
        result,
        outputMode: input.outputMode,
        openAIAdapterOptions: {
          model: input.model,
          includeUsage: input.includeUsage,
        },
      }).flatMap(output =>
        output.format === 'stream-json' && output.jsonShape === 'openai-chat-completions'
          ? [output.data as OpenAIChatCompletionChunk]
          : [],
      )
    }

    if (terminalChunkWritten) {
      return []
    }

    const finalRun = result.output.mode === 'stream'
      ? (result.output.canonicalRuns.at(-1) ?? null)
      : null
    if (!finalRun) {
      return []
    }

    const completedEvent =
      finalRun.events.findLast(
        (event): event is DeepSeekGenerationCompletedEvent => event.kind === 'completed',
      ) ??
      {
        kind: 'completed',
        sequence: (finalRun.events.at(-1)?.sequence ?? 0) + 1,
        occurredAt: finalRun.finalized.completedAt,
        context: finalRun.context,
        result: finalRun.finalized,
      }

    return ensureStreamAdapter(activeAttemptNumber ?? 1, finalRun.context).push(completedEvent)
  }
}
