import type { Page } from 'puppeteer-core'
import type { WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekComposerSnapshot } from '../../types/deepseek-controls.types.js'
import type { DeepSeekHistoryMessagesRecoveryResult } from '../../types/deepseek-history-messages.types.js'
import type {
  DeepSeekResolvedSessionTarget,
  DeepSeekSessionRestoreResult,
} from '../../types/deepseek-session-restore.types.js'
import type { DeepSeekSession } from '../../types/deepseek-session.types.js'
import type { DeepSeekTranscriptRecovery } from '../../types/deepseek-transcript-recovery.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { matchDeepSeekSessionRoute } from './deepSeekApiCatalog.js'
import { waitForStableDeepSeekComposerSnapshot } from './deepSeekComposerControls.js'
import {
  observeDeepSeekHistoryMessagesResponses,
  recoverDeepSeekSessionFromHistoryMessagesCaptures,
  recoverDeepSeekSessionFromHistoryMessagesOnPage,
} from './deepSeekHistoryMessages.js'
import { loadStoredSessionFromFile } from './fileSystemSessionStore.js'
import { buildDeepSeekSessionFilePath } from './deepSeekStoredSession.js'
import { assertDeepSeekStoredSessionAuthorityConsistency } from './deepSeekStoredSessionAuthority.js'

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://chat.deepseek.com'
const DEFAULT_DEEPSEEK_CANONICAL_AGENT_ID = 'chat'

export async function resolveDeepSeekSessionTarget(input: {
  sessionId?: string | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
}): Promise<DeepSeekResolvedSessionTarget> {
  let sessionFile: string
  if (input.sessionFile) {
    sessionFile = input.sessionFile
  } else if (input.sessionId) {
    sessionFile = buildDeepSeekSessionFilePath(input.sessionId, input.sessionStoreDir, input.cwd)
  } else {
    throw new Error('Either sessionId or sessionFile is required.')
  }
  const storedSession = await loadStoredSessionFromFile(sessionFile)
  const authority = assertDeepSeekStoredSessionAuthorityConsistency({
    sessionFile,
    storedSession,
  })
  const { authoritativeSessionId, authoritativeAgentId } = authority

  if (input.sessionId && authoritativeSessionId !== input.sessionId) {
    throw new Error(
      `Stored session authority mismatch: requested ${input.sessionId}, but resolved ${authoritativeSessionId} from ${sessionFile}.`,
    )
  }

  const finalUrl =
    storedSession.metadata?.finalUrl ??
    buildDeepSeekSessionFinalUrl(authoritativeAgentId, authoritativeSessionId)
  validateResolvedFinalUrl(finalUrl, authoritativeAgentId, authoritativeSessionId)

  return {
    requestedSessionId: input.sessionId ?? authoritativeSessionId,
    sessionFile,
    finalUrl,
    authoritativeSessionId,
    authoritativeAgentId,
    storedSession,
  }
}

export function createBootstrapDeepSeekSessionTarget(input: {
  sessionId: string
  title: string
  updatedAt: string
  routeUrl?: string | null | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
}): DeepSeekResolvedSessionTarget {
  const sessionFile =
    input.sessionFile ??
    buildDeepSeekSessionFilePath(input.sessionId, input.sessionStoreDir, input.cwd)
  const routeMatch = input.routeUrl ? matchDeepSeekSessionRoute(input.routeUrl) : null
  const authoritativeAgentId =
    routeMatch?.routeKind === 'session' &&
    routeMatch.sessionId === input.sessionId &&
    routeMatch.agentId
      ? routeMatch.agentId
      : DEFAULT_DEEPSEEK_CANONICAL_AGENT_ID
  const finalUrl =
    routeMatch?.routeKind === 'session' &&
    routeMatch.sessionId === input.sessionId &&
    routeMatch.agentId
      ? input.routeUrl as string
      : buildDeepSeekSessionFinalUrl(authoritativeAgentId, input.sessionId)

  return {
    requestedSessionId: input.sessionId,
    sessionFile,
    finalUrl,
    authoritativeSessionId: input.sessionId,
    authoritativeAgentId,
    storedSession: {
      kind: 'deepseek-stored-session',
      version: 1,
      session: {
        id: input.sessionId,
        agentId: authoritativeAgentId,
        title: input.title,
        createdAt: input.updatedAt,
        branches: [],
      },
      metadata: null,
    },
  }
}

