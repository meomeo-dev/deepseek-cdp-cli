import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import { deepSeekGenerationBudgetGate } from '../../infrastructure/deepseek/deepSeekGenerationBudget.js'
import { recoverDeepSeekSessionFromHistoryMessagesOnPage } from '../../infrastructure/deepseek/deepSeekHistoryMessages.js'
import { resolveDeepSeekReplyTimingPolicy } from '../../infrastructure/deepseek/deepSeekReplyGenerationLiveness.js'
import { runDeepSeekReplyOnPage } from '../../infrastructure/deepseek/deepSeekReplyFlow.js'
import {
  createDeepSeekExpertFileInputTemporarilyDisabledError,
  createDeepSeekExpertSearchTemporarilyDisabledError,
} from '../../shared/errors/deepSeekComposerModeError.js'
import {
  resolveDeepSeekSessionTarget,
} from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import {
  applyTranscriptRecoveryToStoredSession,
  appendReplyTurnToStoredSession,
  buildDeepSeekSessionFilePath,
  createStoredSessionFromFirstMessage,
  overlayLocalAttachmentMetadataOnRecoveredSession,
} from '../../infrastructure/deepseek/deepSeekStoredSession.js'
import { saveStoredSessionToFile } from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import type { DeepSeekComposerModeInput } from '../../types/deepseek-composer-mode.types.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekGenerationStreamEvent } from '../../types/deepseek-stream.types.js'
import type { DeepSeekSession } from '../../types/deepseek-session.types.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { buildDeepSeekModeFactLogPayload } from '../services/deepSeekModeFactLogPayload.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

export interface ReplyDeepSeekMessageInput extends ManagedChromeOptions {
  prompt: string
  files?: string[] | undefined
  sessionId?: string | undefined
  sessionFile?: string | undefined
  sessionStoreDir?: string | undefined
  url?: string | undefined
  waitUntil: WaitUntil
  stream?: boolean | undefined
  composerMode?: DeepSeekComposerModeInput | undefined
  onCanonicalGenerationEvent?: ((input: {
    source: 'buffered' | 'live' | 'finalize'
    event: DeepSeekGenerationStreamEvent
  }) => void) | undefined
}

