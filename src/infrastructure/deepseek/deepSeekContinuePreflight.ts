import type { Page } from 'puppeteer-core'
import type {
  DeepSeekContinuePreflightAutoResumeSummary,
  DeepSeekContinuePreflightContinueControlSummary,
  DeepSeekContinuePreflightResult,
  InspectDeepSeekContinuePreflightOnPageInput,
  ResolveDeepSeekContinuePreflightInput,
} from '../../types/deepseek-continue-preflight.types.js'
import type { DeepSeekResumeStreamObservation } from '../../types/deepseek-stream-control.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { captureDeepSeekMessageActionSnapshot } from './deepSeekMessageActionControls.js'
import {
  judgeDeepSeekGenerationSettlement,
  observeDeepSeekStreamControlResponses,
  summarizeObservedDeepSeekStreamControls,
} from './deepSeekStreamControlRuntime.js'
import { projectDeepSeekSessionRestoreResult, syncDeepSeekSessionOnPage } from './deepSeekSessionSync.js'

const DEFAULT_STREAM_CONTROL_TIMEOUT_MS = 1_500

export async function inspectDeepSeekContinuePreflightOnPage(
  page: Page,
  input: InspectDeepSeekContinuePreflightOnPageInput,
  logger?: RuntimeLogger,
): Promise<DeepSeekContinuePreflightResult> {
  const streamControlObserver = observeDeepSeekStreamControlResponses(page)

  try {
    const sync = await syncDeepSeekSessionOnPage(
      page,
      {
        target: input.target,
        timeoutMs: input.timeoutMs,
        waitUntil: input.waitUntil,
      },
      logger?.child('sync'),
    )
    const restore = projectDeepSeekSessionRestoreResult(sync)
    const streamControlCaptures = await streamControlObserver.stop(
      resolveStreamControlTimeoutMs(input.streamControlTimeoutMs),
    )
    const streamControls = summarizeObservedDeepSeekStreamControls({
      captures: streamControlCaptures,
      routeUrl: restore.finalUrl,
    })
    const continueControl = await inspectDeepSeekContinueControlOnPage(page, {
      preferredAssistantMessageId: input.preferredAssistantMessageId,
    })
    const preflight = resolveDeepSeekContinuePreflight({
      restore,
      streamControls,
      streamControlCaptures,
      continueControl,
    })

    logger?.info('DeepSeek continue preflight settled', {
      status: preflight.status,
      disposition: preflight.disposition,
      explicitContinueAllowed: preflight.explicitContinueAllowed,
      controlSettlementStatus: preflight.controlSettlement.status,
      autoResumeObserved: preflight.autoResume.observed,
      autoResumeRunStatus: preflight.autoResume.runStatus,
      historyRecoveryOutcome: restore.historyMessagesRecovery.outcome,
      continueControlObserved: preflight.continueControl.observed,
      continueControlAssistantMessageId: preflight.continueControl.assistantMessageId,
      continueControlMatchedBy: preflight.continueControl.matchedBy,
    })

    return preflight
  } catch (error) {
    await streamControlObserver
      .stop(resolveStreamControlTimeoutMs(input.streamControlTimeoutMs))
      .catch(() => [])
    throw error
  }
}

