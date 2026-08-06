import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type {
  DeepSeekResolvedOutputMode,
} from '../../types/deepseek-output-modes.types.js'
import type { DeepSeekReplyLiveEvent } from '../../types/deepseek-reply-output.types.js'
import { resolveDeepSeekReplyRateLimitMetadata } from '../../domain/search/deepSeekSearchRateLimitOutput.js'
import {
  buildDeepSeekBufferedReplyOutput,
  buildDeepSeekStreamingReplyOutputChunks,
} from '../../application/services/deepSeekReplyOutputOrchestrator.js'
import { createOpenAIResponsesStreamAdapter } from '../../infrastructure/deepseek/openaiResponsesAdapter.js'
import { createOpenAIChatCompletionsStreamAdapter } from '../../infrastructure/deepseek/openaiChatCompletionsAdapter.js'
import {
  parseDeepSeekReplyOutputFormat,
  parseDeepSeekReplyOutputJsonShape,
  resolveDeepSeekReplyOutputMode,
} from '../../application/services/deepSeekReplyOutputMode.js'

export interface DeepSeekCliOutputOptionInput {
  stream?: boolean | undefined
  format?: string | undefined
  jsonShape?: string | undefined
}

export interface DeepSeekCliRealtimeTextOutputController {
  enabled: boolean
  onEvent: (event: DeepSeekReplyLiveEvent) => void
  writeFinalResult: (result: DeepSeekReplyResult) => void
}

type DeepSeekCliRealtimeJsonOutputController = DeepSeekCliRealtimeTextOutputController

type DeepSeekCliRealtimeOpenAIResponsesAdapter =
  ReturnType<typeof createOpenAIResponsesStreamAdapter>

type DeepSeekCliRealtimeOpenAIChatCompletionsAdapter =
  ReturnType<typeof createOpenAIChatCompletionsStreamAdapter>

export function resolveDeepSeekCliOutputMode(
  input: DeepSeekCliOutputOptionInput,
): DeepSeekResolvedOutputMode {
  return resolveDeepSeekReplyOutputMode({
    stream: input.stream === true,
    format: input.format,
    jsonShape: input.jsonShape,
  })
}

export function buildDeepSeekCliOutputChunks(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  includeCitations?: boolean | undefined
  includeSessionHandleFooter?: boolean | undefined
}): string[] {
  if (input.outputMode.outputFamily === 'text') {
    return buildTextOutputChunks(
      input.result,
      input.outputMode,
      input.includeSessionHandleFooter === true,
      input.includeCitations !== false,
    )
  }

  if (input.outputMode.transport === 'buffered') {
    return [`${JSON.stringify(buildBufferedJsonOutput(input.result, input.outputMode), null, 2)}\n`]
  }

  return buildStreamingJsonChunks(input.result, input.outputMode)
}

export function writeDeepSeekCliOutput(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  includeCitations?: boolean | undefined
  includeSessionHandleFooter?: boolean | undefined
  write?: ((chunk: string) => void) | undefined
}): void {
  const write = input.write ?? (chunk => process.stdout.write(chunk))
  for (const chunk of buildDeepSeekCliOutputChunks(input)) {
    write(chunk)
  }
}

export function createDeepSeekCliRealtimeTextOutputController(input: {
  outputMode: DeepSeekResolvedOutputMode
  includeCitations?: boolean | undefined
  includeSessionHandleFooter?: boolean | undefined
  write?: ((chunk: string) => void) | undefined
}): DeepSeekCliRealtimeTextOutputController {
  const write = input.write ?? (chunk => process.stdout.write(chunk))
  let liveTextWritten = false
  let lastLiveTextEndsWithNewline = true
  let liveTerminalNewlineWritten = false
  const enabled = isStreamingTextOutputMode(input.outputMode)

  return {
    enabled,
    onEvent(event) {
      if (!enabled || event.kind !== 'generation.event') {
        return
      }

      if (event.event.kind === 'completed') {
        if (liveTextWritten && !lastLiveTextEndsWithNewline) {
          write('\n')
          lastLiveTextEndsWithNewline = true
          liveTerminalNewlineWritten = true
        }
        return
      }

      if (event.event.kind !== 'text.delta') {
        return
      }

      write(event.event.delta)
      liveTextWritten = true
      lastLiveTextEndsWithNewline = event.event.delta.endsWith('\n')
    },
    writeFinalResult(result) {
      if (!enabled) {
        writeDeepSeekCliOutput({
          result,
          outputMode: input.outputMode,
          includeCitations: input.includeCitations,
          includeSessionHandleFooter: input.includeSessionHandleFooter,
          write,
        })
        return
      }

      for (const chunk of buildRealtimeTextTerminalChunks({
        result,
        outputMode: input.outputMode,
        liveTextWritten,
        liveTerminalNewlineWritten,
        includeCitations: input.includeCitations !== false,
        includeSessionHandleFooter: input.includeSessionHandleFooter === true,
      })) {
        write(chunk)
      }
    },
  }
}

