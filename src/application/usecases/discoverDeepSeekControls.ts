import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { ensureDeepSeekComposerMode } from '../../infrastructure/deepseek/deepSeekComposerMode.js'
import {
  captureDeepSeekComposerSnapshot,
  waitForStableDeepSeekComposerSnapshot,
} from '../../infrastructure/deepseek/deepSeekComposerControls.js'
import type { DeepSeekComposerModeInput } from '../../types/deepseek-composer-mode.types.js'
import type {
  ManagedChromeOptions,
  WaitUntil,
} from '../../types/managed-chrome.types.js'
import type { DeepSeekComposerSnapshot } from '../../types/deepseek-controls.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import {
  buildAcquiredBrowserRuntimeLogContext,
  buildRequestedBrowserRuntimeLogContext,
} from '../services/browserRuntimeLogContext.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface DiscoverDeepSeekControlsInput extends ManagedChromeOptions {
  url: string
  waitUntil: WaitUntil
  stabilize: boolean
  composerMode?: DeepSeekComposerModeInput | undefined
}

export async function discoverDeepSeekControls(
  input: DiscoverDeepSeekControlsInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'discover-controls' }),
): Promise<DeepSeekComposerSnapshot> {
  try {
    logger.info('Preparing browser session', {
      ...buildRequestedBrowserRuntimeLogContext(input),
    })

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        logger.info('Using browser runtime for DeepSeek composer control discovery', {
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

            let snapshot = input.stabilize
              ? await waitForStableDeepSeekComposerSnapshot(page, {
                  timeoutMs: input.timeoutMs,
                })
              : await captureDeepSeekComposerSnapshot(page)

            if (input.composerMode) {
              const composerMode = await ensureDeepSeekComposerMode(
                page,
                {
                  requestedMode: input.composerMode,
                  timeoutMs: input.timeoutMs,
                },
                logger.child('composer-mode'),
              )
              snapshot = composerMode.settledSnapshot
            }

            logger.info('Composer snapshot captured', {
              routeKind: snapshot.routeKind,
              pageUrl: snapshot.pageUrl,
            })
            return snapshot
          },
        )
      },
      { logger, operation: 'inspect-controls' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek composer control discovery failed',
      error,
      context: {
        url: input.url,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        stabilize: input.stabilize,
      },
    })
    throw error
  }
}
