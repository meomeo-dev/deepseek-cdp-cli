import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { buildDeepSeekSessionBranchCatalog } from '../../domain/session/sessionBranchCatalog.js'
import { inspectDeepSeekContinuePreflightOnPage } from '../../infrastructure/deepseek/deepSeekContinuePreflight.js'
import { prepareDeepSeekContinueTargetOnPage } from '../../infrastructure/deepseek/deepSeekContinueTargetFlow.js'
import { deepSeekGenerationBudgetGate } from '../../infrastructure/deepseek/deepSeekGenerationBudget.js'
import {
  resolveDeepSeekSessionTarget,
} from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import {
  projectDeepSeekResolvedSessionSourceFromSyncResult,
  projectDeepSeekResolvedSessionTargetFromSyncResult,
  syncDeepSeekSessionOnPage,
} from '../../infrastructure/deepseek/deepSeekSessionSync.js'
import {
  applyTranscriptRecoveryToStoredSession,
  appendReplyTurnToStoredSession,
  buildDeepSeekSessionFilePath,
  createStoredSessionFromFirstMessage,
} from '../../infrastructure/deepseek/deepSeekStoredSession.js'
import { saveStoredSessionToFile } from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekComposerModeInput } from '../../types/deepseek-composer-mode.types.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type {
  DeepSeekContinueTargetEntryMode,
  DeepSeekPrepareContinueTargetResult,
} from '../../types/deepseek-continue-target.types.js'
import type { DeepSeekStoredSession } from '../../types/deepseek-session.types.js'
import type { DeepSeekGenerationUsageSnapshot } from '../../types/deepseek-stream.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface PrepareDeepSeekContinueTargetInput extends ManagedChromeOptions {
  prompt: string
  sessionId?: string | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  url?: string | undefined
  waitUntil: WaitUntil
  stopAfterMs: number
  composerMode?: DeepSeekComposerModeInput | undefined
}

