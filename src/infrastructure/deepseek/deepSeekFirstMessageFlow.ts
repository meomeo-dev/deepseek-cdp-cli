import type { Page } from 'puppeteer-core'
import type { DeepSeekComposerModeInput } from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekFirstMessageResult } from '../../types/deepseek-first-message.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { runDeepSeekReplyOnPage } from './deepSeekReplyFlow.js'

export interface SendFirstDeepSeekMessageOnPageInput {
  requestedUrl: string
  prompt: string
  filePaths?: string[] | undefined
  timeoutMs: number
  composerMode?: DeepSeekComposerModeInput | undefined
}

export async function sendFirstDeepSeekMessageOnPage(
  page: Page,
  input: SendFirstDeepSeekMessageOnPageInput,
  logger?: RuntimeLogger,
): Promise<Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'>> {
  return runDeepSeekReplyOnPage(
    page,
    {
      entryMode: 'new-session',
      requestedUrl: input.requestedUrl,
      prompt: input.prompt,
      filePaths: input.filePaths,
      timeoutMs: input.timeoutMs,
      composerMode: input.composerMode,
    },
    logger,
  )
}
