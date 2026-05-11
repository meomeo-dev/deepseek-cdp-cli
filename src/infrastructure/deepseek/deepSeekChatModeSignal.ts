import type { DeepSeekParsedGenerationRun } from '../../types/deepseek-generation.types.js'
import type {
  DeepSeekChatModeSignalLayer,
  DeepSeekChatModeSignalObservation,
} from '../../types/deepseek-chat-mode.types.js'
import {
  resolveDeepSeekChatModeFromModelType,
} from '../../domain/deepseek/deepSeekChatModeFact.js'
import { isRecord, parseJsonIfPossible, readOptionalString, splitSseMessages } from './deepSeekGenerationParserPrimitives.js'
export {
  buildDeepSeekChatModeFact,
  cloneDeepSeekChatModeFact,
  pickLatestDeepSeekChatModeFact,
  rebindDeepSeekChatModeFact,
  resolveDeepSeekChatModeFromModelType,
} from '../../domain/deepseek/deepSeekChatModeFact.js'

export function extractDeepSeekRequestModelType(postData: string | null | undefined): string | null {
  const payload = parseJsonIfPossible(postData ?? null)
  if (!isRecord(payload)) {
    return null
  }

  return readOptionalString(payload, 'model_type')
}

export function extractDeepSeekReadyEventModelType(bodyText: string): string | null {
  for (const message of splitSseMessages(bodyText)) {
    if (message.event !== 'ready') {
      continue
    }

    const payload = parseJsonIfPossible(message.dataText)
    if (!isRecord(payload)) {
      return null
    }

    return readOptionalString(payload, 'model_type')
  }

  return null
}

export function extractDeepSeekHistoryMessagesModelType(bodyText: string): string | null {
  const payload = parseJsonIfPossible(bodyText)
  if (!isRecord(payload)) {
    return null
  }

  const data = isRecord(payload['data']) ? payload['data'] : null
  const bizData = data && isRecord(data['biz_data']) ? data['biz_data'] : null
  const chatSession =
    (bizData && isRecord(bizData['chat_session']) ? bizData['chat_session'] : null) ??
    (data && isRecord(data['chat_session']) ? data['chat_session'] : null)

  return readOptionalString(chatSession, 'model_type')
}

export function extractDeepSeekCanonicalGenerationContextModelType(
  run: DeepSeekParsedGenerationRun | undefined,
): string | null {
  return run?.context.modeFact?.rawModelType ?? null
}

export function buildDeepSeekChatModeSignalObservation(input: {
  layer: DeepSeekChatModeSignalLayer
  rawModelType: string | null
  note: string
}): DeepSeekChatModeSignalObservation {
  return {
    layer: input.layer,
    observed: Boolean(input.rawModelType),
    rawModelType: input.rawModelType,
    resolvedMode: resolveDeepSeekChatModeFromModelType(input.rawModelType),
    note: input.note,
  }
}
