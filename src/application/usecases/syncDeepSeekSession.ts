import { existsSync } from 'node:fs'
import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  resolveDeepSeekSessionTarget,
} from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import {
  applyOnlineCatalogSummaryToStoredSession,
  buildDeepSeekSessionCatalogSummary,
  createCatalogOnlyStoredSessionFromOnlineSummary,
} from '../../infrastructure/deepseek/deepSeekSessionCatalog.js'
import { discoverDeepSeekOnlineSessionCatalogOnPage } from '../../infrastructure/deepseek/deepSeekOnlineSessionCatalog.js'
import { saveStoredSessionToFile } from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import { syncDeepSeekSessionOnPage } from '../../infrastructure/deepseek/deepSeekSessionSync.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import { buildDeepSeekSessionFilePath, resolveDeepSeekSessionStoreDir } from '../../infrastructure/deepseek/deepSeekStoredSession.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type {
  DeepSeekSessionCatalogSyncEntry,
  DeepSeekSessionCatalogSyncResult,
  DeepSeekSessionCatalogSyncWarning,
  DeepSeekSessionSyncResult,
} from '../../types/deepseek-session-sync.types.js'
import type {
  DeepSeekOnlineSessionCatalogResult,
  DeepSeekOnlineSessionCatalogSummary,
} from '../../types/deepseek-online-session-catalog.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface SyncDeepSeekSessionInput extends ManagedChromeOptions {
  sessionId?: string | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  waitUntil: WaitUntil
}

export interface SyncDeepSeekSessionTargetedResult {
  mode: 'targeted'
  sessionFile: string
  requestedSessionId: string
  authoritativeSessionId: string
  authoritativeAgentId: string
  finalUrl: string
  contextSource: DeepSeekSessionSyncResult['contextSource']
  historyRecoveryOutcome: DeepSeekSessionSyncResult['historyMessagesRecovery']['outcome']
  branchCountBefore: number
  branchCountAfter: number
  messageCountBefore: number
  messageCountAfter: number
  sync: DeepSeekSessionSyncResult
}

export type SyncDeepSeekSessionResult =
  | SyncDeepSeekSessionTargetedResult
  | DeepSeekSessionCatalogSyncResult

export interface ReconcileDeepSeekSessionCatalogInput {
  requestedUrl: string
  sessionStoreDir: string
  catalog: DeepSeekOnlineSessionCatalogResult
  syncedAt?: string | undefined
}

interface ReconcileDeepSeekSessionCatalogDependencies {
  saveStoredSession?: typeof saveStoredSessionToFile
  resolveLocalTarget?: typeof resolveDiscoveredSessionLocalTarget
}

export async function syncDeepSeekSession(
  input: SyncDeepSeekSessionInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'sync-session' }),
): Promise<SyncDeepSeekSessionResult> {
  try {
    if (!input.sessionId && !input.sessionFile) {
      return await syncDeepSeekSessionCatalog(input, logger)
    }

    const source = await resolveDeepSeekSessionSource({
      sessionId: input.sessionId,
      sessionFile: input.sessionFile,
      sessionStoreDir: input.sessionStoreDir,
    })
    const target = await resolveDeepSeekSessionTarget({
      sessionId: source.authoritativeSessionId,
      sessionFile: source.sessionFile,
    })
    const branchCountBefore = target.storedSession.session.branches.length
    const messageCountBefore = countSessionMessages(target.storedSession.session)

    logger.info('Resolved DeepSeek session sync target', {
      requestedSessionId: input.sessionId ?? source.authoritativeSessionId,
      authoritativeSessionId: target.authoritativeSessionId,
      authoritativeAgentId: target.authoritativeAgentId,
      finalUrl: target.finalUrl,
      sessionFile: target.sessionFile,
      branchCountBefore,
      messageCountBefore,
    })

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime =>
        withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page }) => {
            const sync = await syncDeepSeekSessionOnPage(
              page,
              {
                target,
                timeoutMs: input.timeoutMs,
                waitUntil: input.waitUntil,
                requireRecoveredHistory: true,
              },
              logger.child('sync'),
            )
            const branchCountAfter = sync.storedSession.session.branches.length
            const messageCountAfter = countSessionMessages(sync.storedSession.session)

            logger.info('DeepSeek session sync completed', {
              authoritativeSessionId: sync.authoritativeSessionId,
              contextSource: sync.contextSource,
              historyRecoveryOutcome: sync.historyMessagesRecovery.outcome,
              branchCountBefore,
              branchCountAfter,
              messageCountBefore,
              messageCountAfter,
              sessionFile: sync.sessionFile,
            })

            return {
              mode: 'targeted',
              sessionFile: sync.sessionFile,
              requestedSessionId: sync.requestedSessionId,
              authoritativeSessionId: sync.authoritativeSessionId,
              authoritativeAgentId: sync.authoritativeAgentId,
              finalUrl: sync.finalUrl,
              contextSource: sync.contextSource,
              historyRecoveryOutcome: sync.historyMessagesRecovery.outcome,
              branchCountBefore,
              branchCountAfter,
              messageCountBefore,
              messageCountAfter,
              sync,
            }
          },
        ),
      { logger, operation: 'sync-session' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek session sync failed',
      error,
      context: {
        sessionId: input.sessionId ?? null,
        sessionFile: input.sessionFile ?? null,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
      },
    })
    throw error
  }
}

