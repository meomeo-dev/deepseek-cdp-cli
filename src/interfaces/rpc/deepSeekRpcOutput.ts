import {
  buildDeepSeekBufferedReplyOutput,
  buildDeepSeekStreamingReplyOutputChunks,
  summarizeDeepSeekReplyOutput,
  toBufferedDeepSeekReplyOutputMode,
} from '../../application/services/deepSeekReplyOutputOrchestrator.js'
import { createOpenAIResponsesStreamAdapter } from '../../infrastructure/deepseek/openaiResponsesAdapter.js'
import { createOpenAIChatCompletionsStreamAdapter } from '../../infrastructure/deepseek/openaiChatCompletionsAdapter.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'
import type {
  DeepSeekReplyLiveEvent,
  DeepSeekReplyOutputSummary,
} from '../../types/deepseek-reply-output.types.js'
import type {
  DeepSeekRpcBufferedOutputEnvelope,
  DeepSeekRpcBufferedResult,
  DeepSeekRpcStreamEventFrame,
  DeepSeekRpcStreamingOutputEnvelope,
  DeepSeekRpcStreamingResult,
} from '../../types/rpc-output.types.js'
import { resolveDeepSeekReplyRateLimitMetadata } from '../../domain/search/deepSeekSearchRateLimitOutput.js'

type DeepSeekRpcRealtimeOpenAIResponsesAdapter =
  ReturnType<typeof createOpenAIResponsesStreamAdapter>

type DeepSeekRpcRealtimeOpenAIChatCompletionsAdapter =
  ReturnType<typeof createOpenAIChatCompletionsStreamAdapter>

export interface DeepSeekRpcRealtimeStreamEventController {
  enabled: boolean
  onEvent: (event: DeepSeekReplyLiveEvent) => DeepSeekRpcStreamEventFrame[]
  buildTerminalFrames: (result: DeepSeekReplyResult) => DeepSeekRpcStreamEventFrame[]
}

export function buildDeepSeekRpcBufferedResult(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
}): DeepSeekRpcBufferedResult {
  return {
    outputMode: input.outputMode,
    output: toDeepSeekRpcBufferedOutputEnvelope(
      buildDeepSeekBufferedReplyOutput(input),
    ),
    summary: summarizeDeepSeekReplyResult(input.result),
  }
}

export function buildDeepSeekRpcStreamEventFrames(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
}): DeepSeekRpcStreamEventFrame[] {
  return buildDeepSeekStreamingReplyOutputChunks(input).map(output => ({
    outputMode: input.outputMode,
    output: toDeepSeekRpcStreamingOutputEnvelope(output),
  }))
}

export function createDeepSeekRpcRealtimeStreamEventController(input: {
  outputMode: DeepSeekResolvedOutputMode
}): DeepSeekRpcRealtimeStreamEventController {
  if (input.outputMode.transport !== 'streaming') {
    return createDisabledRealtimeStreamEventController()
  }

  if (input.outputMode.outputFamily === 'text') {
    return createDeepSeekRpcRealtimeTextStreamEventController(input.outputMode)
  }

  return createDeepSeekRpcRealtimeJsonStreamEventController(input.outputMode)
}

export function buildDeepSeekRpcStreamingResult(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
}): DeepSeekRpcStreamingResult {
  return {
    outputMode: input.outputMode,
    finalOutput: toDeepSeekRpcBufferedOutputEnvelope(
      buildDeepSeekBufferedReplyOutput({
        result: input.result,
        outputMode: toBufferedDeepSeekReplyOutputMode(input.outputMode),
      }),
    ),
    summary: summarizeDeepSeekReplyResult(input.result),
  }
}

export function summarizeDeepSeekReplyResult(
  result: DeepSeekReplyResult,
): DeepSeekReplyOutputSummary {
  return summarizeDeepSeekReplyOutput(result)
}

function toDeepSeekRpcBufferedOutputEnvelope(
  output: ReturnType<typeof buildDeepSeekBufferedReplyOutput>,
): DeepSeekRpcBufferedOutputEnvelope {
  return output
}

function toDeepSeekRpcStreamingOutputEnvelope(
  output: ReturnType<typeof buildDeepSeekStreamingReplyOutputChunks>[number],
): DeepSeekRpcStreamingOutputEnvelope {
  return output
}

function createDisabledRealtimeStreamEventController(): DeepSeekRpcRealtimeStreamEventController {
  return {
    enabled: false,
    onEvent() {
      return []
    },
    buildTerminalFrames() {
      return []
    },
  }
}

function createDeepSeekRpcRealtimeTextStreamEventController(
  outputMode: DeepSeekResolvedOutputMode,
): DeepSeekRpcRealtimeStreamEventController {
  let liveTextWritten = false

  return {
    enabled: true,
    onEvent(event) {
      if (event.kind !== 'generation.event' || event.event.kind !== 'text.delta') {
        return []
      }

      liveTextWritten = true
      return [
        toStreamEventFrame(outputMode, {
          format: 'text',
          delta: event.event.delta,
        }),
      ]
    },
    buildTerminalFrames(result) {
      const frames = buildDeepSeekRpcStreamEventFrames({
        result,
        outputMode,
      })
      if (!liveTextWritten) {
        return frames
      }

      const leadingDeltaCount = countStreamingTextDeltaEvents(result)
      const boundedDeltaCount = Math.min(leadingDeltaCount, frames.length)
      return frames.slice(boundedDeltaCount)
    },
  }
}

