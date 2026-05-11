import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { waitForStableDeepSeekComposerSnapshot } from '../../infrastructure/deepseek/deepSeekComposerControls.js'
import {
  deleteDeepSeekSessionOnPage,
  saveDeepSeekDeleteSessionAuditFixture,
  withDeleteSessionAuditOutput,
} from '../../infrastructure/deepseek/deepSeekDeleteSessionFlow.js'
import { deleteStoredSessionFile } from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import {
  assertSnapshotMatchesTarget,
  resolveDeepSeekSessionTarget,
} from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekDeleteSessionResult } from '../../types/deepseek-chat-session-delete.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export const DEEPSEEK_DELETE_SESSION_ALLOW_OPTION = '--allow-destructive-delete-session'

export function buildDeleteDeepSeekSessionActionLabel(sessionId: string): string {
  return `delete DeepSeek session ${sessionId}`
}

export function buildDeleteDeepSeekSessionConfirmationText(sessionId: string): string {
  return `DELETE SESSION ${sessionId}`
}

export interface DeleteDeepSeekSessionInput extends ManagedChromeOptions {
  sessionId: string
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  waitUntil: WaitUntil
  auditOutputFile?: string | undefined
}

export async function deleteDeepSeekSession(
  input: DeleteDeepSeekSessionInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'delete-session' }),
): Promise<DeepSeekDeleteSessionResult> {
  try {
    const target = await resolveDeepSeekSessionTarget({
      sessionId: input.sessionId,
      sessionFile: input.sessionFile,
      sessionStoreDir: input.sessionStoreDir,
    })
    const actionLabel = buildDeleteDeepSeekSessionActionLabel(target.authoritativeSessionId)
    const confirmationText = buildDeleteDeepSeekSessionConfirmationText(
      target.authoritativeSessionId,
    )

    logger.info('Resolved authoritative DeepSeek session delete target', {
      requestedSessionId: input.sessionId,
      authoritativeSessionId: target.authoritativeSessionId,
      finalUrl: target.finalUrl,
      sessionFile: target.sessionFile,
    })

    const result = await withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page, goto }) => {
            await goto(target.finalUrl, input.waitUntil)
            await page.waitForSelector('body')

            const snapshot = await waitForStableDeepSeekComposerSnapshot(page, {
              timeoutMs: input.timeoutMs,
            })
            assertSnapshotMatchesTarget(snapshot, target)

            const deletion = await deleteDeepSeekSessionOnPage(
              page,
              {
                requestedSessionId: target.requestedSessionId,
                authoritativeSessionId: target.authoritativeSessionId,
                finalUrl: target.finalUrl,
                sessionFile: target.sessionFile,
                timeoutMs: input.timeoutMs,
                actionLabel,
                allowOptionName: DEEPSEEK_DELETE_SESSION_ALLOW_OPTION,
                confirmationText,
              },
              logger,
            )

            const localSessionFileDeleted = await deleteStoredSessionFile(target.sessionFile)
            const output = withDeleteSessionAuditOutput(deletion, {
              localSessionFileDeleted,
              ...(input.auditOutputFile
                ? { auditOutputFile: input.auditOutputFile }
                : {}),
            })

            if (input.auditOutputFile) {
              await saveDeepSeekDeleteSessionAuditFixture(input.auditOutputFile, output)
            }

            return output
          },
        )
      },
      { logger, operation: 'delete-session' },
    )

    logger.info('DeepSeek single-session delete completed', {
      authoritativeSessionId: result.target.authoritativeSessionId,
      localSessionFileDeleted: result.localSessionFileDeleted,
      auditOutputFile: result.auditOutputFile,
    })
    return result
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek single-session delete failed',
      error,
      context: {
        sessionId: input.sessionId,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        auditOutputFile: input.auditOutputFile ?? null,
      },
    })
    throw error
  }
}