function countSessionMessages(session: DeepSeekSessionSyncResult['session']): number {
  return session.branches.reduce((total, branch) => total + branch.messages.length, 0)
}

async function syncDeepSeekSessionCatalog(
  input: SyncDeepSeekSessionInput,
  logger: RuntimeLogger,
): Promise<DeepSeekSessionCatalogSyncResult> {
  const requestedUrl = `${DEFAULT_DEEPSEEK_BASE_URL}/`
  const sessionStoreDir = resolveDeepSeekSessionStoreDir(input.sessionStoreDir)

  logger.info('Preparing browser-backed DeepSeek session catalog reconcile', {
    requestedUrl,
    sessionStoreDir,
  })

  return withManagedChromeRuntimeIfNeeded(
    input,
    async runtime =>
      withBrowserPageLease(
        {
          runtime,
          timeoutMs: input.timeoutMs,
        },
        async ({ page }) => {
          const catalog = await discoverDeepSeekOnlineSessionCatalogOnPage(
            page,
            {
              requestedUrl,
              timeoutMs: input.timeoutMs,
              waitUntil: input.waitUntil,
            },
            logger.child('catalog'),
          )
          const result = await reconcileDeepSeekSessionCatalog({
            requestedUrl,
            sessionStoreDir,
            catalog,
          })

          logger.info('DeepSeek session catalog reconcile completed', {
            discoveredCount: result.discoveredCount,
            importedCount: result.importedCount,
            refreshedCount: result.refreshedCount,
            unchangedCount: result.unchangedCount,
            skippedCount: result.skippedCount,
            hasMore: result.hasMore,
            partial: result.partial,
            sessionStoreDir: result.sessionStoreDir,
          })

          return result
        },
      ),
    { logger, operation: 'sync-session' },
  )
}

