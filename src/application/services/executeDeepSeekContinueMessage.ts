import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  DeepSeekContinueMessageExecutionInput,
  DeepSeekReplyExecutionResult,
  DeepSeekReplyLiveDeliveryInput,
  DeepSeekReplyLiveEvent,
} from '../../types/deepseek-reply-output.types.js'
import { resolveDeepSeekReplyOutputMode } from './deepSeekReplyOutputMode.js'
import { continueDeepSeekAssistantMessage } from '../usecases/continueDeepSeekAssistantMessage.js'

export async function executeDeepSeekContinueMessage(
  input: DeepSeekContinueMessageExecutionInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'continue-message-output' }),
): Promise<DeepSeekReplyExecutionResult> {
  const outputMode = resolveDeepSeekReplyOutputMode(input.output)
  const live = outputMode.transport === 'streaming' ? input.live : undefined
  emitLiveEvent(live, {
    kind: 'attempt.started',
    attemptNumber: 1,
    outputMode,
  })
  const result = await continueDeepSeekAssistantMessage(
    {
      ...input.continue,
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
