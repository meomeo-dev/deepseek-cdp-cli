import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { waitForDeepSeekHomeEntry } from '../../infrastructure/deepseek/deepSeekHomeEntry.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekHomeEntryResult } from '../../types/deepseek-home-entry.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import {
  buildAcquiredBrowserRuntimeLogContext,
  buildRequestedBrowserRuntimeLogContext,
} from '../services/browserRuntimeLogContext.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface InspectDeepSeekHomeEntryInput extends ManagedChromeOptions {
  url: string
  waitUntil: WaitUntil
}

export async function inspectDeepSeekHomeEntry(
  input: InspectDeepSeekHomeEntryInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'inspect-home' }),
): Promise<DeepSeekHomeEntryResult> {
  try {
    logger.info('Preparing DeepSeek home entry inspection', {
      ...buildRequestedBrowserRuntimeLogContext(input),
      url: input.url,
    })

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        logger.info('Using browser runtime for DeepSeek home entry inspection', {
          ...buildAcquiredBrowserRuntimeLogContext(runtime),
          url: input.url,
        })
        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page, goto }) => {
            await goto(input.url, input.waitUntil)
            await page.waitForSelector('body')

            const result = await waitForDeepSeekHomeEntry(page, {
              requestedUrl: input.url,
              timeoutMs: input.timeoutMs,
            })

            logger.info('DeepSeek home entry ready', {
              finalUrl: result.finalUrl,
              routeKind: result.routeKind,
              settledAfterMs: result.settledAfterMs,
            })
            return result
          },
        )
      },
      { logger, operation: 'inspect-home' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek home entry inspection failed',
      error,
      context: {
        url: input.url,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
      },
    })
    throw error
  }
}
