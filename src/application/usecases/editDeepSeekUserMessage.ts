import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { materializeDeepSeekEditedBranch } from '../../domain/session/sessionEditBranchMaterialization.js'
import { updateStoredSessionAfterMutation } from '../../domain/session/sessionMutationPersistence.js'
import {
  resolveMutationAssistantTextSource,
  resolveMutationTranscriptRecovery,
} from '../../domain/session/sessionMutationRecovery.js'
import { resolveDeepSeekSessionMessageTarget } from '../../domain/session/sessionMessageTarget.js'
import { recoverDeepSeekSessionFromHistoryMessagesOnPage } from '../../infrastructure/deepseek/deepSeekHistoryMessages.js'
import { runDeepSeekEditMessageOnPage } from '../../infrastructure/deepseek/deepSeekEditMessageFlow.js'
import { deepSeekGenerationBudgetGate } from '../../infrastructure/deepseek/deepSeekGenerationBudget.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import { resolveDeepSeekSessionTarget } from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import {
  projectDeepSeekResolvedSessionSourceFromSyncResult,
  projectDeepSeekResolvedSessionTargetFromSyncResult,
  syncDeepSeekSessionOnPage,
} from '../../infrastructure/deepseek/deepSeekSessionSync.js'
import { saveStoredSessionToFile } from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import type { DeepSeekComposerModeInput } from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekParsedGenerationRun } from '../../types/deepseek-generation.types.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekGenerationStreamEvent } from '../../types/deepseek-stream.types.js'
import type { DeepSeekSession, DeepSeekStoredSession } from '../../types/deepseek-session.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { buildDeepSeekModeFactLogPayload } from '../services/deepSeekModeFactLogPayload.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface EditDeepSeekUserMessageInput extends ManagedChromeOptions {
  prompt: string
  sessionId?: string | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  branchId?: string | undefined
  messageId: string
  activeBranchId?: string | undefined
  waitUntil: WaitUntil
  stream?: boolean | undefined
  composerMode?: DeepSeekComposerModeInput | undefined
  onCanonicalGenerationEvent?: ((input: {
    source: 'buffered' | 'live' | 'finalize'
    event: DeepSeekGenerationStreamEvent
  }) => void) | undefined
}