function createDeepSeekRpcRealtimeJsonStreamEventController(
  outputMode: DeepSeekResolvedOutputMode,
): DeepSeekRpcRealtimeStreamEventController {
  let liveFrameWritten = false
  let activeAttemptNumber: number | null = null
  let openAIResponsesAdapter: DeepSeekRpcRealtimeOpenAIResponsesAdapter | null = null
  let openAIChatCompletionsAdapter: DeepSeekRpcRealtimeOpenAIChatCompletionsAdapter | null = null

  return {
    enabled: true,
    onEvent(event) {
      if (event.kind === 'attempt.started') {
        resetStreamingJsonAdapterState(event.attemptNumber)
        return []
      }
      if (event.kind !== 'generation.event') {
        return []
      }

      const frames = buildRealtimeStreamingJsonFrames({
        event,
        outputMode,
        ensureOpenAIResponsesAdapter: () => {
          if (activeAttemptNumber !== event.attemptNumber || openAIResponsesAdapter === null) {
            activeAttemptNumber = event.attemptNumber
            openAIResponsesAdapter = createOpenAIResponsesStreamAdapter({
              context: event.event.context,
            })
            openAIChatCompletionsAdapter = null
          }
          return openAIResponsesAdapter
        },
        ensureOpenAIChatCompletionsAdapter: () => {
          if (
            activeAttemptNumber !== event.attemptNumber ||
            openAIChatCompletionsAdapter === null
          ) {
            activeAttemptNumber = event.attemptNumber
            openAIChatCompletionsAdapter = createOpenAIChatCompletionsStreamAdapter({
              context: event.event.context,
            })
            openAIResponsesAdapter = null
          }
          return openAIChatCompletionsAdapter
        },
      })
      if (frames.length > 0) {
        liveFrameWritten = true
      }
      return frames
    },
    buildTerminalFrames(result) {
      if (!liveFrameWritten) {
        return buildDeepSeekRpcStreamEventFrames({
          result,
          outputMode,
        })
      }

      if (outputMode.jsonShape !== 'native') {
        return []
      }

      const rateLimit = resolveDeepSeekReplyRateLimitMetadata(result)
      if (!rateLimit) {
        return []
      }

      return [
        toStreamEventFrame(outputMode, {
          format: 'stream-json',
          jsonShape: 'native',
          data: {
            kind: 'reply.rate_limit',
            rateLimit,
          },
        }),
      ]
    },
  }

  function resetStreamingJsonAdapterState(attemptNumber: number): void {
    activeAttemptNumber = attemptNumber
    openAIResponsesAdapter = null
    openAIChatCompletionsAdapter = null
  }
}

function buildRealtimeStreamingJsonFrames(input: {
  event: Extract<DeepSeekReplyLiveEvent, { kind: 'generation.event' }>
  outputMode: DeepSeekResolvedOutputMode
  ensureOpenAIResponsesAdapter: () => DeepSeekRpcRealtimeOpenAIResponsesAdapter
  ensureOpenAIChatCompletionsAdapter: () => DeepSeekRpcRealtimeOpenAIChatCompletionsAdapter
}): DeepSeekRpcStreamEventFrame[] {
  if (input.outputMode.jsonShape === 'native') {
    return [
      toStreamEventFrame(input.outputMode, {
        format: 'stream-json',
        jsonShape: 'native',
        data: input.event.event,
      }),
    ]
  }

  if (input.outputMode.jsonShape === 'openai-responses') {
    return input.ensureOpenAIResponsesAdapter()
      .push(input.event.event)
      .map(frame =>
        toStreamEventFrame(input.outputMode, {
          format: 'stream-json',
          jsonShape: 'openai-responses',
          data: frame,
        }),
      )
  }

  return input.ensureOpenAIChatCompletionsAdapter()
    .push(input.event.event)
    .map(frame =>
      toStreamEventFrame(input.outputMode, {
        format: 'stream-json',
        jsonShape: 'openai-chat-completions',
        data: frame,
      }),
    )
}

function toStreamEventFrame(
  outputMode: DeepSeekResolvedOutputMode,
  output: DeepSeekRpcStreamingOutputEnvelope,
): DeepSeekRpcStreamEventFrame {
  return {
    outputMode,
    output,
  }
}

function countStreamingTextDeltaEvents(result: DeepSeekReplyResult): number {
  if (result.output.mode !== 'stream') {
    return 0
  }

  return result.output.canonicalRuns.reduce(
    (count, run) => count + run.events.filter(event => event.kind === 'text.delta').length,
    0,
  )
}