export async function prepareDeepSeekContinueTarget(
  input: PrepareDeepSeekContinueTargetInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'prepare-continue-target' }),
): Promise<DeepSeekPrepareContinueTargetResult> {
  let budget = deepSeekGenerationBudgetGate.consumeQuery()
  logger.info('Reserved DeepSeek generation budget', budget)

  try {
    const entryMode: DeepSeekContinueTargetEntryMode =
      input.sessionId || input.sessionFile ? 'existing-session' : 'new-session'
    const source =
      entryMode === 'existing-session'
        ? await resolveDeepSeekSessionSource({
            sessionId: input.sessionId,
            sessionFile: input.sessionFile,
            sessionStoreDir: input.sessionStoreDir,
          })
        : null

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page, goto }) => {
            let authoritativeChatModeHint: DeepSeekChatMode | undefined
            let currentSource = source
            let requestedUrl = input.url ?? 'https://chat.deepseek.com/'

            if (entryMode === 'existing-session') {
              const restoreTarget = await resolveDeepSeekSessionTarget({
                sessionId: source?.authoritativeSessionId ?? input.sessionId ?? '',
                sessionFile: source?.sessionFile,
              })
              const sessionSync = await syncDeepSeekSessionOnPage(
                page,
                {
                  target: restoreTarget,
                  timeoutMs: input.timeoutMs,
                  waitUntil: input.waitUntil,
                },
                logger.child('sync'),
              )
              const syncedTarget = projectDeepSeekResolvedSessionTargetFromSyncResult(sessionSync)
              currentSource = projectDeepSeekResolvedSessionSourceFromSyncResult(sessionSync)
              requestedUrl = syncedTarget.finalUrl
              authoritativeChatModeHint =
                sessionSync.session.modeFact?.resolvedMode ??
                syncedTarget.storedSession.session.modeFact?.resolvedMode ??
                syncedTarget.storedSession.metadata?.modeFact?.resolvedMode ??
                undefined
            } else {
              requestedUrl = input.url ?? 'https://chat.deepseek.com/'
              await goto(requestedUrl, input.waitUntil)
              await page.waitForSelector('body')
            }

            const run = await prepareDeepSeekContinueTargetOnPage(
              page,
              {
                requestedUrl,
                prompt: input.prompt,
                timeoutMs: input.timeoutMs,
                stopAfterMs: input.stopAfterMs,
                entryMode,
                composerMode: input.composerMode,
                ...(authoritativeChatModeHint ? { authoritativeChatModeHint } : {}),
                ...(entryMode === 'existing-session'
                  ? {
                      expectedSessionId: currentSource?.authoritativeSessionId,
                      expectedAgentId: currentSource?.authoritativeAgentId,
                    }
                  : {}),
              },
              logger.child('stop-helper'),
            )

            budget = deepSeekGenerationBudgetGate.recordOutputTokens(run.outputTokensUsed)
            logger.info('Recorded DeepSeek stop-helper output token usage', {
              outputTokensUsed: run.outputTokensUsed,
              budget,
            })

            const sessionFile =
              entryMode === 'existing-session'
                ? currentSource?.sessionFile ?? input.sessionFile ?? ''
                : buildDeepSeekSessionFilePath(run.sessionId, input.sessionStoreDir)
            const provisionalStoredSession =
              entryMode === 'existing-session' && currentSource
                ? appendReplyTurnToStoredSession({
                    storedSession: currentSource.storedSession,
                    prompt: input.prompt,
                    result: {
                      finalUrl: run.finalUrl,
                      agentId: run.agentId,
                      sessionId: run.sessionId,
                      generationObservations: run.generationObservations,
                      generationRuns: run.generationRuns,
                      fileUpload: null,
                      assistantText: run.assistantText,
                      assistantTextSource: run.assistantTextSource,
                    },
                  })
                : createStoredSessionFromFirstMessage({
                    prompt: input.prompt,
                    result: {
                      requestedUrl,
                      finalUrl: run.finalUrl,
                      agentId: run.agentId,
                      sessionId: run.sessionId,
                      sessionCreate: run.sessionCreate,
                      completionRequestObserved: run.generationObservations.some(
                        observation => observation.endpoint === '/api/v0/chat/completion',
                      ),
                      generationObservations: run.generationObservations,
                      generationRuns: run.generationRuns,
                      outputTokensUsed: run.outputTokensUsed,
                      settledAfterMs: run.settledAfterMs,
                      requestedComposerMode: run.requestedComposerMode,
                      composerMode: run.composerMode,
                      beforeSendSnapshot: run.beforeSendSnapshot,
                      afterSendSnapshot: run.afterStopSnapshot,
                      assistantText: run.assistantText,
                      assistantTextSource: run.assistantTextSource,
                    },
                  })
            const provisionalTarget = updateStoredSessionActiveBranch(
              provisionalStoredSession,
              entryMode,
              run.liveSettlement.assistantMessageId,
            )
            await saveStoredSessionToFile(sessionFile, provisionalTarget)

            const preflightTarget = await resolveDeepSeekSessionTarget({
              sessionId: run.sessionId,
              sessionFile,
            })
            const preflight = await inspectDeepSeekContinuePreflightOnPage(
              page,
              {
                target: preflightTarget,
                timeoutMs: input.timeoutMs,
                waitUntil: input.waitUntil,
                preferredAssistantMessageId: run.liveSettlement.assistantMessageId ?? undefined,
              },
              logger.child('preflight'),
            )

            const preflightOutputTokens = sumOutputTokensFromPreflight(preflight)
            if (preflightOutputTokens > 0) {
              budget = deepSeekGenerationBudgetGate.recordOutputTokens(preflightOutputTokens)
              logger.info('Recorded DeepSeek preflight resume_stream output token usage', {
                outputTokensUsed: preflightOutputTokens,
                budget,
              })
            }

            const finalStoredSession = updateStoredSessionActiveBranch(
              applyHistoryRecoveryIfAvailable(provisionalTarget, preflight),
              entryMode,
              resolvePreparedTargetMessageId(preflight, run.liveSettlement.assistantMessageId),
            )
            await saveStoredSessionToFile(sessionFile, finalStoredSession)

            const preparedTarget = resolvePreparedTarget({
              sessionFile,
              storedSession: finalStoredSession,
              preflight,
              liveSettlement: run.liveSettlement,
              assistantText: run.assistantText,
              assistantTextSource: run.assistantTextSource,
            })

            return {
              entryMode,
              requestedUrl,
              finalUrl: run.finalUrl,
              agentId: run.agentId,
              sessionId: run.sessionId,
              sessionFile,
              sessionCreate: run.sessionCreate,
              budget,
              outputTokensUsed: run.outputTokensUsed + preflightOutputTokens,
              settledAfterMs: run.settledAfterMs,
              requestedComposerMode: run.requestedComposerMode,
              composerMode: run.composerMode,
              beforeSendSnapshot: run.beforeSendSnapshot,
              afterStopSnapshot: run.afterStopSnapshot,
              generationObservations: run.generationObservations,
              generationRuns: run.generationRuns,
              streamControls: run.streamControls,
              liveSettlement: run.liveSettlement,
              preflight,
              stopAttempt: run.stopAttempt,
              transcriptRecovery:
                finalStoredSession.metadata?.transcriptRecovery ??
                preflight.restore.transcriptRecovery,
              target: preparedTarget,
              session: finalStoredSession.session,
            }
          },
        )
      },
      { logger, operation: 'prepare-continue-target' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek continue target preparation failed',
      error,
      context: {
        sessionId: input.sessionId ?? null,
        sessionFile: input.sessionFile ?? null,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        stopAfterMs: input.stopAfterMs,
      },
    })
    throw error
  }
}