export function resolveDeepSeekContinuePreflight(
  input: ResolveDeepSeekContinuePreflightInput,
): DeepSeekContinuePreflightResult {
  const historyCapture = input.restore.historyMessagesRecovery.capture
  const continueControl = cloneContinueControlSummary(input.continueControl)
  const controlSettlement = judgeDeepSeekGenerationSettlement({
    streamControls: input.streamControls,
    historyCapture,
    resumableCandidate: inferResumableCandidateFromContinueControl(
      input.restore.authoritativeSessionId,
      continueControl,
    ),
  })
  const autoResumeObservation = findLatestResumeStreamObservation(input.streamControls)
  const autoResume = summarizeAutoResume(autoResumeObservation)

  if (autoResume.observed) {
    return {
      status: 'auto-resumed',
      disposition: 'blocked-auto-resume',
      explicitContinueAllowed: false,
      restore: input.restore,
      controlSettlement,
      historyCapture,
      streamControls: cloneStreamControls(input.streamControls),
      streamControlCaptures: cloneStreamControlCaptures(input.streamControlCaptures),
      continueControl,
      autoResume,
    }
  }

  if (controlSettlement.status === 'resumable') {
    return {
      status: 'resumable',
      disposition: 'allow-explicit-continue',
      explicitContinueAllowed: true,
      restore: input.restore,
      controlSettlement,
      historyCapture,
      streamControls: cloneStreamControls(input.streamControls),
      streamControlCaptures: cloneStreamControlCaptures(input.streamControlCaptures),
      continueControl,
      autoResume,
    }
  }

  if (controlSettlement.status === 'stopped') {
    return {
      status: 'stopped',
      disposition: 'blocked-stopped',
      explicitContinueAllowed: false,
      restore: input.restore,
      controlSettlement,
      historyCapture,
      streamControls: cloneStreamControls(input.streamControls),
      streamControlCaptures: cloneStreamControlCaptures(input.streamControlCaptures),
      continueControl,
      autoResume,
    }
  }

  if (
    controlSettlement.status === 'completed' ||
    (input.restore.historyMessagesRecovery.outcome === 'recovered' &&
      input.restore.historyMessagesRecovery.recovery.settled)
  ) {
    return {
      status: 'completed',
      disposition: 'blocked-completed',
      explicitContinueAllowed: false,
      restore: input.restore,
      controlSettlement,
      historyCapture,
      streamControls: cloneStreamControls(input.streamControls),
      streamControlCaptures: cloneStreamControlCaptures(input.streamControlCaptures),
      continueControl,
      autoResume,
    }
  }

  return {
    status: 'failed',
    disposition: 'blocked-failed',
    explicitContinueAllowed: false,
    restore: input.restore,
    controlSettlement,
    historyCapture,
    streamControls: cloneStreamControls(input.streamControls),
    streamControlCaptures: cloneStreamControlCaptures(input.streamControlCaptures),
    continueControl,
    autoResume,
  }
}

function resolveStreamControlTimeoutMs(timeoutMs: number | undefined): number {
  const candidate =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? timeoutMs
      : DEFAULT_STREAM_CONTROL_TIMEOUT_MS

  return Math.max(250, Math.floor(candidate))
}

function findLatestResumeStreamObservation(
  streamControls: ResolveDeepSeekContinuePreflightInput['streamControls'],
): DeepSeekResumeStreamObservation | null {
  for (let index = streamControls.length - 1; index >= 0; index -= 1) {
    const candidate = streamControls[index]
    if (candidate?.endpoint === '/api/v0/chat/resume_stream') {
      return candidate
    }
  }

  return null
}

function summarizeAutoResume(
  observation: DeepSeekResumeStreamObservation | null,
): DeepSeekContinuePreflightAutoResumeSummary {
  if (!observation) {
    return {
      observed: false,
      acknowledged: false,
      sessionId: null,
      assistantMessageId: null,
      runStatus: null,
    }
  }

  return {
    observed: true,
    acknowledged: observation.acknowledged,
    sessionId: observation.sessionId ?? observation.run?.context.sessionId ?? null,
    assistantMessageId:
      observation.messageId ?? observation.run?.context.assistantMessageId ?? null,
    runStatus: observation.run?.finalized.status ?? null,
  }
}

function cloneStreamControls(
  streamControls: ResolveDeepSeekContinuePreflightInput['streamControls'],
): DeepSeekContinuePreflightResult['streamControls'] {
  return streamControls.map(control =>
    control.endpoint === '/api/v0/chat/resume_stream'
      ? {
          ...control,
          run: control.run
            ? {
                ...control.run,
                context: { ...control.run.context },
                events: control.run.events.map(event => ({ ...event })),
                finalized: {
                  ...control.run.finalized,
                  citations: control.run.finalized.citations.map(citation => ({
                    ...citation,
                    ...(citation.annotation ? { annotation: { ...citation.annotation } } : {}),
                  })),
                  searches: control.run.finalized.searches.map(search => ({
                    ...search,
                    results: search.results.map(result => ({ ...result })),
                  })),
                  usage: control.run.finalized.usage ? { ...control.run.finalized.usage } : null,
                  error: control.run.finalized.error ? { ...control.run.finalized.error } : null,
                },
                unknownObservations: control.run.unknownObservations.map(observation => ({
                  ...observation,
                })),
                unknownObservationLabels: [...control.run.unknownObservationLabels],
              }
            : null,
          error: control.error ? { ...control.error } : null,
        }
      : {
          ...control,
          error: control.error ? { ...control.error } : null,
        },
  )
}