export async function editDeepSeekUserMessage(
  input: EditDeepSeekUserMessageInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'edit-message' }),
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
              allowedRoles: ['user'],
            })
            if (!target.message) {
              throw new Error('Target message resolution did not produce a user message.')
            }
            const targetMessage = target.message

            const editRun = await runDeepSeekEditMessageOnPage(
              page,
              {
                requestedUrl: syncedTarget.finalUrl,
                targetMessageId: targetMessage.id,
                targetBranchId: target.resolvedBranchId,
                targetMessageText: targetMessage.text,
                prompt: input.prompt,
                timeoutMs: input.timeoutMs,
                composerMode: input.composerMode,
                authoritativeChatModeHint:
                  sessionSync.session.modeFact?.resolvedMode ??
                  syncedTarget.storedSession.session.modeFact?.resolvedMode ??
                  syncedTarget.storedSession.metadata?.modeFact?.resolvedMode ??
                  undefined,
                expectedSessionId: syncedTarget.authoritativeSessionId,
                expectedAgentId: syncedTarget.authoritativeAgentId,
                onCanonicalGenerationEvent: input.onCanonicalGenerationEvent,
              },
              logger,
            )

            logger.info('DeepSeek edit_message completed', {
              sourceBranchId: target.resolvedBranchId,
              sourceMessageId: targetMessage.id,
              finalUrl: editRun.finalUrl,
              outputTokensUsed: editRun.outputTokensUsed,
            })

            const budget = deepSeekGenerationBudgetGate.recordOutputTokens(editRun.outputTokensUsed)
            logger.info('Recorded DeepSeek output token usage', budget)

            const transcriptRecovery = await recoverDeepSeekSessionFromHistoryMessagesOnPage(
              page,
              {
                finalUrl: editRun.finalUrl,
                sessionId: editRun.sessionId,
                timeoutMs: Math.max(5_000, Math.min(input.timeoutMs, 20_000)),
              },
              logger.child('history-messages'),
            )

            const replacementMessageId = selectLatestCanonicalRunContextValue(
              editRun.canonicalGenerationRuns,
              'parentMessageId',
            )
            const assistantMessageId = selectLatestCanonicalRunContextValue(
              editRun.canonicalGenerationRuns,
              'assistantMessageId',
            )
            const materialized = materializeDeepSeekEditedBranch({
              storedSession: syncedSource.storedSession,
              sourceBranchId: target.resolvedBranchId,
              sourceMessageId: targetMessage.id,
              replacementMessageId,
              assistantMessageId,
              replacementPrompt: input.prompt,
              assistantText: editRun.assistantText,
              ...(transcriptRecovery.outcome === 'recovered'
                ? { recoveredSession: transcriptRecovery.session }
                : {}),
            })
            const materializedAssistantMessageId = materialized.materialization.assistantMessageId
            const assistantText =
              selectLatestAssistantMessageText(materialized.session) ?? editRun.assistantText
            const assistantTextSource = resolveMutationAssistantTextSource({
              recoveredSession:
                transcriptRecovery.outcome === 'recovered' ? transcriptRecovery.session : null,
              assistantMessageId: materializedAssistantMessageId,
              fallback: editRun.assistantTextSource,
            })
            const mutation = {
              kind: 'edit-message' as const,
              sourceBranchId: materialized.materialization.sourceBranchId,
              sourceMessageId: materialized.materialization.sourceMessageId,
              materializedBranchId: materialized.materialization.materializedBranchId,
              materializedBranchCreated: materialized.materialization.materializedBranchCreated,
              replacementMessageId: materialized.materialization.replacementMessageId,
              assistantMessageId: materialized.materialization.assistantMessageId,
              transcriptShape: materialized.materialization.transcriptShape,
            }
            const storedSession = updateStoredSessionAfterEdit({
              storedSession: syncedSource.storedSession,
              materializedSession: materialized.session,
              finalUrl: editRun.finalUrl,
              agentId: editRun.agentId,
              sessionId: editRun.sessionId,
              transcriptRecovery: resolveMutationTranscriptRecovery({
                previous: syncedSource.storedSession.metadata?.transcriptRecovery ?? null,
                next: transcriptRecovery.recovery,
                ...(transcriptRecovery.outcome === 'recovered'
                  ? { recoveredSession: transcriptRecovery.session }
                  : {}),
              }),
              outputTokensUsed: editRun.outputTokensUsed,
              settledAfterMs: editRun.settledAfterMs,
              activeBranchId: materialized.materialization.materializedBranchId,
              assistantTextSource,
              mutation,
            })
            logger.info('DeepSeek stored session mode fact settled', {
              sessionId: editRun.sessionId,
              modeFact: buildDeepSeekModeFactLogPayload({
                storedSession,
                generationRuns: editRun.generationRuns,
              }),
            })
            await saveStoredSessionToFile(syncedSource.sessionFile, storedSession)

            const streamRequested = input.stream === true

            return {
              entryMode: 'message-edit',
              streamRequested,
              requestedUrl: syncedTarget.finalUrl,
              finalUrl: editRun.finalUrl,
              agentId: editRun.agentId,
              sessionId: editRun.sessionId,
              sessionFile: syncedSource.sessionFile,
              sessionCreate: null,
              completionRequestObserved: false,
              generationObservations: editRun.generationObservations,
              generationRuns: editRun.generationRuns,
              outputTokensUsed: editRun.outputTokensUsed,
              settledAfterMs: editRun.settledAfterMs,
              budget,
              requestedComposerMode: editRun.requestedComposerMode,
              ...(editRun.effectiveComposerMode
                ? { effectiveComposerMode: editRun.effectiveComposerMode }
                : {}),
              ...(editRun.ignoredComposerToggles
                ? { ignoredComposerToggles: editRun.ignoredComposerToggles }
                : {}),
              composerMode: editRun.composerMode,
              beforeSendSnapshot: editRun.beforeSendSnapshot,
              afterSendSnapshot: editRun.afterSendSnapshot,
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
                    canonicalEvents: editRun.canonicalGenerationRuns.flatMap(run => run.events),
                    canonicalRuns: editRun.canonicalGenerationRuns,
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
      { logger, operation: 'edit-message' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek edit_message failed',
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

function updateStoredSessionAfterEdit(input: {
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
    activeBranchSource: 'edit-message',
    assistantTextSource: input.assistantTextSource,
    mutation: input.mutation,
    persistedAt: input.persistedAt,
  })
}

function selectLatestAssistantMessageText(session: DeepSeekSession | null): string | null {
  if (!session) {
    return null
  }

  let latestAssistant: { createdAt: string; text: string } | null = null
  for (const branch of session.branches) {
    for (const message of branch.messages) {
      if (message.role !== 'assistant') {
        continue
      }

      if (
        latestAssistant === null ||
        new Date(message.createdAt).getTime() >= new Date(latestAssistant.createdAt).getTime()
      ) {
        latestAssistant = {
          createdAt: message.createdAt,
          text: message.text,
        }
      }
    }
  }

  return latestAssistant?.text ?? null
}

function selectLatestCanonicalRunContextValue(
  runs: DeepSeekParsedGenerationRun[],
  key: 'parentMessageId' | 'assistantMessageId',
): string | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const value = runs[index]?.context[key]?.trim()
    if (value) {
      return value
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