function applyHistoryRecoveryIfAvailable(
  storedSession: DeepSeekStoredSession,
  preflight: DeepSeekPrepareContinueTargetResult['preflight'],
): DeepSeekStoredSession {
  const recoveredSession = preflight.restore.historyMessagesRecovery.session
  if (!recoveredSession) {
    return storedSession
  }

  return applyTranscriptRecoveryToStoredSession({
    storedSession,
    transcriptRecovery: preflight.restore.historyMessagesRecovery.recovery,
    recoveredSession,
  })
}

function resolvePreparedTarget(input: {
  sessionFile: string
  storedSession: DeepSeekStoredSession
  preflight: DeepSeekPrepareContinueTargetResult['preflight']
  liveSettlement: DeepSeekPrepareContinueTargetResult['liveSettlement']
  assistantText: string | null
  assistantTextSource: DeepSeekPrepareContinueTargetResult['target']['assistantTextSource']
}): DeepSeekPrepareContinueTargetResult['target'] {
  const messageId = resolvePreparedTargetMessageId(
    input.preflight,
    input.liveSettlement.assistantMessageId,
  )
  const activeBranchId = input.storedSession.metadata?.lastKnownActiveBranchId ?? null
  const catalog = buildDeepSeekSessionBranchCatalog(input.storedSession.session, {
    activeBranchId,
    activeBranchSource: activeBranchId ? 'stored-session' : 'unavailable',
  })
  const branch = messageId
    ? input.storedSession.session.branches.find(candidate =>
        candidate.messages.some(message => message.id === messageId),
      ) ?? null
    : null
  const message = branch?.messages.find(candidate => candidate.id === messageId) ?? null
  const branchId = branch?.id ?? activeBranchId
  const continueCommand = messageId
    ? buildContinueCommand({
        sessionFile: input.sessionFile,
        messageId,
        branchId,
        activeBranchId: catalog.activeBranchId,
      })
    : null

  return {
    branchId,
    activeBranchId: catalog.activeBranchId,
    messageId,
    parentMessageId: message?.parentId ?? null,
    assistantText: message?.text ?? input.liveSettlement.finalized?.outputText ?? input.assistantText,
    assistantTextSource:
      message !== null &&
      input.preflight.restore.historyMessagesRecovery.session !== null
        ? 'history_messages'
        : input.assistantTextSource,
    status: resolvePreparedTargetStatus(input.preflight.status, input.liveSettlement.status),
    continueCommand,
  }
}

