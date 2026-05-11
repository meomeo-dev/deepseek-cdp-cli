import type {
  DeepSeekChatMode,
  DeepSeekChatModeFact,
  DeepSeekChatModeSignalLayer,
} from '../../types/deepseek-chat-mode.types.js'

export function resolveDeepSeekChatModeFromModelType(
  modelType: string | null | undefined,
): DeepSeekChatMode | null {
  if (!modelType) {
    return null
  }

  const normalized = modelType.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized === 'default') {
    return 'instant'
  }
  if (normalized === 'expert') {
    return 'expert'
  }
  if (normalized === 'vision') {
    return 'vision'
  }

  return null
}

export function buildDeepSeekChatModeFact(input: {
  sourceLayer: DeepSeekChatModeSignalLayer
  rawModelType: string | null | undefined
  derivedFromLayer?: DeepSeekChatModeSignalLayer | undefined
}): DeepSeekChatModeFact | null {
  const normalized = input.rawModelType?.trim()
  if (!normalized) {
    return null
  }

  return {
    sourceLayer: input.sourceLayer,
    rawModelType: normalized,
    resolvedMode: resolveDeepSeekChatModeFromModelType(normalized),
    ...(input.derivedFromLayer ? { derivedFromLayer: input.derivedFromLayer } : {}),
  }
}

export function cloneDeepSeekChatModeFact(
  fact: DeepSeekChatModeFact | null | undefined,
): DeepSeekChatModeFact | null {
  if (!fact) {
    return null
  }

  return {
    sourceLayer: fact.sourceLayer,
    rawModelType: fact.rawModelType,
    resolvedMode: fact.resolvedMode,
    ...(fact.derivedFromLayer ? { derivedFromLayer: fact.derivedFromLayer } : {}),
  }
}

export function rebindDeepSeekChatModeFact(input: {
  fact: DeepSeekChatModeFact | null | undefined
  sourceLayer: DeepSeekChatModeSignalLayer
  derivedFromLayer?: DeepSeekChatModeSignalLayer | undefined
}): DeepSeekChatModeFact | null {
  if (!input.fact) {
    return null
  }

  return {
    sourceLayer: input.sourceLayer,
    rawModelType: input.fact.rawModelType,
    resolvedMode: input.fact.resolvedMode,
    derivedFromLayer: input.derivedFromLayer ?? input.fact.sourceLayer,
  }
}

export function pickLatestDeepSeekChatModeFact(
  ...facts: Array<DeepSeekChatModeFact | null | undefined>
): DeepSeekChatModeFact | null {
  for (let index = facts.length - 1; index >= 0; index -= 1) {
    const fact = cloneDeepSeekChatModeFact(facts[index])
    if (fact) {
      return fact
    }
  }

  return null
}
