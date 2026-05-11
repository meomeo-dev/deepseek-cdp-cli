import { resolveDeepSeekOutputMode } from '../../infrastructure/deepseek/deepSeekOutputModes.js'
import type {
  DeepSeekOutputFormat,
  DeepSeekOutputJsonShape,
  DeepSeekResolvedOutputMode,
} from '../../types/deepseek-output-modes.types.js'
import type { DeepSeekReplyOutputOptionInput } from '../../types/deepseek-reply-output.types.js'

export function resolveDeepSeekReplyOutputMode(
  input: DeepSeekReplyOutputOptionInput = {},
): DeepSeekResolvedOutputMode {
  if (
    input.stream !== undefined &&
    input.legacyStream !== undefined &&
    input.stream !== input.legacyStream
  ) {
    throw new Error('Output stream flag conflicts with legacy `stream` param.')
  }

  return resolveDeepSeekOutputMode({
    stream: input.stream ?? input.legacyStream ?? false,
    ...(input.format ? { format: parseDeepSeekReplyOutputFormat(input.format) } : {}),
    ...(input.jsonShape ? { jsonShape: parseDeepSeekReplyOutputJsonShape(input.jsonShape) } : {}),
  })
}

export function parseDeepSeekReplyOutputFormat(value: string): DeepSeekOutputFormat {
  if (value === 'text' || value === 'json' || value === 'stream-json') {
    return value
  }

  throw new Error(`Invalid format option: ${value}. Expected text, json, or stream-json.`)
}

export function parseDeepSeekReplyOutputJsonShape(value: string): DeepSeekOutputJsonShape {
  if (
    value === 'native' ||
    value === 'openai-responses' ||
    value === 'openai-chat-completions'
  ) {
    return value
  }

  throw new Error(
    `Invalid json-shape option: ${value}. Expected native, openai-responses, or openai-chat-completions.`,
  )
}
