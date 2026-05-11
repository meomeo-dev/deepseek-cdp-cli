import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { updateStoredSessionAfterMutation } from '../../domain/session/sessionMutationPersistence.js'
import {
  resolveMutationAssistantTextSource,
  resolveMutationTranscriptRecovery,
} from '../../domain/session/sessionMutationRecovery.js'
import { resolveDeepSeekSessionMessageTarget } from '../../domain/session/sessionMessageTarget.js'
import { materializeDeepSeekRegeneratedBranch } from '../../domain/session/sessionRegenerateBranchMaterialization.js'
import { recoverDeepSeekSessionFromHistoryMessagesOnPage } from '../../infrastructure/deepseek/deepSeekHistoryMessages.js'
import { runDeepSeekRegenerateMessageOnPage } from '../../infrastructure/deepseek/deepSeekRegenerateMessageFlow.js'
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
import type {
  DeepSeekSession,
  DeepSeekStoredSession,
} from '../../types/deepseek-session.types.js'
import type { DeepSeekTranscriptRecovery } from '../../types/deepseek-transcript-recovery.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { buildDeepSeekModeFactLogPayload } from '../services/deepSeekModeFactLogPayload.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface RegenerateDeepSeekAssistantMessageInput extends ManagedChromeOptions {
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

export async function regenerateDeepSeekAssistantMessage(
  input: RegenerateDeepSeekAssistantMessageInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'regenerate-message' }),
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
            const sourceParentMessageId =
              normalizeOptionalString(targetAssistantMessage.parentId) ??
              findPreviousUserMessageId(target.branch.messages, targetAssistantMessage.id)
            if (!sourceParentMessageId) {
              throw new Error(
                `Could not resolve the parent user message for assistant message ${targetAssistantMessage.id}.`,
              )
            }

            const regenerateRun = await runDeepSeekRegenerateMessageOnPage(
              page,
              {
                requestedUrl: syncedTarget.finalUrl,
                targetMessageId: targetAssistantMessage.id,
                targetBranchId: target.resolvedBranchId,
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

            logger.info('DeepSeek regenerate completed', {
              sourceBranchId: target.resolvedBranchId,
              sourceAssistantMessageId: targetAssistantMessage.id,
              finalUrl: regenerateRun.finalUrl,
              outputTokensUsed: regenerateRun.outputTokensUsed,
            })

            const budget = deepSeekGenerationBudgetGate.recordOutputTokens(
              regenerateRun.outputTokensUsed,
            )
            logger.info('Recorded DeepSeek output token usage', budget)

            const transcriptRecovery = await recoverDeepSeekSessionFromHistoryMessagesOnPage(
              page,
              {
                finalUrl: regenerateRun.finalUrl,
                sessionId: regenerateRun.sessionId,
                timeoutMs: Math.max(5_000, Math.min(input.timeoutMs, 20_000)),
              },
              logger.child('history-messages'),
            )

            const regeneratedAssistantMessageId = selectLatestCanonicalRunContextValue(
              regenerateRun.canonicalGenerationRuns,
              'assistantMessageId',
            )
            const regeneratedParentMessageId =
              selectLatestCanonicalRunContextValue(
                regenerateRun.canonicalGenerationRuns,
                'parentMessageId',
              ) ?? sourceParentMessageId
            const materialized = materializeDeepSeekRegeneratedBranch({
              storedSession: syncedSource.storedSession,
              sourceBranchId: target.resolvedBranchId,
              sourceAssistantMessageId: targetAssistantMessage.id,
              sourceParentMessageId: regeneratedParentMessageId,
              regeneratedAssistantMessageId,
              assistantText: regenerateRun.assistantText,
              ...(transcriptRecovery.outcome === 'recovered'
                ? { recoveredSession: transcriptRecovery.session }
                : {}),
            })
            const assistantText =
              selectLatestAssistantMessageText(materialized.session) ?? regenerateRun.assistantText
            const assistantTextSource = resolveMutationAssistantTextSource({
              recoveredSession:
                transcriptRecovery.outcome === 'recovered' ? transcriptRecovery.session : null,
              assistantMessageId: regeneratedAssistantMessageId,
              fallback: regenerateRun.assistantTextSource,
            })
            const mutation = {
              kind: 'regenerate' as const,
              sourceBranchId: materialized.materialization.sourceBranchId,
              sourceAssistantMessageId: materialized.materialization.sourceAssistantMessageId,
              sourceParentMessageId: materialized.materialization.sourceParentMessageId,
              materializedBranchId: materialized.materialization.materializedBranchId,
              materializedBranchCreated: materialized.materialization.materializedBranchCreated,
              regeneratedAssistantMessageId:
                materialized.materialization.regeneratedAssistantMessageId,
              transcriptShape: materialized.materialization.transcriptShape,
            }

            const storedSession = updateStoredSessionAfterRegenerate({
              storedSession: syncedSource.storedSession,
              materializedSession: materialized.session,
              finalUrl: regenerateRun.finalUrl,
              agentId: regenerateRun.agentId,
              sessionId: regenerateRun.sessionId,
              transcriptRecovery: resolveMutationTranscriptRecovery({
                previous: syncedSource.storedSession.metadata?.transcriptRecovery ?? null,
                next: transcriptRecovery.recovery,
                ...(transcriptRecovery.outcome === 'recovered'
                  ? { recoveredSession: transcriptRecovery.session }
                  : {}),
              }),
              outputTokensUsed: regenerateRun.outputTokensUsed,
              settledAfterMs: regenerateRun.settledAfterMs,
              activeBranchId: materialized.materialization.materializedBranchId,
              assistantTextSource,
              mutation,
            })
            logger.info('DeepSeek stored session mode fact settled', {
              sessionId: regenerateRun.sessionId,
              modeFact: buildDeepSeekModeFactLogPayload({
                storedSession,
                generationRuns: regenerateRun.generationRuns,
              }),
            })
            await saveStoredSessionToFile(syncedSource.sessionFile, storedSession)

            const streamRequested = input.stream === true

            return {
              entryMode: 'message-regenerate',
              streamRequested,
              requestedUrl: syncedTarget.finalUrl,
              finalUrl: regenerateRun.finalUrl,
              agentId: regenerateRun.agentId,
              sessionId: regenerateRun.sessionId,
              sessionFile: syncedSource.sessionFile,
              sessionCreate: null,
              completionRequestObserved: false,
              generationObservations: regenerateRun.generationObservations,
              generationRuns: regenerateRun.generationRuns,
              outputTokensUsed: regenerateRun.outputTokensUsed,
              settledAfterMs: regenerateRun.settledAfterMs,
              budget,
              requestedComposerMode: regenerateRun.requestedComposerMode,
              ...(regenerateRun.effectiveComposerMode
                ? { effectiveComposerMode: regenerateRun.effectiveComposerMode }
                : {}),
              ...(regenerateRun.ignoredComposerToggles
                ? { ignoredComposerToggles: regenerateRun.ignoredComposerToggles }
                : {}),
              composerMode: regenerateRun.composerMode,
              beforeSendSnapshot: regenerateRun.beforeSendSnapshot,
              afterSendSnapshot: regenerateRun.afterSendSnapshot,
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
                    canonicalEvents: regenerateRun.canonicalGenerationRuns.flatMap(
                      run => run.events,
                    ),
                    canonicalRuns: regenerateRun.canonicalGenerationRuns,
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
      { logger, operation: 'regenerate-message' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek regenerate failed',
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

function updateStoredSessionAfterRegenerate(input: {
  storedSession: DeepSeekStoredSession
  materializedSession: DeepSeekSession
  finalUrl: string
  agentId: string
  sessionId: string
  transcriptRecovery: DeepSeekTranscriptRecovery
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
    activeBranchSource: 'regenerate',
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

function findPreviousUserMessageId(
  messages: DeepSeekSession['branches'][number]['messages'],
  assistantMessageId: string,
): string | null {
  const sortedMessages = [...messages].sort(compareMessagesByCreatedAt)
  const targetIndex = sortedMessages.findIndex(message => message.id === assistantMessageId)
  if (targetIndex < 0) {
    return null
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const message = sortedMessages[index]
    if (message?.role === 'user') {
      return message.id
    }
  }

  return null
}

function compareMessagesByCreatedAt(
  left: DeepSeekSession['branches'][number]['messages'][number],
  right: DeepSeekSession['branches'][number]['messages'][number],
): number {
  const timestampDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  if (timestampDiff !== 0) {
    return timestampDiff
  }

  return left.id.localeCompare(right.id)
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}
