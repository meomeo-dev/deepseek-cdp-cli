import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { ReplyDeepSeekMessageInput } from '../usecases/replyDeepSeekMessage.js'
import { replyDeepSeekMessage } from '../usecases/replyDeepSeekMessage.js'
import type {
  DeepSeekReplyExecutionInput,
  DeepSeekReplyExecutionResult,
} from '../../types/deepseek-reply-output.types.js'
import { resolveDeepSeekReplyOutputMode } from './deepSeekReplyOutputMode.js'
import { runDeepSeekReplyWithRateLimitRetry } from './deepSeekReplyRateLimitRetry.js'

export async function executeDeepSeekReply(
  input: DeepSeekReplyExecutionInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'reply-output' }),
): Promise<DeepSeekReplyExecutionResult> {
  const outputMode = resolveDeepSeekReplyOutputMode(input.output)
  const live = outputMode.transport === 'streaming' ? input.live : undefined
  const result = await runDeepSeekReplyWithRateLimitRetry({
    reply: input.reply,
    outputMode,
    retry: input.retry,
    progress: input.progress,
    live,
    runAttempt: replyInput => replyDeepSeekMessage(replyInput, logger),
  })

  return {
    result,
    outputMode,
  }
}

export type { ReplyDeepSeekMessageInput }
