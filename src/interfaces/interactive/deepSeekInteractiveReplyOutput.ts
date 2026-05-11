import {
  buildDeepSeekCliOutputChunks,
  createDeepSeekCliRealtimeOutputController,
} from '../cli/deepSeekCliOutput.js'
import { createDeepSeekReplyRetryNoticeHandler } from '../../shared/runtime/deepSeekReplyRetryNotice.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type {
  DeepSeekReplyLiveEvent,
  DeepSeekReplyRetryProgressEvent,
} from '../../types/deepseek-reply-output.types.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'

export interface DeepSeekInteractiveOutputWriter {
  writeReplyChunk: (chunk: string) => void
  createRetryNoticeHandler: () => (event: DeepSeekReplyRetryProgressEvent) => void
  flushPendingLine: () => void
}

export interface DeepSeekInteractiveRealtimeOutputController {
  enabled: boolean
  onEvent: (event: DeepSeekReplyLiveEvent) => void
  writeFinalResult: (result: DeepSeekReplyResult) => void
  flushPendingLine: () => void
}

export function buildDeepSeekInteractiveReplyOutputChunks(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
}): string[] {
  return buildDeepSeekCliOutputChunks(input)
}

export function createDeepSeekInteractiveOutputWriter(input: {
  write?: ((chunk: string) => void) | undefined
  isTTY?: boolean | undefined
} = {}): DeepSeekInteractiveOutputWriter {
  const write = input.write ?? (chunk => process.stdout.write(chunk))
  const isTTY = input.isTTY ?? (process.stdout.isTTY === true)
  let transientStatusActive = false

  function flushPendingLine(): void {
    if (!transientStatusActive) {
      return
    }

    write('\n')
    transientStatusActive = false
  }

  function writeReplyChunk(chunk: string): void {
    if (chunk.length === 0) {
      return
    }

    flushPendingLine()
    write(chunk)
  }

  function writeRetryChunk(chunk: string): void {
    if (chunk.length === 0) {
      return
    }

    if (isTTY && chunk.startsWith('\r') && !chunk.includes('\n')) {
      write(chunk)
      transientStatusActive = true
      return
    }

    if (transientStatusActive && !chunk.startsWith('\n')) {
      write('\n')
    }

    write(chunk)
    transientStatusActive = false
  }

  return {
    writeReplyChunk,
    createRetryNoticeHandler() {
      return createDeepSeekReplyRetryNoticeHandler({
        write: writeRetryChunk,
        isTTY,
      })
    },
    flushPendingLine,
  }
}

export function createDeepSeekInteractiveRealtimeOutputController(input: {
  outputMode: DeepSeekResolvedOutputMode
  outputWriter?: DeepSeekInteractiveOutputWriter | undefined
  write?: ((chunk: string) => void) | undefined
  isTTY?: boolean | undefined
}): DeepSeekInteractiveRealtimeOutputController {
  const outputWriter =
    input.outputWriter ??
    createDeepSeekInteractiveOutputWriter({
      write: input.write,
      isTTY: input.isTTY,
    })
  const baseController = createDeepSeekCliRealtimeOutputController({
    outputMode: input.outputMode,
    write: chunk => outputWriter.writeReplyChunk(chunk),
  })
  const retryNoticeHandler = outputWriter.createRetryNoticeHandler()

  return {
    enabled: baseController.enabled,
    onEvent(event) {
      if (!baseController.enabled) {
        return
      }

      if (event.kind === 'retry.progress') {
        retryNoticeHandler(event.progress)
        return
      }

      baseController.onEvent(event)
    },
    writeFinalResult(result) {
      baseController.writeFinalResult(result)
      outputWriter.flushPendingLine()
    },
    flushPendingLine: outputWriter.flushPendingLine,
  }
}

export function writeDeepSeekInteractiveReplyOutput(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  write?: ((chunk: string) => void) | undefined
}): void {
  const write = input.write ?? (chunk => process.stdout.write(chunk))
  for (const chunk of buildDeepSeekInteractiveReplyOutputChunks(input)) {
    write(chunk)
  }
}
