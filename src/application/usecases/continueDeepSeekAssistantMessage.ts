import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { materializeDeepSeekContinuedBranch } from '../../domain/session/sessionContinueBranchMaterialization.js'
import { updateStoredSessionAfterMutation } from '../../domain/session/sessionMutationPersistence.js'
import {
  resolveMutationAssistantTextSource,
  resolveMutationTranscriptRecovery,
} from '../../domain/session/sessionMutationRecovery.js'
import { resolveDeepSeekSessionMessageTarget } from '../../domain/session/sessionMessageTarget.js'
import {
  inspectDeepSeekContinuePreflightOnPage,
} from '../../infrastructure/deepseek/deepSeekContinuePreflight.js'
import {
  runDeepSeekContinueMessageOnPage,
} from '../../infrastructure/deepseek/deepSeekContinueMessageFlow.js'
import { deepSeekGenerationBudgetGate } from '../../infrastructure/deepseek/deepSeekGenerationBudget.js'
import { recoverDeepSeekSessionFromHistoryMessagesOnPage } from '../../infrastructure/deepseek/deepSeekHistoryMessages.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import { resolveDeepSeekSessionTarget } from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import {
  projectDeepSeekResolvedSessionSourceFromSyncResult,
  projectDeepSeekResolvedSessionTargetFromSyncResult,
  syncDeepSeekSessionOnPage,
} from '../../infrastructure/deepseek/deepSeekSessionSync.js'
import { saveStoredSessionToFile } from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type {
  DeepSeekParsedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekGenerationStreamEvent } from '../../types/deepseek-stream.types.js'
import type { DeepSeekSession, DeepSeekStoredSession } from '../../types/deepseek-session.types.js'
import { normalizeDeepSeekComposerModeRequest, resolveDeepSeekComposerMode } from '../../infrastructure/deepseek/deepSeekComposerMode.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { buildDeepSeekModeFactLogPayload } from '../services/deepSeekModeFactLogPayload.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface ContinueDeepSeekAssistantMessageInput extends ManagedChromeOptions {
  sessionId?: string | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  branchId?: string | undefined
  messageId: string
  activeBranchId?: string | undefined
  waitUntil: WaitUntil
  stream?: boolean | undefined
  onCanonicalGenerationEvent?: ((input: {
    source: 'buffered' | 'live' | 'finalize'
    event: DeepSeekGenerationStreamEvent
  }) => void) | undefined
}