export function createDeepSeekCliRealtimeOutputController(input: {
  outputMode: DeepSeekResolvedOutputMode
  includeCitations?: boolean | undefined
  includeSessionHandleFooter?: boolean | undefined
  write?: ((chunk: string) => void) | undefined
}): DeepSeekCliRealtimeTextOutputController {
  if (isStreamingTextOutputMode(input.outputMode)) {
    return createDeepSeekCliRealtimeTextOutputController(input)
  }

  if (isStreamingJsonOutputMode(input.outputMode)) {
    return createDeepSeekCliRealtimeJsonOutputController(input)
  }

  return createDisabledRealtimeOutputController(input)
}

function buildTextOutputChunks(
  result: DeepSeekReplyResult,
  outputMode: DeepSeekResolvedOutputMode,
  includeSessionHandleFooter: boolean,
  includeCitations: boolean,
): string[] {
  if (outputMode.transport === 'buffered') {
    const output = buildDeepSeekBufferedReplyOutput({
      result,
      outputMode,
      includeCitations,
    })
    if (output.format !== 'text') {
      throw new Error('CLI text output expected a buffered text reply output.')
    }
    return [
      `${output.text}\n`,
      ...buildSessionHandleFooterChunks(result, includeSessionHandleFooter, output.text),
    ]
  }

  const chunks = buildDeepSeekStreamingReplyOutputChunks({
    result,
    outputMode,
    includeCitations,
  })
  const deltas = chunks
    .filter(chunk => chunk.format === 'text')
    .map(chunk => chunk.delta)
  return [
    ...deltas,
    '\n',
    ...buildSessionHandleFooterChunks(result, includeSessionHandleFooter, deltas.join('')),
  ]
}

function buildRealtimeTextTerminalChunks(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  liveTextWritten: boolean
  liveTerminalNewlineWritten: boolean
  includeCitations: boolean
  includeSessionHandleFooter: boolean
}): string[] {
  const chunks = buildTextOutputChunks(
    input.result,
    input.outputMode,
    input.includeSessionHandleFooter,
    input.includeCitations,
  )
  if (!input.liveTextWritten) {
    return chunks
  }

  const leadingDeltaCount = countStreamingTextDeltaEvents(input.result)
  const boundedDeltaCount = Math.min(leadingDeltaCount, Math.max(0, chunks.length - 1))
  const remainingChunks = chunks.slice(boundedDeltaCount)
  if (input.liveTerminalNewlineWritten && remainingChunks[0] === '\n') {
    return remainingChunks.slice(1)
  }
  return remainingChunks
}

function countStreamingTextDeltaEvents(result: DeepSeekReplyResult): number {
  if (result.output.mode !== 'stream') {
    return 0
  }

  return result.output.canonicalRuns.reduce(
    (count, run) =>
      count + run.events.filter(event => event.kind === 'text.delta').length,
    0,
  )
}

function isStreamingTextOutputMode(outputMode: DeepSeekResolvedOutputMode): boolean {
  return outputMode.transport === 'streaming' && outputMode.outputFamily === 'text'
}

function isStreamingJsonOutputMode(outputMode: DeepSeekResolvedOutputMode): boolean {
  return outputMode.transport === 'streaming' && outputMode.outputFamily === 'json'
}

function createDisabledRealtimeOutputController(input: {
  outputMode: DeepSeekResolvedOutputMode
  includeCitations?: boolean | undefined
  includeSessionHandleFooter?: boolean | undefined
  write?: ((chunk: string) => void) | undefined
}): DeepSeekCliRealtimeTextOutputController {
  const write = input.write ?? (chunk => process.stdout.write(chunk))

  return {
    enabled: false,
    onEvent() {},
    writeFinalResult(result) {
      writeDeepSeekCliOutput({
        result,
        outputMode: input.outputMode,
        includeCitations: input.includeCitations,
        includeSessionHandleFooter: input.includeSessionHandleFooter,
        write,
      })
    },
  }
}