export async function restoreDeepSeekSessionOnPage(
  page: Page,
  input: {
    target: DeepSeekResolvedSessionTarget
    timeoutMs: number
    waitUntil: WaitUntil
  },
  logger?: RuntimeLogger,
): Promise<DeepSeekSessionRestoreResult> {
  const historyObserver = observeDeepSeekHistoryMessagesResponses(page, {
    sessionId: input.target.authoritativeSessionId,
  })
  await page.goto(input.target.finalUrl, {
    waitUntil: input.waitUntil,
  })
  await page.waitForSelector('body')

  const initialSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: input.timeoutMs,
  })
  assertSnapshotMatchesTarget(initialSnapshot, input.target)

  const observedHistoryCaptures = await historyObserver.stop(
    Math.max(1_000, Math.min(input.timeoutMs, 5_000)),
  )
  const observedHistoryRecovery = recoverDeepSeekSessionFromHistoryMessagesCaptures({
    captures: observedHistoryCaptures,
    attempts: 1,
  })
  const transcriptRecovery =
    observedHistoryRecovery?.outcome === 'recovered'
      ? observedHistoryRecovery
      : await recoverDeepSeekSessionFromHistoryMessagesOnPage(
          page,
          {
            finalUrl: input.target.finalUrl,
            sessionId: input.target.authoritativeSessionId,
            timeoutMs: Math.max(5_000, Math.min(input.timeoutMs, 20_000)),
          },
          logger?.child('history-messages'),
        )

  if (observedHistoryRecovery?.outcome === 'recovered') {
    logger?.debug('Recovered history_messages transcript from the initial session-page load', {
      sessionId: input.target.authoritativeSessionId,
      requestUrl: observedHistoryRecovery.recovery.requestUrl,
      responseStatus: observedHistoryRecovery.recovery.responseStatus,
      messageCount: observedHistoryRecovery.recovery.messageCount,
      branchCount: observedHistoryRecovery.recovery.branchCount,
    })
  } else if (observedHistoryRecovery) {
    logger?.debug('Initial session-page history_messages capture was not settled; falling back to explicit reload recovery', {
      sessionId: input.target.authoritativeSessionId,
      requestUrl: observedHistoryRecovery.recovery.requestUrl,
      responseStatus: observedHistoryRecovery.recovery.responseStatus,
      errorMessage: observedHistoryRecovery.recovery.errorMessage ?? 'Unknown history_messages recovery failure.',
    })
  } else {
    logger?.debug('Initial session-page load did not emit a captured history_messages response; falling back to explicit reload recovery', {
      sessionId: input.target.authoritativeSessionId,
    })
  }

  const finalSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: input.timeoutMs,
  })
  assertSnapshotMatchesTarget(finalSnapshot, input.target)
  assertRecoveredSessionMatchesTarget(transcriptRecovery, input.target)
  const restoredContext = resolveRestoredSessionContext({
    storedSession: input.target.storedSession,
    recovery: transcriptRecovery,
  })

  return {
    requestedSessionId: input.target.requestedSessionId,
    authoritativeSessionId: input.target.authoritativeSessionId,
    authoritativeAgentId: input.target.authoritativeAgentId,
    finalUrl: input.target.finalUrl,
    sessionFile: input.target.sessionFile,
    routeVerified: true,
    composerSnapshot: finalSnapshot,
    historyMessagesRecovery: transcriptRecovery,
    contextSource: restoredContext.contextSource,
    transcriptRecovery: restoredContext.transcriptRecovery,
    session: restoredContext.session,
  }
}