export async function continueDeepSeekAssistantMessage(
  input: ContinueDeepSeekAssistantMessageInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'continue-message' }),
): Promise<DeepSeekReplyResult> {
  try {
    const source = await resolveDeepSeekSessionSource({
      sessionFile: input.sessionFile,
      sessionId: input.sessionId,
      sessionStoreDir: input.sessionStoreDir,
    })

    const reservedBudget = deepSeekGenerationBudgetGate.consumeQuery()
    logger.info('Reserved DeepSeek generation budget', reservedBudget)

    return withManagedChromeRuntimeIfNeeded(
      input,
      async runtime => {
        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page }) => {
            const sessionTarget = await resolveDeepSeekSessionTarget({
              sessionId: source.authoritativeSessionId,
              sessionFile: source.sessionFile,
            })
            const sessionSync = await syncDeepSeekSessionOnPage(
              page,
              {
                target: sessionTarget,
                timeoutMs: input.timeoutMs,
                waitUntil: input.waitUntil,
              },
              logger.child('sync'),
            )
            const syncedTarget = projectDeepSeekResolvedSessionTargetFromSyncResult(sessionSync)
            const syncedSource = projectDeepSeekResolvedSessionSourceFromSyncResult(sessionSync)
            const preferredActiveBranchId =
              normalizeOptionalString(input.activeBranchId) ??
              normalizeOptionalString(syncedSource.storedSession.metadata?.lastKnownActiveBranchId)
            const activeBranchSource =
              preferredActiveBranchId === null
                ? 'unavailable'
                : normalizeOptionalString(input.activeBranchId)
                  ? 'page'
                  : 'stored-session'
            const target = resolveDeepSeekSessionMessageTarget({
              session: syncedSource.session,
              sessionFile: syncedSource.sessionFile,
              branchId: input.branchId,
              messageId: input.messageId,
              activeBranchId: preferredActiveBranchId,
              activeBranchSource,
              allowedRoles: ['assistant'],
            })
            if (!target.message) {
              throw new Error('Target message resolution did not produce an assistant message.')
            }
            const targetAssistantMessage = target.message
            const preflight = await inspectDeepSeekContinuePreflightOnPage(
              page,
              {
                target: syncedTarget,
                timeoutMs: input.timeoutMs,
                waitUntil: input.waitUntil,
                preferredAssistantMessageId: targetAssistantMessage.id,
              },
              logger.child('preflight'),
            )
            assertExplicitContinueAllowed(preflight, targetAssistantMessage.id)

            const continueRun = await runDeepSeekContinueMessageOnPage(
              page,
              {
                requestedUrl: syncedTarget.finalUrl,
                targetMessageId: targetAssistantMessage.id,
                targetBranchId: target.resolvedBranchId,
                timeoutMs: input.timeoutMs,
                expectedSessionId: syncedTarget.authoritativeSessionId,
                expectedAgentId: syncedTarget.authoritativeAgentId,
                onCanonicalGenerationEvent: input.onCanonicalGenerationEvent,
              },
              logger,
            )

            logger.info('DeepSeek continue completed', {
              sourceBranchId: target.resolvedBranchId,
              targetMessageId: targetAssistantMessage.id,
              finalUrl: continueRun.finalUrl,
              outputTokensUsed: continueRun.outputTokensUsed,
            })

            const budget = deepSeekGenerationBudgetGate.recordOutputTokens(
              continueRun.outputTokensUsed,
            )
            logger.info('Recorded DeepSeek output token usage', budget)

            const transcriptRecovery = await recoverDeepSeekSessionFromHistoryMessagesOnPage(
              page,
              {
                finalUrl: continueRun.finalUrl,
                sessionId: continueRun.sessionId,
                timeoutMs: Math.max(5_000, Math.min(input.timeoutMs, 20_000)),
              },
              logger.child('history-messages'),
            )
            const continuedAssistantMessageId =
              selectLatestCanonicalRunContextValue(
                continueRun.canonicalGenerationRuns,
                'assistantMessageId',
              ) ?? targetAssistantMessage.id
            const recoveredSession =
              transcriptRecovery.outcome === 'recovered' ? transcriptRecovery.session : null
            const continuedParentMessageId =
              selectLatestCanonicalRunContextValue(
                continueRun.canonicalGenerationRuns,
                'parentMessageId',
              ) ?? normalizeOptionalString(targetAssistantMessage.parentId)
            const materialized = materializeDeepSeekContinuedBranch({
              storedSession: syncedSource.storedSession,
              sourceBranchId: target.resolvedBranchId,
              sourceAssistantMessageId: targetAssistantMessage.id,
              sourceParentMessageId: continuedParentMessageId,
              continuedAssistantMessageId,
              assistantText: continueRun.assistantText,
              ...(recoveredSession ? { recoveredSession } : {}),
            })
            const assistantText =
              selectAssistantMessageTextById(
                materialized.session,
                materialized.materialization.continuedAssistantMessageId,
              ) ?? continueRun.assistantText
            const assistantTextSource = resolveMutationAssistantTextSource({
              recoveredSession,
              assistantMessageId: materialized.materialization.continuedAssistantMessageId,
              fallback: continueRun.assistantTextSource,
            })
            const mutation = {
              kind: 'continue' as const,
              sourceBranchId: materialized.materialization.sourceBranchId,
              sourceAssistantMessageId: materialized.materialization.sourceAssistantMessageId,
              sourceParentMessageId: materialized.materialization.sourceParentMessageId,
              materializedBranchId: materialized.materialization.materializedBranchId,
              materializedBranchCreated: materialized.materialization.materializedBranchCreated,
              continuedAssistantMessageId: materialized.materialization.continuedAssistantMessageId,
              continuationDisposition: materialized.materialization.continuationDisposition,
              transcriptShape: materialized.materialization.transcriptShape,
            }
            const storedSession = updateStoredSessionAfterContinue({
              storedSession: syncedSource.storedSession,
              materializedSession: materialized.session,
              finalUrl: continueRun.finalUrl,
              agentId: continueRun.agentId,
              sessionId: continueRun.sessionId,
              transcriptRecovery: resolveMutationTranscriptRecovery({
                previous: preflight.restore.transcriptRecovery,
                next: transcriptRecovery.recovery,
                ...(recoveredSession ? { recoveredSession } : {}),
              }),
              outputTokensUsed: continueRun.outputTokensUsed,
              settledAfterMs: continueRun.settledAfterMs,
              activeBranchId: materialized.materialization.materializedBranchId,
              assistantTextSource,
              mutation,
            })
            logger.info('DeepSeek stored session mode fact settled', {
              sessionId: continueRun.sessionId,
              modeFact: buildDeepSeekModeFactLogPayload({
                storedSession,
                generationRuns: continueRun.generationRuns,
              }),
            })
            await saveStoredSessionToFile(syncedSource.sessionFile, storedSession)

            const streamRequested = input.stream === true

            return {
              entryMode: 'message-continue',
              streamRequested,
              requestedUrl: syncedTarget.finalUrl,
              finalUrl: continueRun.finalUrl,
              agentId: continueRun.agentId,
              sessionId: continueRun.sessionId,
              sessionFile: syncedSource.sessionFile,
              sessionCreate: null,
              completionRequestObserved: false,
              generationObservations: continueRun.generationObservations,
              generationRuns: continueRun.generationRuns,
              outputTokensUsed: continueRun.outputTokensUsed,
              settledAfterMs: continueRun.settledAfterMs,
              budget,
              requestedComposerMode: normalizeDeepSeekComposerModeRequest(),
              composerMode: resolveDeepSeekComposerMode(continueRun.afterSendSnapshot),
              beforeSendSnapshot: continueRun.beforeSendSnapshot,
              afterSendSnapshot: continueRun.afterSendSnapshot,
              fileUpload: null,
              assistantText,
              assistantTextSource,
              transcriptRecovery:
                storedSession.metadata?.transcriptRecovery ?? transcriptRecovery.recovery,
              mutation,
              session: storedSession.session,
              output: streamRequested
                ? {
                    mode: 'stream',
                    canonicalEvents: continueRun.canonicalGenerationRuns.flatMap(
                      run => run.events,
                    ),
                    canonicalRuns: continueRun.canonicalGenerationRuns,
                    finalizedAssistantText: assistantText,
                  }
                : {
                    mode: 'buffered',
                    canonicalEvents: [],
                    canonicalRuns: [],
                    finalizedAssistantText: assistantText,
                  },
            }
          },
        )
      },
      { logger, operation: 'continue-message' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek continue failed',
      error,
      context: {
        sessionId: input.sessionId ?? null,
        messageId: input.messageId,
        branchId: input.branchId ?? null,
        activeBranchId: input.activeBranchId ?? null,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
      },
    })
    throw error
  }
}