function createDeepSeekCliRealtimeJsonOutputController(input: {
  outputMode: DeepSeekResolvedOutputMode
  write?: ((chunk: string) => void) | undefined
}): DeepSeekCliRealtimeJsonOutputController {
  const write = input.write ?? (chunk => process.stdout.write(chunk))
  let liveChunkWritten = false
  let activeAttemptNumber: number | null = null
  let openAIResponsesAdapter: DeepSeekCliRealtimeOpenAIResponsesAdapter | null = null
  let openAIChatCompletionsAdapter: DeepSeekCliRealtimeOpenAIChatCompletionsAdapter | null = null

  return {
    enabled: true,
    onEvent(event) {
      if (event.kind === 'attempt.started') {
        resetStreamingJsonAdapterState(event.attemptNumber)
        return
      }
      if (event.kind !== 'generation.event') {
        return
      }

      const chunks = buildRealtimeStreamingJsonChunks({
        event,
        outputMode: input.outputMode,
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
          if (activeAttemptNumber !== event.attemptNumber || openAIChatCompletionsAdapter === null) {
            activeAttemptNumber = event.attemptNumber
            openAIChatCompletionsAdapter = createOpenAIChatCompletionsStreamAdapter({
              context: event.event.context,
            })
            openAIResponsesAdapter = null
          }
          return openAIChatCompletionsAdapter
        },
      })
      if (chunks.length === 0) {
        return
      }

      liveChunkWritten = true
      for (const chunk of chunks) {
        write(chunk)
      }
    },
    writeFinalResult(result) {
      if (!liveChunkWritten) {
        writeDeepSeekCliOutput({
          result,
          outputMode: input.outputMode,
          write,
        })
        return
      }

      for (const chunk of buildRealtimeStreamingJsonTerminalChunks({
        result,
        outputMode: input.outputMode,
      })) {
        write(chunk)
      }
    },
  }

  function resetStreamingJsonAdapterState(attemptNumber: number): void {
    activeAttemptNumber = attemptNumber
    openAIResponsesAdapter = null
    openAIChatCompletionsAdapter = null
  }
}

function buildBufferedJsonOutput(
  result: DeepSeekReplyResult,
  outputMode: DeepSeekResolvedOutputMode,
): unknown {
  const output = buildDeepSeekBufferedReplyOutput({
    result,
    outputMode,
  })
  if (output.format !== 'json') {
    throw new Error('CLI JSON output expected a buffered JSON reply output.')
  }
  return output.data
}

function buildStreamingJsonChunks(
  result: DeepSeekReplyResult,
  outputMode: DeepSeekResolvedOutputMode,
): string[] {
  return buildDeepSeekStreamingReplyOutputChunks({
    result,
    outputMode,
  }).map(chunk => {
    if (chunk.format !== 'stream-json') {
      throw new Error('CLI stream-json output expected JSON streaming reply chunks.')
    }
    return `${JSON.stringify(chunk.data)}\n`
  })
}

function buildRealtimeStreamingJsonChunks(input: {
  event: Extract<DeepSeekReplyLiveEvent, { kind: 'generation.event' }>
  outputMode: DeepSeekResolvedOutputMode
  ensureOpenAIResponsesAdapter: () => DeepSeekCliRealtimeOpenAIResponsesAdapter
  ensureOpenAIChatCompletionsAdapter: () => DeepSeekCliRealtimeOpenAIChatCompletionsAdapter
}): string[] {
  if (input.outputMode.jsonShape === 'native') {
    return [`${JSON.stringify(input.event.event)}\n`]
  }

  if (input.outputMode.jsonShape === 'openai-responses') {
    return input.ensureOpenAIResponsesAdapter()
      .push(input.event.event)
      .map(frame => `${JSON.stringify(frame)}\n`)
  }

  return input.ensureOpenAIChatCompletionsAdapter()
    .push(input.event.event)
    .map(frame => `${JSON.stringify(frame)}\n`)
}

function buildRealtimeStreamingJsonTerminalChunks(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
}): string[] {
  if (input.outputMode.jsonShape !== 'native') {
    return []
  }

  const rateLimit = resolveDeepSeekReplyRateLimitMetadata(input.result)
  if (!rateLimit) {
    return []
  }

  return [
    `${JSON.stringify({
      kind: 'reply.rate_limit',
      rateLimit,
    })}\n`,
  ]
}

export const parseDeepSeekOutputFormat = parseDeepSeekReplyOutputFormat
export const parseDeepSeekOutputJsonShape = parseDeepSeekReplyOutputJsonShape

function buildSessionHandleFooterChunks(
  result: DeepSeekReplyResult,
  includeSessionHandleFooter: boolean,
  bodyText: string,
): string[] {
  if (!includeSessionHandleFooter || result.sessionId.trim().length === 0) {
    return []
  }

  const separator = bodyText.trim().length > 0 ? '\n' : ''
  return [`${separator}sessionId: ${result.sessionId}\n`]
}