export async function reconcileDeepSeekSessionCatalog(
  input: ReconcileDeepSeekSessionCatalogInput,
  dependencies: ReconcileDeepSeekSessionCatalogDependencies = {},
): Promise<DeepSeekSessionCatalogSyncResult> {
  const saveStoredSession = dependencies.saveStoredSession ?? saveStoredSessionToFile
  const resolveLocalTarget = dependencies.resolveLocalTarget ?? resolveDiscoveredSessionLocalTarget
  const warnings: DeepSeekSessionCatalogSyncWarning[] = input.catalog.warnings.map(warning => ({
    code: warning.code,
    message: warning.message,
  }))
  const sessions: DeepSeekSessionCatalogSyncEntry[] = []
  let importedCount = 0
  let refreshedCount = 0
  let unchangedCount = 0
  let skippedCount = 0
  const syncedAt = input.syncedAt ?? new Date().toISOString()

  for (const discoveredSession of input.catalog.sessions) {
    const localTarget = await resolveLocalTarget({
      discoveredSession,
      sessionStoreDir: input.sessionStoreDir,
    })

    if (localTarget.kind === 'invalid-local') {
      skippedCount += 1
      warnings.push(localTarget.warning)
      sessions.push({
        ...discoveredSession,
        reconciliation: 'skipped',
        sessionFile: localTarget.sessionFile,
        finalUrl: null,
        contextSource: null,
        historyRecoveryOutcome: null,
        branchCountBefore: null,
        branchCountAfter: null,
        messageCountBefore: null,
        messageCountAfter: null,
      })
      continue
    }

    try {
      if (localTarget.kind === 'remote-only') {
        const storedSession = createCatalogOnlyStoredSessionFromOnlineSummary({
          summary: discoveredSession,
          syncedAt,
        })
        await saveStoredSession(localTarget.sessionFile, storedSession)
        importedCount += 1
        sessions.push({
          ...discoveredSession,
          reconciliation: 'discovered_remote_only',
          sessionFile: localTarget.sessionFile,
          finalUrl: buildDeepSeekSessionCatalogSummary({
            sessionFile: localTarget.sessionFile,
            storedSession,
          }).finalUrl,
          contextSource: null,
          historyRecoveryOutcome: null,
          branchCountBefore: 0,
          branchCountAfter: 0,
          messageCountBefore: 0,
          messageCountAfter: 0,
        })
        continue
      }

      const branchCount = localTarget.target.storedSession.session.branches.length
      const messageCount = countSessionMessages(localTarget.target.storedSession.session)
      const applied = applyOnlineCatalogSummaryToStoredSession({
        storedSession: localTarget.target.storedSession,
        summary: discoveredSession,
        syncedAt,
      })

      if (applied.changed) {
        await saveStoredSession(localTarget.target.sessionFile, applied.storedSession)
        refreshedCount += 1
        sessions.push({
          ...discoveredSession,
          reconciliation: 'refreshed_existing',
          sessionFile: localTarget.target.sessionFile,
          finalUrl: buildDeepSeekSessionCatalogSummary({
            sessionFile: localTarget.target.sessionFile,
            storedSession: applied.storedSession,
          }).finalUrl,
          contextSource: null,
          historyRecoveryOutcome: null,
          branchCountBefore: branchCount,
          branchCountAfter: branchCount,
          messageCountBefore: messageCount,
          messageCountAfter: messageCount,
        })
        continue
      }

      unchangedCount += 1
      sessions.push({
        ...discoveredSession,
        reconciliation: 'already_current',
        sessionFile: localTarget.target.sessionFile,
        finalUrl: localTarget.target.finalUrl,
        contextSource: null,
        historyRecoveryOutcome: null,
        branchCountBefore: branchCount,
        branchCountAfter: branchCount,
        messageCountBefore: messageCount,
        messageCountAfter: messageCount,
      })
    } catch (error) {
      skippedCount += 1
      warnings.push({
        code: 'session_catalog_persist_failed',
        sessionId: discoveredSession.sessionId,
        sessionFile:
          localTarget.kind === 'remote-only'
            ? localTarget.sessionFile
            : localTarget.target.sessionFile,
        message: error instanceof Error ? error.message : 'DeepSeek session sync failed.',
      })
      sessions.push({
        ...discoveredSession,
        reconciliation: 'skipped',
        sessionFile:
          localTarget.kind === 'remote-only'
            ? localTarget.sessionFile
            : localTarget.target.sessionFile,
        finalUrl:
          localTarget.kind === 'remote-only'
            ? null
            : localTarget.target.finalUrl,
        contextSource: null,
        historyRecoveryOutcome: null,
        branchCountBefore:
          localTarget.kind === 'remote-only'
            ? 0
            : localTarget.target.storedSession.session.branches.length,
        branchCountAfter: null,
        messageCountBefore:
          localTarget.kind === 'remote-only'
            ? 0
            : countSessionMessages(localTarget.target.storedSession.session),
        messageCountAfter: null,
      })
    }
  }

  return {
    mode: 'catalog',
    sessionStoreDir: input.sessionStoreDir,
    requestedUrl: input.requestedUrl,
    discoverySource: 'fetch_page',
    discoveredCount: input.catalog.sessions.length,
    importedCount,
    refreshedCount,
    unchangedCount,
    skippedCount,
    hasMore: input.catalog.hasMore,
    partial: input.catalog.partial || skippedCount > 0,
    warnings,
    sessions,
  }
}

async function resolveDiscoveredSessionLocalTarget(input: {
  discoveredSession: DeepSeekOnlineSessionCatalogSummary
  sessionStoreDir?: string | undefined
}): Promise<
  | {
      kind: 'remote-only'
      sessionFile: string
    }
  | {
      kind: 'invalid-local'
      sessionFile: string
      warning: DeepSeekSessionCatalogSyncWarning
    }
  | {
      kind: 'existing'
      target: Awaited<ReturnType<typeof resolveDeepSeekSessionTarget>>
    }
> {
  const sessionFile = buildDeepSeekSessionFilePath(
    input.discoveredSession.sessionId,
    input.sessionStoreDir,
  )
  if (!existsSync(sessionFile)) {
    return {
      kind: 'remote-only',
      sessionFile,
    }
  }

  try {
    const target = await resolveDeepSeekSessionTarget({
      sessionId: input.discoveredSession.sessionId,
      sessionFile,
    })
    return {
      kind: 'existing',
      target,
    }
  } catch (error) {
    return {
      kind: 'invalid-local',
      sessionFile,
      warning: createLocalSessionSyncWarning({
        sessionId: input.discoveredSession.sessionId,
        sessionFile,
        error,
      }),
    }
  }
}

function createLocalSessionSyncWarning(input: {
  sessionId: string
  sessionFile: string
  error: unknown
}): DeepSeekSessionCatalogSyncWarning {
  const message =
    input.error instanceof Error
      ? input.error.message
      : 'DeepSeek local stored session could not be loaded.'

  return {
    code: /is inconsistent:|authority mismatch/i.test(message)
      ? 'session_file_inconsistent'
      : 'session_file_load_failed',
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    message,
  }
}
