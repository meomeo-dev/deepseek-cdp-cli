import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { resolveDeepSeekSessionTarget } from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import {
  projectDeepSeekSessionRestoreResult,
  syncDeepSeekSessionOnPage,
} from '../../infrastructure/deepseek/deepSeekSessionSync.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekSessionRestoreResult } from '../../types/deepseek-session-restore.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface InspectDeepSeekSessionInput extends ManagedChromeOptions {
  sessionId: string
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  waitUntil: WaitUntil
}

export async function inspectDeepSeekSession(
  input: InspectDeepSeekSessionInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'inspect-session' }),
): Promise<DeepSeekSessionRestoreResult> {
  try {
    const target = await resolveDeepSeekSessionTarget({
      sessionId: input.sessionId,
      sessionFile: input.sessionFile,
      sessionStoreDir: input.sessionStoreDir,
    })

    logger.info('Resolved authoritative DeepSeek session target', {
      requestedSessionId: input.sessionId,
      authoritativeSessionId: target.authoritativeSessionId,
      authoritativeAgentId: target.authoritativeAgentId,
      finalUrl: target.finalUrl,
      sessionFile: target.sessionFile,
    })

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page }) => {
            const result = await syncDeepSeekSessionOnPage(
              page,
              {
                target,
                timeoutMs: input.timeoutMs,
                waitUntil: input.waitUntil,
              },
              logger.child('sync'),
            )

            logger.info('DeepSeek session context restored', {
              authoritativeSessionId: result.authoritativeSessionId,
              contextSource: result.contextSource,
              branchCount: result.session.branches.length,
            })
            return projectDeepSeekSessionRestoreResult(result)
          },
        )
      },
      { logger, operation: 'inspect-session' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek session inspection failed',
      error,
      context: {
        sessionId: input.sessionId,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
      },
    })
    throw error
  }
}
