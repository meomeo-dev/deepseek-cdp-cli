import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildDeepSeekStreamingReplyOutputChunks } from '../../application/services/deepSeekReplyOutputOrchestrator.js'
import { createOpenAIResponsesStreamAdapter } from '../../infrastructure/deepseek/openaiResponsesAdapter.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'
import type { DeepSeekReplyLiveEvent } from '../../types/deepseek-reply-output.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekGenerationCompletedEvent } from '../../types/deepseek-stream.types.js'
import type { OpenAIHttpExecutionFailure } from '../../types/openai-http-service.types.js'
import type {
  OpenAIResponsesAdapterOptions,
  OpenAIResponsesStreamEvent,
} from '../../types/openai-responses.types.js'
import {
  applyEventStreamResponseHeaders,
  writeSseDataFrame,
  writeSseEventFrame,
} from './httpHeaders.js'

export interface OpenAIResponsesSseController {
  hasStarted: () => boolean
  onEvent: (event: DeepSeekReplyLiveEvent) => void
  finish: (result: DeepSeekReplyResult) => void
  fail: (failure: OpenAIHttpExecutionFailure) => void
  abort: () => void
}

export function createOpenAIResponsesSseController(input: {
  response: ServerResponse<IncomingMessage>
  outputMode: DeepSeekResolvedOutputMode
  adapterOptions: OpenAIResponsesAdapterOptions
}): OpenAIResponsesSseController {
  let streamStarted = false
  let liveEventWritten = false
  let terminalEventWritten = false
  let activeAttemptNumber: number | null = null
  let streamAdapter: ReturnType<typeof createOpenAIResponsesStreamAdapter> | null = null

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

      const streamEvents = ensureStreamAdapter(
        event.attemptNumber,
        event.event.context,
      ).push(event.event)
      writeResponsesEvents(streamEvents)
    },
    finish(result) {
      const terminalEvents = resolveTerminalEvents(result)
      writeResponsesEvents(terminalEvents)
      if (!streamStarted) {
        startStream()
      }
      writeSseDataFrame(input.response, '[DONE]')
      input.response.end()
    },
    fail(failure) {
      if (input.response.writableEnded) {
        return
      }

      const failureEvents = resolveFailureEvents(failure)
      writeResponsesEvents(failureEvents)
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
    terminalEventWritten = false
  }

  function ensureStreamAdapter(
    attemptNumber: number,
    context: Parameters<typeof createOpenAIResponsesStreamAdapter>[0]['context'],
  ) {
    if (activeAttemptNumber !== attemptNumber || streamAdapter === null) {
      activeAttemptNumber = attemptNumber
      streamAdapter = createOpenAIResponsesStreamAdapter({
        context,
        ...input.adapterOptions,
      })
      terminalEventWritten = false
    }

    return streamAdapter
  }

  function writeResponsesEvents(events: OpenAIResponsesStreamEvent[]): void {
    if (events.length === 0) {
      return
    }

    startStream()
    liveEventWritten = true
    for (const event of events) {
      if (isTerminalResponsesEvent(event)) {
        terminalEventWritten = true
      }
      writeSseEventFrame(input.response, event.type, JSON.stringify(event))
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

  function resolveTerminalEvents(result: DeepSeekReplyResult): OpenAIResponsesStreamEvent[] {
    if (!liveEventWritten) {
      return buildDeepSeekStreamingReplyOutputChunks({
        result,
        outputMode: input.outputMode,
        openAIAdapterOptions: input.adapterOptions,
      }).flatMap(output =>
        output.format === 'stream-json' && output.jsonShape === 'openai-responses'
          ? [output.data as OpenAIResponsesStreamEvent]
          : [],
      )
    }

    if (terminalEventWritten) {
      return []
    }

    const finalRun =
      result.output.mode === 'stream'
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

  function resolveFailureEvents(
    failure: OpenAIHttpExecutionFailure,
  ): OpenAIResponsesStreamEvent[] {
    if (terminalEventWritten || streamAdapter === null) {
      return []
    }

    return streamAdapter.fail({
      code: failure.code,
      message: failure.message,
    })
  }
}

function isTerminalResponsesEvent(event: OpenAIResponsesStreamEvent): boolean {
  return (
    event.type === 'response.completed' ||
    event.type === 'response.failed' ||
    event.type === 'response.incomplete'
  )
}