export async function replyDeepSeekMessage(
  input: ReplyDeepSeekMessageInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'reply' }),
): Promise<DeepSeekReplyResult> {
  try {
    assertRequestedDeepSeekSearchSupported(input)
    assertRequestedDeepSeekFilePathSupported(input)
    const timingPolicy = resolveDeepSeekReplyTimingPolicy({
      timeoutMs: input.timeoutMs,
      composerMode: input.composerMode,
    })
    const executionInput: ReplyDeepSeekMessageInput = {
      ...input,
      timeoutMs: timingPolicy.executionTimeoutMs,
    }
    const hasExistingSessionTarget =
      input.sessionId !== undefined || input.sessionFile !== undefined
    const reservedBudget = deepSeekGenerationBudgetGate.consumeQuery()
    logger.info('Reserved DeepSeek generation budget', reservedBudget)
    if (executionInput.timeoutMs !== input.timeoutMs) {
      logger.info('Extended DeepSeek reply timeout for long-running generation', {
        requestedTimeoutMs: input.timeoutMs,
        executionTimeoutMs: executionInput.timeoutMs,
        historyRecoveryTimeoutMs: timingPolicy.historyRecoveryTimeoutMs,
      })
    }

    return withManagedChromeRuntimeIfNeeded(
      executionInput,
      async runtime => {
        return withBrowserPageLease(
          {
            runtime,
            timeoutMs: executionInput.timeoutMs,
          },
          async ({ page, goto }) => {
            const streamRequested = executionInput.stream === true
            if (!hasExistingSessionTarget) {
              const requestedUrl = executionInput.url ?? 'https://chat.deepseek.com/'
              await goto(requestedUrl, executionInput.waitUntil)
              await page.waitForSelector('body')

              const replyRun = await runDeepSeekReplyOnPage(
                page,
                {
                  entryMode: 'new-session',
                requestedUrl,
                prompt: executionInput.prompt,
                filePaths: executionInput.files,
                timeoutMs: executionInput.timeoutMs,
                composerMode: executionInput.composerMode,
                onCanonicalGenerationEvent: executionInput.onCanonicalGenerationEvent,
              },
              logger,
            )

              logger.info('DeepSeek reply created a new session', {
                finalUrl: replyRun.finalUrl,
                agentId: replyRun.agentId,
                sessionId: replyRun.sessionId,
                outputTokensUsed: replyRun.outputTokensUsed,
              })

              const budget = deepSeekGenerationBudgetGate.recordOutputTokens(
                replyRun.outputTokensUsed,
              )
              logger.info('Recorded DeepSeek output token usage', budget)

              const sessionFile = buildDeepSeekSessionFilePath(
                replyRun.sessionId,
                input.sessionStoreDir,
              )
              let storedSession = createStoredSessionFromFirstMessage({
                prompt: executionInput.prompt,
                result: replyRun,
              })

              const transcriptRecovery = await recoverDeepSeekSessionFromHistoryMessagesOnPage(
                page,
                {
                  finalUrl: replyRun.finalUrl,
                  sessionId: replyRun.sessionId,
                  timeoutMs: timingPolicy.historyRecoveryTimeoutMs,
                  maxAttempts: timingPolicy.historyRecoveryMaxAttempts,
                  retryDelayMs: timingPolicy.historyRecoveryRetryDelayMs,
                },
                logger.child('history-messages'),
              )
              storedSession = applyTranscriptRecoveryToStoredSession({
                storedSession,
                transcriptRecovery: transcriptRecovery.recovery,
                ...(transcriptRecovery.outcome === 'recovered'
                  ? {
                      recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
                        localSession: storedSession.session,
                        recoveredSession: transcriptRecovery.session,
                      }),
                    }
                  : {}),
              })
              logger.info('DeepSeek stored session mode fact settled', {
                sessionId: replyRun.sessionId,
                modeFact: buildDeepSeekModeFactLogPayload({
                  storedSession,
                  generationRuns: replyRun.generationRuns,
                }),
              })

              const assistantText = selectLatestAssistantMessageText(
                transcriptRecovery.outcome === 'recovered'
                  ? transcriptRecovery.session
                  : storedSession.session,
              ) ?? replyRun.assistantText
              const assistantTextSource =
                transcriptRecovery.outcome === 'recovered'
                  ? 'history_messages'
                  : replyRun.assistantTextSource

              await saveStoredSessionToFile(sessionFile, storedSession)

              return {
                entryMode: 'new-session',
                streamRequested,
                requestedUrl: requestedUrl,
                finalUrl: replyRun.finalUrl,
                agentId: replyRun.agentId,
                sessionId: replyRun.sessionId,
                sessionFile,
                sessionCreate: replyRun.sessionCreate,
                completionRequestObserved: replyRun.completionRequestObserved,
                generationObservations: replyRun.generationObservations,
                generationRuns: replyRun.generationRuns,
                outputTokensUsed: replyRun.outputTokensUsed,
                settledAfterMs: replyRun.settledAfterMs,
                budget,
                requestedComposerMode: replyRun.requestedComposerMode,
                ...(replyRun.effectiveComposerMode
                  ? { effectiveComposerMode: replyRun.effectiveComposerMode }
                  : {}),
                ...(replyRun.ignoredComposerToggles
                  ? { ignoredComposerToggles: replyRun.ignoredComposerToggles }
                  : {}),
                composerMode: replyRun.composerMode,
                beforeSendSnapshot: replyRun.beforeSendSnapshot,
                afterSendSnapshot: replyRun.afterSendSnapshot,
                fileUpload: replyRun.fileUpload,
                assistantText,
                assistantTextSource,
                transcriptRecovery: storedSession.metadata?.transcriptRecovery ?? null,
                session: storedSession.session,
                output: streamRequested
                  ? {
                      mode: 'stream',
                      canonicalEvents: replyRun.canonicalGenerationRuns.flatMap(run => run.events),
                      canonicalRuns: replyRun.canonicalGenerationRuns,
                      finalizedAssistantText: assistantText,
                    }
                  : {
                      mode: 'buffered',
                      canonicalEvents: [],
                      canonicalRuns: [],
                      finalizedAssistantText: assistantText,
                    },
              }
            }

            const target = await resolveDeepSeekSessionTarget({
              ...(executionInput.sessionId !== undefined
                ? { sessionId: executionInput.sessionId }
                : {}),
              ...(executionInput.sessionFile !== undefined
                ? { sessionFile: executionInput.sessionFile }
                : {}),
              ...(executionInput.sessionStoreDir !== undefined
                ? { sessionStoreDir: executionInput.sessionStoreDir }
                : {}),
            })

            const replyRun = await runDeepSeekReplyOnPage(
              page,
              {
                entryMode: 'existing-session',
                requestedUrl: target.finalUrl,
                prompt: executionInput.prompt,
                filePaths: executionInput.files,
                timeoutMs: executionInput.timeoutMs,
                composerMode: executionInput.composerMode,
                authoritativeChatModeHint:
                  target.storedSession.session.modeFact?.resolvedMode ??
                  target.storedSession.metadata?.modeFact?.resolvedMode ??
                  undefined,
                expectedSessionId: target.authoritativeSessionId,
                expectedAgentId: target.authoritativeAgentId,
                onCanonicalGenerationEvent: executionInput.onCanonicalGenerationEvent,
              },
              logger,
            )

            logger.info('DeepSeek reply continued an existing session', {
              finalUrl: replyRun.finalUrl,
              agentId: replyRun.agentId,
              sessionId: replyRun.sessionId,
              outputTokensUsed: replyRun.outputTokensUsed,
            })

            const budget = deepSeekGenerationBudgetGate.recordOutputTokens(replyRun.outputTokensUsed)
            logger.info('Recorded DeepSeek output token usage', budget)

            const transcriptRecovery = await recoverDeepSeekSessionFromHistoryMessagesOnPage(
              page,
              {
                finalUrl: replyRun.finalUrl,
                sessionId: replyRun.sessionId,
                timeoutMs: timingPolicy.historyRecoveryTimeoutMs,
                maxAttempts: timingPolicy.historyRecoveryMaxAttempts,
                retryDelayMs: timingPolicy.historyRecoveryRetryDelayMs,
              },
              logger.child('history-messages'),
            )
            const replyOverlaySession = appendReplyTurnToStoredSession({
              storedSession: target.storedSession,
              prompt: executionInput.prompt,
              result: replyRun,
            })
            const storedSession = applyTranscriptRecoveryToStoredSession({
              storedSession:
                transcriptRecovery.outcome === 'recovered'
                  ? target.storedSession
                  : replyOverlaySession,
              transcriptRecovery: transcriptRecovery.recovery,
              ...(transcriptRecovery.outcome === 'recovered'
                ? {
                    recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
                      localSession: replyOverlaySession.session,
                      recoveredSession: transcriptRecovery.session,
                    }),
                  }
                : {}),
            })
            logger.info('DeepSeek stored session mode fact settled', {
              sessionId: replyRun.sessionId,
              modeFact: buildDeepSeekModeFactLogPayload({
                storedSession,
                generationRuns: replyRun.generationRuns,
              }),
            })

            const assistantText = selectLatestAssistantMessageText(
              transcriptRecovery.outcome === 'recovered'
                ? transcriptRecovery.session
                : storedSession.session,
            ) ?? replyRun.assistantText
            const assistantTextSource =
              transcriptRecovery.outcome === 'recovered'
                ? 'history_messages'
                : replyRun.assistantTextSource

            await saveStoredSessionToFile(target.sessionFile, storedSession)

            return {
              entryMode: 'existing-session',
              streamRequested,
              requestedUrl: target.finalUrl,
              finalUrl: replyRun.finalUrl,
              agentId: replyRun.agentId,
              sessionId: replyRun.sessionId,
              sessionFile: target.sessionFile,
              sessionCreate: null,
              completionRequestObserved: replyRun.completionRequestObserved,
              generationObservations: replyRun.generationObservations,
              generationRuns: replyRun.generationRuns,
              outputTokensUsed: replyRun.outputTokensUsed,
              settledAfterMs: replyRun.settledAfterMs,
              budget,
              requestedComposerMode: replyRun.requestedComposerMode,
              ...(replyRun.effectiveComposerMode
                ? { effectiveComposerMode: replyRun.effectiveComposerMode }
                : {}),
              ...(replyRun.ignoredComposerToggles
                ? { ignoredComposerToggles: replyRun.ignoredComposerToggles }
                : {}),
              composerMode: replyRun.composerMode,
              beforeSendSnapshot: replyRun.beforeSendSnapshot,
              afterSendSnapshot: replyRun.afterSendSnapshot,
              fileUpload: replyRun.fileUpload,
              assistantText,
              assistantTextSource,
              transcriptRecovery:
                storedSession.metadata?.transcriptRecovery ?? transcriptRecovery.recovery,
              session: storedSession.session,
              output: streamRequested
                ? {
                    mode: 'stream',
                    canonicalEvents: replyRun.canonicalGenerationRuns.flatMap(run => run.events),
                    canonicalRuns: replyRun.canonicalGenerationRuns,
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
      { logger, operation: 'reply' },
    )
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek reply failed',
      error,
      context: {
        sessionId: input.sessionId ?? null,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        stream: input.stream === true,
      },
    })
    throw error
  }
}

function assertRequestedDeepSeekSearchSupported(
  input: ReplyDeepSeekMessageInput,
): void {
  if (
    input.composerMode?.chatMode !== 'expert' ||
    input.composerMode.search !== 'on'
  ) {
    return
  }

  throw createDeepSeekExpertSearchTemporarilyDisabledError({
    targetState: 'on',
  })
}

function assertRequestedDeepSeekFilePathSupported(
  input: ReplyDeepSeekMessageInput,
): void {
  const requestedFileCount = input.files?.length ?? 0
  if (
    requestedFileCount === 0 ||
    input.composerMode?.chatMode !== 'expert'
  ) {
    return
  }

  throw createDeepSeekExpertFileInputTemporarilyDisabledError({
    requestedFileCount,
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