function updateStoredSessionAfterContinue(input: {
  storedSession: DeepSeekStoredSession
  materializedSession: DeepSeekSession
  finalUrl: string
  agentId: string
  sessionId: string
  transcriptRecovery: NonNullable<DeepSeekReplyResult['transcriptRecovery']>
  outputTokensUsed: number
  settledAfterMs: number
  activeBranchId: string
  assistantTextSource: DeepSeekReplyResult['assistantTextSource']
  mutation: NonNullable<DeepSeekReplyResult['mutation']>
  persistedAt?: string | undefined
}): DeepSeekStoredSession {
  return updateStoredSessionAfterMutation({
    storedSession: input.storedSession,
    materializedSession: input.materializedSession,
    finalUrl: input.finalUrl,
    agentId: input.agentId,
    sessionId: input.sessionId,
    transcriptRecovery: input.transcriptRecovery,
    outputTokensUsed: input.outputTokensUsed,
    settledAfterMs: input.settledAfterMs,
    activeBranchId: input.activeBranchId,
    activeBranchSource: 'continue',
    assistantTextSource: input.assistantTextSource,
    mutation: input.mutation,
    persistedAt: input.persistedAt,
  })
}

function assertExplicitContinueAllowed(
  preflight: Awaited<ReturnType<typeof inspectDeepSeekContinuePreflightOnPage>>,
  targetMessageId: string,
): void {
  if (!preflight.explicitContinueAllowed) {
    if (preflight.status === 'auto-resumed') {
      throw new Error(
        `DeepSeek session restore already auto-resumed assistant message ${preflight.autoResume.assistantMessageId ?? 'unknown'}; explicit continue is blocked.`,
      )
    }

    throw new Error(
      `DeepSeek explicit continue is not allowed because the preflight status is ${preflight.status}.`,
    )
  }

  const resumableAssistantMessageId =
    preflight.controlSettlement.resumable?.assistantMessageId ??
    preflight.controlSettlement.assistantMessageId
  if (!resumableAssistantMessageId) {
    throw new Error('DeepSeek continue preflight did not expose a resumable assistant message id.')
  }

  if (resumableAssistantMessageId !== targetMessageId) {
    throw new Error(
      `DeepSeek continue target mismatch: resumable assistant message is ${resumableAssistantMessageId}, but requested ${targetMessageId}.`,
    )
  }
}

function selectLatestCanonicalRunContextValue(
  runs: DeepSeekParsedGenerationRun[],
  key: 'assistantMessageId' | 'parentMessageId',
): string | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const candidate = runs[index]?.context[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
  }

  return null
}

function selectAssistantMessageTextById(
  session: DeepSeekSession | null,
  assistantMessageId: string | null,
): string | null {
  if (!session || !assistantMessageId) {
    return null
  }

  for (const branch of session.branches) {
    for (const message of branch.messages) {
      if (message.role === 'assistant' && message.id === assistantMessageId) {
        return message.text
      }
    }
  }

  return null
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}