function cloneStreamControlCaptures(
  captures: ResolveDeepSeekContinuePreflightInput['streamControlCaptures'],
): DeepSeekContinuePreflightResult['streamControlCaptures'] {
  return (captures ?? []).map(capture => ({
    endpoint: capture.endpoint,
    routeUrl: capture.routeUrl ?? null,
    request: {
      method: capture.request.method,
      url: capture.request.url,
      postData: capture.request.postData,
    },
    response: {
      status: capture.response.status,
      contentType: capture.response.contentType,
      bodyText: capture.response.bodyText,
    },
  }))
}

async function inspectDeepSeekContinueControlOnPage(
  page: Page,
  input: {
    preferredAssistantMessageId?: string | undefined
  },
): Promise<DeepSeekContinuePreflightContinueControlSummary> {
  const preferredAssistantMessageId = normalizeOptionalString(input.preferredAssistantMessageId)
  let snapshot: Awaited<ReturnType<typeof captureDeepSeekMessageActionSnapshot>>
  try {
    snapshot = await captureDeepSeekMessageActionSnapshot(page)
  } catch {
    return {
      observed: false,
      assistantMessageId: null,
      controlKind: null,
      label: null,
      selector: null,
      matchedBy: 'unavailable',
    }
  }

  if (preferredAssistantMessageId) {
    const preferredItem = snapshot.items.find(item => item.messageId === preferredAssistantMessageId)
    const preferredContinue = preferredItem?.actions.find(action => action.action === 'continue')
    if (preferredContinue?.found) {
      return {
        observed: true,
        assistantMessageId: preferredAssistantMessageId,
        controlKind: preferredContinue.controlKind,
        label: preferredContinue.tooltipLabel ?? preferredContinue.label,
        selector: preferredContinue.selector,
        matchedBy: 'preferred-message',
      }
    }
  }

  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const candidateItem = snapshot.items[index]
    if (candidateItem?.role !== 'assistant') {
      continue
    }

    const continueControl = candidateItem.actions.find(action => action.action === 'continue')
    if (!continueControl?.found) {
      continue
    }

    return {
      observed: true,
      assistantMessageId: candidateItem.messageId,
      controlKind: continueControl.controlKind,
      label: continueControl.tooltipLabel ?? continueControl.label,
      selector: continueControl.selector,
      matchedBy: 'snapshot-last-assistant',
    }
  }

  return cloneContinueControlSummary()
}

function inferResumableCandidateFromContinueControl(
  sessionId: string,
  continueControl: DeepSeekContinuePreflightContinueControlSummary,
) {
  if (!continueControl.observed || !continueControl.assistantMessageId) {
    return null
  }

  return {
    sessionId,
    assistantMessageId: continueControl.assistantMessageId,
    status: 'CONTINUE_CONTROL_VISIBLE',
    source: 'message_action_control' as const,
  }
}

function cloneContinueControlSummary(
  continueControl?: ResolveDeepSeekContinuePreflightInput['continueControl'],
): DeepSeekContinuePreflightContinueControlSummary {
  if (!continueControl) {
    return {
      observed: false,
      assistantMessageId: null,
      controlKind: null,
      label: null,
      selector: null,
      matchedBy: 'unavailable',
    }
  }

  return {
    observed: continueControl.observed,
    assistantMessageId: continueControl.assistantMessageId ?? null,
    controlKind: continueControl.controlKind ?? null,
    label: continueControl.label ?? null,
    selector: continueControl.selector ?? null,
    matchedBy: continueControl.matchedBy,
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}
