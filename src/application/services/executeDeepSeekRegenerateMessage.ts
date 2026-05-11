import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  DeepSeekRegenerateMessageExecutionInput,
  DeepSeekReplyExecutionResult,
  DeepSeekReplyLiveDeliveryInput,
  DeepSeekReplyLiveEvent,
} from '../../types/deepseek-reply-output.types.js'
import { resolveDeepSeekReplyOutputMode } from './deepSeekReplyOutputMode.js'
import { regenerateDeepSeekAssistantMessage } from '../usecases/regenerateDeepSeekAssistantMessage.js'

export async function executeDeepSeekRegenerateMessage(
  input: DeepSeekRegenerateMessageExecutionInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'regenerate-message-output' }),
): Promise<DeepSeekReplyExecutionResult> {
  const outputMode = resolveDeepSeekReplyOutputMode(input.output)
  const live = outputMode.transport === 'streaming' ? input.live : undefined
  emitLiveEvent(live, {
    kind: 'attempt.started',
    attemptNumber: 1,
    outputMode,
  })
  const result = await regenerateDeepSeekAssistantMessage(
    {
      ...input.regenerate,
      stream: outputMode.stream,
      onCanonicalGenerationEvent: item => {
        emitLiveEvent(live, {
          kind: 'generation.event',
          attemptNumber: 1,
          outputMode,
          source: item.source,
          event: item.event,
        })
      },
    },
    logger,
  )
  emitLiveEvent(live, {
    kind: 'attempt.completed',
    attemptNumber: 1,
    outputMode,
    result,
    willRetry: false,
  })

  return {
    result,
    outputMode,
  }
}

function emitLiveEvent(
  live: DeepSeekReplyLiveDeliveryInput | undefined,
  event: DeepSeekReplyLiveEvent,
): void {
  live?.onEvent?.(event)
}
