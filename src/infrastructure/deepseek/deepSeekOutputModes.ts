import type {
  DeepSeekOutputFormat,
  DeepSeekOutputJsonShape,
  DeepSeekOutputModeInput,
  DeepSeekResolvedOutputMode,
} from '../../types/deepseek-output-modes.types.js'

export function resolveDeepSeekOutputMode(
  input: DeepSeekOutputModeInput,
): DeepSeekResolvedOutputMode {
  const format = resolveRequestedFormat(input)
  const jsonShape = input.jsonShape ?? null

  if (format === 'text') {
    if (jsonShape !== null) {
      throw new Error('`jsonShape` can only be used with `json` or `stream-json` output.')
    }
    return {
      stream: input.stream,
      format,
      jsonShape: null,
      transport: input.stream ? 'streaming' : 'buffered',
      outputFamily: 'text',
    }
  }

  if (format === 'json' && input.stream) {
    throw new Error('`json` output requires `stream=false`.')
  }

  if (format === 'stream-json' && !input.stream) {
    throw new Error('`stream-json` output requires `stream=true`.')
  }

  if (jsonShape === null) {
    throw new Error('JSON output requires `jsonShape` to be one of native|openai-responses|openai-chat-completions.')
  }

  return {
    stream: input.stream,
    format,
    jsonShape,
    transport: input.stream ? 'streaming' : 'buffered',
    outputFamily: 'json',
  }
}

export function isDeepSeekOutputJsonShape(value: string): value is DeepSeekOutputJsonShape {
  return ['native', 'openai-responses', 'openai-chat-completions'].includes(value)
}

function resolveRequestedFormat(input: DeepSeekOutputModeInput): DeepSeekOutputFormat {
  if (input.format) {
    return input.format
  }

  if (input.jsonShape) {
    return input.stream ? 'stream-json' : 'json'
  }

  return 'text'
}