function resolvePreparedTargetStatus(
  preflightStatus: DeepSeekPrepareContinueTargetResult['preflight']['status'],
  liveStatus: DeepSeekPrepareContinueTargetResult['liveSettlement']['status'],
): DeepSeekPrepareContinueTargetResult['target']['status'] {
  if (preflightStatus === 'auto-resumed') {
    return 'auto-resumed'
  }
  if (preflightStatus === 'resumable') {
    return 'resumable'
  }
  if (preflightStatus === 'completed') {
    return 'completed'
  }
  if (preflightStatus === 'failed') {
    return 'failed'
  }
  if (preflightStatus === 'stopped') {
    return 'stopped'
  }
  if (liveStatus === 'resumable') {
    return 'resumable'
  }
  if (liveStatus === 'completed') {
    return 'completed'
  }
  if (liveStatus === 'stopped') {
    return 'stopped'
  }
  if (liveStatus === 'failed') {
    return 'failed'
  }
  return 'unknown'
}

function resolvePreparedTargetMessageId(
  preflight: DeepSeekPrepareContinueTargetResult['preflight'],
  fallbackAssistantMessageId: string | null,
): string | null {
  return (
    preflight.controlSettlement.resumable?.assistantMessageId ??
    preflight.autoResume.assistantMessageId ??
    preflight.controlSettlement.assistantMessageId ??
    fallbackAssistantMessageId
  )
}

function updateStoredSessionActiveBranch(
  storedSession: DeepSeekStoredSession,
  entryMode: DeepSeekContinueTargetEntryMode,
  assistantMessageId: string | null,
): DeepSeekStoredSession {
  if (!storedSession.metadata) {
    return storedSession
  }

  const branchId =
    assistantMessageId === null
      ? storedSession.metadata.lastKnownActiveBranchId ?? null
      : storedSession.session.branches.find(branch =>
          branch.messages.some(message => message.id === assistantMessageId),
        )?.id ?? storedSession.metadata.lastKnownActiveBranchId ?? null

  return {
    ...storedSession,
    metadata: {
      ...storedSession.metadata,
      lastKnownActiveBranchId: branchId,
      lastKnownActiveBranchSource: entryMode === 'new-session' ? 'first-message' : 'reply',
      persistedAt: new Date().toISOString(),
    },
  }
}

function buildContinueCommand(input: {
  sessionFile: string
  messageId: string
  branchId: string | null
  activeBranchId: string | null
}): string {
  const parts = [
    'npm run dev -- continue-message',
    `--session-file ${shellQuote(input.sessionFile)}`,
    `--message-id ${shellQuote(input.messageId)}`,
  ]
  if (input.branchId) {
    parts.push(`--branch-id ${shellQuote(input.branchId)}`)
  }
  if (input.activeBranchId) {
    parts.push(`--active-branch-id ${shellQuote(input.activeBranchId)}`)
  }
  return parts.join(' ')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function sumOutputTokensFromPreflight(
  preflight: DeepSeekPrepareContinueTargetResult['preflight'],
): number {
  return preflight.streamControls.reduce((total, control) => {
    if (control.endpoint !== '/api/v0/chat/resume_stream' || !control.run?.finalized.usage) {
      return total
    }

    return total + readOutputTokens(control.run.finalized.usage)
  }, 0)
}

function readOutputTokens(usage: DeepSeekGenerationUsageSnapshot): number {
  if (typeof usage.outputTokens !== 'number' || !Number.isFinite(usage.outputTokens)) {
    return 0
  }

  return Math.max(0, Math.floor(usage.outputTokens))
}
