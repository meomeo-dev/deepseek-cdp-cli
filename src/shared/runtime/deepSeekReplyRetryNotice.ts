import type { DeepSeekReplyRetryProgressEvent } from '../../types/deepseek-reply-output.types.js'

export function createDeepSeekReplyRetryNoticeHandler(input: {
  write: (chunk: string) => void
  isTTY: boolean
}): (event: DeepSeekReplyRetryProgressEvent) => void {
  let countdownActive = false
  const prefix = '[api-rate-limit-retry]'

  return event => {
    switch (event.kind) {
      case 'retry.scheduled': {
        if (!input.isTTY || event.cooldownMs <= 0) {
          input.write(
            `${prefix} waiting ${Math.ceil(event.cooldownMs / 1000)}s before browser-flow replay attempt ${event.nextAttemptNumber}/${event.maxRetries + 1}\n`,
          )
          countdownActive = false
          return
        }
        countdownActive = true
        input.write(
          `\r${prefix} browser-flow replay attempt ${event.nextAttemptNumber}/${event.maxRetries + 1} in ${Math.ceil(event.cooldownMs / 1000)}s`,
        )
        return
      }
      case 'retry.tick': {
        if (!input.isTTY) {
          return
        }
        countdownActive = true
        input.write(
          `\r${prefix} browser-flow replay attempt ${event.nextAttemptNumber} in ${Math.ceil(event.remainingMs / 1000)}s`,
        )
        return
      }
      case 'retry.peer-wait': {
        if (countdownActive) {
          input.write('\n')
          countdownActive = false
        }
        input.write(
          `${prefix} waiting for ${event.activeSearchAttemptCount} other active search attempt${event.activeSearchAttemptCount === 1 ? '' : 's'} to settle before replay attempt ${event.nextAttemptNumber}\n`,
        )
        return
      }
      case 'retry.starting': {
        if (countdownActive) {
          input.write('\n')
          countdownActive = false
        }
        input.write(
          `${prefix} starting browser-flow replay attempt ${event.attemptNumber}/${event.maxRetries + 1}\n`,
        )
        return
      }
      case 'retry.exhausted': {
        if (countdownActive) {
          input.write('\n')
          countdownActive = false
        }
        input.write(
          `${prefix} exhausted automatic browser-flow retries after ${event.attemptNumber}/${event.maxRetries + 1} attempts; no confirmed UI retry button was clicked\n`,
        )
        return
      }
    }
  }
}
