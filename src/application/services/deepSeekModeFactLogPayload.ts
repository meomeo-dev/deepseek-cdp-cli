import { cloneDeepSeekChatModeFact, pickLatestDeepSeekChatModeFact } from '../../domain/deepseek/deepSeekChatModeFact.js'
import type { DeepSeekObservedGenerationRun } from '../../types/deepseek-generation.types.js'
import type { DeepSeekSession, DeepSeekStoredSession } from '../../types/deepseek-session.types.js'

export function buildDeepSeekModeFactLogPayload(input: {
  storedSession?: DeepSeekStoredSession | null | undefined
  session?: DeepSeekSession | null | undefined
  generationRuns?: DeepSeekObservedGenerationRun[] | null | undefined
}): {
  sourceLayer: string
  rawModelType: string
  resolvedMode: string | null
  derivedFromLayer?: string | undefined
} | null {
  const modeFact = cloneDeepSeekChatModeFact(
    pickLatestDeepSeekChatModeFact(
      input.generationRuns
        ? selectLatestGenerationRunModeFact(input.generationRuns)
        : null,
      input.session?.modeFact,
      input.storedSession?.session.modeFact,
      input.storedSession?.metadata?.modeFact,
    ),
  )
  if (!modeFact) {
    return null
  }

  return {
    sourceLayer: modeFact.sourceLayer,
    rawModelType: modeFact.rawModelType,
    resolvedMode: modeFact.resolvedMode,
    ...(modeFact.derivedFromLayer ? { derivedFromLayer: modeFact.derivedFromLayer } : {}),
  }
}

function selectLatestGenerationRunModeFact(
  generationRuns: DeepSeekObservedGenerationRun[],
) {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const modeFact = generationRuns[index]?.context.modeFact
    if (modeFact) {
      return modeFact
    }
  }

  return null
}
