import {
  parseDeepSeekReplyOutputFormat,
  parseDeepSeekReplyOutputJsonShape,
  resolveDeepSeekReplyOutputMode,
} from '../../application/services/deepSeekReplyOutputMode.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'

export interface DeepSeekInteractiveOutputModeInput {
  stream?: boolean | undefined
  format?: string | undefined
  jsonShape?: string | undefined
}

export interface DeepSeekInteractiveOutputModeState {
  requested: Required<Pick<DeepSeekInteractiveOutputModeInput, 'stream'>> &
    Pick<DeepSeekInteractiveOutputModeInput, 'format' | 'jsonShape'>
  resolved: DeepSeekResolvedOutputMode
}

export function createDeepSeekInteractiveOutputModeState(
  input: DeepSeekInteractiveOutputModeInput | undefined,
): DeepSeekInteractiveOutputModeState {
  const requested = {
    stream: input?.stream === true,
    ...(input?.format ? { format: input.format } : {}),
    ...(input?.jsonShape ? { jsonShape: input.jsonShape } : {}),
  }

  return {
    requested,
    resolved: resolveDeepSeekReplyOutputMode(requested),
  }
}

export function serializeDeepSeekInteractiveOutputModeState(
  state: DeepSeekInteractiveOutputModeState,
): string {
  return JSON.stringify(
    {
      requested: {
        stream: state.requested.stream,
        format: state.requested.format ?? null,
        jsonShape: state.requested.jsonShape ?? null,
      },
      resolved: state.resolved,
    },
    null,
    2,
  )
}

export function applyDeepSeekInteractiveOutputModeCommand(
  current: DeepSeekInteractiveOutputModeState,
  command: string,
): DeepSeekInteractiveOutputModeState {
  const [target, value] = command.split(/\s+/, 2)
  if (target === 'reset') {
    return createDeepSeekInteractiveOutputModeState(undefined)
  }

  if (target === 'stream') {
    if (value !== 'on' && value !== 'off') {
      throw new Error('Usage: output stream <on|off>')
    }
    return createDeepSeekInteractiveOutputModeState({
      ...current.requested,
      stream: value === 'on',
    })
  }

  if (target === 'format') {
    if (!value) {
      throw new Error('Usage: output format <text|json|stream-json|auto>')
    }

    return createDeepSeekInteractiveOutputModeState({
      ...current.requested,
      ...(value === 'auto' ? { format: undefined } : { format: parseDeepSeekReplyOutputFormat(value) }),
    })
  }

  if (target === 'shape') {
    if (!value) {
      throw new Error(
        'Usage: output shape <native|openai-responses|openai-chat-completions|none>',
      )
    }

    return createDeepSeekInteractiveOutputModeState({
      ...current.requested,
      ...(value === 'none'
        ? { jsonShape: undefined }
        : { jsonShape: parseDeepSeekReplyOutputJsonShape(value) }),
    })
  }

  throw new Error(
    'Usage: output stream <on|off> | output format <text|json|stream-json|auto> | output shape <native|openai-responses|openai-chat-completions|none> | output reset',
  )
}
