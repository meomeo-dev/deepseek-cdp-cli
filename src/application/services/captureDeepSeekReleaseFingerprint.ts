import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { captureDeepSeekReleaseFingerprintOnPage } from '../../infrastructure/deepseek/deepSeekReleaseFingerprint.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekReleaseFingerprint } from '../../types/deepseek-release-fingerprint.types.js'
import {
  buildAcquiredBrowserRuntimeLogContext,
  buildRequestedBrowserRuntimeLogContext,
} from './browserRuntimeLogContext.js'
import { withBrowserPageLease } from './withBrowserPageLease.js'

export interface CaptureDeepSeekReleaseFingerprintInput extends ManagedChromeOptions {
  targetUrl: string
  waitUntil: WaitUntil
  captureMessageActions?: boolean | undefined
}

export async function captureDeepSeekReleaseFingerprint(
  input: CaptureDeepSeekReleaseFingerprintInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'release-fingerprint' }),
): Promise<DeepSeekReleaseFingerprint> {
  try {
    logger.info('Preparing DeepSeek release fingerprint capture', {
      ...buildRequestedBrowserRuntimeLogContext(input),
      targetUrl: input.targetUrl,
      captureMessageActions: input.captureMessageActions ?? true,
    })

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        logger.info('Using browser runtime for DeepSeek release fingerprint capture', {
          ...buildAcquiredBrowserRuntimeLogContext(runtime),
          targetUrl: input.targetUrl,
        })

        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page }) =>
            captureDeepSeekReleaseFingerprintOnPage(page, {
              targetUrl: input.targetUrl,
              waitUntil: input.waitUntil,
              captureMessageActions: input.captureMessageActions ?? true,
            }),
        )
      },
      { logger, operation: 'capture-release-fingerprint' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek release fingerprint capture failed',
      error,
      context: {
        targetUrl: input.targetUrl,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
      },
    })
    throw error
  }
}