export function resolveRestoredSessionContext(input: {
  storedSession: DeepSeekResolvedSessionTarget['storedSession']
  recovery: DeepSeekHistoryMessagesRecoveryResult
}): Pick<DeepSeekSessionRestoreResult, 'contextSource' | 'transcriptRecovery' | 'session'> {
  if (input.recovery.outcome === 'recovered') {
    return {
      contextSource: 'history_messages',
      transcriptRecovery: input.recovery.recovery,
      session: input.recovery.session,
    }
  }

  return {
    contextSource: 'stored-session',
    transcriptRecovery: resolveStoredTranscriptRecovery(
      input.storedSession.metadata?.transcriptRecovery ?? null,
      input.recovery.recovery,
    ),
    session: input.storedSession.session,
  }
}

export function buildDeepSeekSessionFinalUrl(
  agentId: string,
  sessionId: string,
  baseUrl = DEFAULT_DEEPSEEK_BASE_URL,
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return `${normalizedBaseUrl}/a/${encodeURIComponent(agentId)}/s/${encodeURIComponent(sessionId)}`
}

export function assertSnapshotMatchesTarget(
  snapshot: DeepSeekComposerSnapshot,
  target: Pick<DeepSeekResolvedSessionTarget, 'authoritativeAgentId' | 'authoritativeSessionId'>,
): void {
  if (snapshot.routeKind !== 'session') {
    throw new Error(`Expected a DeepSeek session route, but resolved ${snapshot.routeKind}.`)
  }

  if (snapshot.sessionId !== target.authoritativeSessionId) {
    throw new Error(
      `DeepSeek route mismatch: expected session ${target.authoritativeSessionId}, but browser is on ${snapshot.sessionId ?? 'unknown'}.`,
    )
  }

  if (snapshot.agentId !== target.authoritativeAgentId) {
    throw new Error(
      `DeepSeek route mismatch: expected agent ${target.authoritativeAgentId}, but browser is on ${snapshot.agentId ?? 'unknown'}.`,
    )
  }

  if (!snapshot.composerInput.found) {
    throw new Error(`DeepSeek session ${target.authoritativeSessionId} did not expose a composer input.`)
  }
}

export function assertRecoveredSessionMatchesTarget(
  recovery: DeepSeekHistoryMessagesRecoveryResult,
  target: Pick<DeepSeekResolvedSessionTarget, 'authoritativeAgentId' | 'authoritativeSessionId'>,
): void {
  const candidateSession =
    recovery.outcome === 'recovered' ? recovery.session : recovery.session
  if (!candidateSession) {
    return
  }

  assertSessionMatchesTarget(candidateSession, target)
}

function assertSessionMatchesTarget(
  session: DeepSeekSession,
  target: Pick<DeepSeekResolvedSessionTarget, 'authoritativeAgentId' | 'authoritativeSessionId'>,
): void {
  if (session.id !== target.authoritativeSessionId) {
    throw new Error(
      `history_messages recovered the wrong session: expected ${target.authoritativeSessionId}, got ${session.id}.`,
    )
  }

  if (session.agentId !== target.authoritativeAgentId) {
    throw new Error(
      `history_messages recovered the wrong agent: expected ${target.authoritativeAgentId}, got ${session.agentId}.`,
    )
  }
}

function validateResolvedFinalUrl(finalUrl: string, agentId: string, sessionId: string): void {
  const routeMatch = matchDeepSeekSessionRoute(finalUrl)
  if (routeMatch.routeKind !== 'session') {
    throw new Error(`Stored finalUrl is not a DeepSeek session route: ${finalUrl}`)
  }

  if (routeMatch.sessionId !== sessionId) {
    throw new Error(
      `Stored finalUrl authority mismatch: expected session ${sessionId}, got ${routeMatch.sessionId ?? 'unknown'}.`,
    )
  }

  if (routeMatch.agentId !== agentId) {
    throw new Error(
      `Stored finalUrl authority mismatch: expected agent ${agentId}, got ${routeMatch.agentId ?? 'unknown'}.`,
    )
  }
}

function resolveStoredTranscriptRecovery(
  storedTranscriptRecovery: DeepSeekTranscriptRecovery | null,
  attemptedTranscriptRecovery: DeepSeekTranscriptRecovery,
): DeepSeekTranscriptRecovery {
  if (storedTranscriptRecovery?.status === 'recovered' && attemptedTranscriptRecovery.status !== 'recovered') {
    return storedTranscriptRecovery
  }

  return attemptedTranscriptRecovery
}
