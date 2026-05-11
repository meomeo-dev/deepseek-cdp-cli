import type { Page } from 'puppeteer-core'
import type { WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekResolvedSessionSource } from '../../types/deepseek-branch-catalog.types.js'
import type { DeepSeekSessionSyncResult } from '../../types/deepseek-session-sync.types.js'
import type {
  DeepSeekResolvedSessionTarget,
  DeepSeekSessionRestoreResult,
} from '../../types/deepseek-session-restore.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import {
  applyTranscriptRecoveryToStoredSession,
  overlayLocalAttachmentMetadataOnRecoveredSession,
} from './deepSeekStoredSession.js'
import { saveStoredSessionToFile } from './fileSystemSessionStore.js'
import { restoreDeepSeekSessionOnPage } from './deepSeekSessionRestore.js'

export interface SyncDeepSeekSessionOnPageInput {
  target: DeepSeekResolvedSessionTarget
  timeoutMs: number
  waitUntil: WaitUntil
  requireRecoveredHistory?: boolean | undefined
  persistedAt?: string | undefined
}

export interface SyncDeepSeekSessionOnPageDependencies {
  restoreSession?: typeof restoreDeepSeekSessionOnPage
  persistSession?: typeof persistDeepSeekSessionSyncResult
}

export interface PersistDeepSeekSessionSyncResultInput {
  target: DeepSeekResolvedSessionTarget
  restore: DeepSeekSessionRestoreResult
  persistedAt?: string | undefined
}

export function materializeDeepSeekSessionSyncResult(
  input: PersistDeepSeekSessionSyncResultInput,
): DeepSeekSessionSyncResult {
  const storedSession = applyTranscriptRecoveryToStoredSession({
    storedSession: input.target.storedSession,
    transcriptRecovery: input.restore.historyMessagesRecovery.recovery,
    ...(input.restore.historyMessagesRecovery.outcome === 'recovered'
      ? {
          recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
            localSession: input.target.storedSession.session,
            recoveredSession: input.restore.historyMessagesRecovery.session,
          }),
        }
      : {}),
    ...(input.persistedAt ? { persistedAt: input.persistedAt } : {}),
  })

  return {
    ...input.restore,
    transcriptRecovery:
      storedSession.metadata?.transcriptRecovery ?? input.restore.transcriptRecovery,
    session: storedSession.session,
    storedSession,
  }
}

export async function persistDeepSeekSessionSyncResult(
  input: PersistDeepSeekSessionSyncResultInput,
): Promise<DeepSeekSessionSyncResult> {
  const result = materializeDeepSeekSessionSyncResult(input)
  await saveStoredSessionToFile(input.target.sessionFile, result.storedSession)
  return result
}

export async function syncDeepSeekSessionOnPage(
  page: Page,
  input: SyncDeepSeekSessionOnPageInput,
  logger?: RuntimeLogger,
  dependencies: SyncDeepSeekSessionOnPageDependencies = {},
): Promise<DeepSeekSessionSyncResult> {
  const restoreSession = dependencies.restoreSession ?? restoreDeepSeekSessionOnPage
  const persistSession = dependencies.persistSession ?? persistDeepSeekSessionSyncResult
  const restore = await restoreSession(
    page,
    {
      target: input.target,
      timeoutMs: input.timeoutMs,
      waitUntil: input.waitUntil,
    },
    logger,
  )

  if (input.requireRecoveredHistory && restore.historyMessagesRecovery.outcome !== 'recovered') {
    throw new Error(
      `DeepSeek session ${input.target.authoritativeSessionId} could not be synchronized because history_messages recovery did not settle to a recovered transcript.`,
    )
  }

  return persistSession({
    target: input.target,
    restore,
    ...(input.persistedAt ? { persistedAt: input.persistedAt } : {}),
  })
}

export function projectDeepSeekSessionRestoreResult(
  result: DeepSeekSessionSyncResult,
): DeepSeekSessionRestoreResult {
  return {
    requestedSessionId: result.requestedSessionId,
    authoritativeSessionId: result.authoritativeSessionId,
    authoritativeAgentId: result.authoritativeAgentId,
    finalUrl: result.finalUrl,
    sessionFile: result.sessionFile,
    routeVerified: result.routeVerified,
    composerSnapshot: result.composerSnapshot,
    historyMessagesRecovery: result.historyMessagesRecovery,
    contextSource: result.contextSource,
    transcriptRecovery: result.transcriptRecovery,
    session: result.session,
  }
}

export function projectDeepSeekResolvedSessionTargetFromSyncResult(
  result: DeepSeekSessionSyncResult,
): DeepSeekResolvedSessionTarget {
  return {
    requestedSessionId: result.requestedSessionId,
    sessionFile: result.sessionFile,
    finalUrl: result.finalUrl,
    authoritativeSessionId: result.authoritativeSessionId,
    authoritativeAgentId: result.authoritativeAgentId,
    storedSession: result.storedSession,
  }
}

export function projectDeepSeekResolvedSessionSourceFromSyncResult(
  result: DeepSeekSessionSyncResult,
): DeepSeekResolvedSessionSource {
  return {
    sessionFile: result.sessionFile,
    storedSession: result.storedSession,
    session: result.storedSession.session,
    authoritativeSessionId: result.authoritativeSessionId,
    authoritativeAgentId: result.authoritativeAgentId,
    finalUrl: result.finalUrl,
  }
}
