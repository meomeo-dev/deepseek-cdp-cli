import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { withManagedChromeRuntimeIfNeeded } from '../../domain/browser/managedChrome.js'
import {
  buildDeepSeekReleaseCompatibilityRecord,
} from '../../domain/regression/deepSeekReleaseFingerprint.js'
import { buildDeepSeekSessionExportDocument } from '../../domain/session/sessionExport.js'
import { buildDeepSeekSessionExportSnapshot } from '../../domain/session/sessionExportSnapshot.js'
import {
  buildDeepSeekChatModeCapabilityMatrix,
  waitForStableDeepSeekChatModeSurface,
} from '../../infrastructure/deepseek/deepSeekChatModeControls.js'
import { captureDeepSeekReleaseFingerprintOnPage } from '../../infrastructure/deepseek/deepSeekReleaseFingerprint.js'
import { selectDeepSeekChatMode } from '../../infrastructure/deepseek/deepSeekChatModeInteractions.js'
import {
  buildDeepSeekChatModeSignalObservation,
  extractDeepSeekCanonicalGenerationContextModelType,
  extractDeepSeekHistoryMessagesModelType,
  extractDeepSeekReadyEventModelType,
  extractDeepSeekRequestModelType,
} from '../../infrastructure/deepseek/deepSeekChatModeSignal.js'
import { recoverDeepSeekSessionFromHistoryMessagesOnPage } from '../../infrastructure/deepseek/deepSeekHistoryMessages.js'
import { resolveDeepSeekReplyTimingPolicy } from '../../infrastructure/deepseek/deepSeekReplyGenerationLiveness.js'
import { runDeepSeekReplyOnPage } from '../../infrastructure/deepseek/deepSeekReplyFlow.js'
import {
  applyTranscriptRecoveryToStoredSession,
  createStoredSessionFromFirstMessage,
  overlayLocalAttachmentMetadataOnRecoveredSession,
} from '../../infrastructure/deepseek/deepSeekStoredSession.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeFact,
  DeepSeekChatModeSignalObservation,
} from '../../types/deepseek-chat-mode.types.js'
import type {
  AuditDeepSeekChatModesInput,
  DeepSeekChatModeAuditReport,
  DeepSeekChatModeAuditScenarioReport,
} from '../../types/deepseek-mode-audit.types.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'

const DEFAULT_AUDIT_PROMPTS: Record<DeepSeekChatMode, string> = {
  instant: 'Reply with exactly: instant mode audit ok.',
  expert: 'Reply with exactly: expert mode audit ok.',
  vision: 'Read the attached image and reply with exactly: vision mode audit ok.',
}

const MODE_AUDIT_SCENARIOS: DeepSeekChatMode[] = ['instant', 'expert', 'vision']
const VISION_AUDIT_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHxcCA+2K6yQAAAAASUVORK5CYII='

export function resolveModeAuditChromeOptions(
  input: AuditDeepSeekChatModesInput,
): AuditDeepSeekChatModesInput {
  const browserId = input.browserId?.trim()
  if (!browserId) {
    return input
  }

  return {
    ...input,
    browserId,
    browserPurpose: 'audit',
    browserRuntime: undefined,
  }
}

export async function auditDeepSeekChatModes(
  input: AuditDeepSeekChatModesInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'mode-audit' }),
): Promise<DeepSeekChatModeAuditReport> {
  const chrome = resolveModeAuditChromeOptions(input)
  try {
    const timingPolicy = resolveDeepSeekReplyTimingPolicy({
      timeoutMs: chrome.timeoutMs,
      composerMode: {
        deepThink: 'unchanged',
        search: 'unchanged',
      },
    })
    const executionInput: AuditDeepSeekChatModesInput = {
      ...chrome,
      timeoutMs: timingPolicy.executionTimeoutMs,
    }
    const visionAuditFile = await resolveVisionAuditFile(executionInput.visionFile)

    const report = await (async () => {
      try {
        return await withManagedChromeRuntimeIfNeeded(
          executionInput,
          async runtime =>
            withBrowserPageLease(
              {
                runtime,
                timeoutMs: executionInput.timeoutMs,
              },
              async ({ page, goto }) => {
                await goto(executionInput.url, executionInput.waitUntil)
                await page.waitForSelector('body')

                const defaultHomeSurface = await waitForStableDeepSeekChatModeSurface(page, {
                  timeoutMs: executionInput.timeoutMs,
                })
                const defaultHomeFingerprint = await captureDeepSeekReleaseFingerprintOnPage(page, {
                  targetUrl: page.url(),
                  waitUntil: executionInput.waitUntil,
                })

              const scenarios: DeepSeekChatModeAuditScenarioReport[] = []
              for (const requestedMode of MODE_AUDIT_SCENARIOS) {
                const prompt = resolveModeAuditPrompt(executionInput, requestedMode)

                await goto(executionInput.url, executionInput.waitUntil)
                await page.waitForSelector('body')

                const initialHomeSurface = await waitForStableDeepSeekChatModeSurface(page, {
                  timeoutMs: executionInput.timeoutMs,
                })
                const homeSurface = isRequestedModeAlreadySettled(initialHomeSurface, requestedMode)
                  ? initialHomeSurface
                  : await selectDeepSeekChatMode(page, {
                      mode: requestedMode,
                      timeoutMs: executionInput.timeoutMs,
                    })

                const replyRun = await runDeepSeekReplyOnPage(
                  page,
                  {
                    entryMode: 'new-session',
                    requestedUrl: executionInput.url,
                    prompt,
                    ...(requestedMode === 'vision'
                      ? { filePaths: [visionAuditFile.filePath] }
                      : {}),
                    timeoutMs: executionInput.timeoutMs,
                    composerMode: {
                      chatMode: requestedMode,
                      deepThink: 'unchanged',
                      search: 'unchanged',
                    },
                  },
                  logger.child(`reply:${requestedMode}`),
                )
                if (requestedMode === 'vision') {
                  logger.info('DeepSeek vision mode audit image upload attempted', {
                    file: visionAuditFile.filePath,
                    cleanup: visionAuditFile.cleanup ? 'temporary' : 'caller-owned',
                    uploadedFileIds:
                      replyRun.fileUpload?.files
                        .filter(file => file.mounted && file.fileId)
                        .map(file => file.fileId) ?? [],
                    requestRefFileIds:
                      replyRun.generationObservations.flatMap(
                        observation => observation.requestRefFileIds ?? [],
                      ),
                  })
                }

                const sessionSurface = await waitForStableDeepSeekChatModeSurface(page, {
                  timeoutMs: executionInput.timeoutMs,
                })

                const transcriptRecovery = await recoverDeepSeekSessionFromHistoryMessagesOnPage(
                  page,
                  {
                    finalUrl: replyRun.finalUrl,
                    sessionId: replyRun.sessionId,
                    timeoutMs: timingPolicy.historyRecoveryTimeoutMs,
                    maxAttempts: 1,
                    retryDelayMs: timingPolicy.historyRecoveryRetryDelayMs,
                  },
                  logger.child(`history:${requestedMode}`),
                )

                const reopenedSessionSurface = await waitForStableDeepSeekChatModeSurface(page, {
                  timeoutMs: executionInput.timeoutMs,
                })

                let storedSession = createStoredSessionFromFirstMessage({
                  prompt,
                  result: replyRun,
                })
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

                const exportSnapshot = buildDeepSeekSessionExportSnapshot({
                  source: {
                    sessionFile: `memory://${replyRun.sessionId}.json`,
                    storedSession,
                    session: storedSession.session,
                    authoritativeSessionId: replyRun.sessionId,
                    authoritativeAgentId: replyRun.agentId,
                    finalUrl: replyRun.finalUrl,
                  },
                })
                const exportDocument = buildDeepSeekSessionExportDocument(exportSnapshot)
                const mappedSessionModeFact = extractModeFact(
                  transcriptRecovery.outcome === 'recovered' ? transcriptRecovery.session : null,
                )
                const storedSessionModeFact = extractModeFact(storedSession.metadata)
                const exportDocumentModeFact = extractModeFact(exportDocument.session)

                scenarios.push({
                  requestedMode,
                  prompt,
                  finalUrl: replyRun.finalUrl,
                  sessionId: replyRun.sessionId,
                  homeSurface,
                  sessionSurface,
                  reopenedSessionSurface,
                  homeCapabilities: buildDeepSeekChatModeCapabilityMatrix(homeSurface),
                  sessionCapabilities: buildDeepSeekChatModeCapabilityMatrix(sessionSurface),
                  reopenedSessionCapabilities: buildDeepSeekChatModeCapabilityMatrix(
                    reopenedSessionSurface,
                  ),
                  authoritySignals: buildAuthoritySignals({
                    replyRun,
                    transcriptRecovery,
                    mappedSessionModeFact,
                    storedSessionModeFact,
                    exportDocumentModeFact,
                  }),
                  deliverySurfaces: {
                    mappedSessionModeFact,
                    mappedSessionHasModeFact: mappedSessionModeFact !== null,
                    storedSessionModeFact,
                    storedSessionHasModeFact: storedSessionModeFact !== null,
                    exportDocumentModeFact,
                    exportDocumentHasModeFact: exportDocumentModeFact !== null,
                    note:
                      'This audit distinguishes raw authoritative mode signals from downstream persisted mode facts. Missing values here indicate a concrete delivery-surface drop after capture, not a UI-label observation gap.',
                  },
                  fileEvidence: buildModeAuditFileEvidence({
                    replyRun,
                    requestedFiles:
                      requestedMode === 'vision' ? [visionAuditFile.filePath] : [],
                  }),
                })
              }

                const preliminaryReport = {
                  scenario: 'mode-audit',
                  capturedAt: new Date().toISOString(),
                  requestedUrl: executionInput.url,
                  defaultHomeSurface,
                  scenarios,
                } satisfies Omit<DeepSeekChatModeAuditReport, 'releaseFingerprints' | 'compatibility'>

                return {
                  ...preliminaryReport,
                  releaseFingerprints: [defaultHomeFingerprint],
                  compatibility: buildDeepSeekReleaseCompatibilityRecord({
                    artifactKind: 'gate',
                    releaseFingerprints: [defaultHomeFingerprint],
                    failureCount: countModeAuditCheckStatuses(preliminaryReport, 'fail'),
                    warningCount: countModeAuditCheckStatuses(preliminaryReport, 'warn'),
                  }),
                } satisfies DeepSeekChatModeAuditReport
              },
            ),
          { logger, operation: 'mode-audit' },
        )
      } finally {
        if (visionAuditFile.cleanup) {
          await visionAuditFile.cleanup()
        }
      }
    })()

    if (input.outputFile) {
      const outputFile = resolve(process.cwd(), input.outputFile)
      await mkdir(dirname(outputFile), { recursive: true })
      await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }

    return report
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek chat mode audit failed',
      error,
      context: {
        url: chrome.url,
        cloneChromeProfile: chrome.cloneChromeProfile,
        waitUntil: chrome.waitUntil,
      },
    })
    throw error
  }
}

function resolveModeAuditPrompt(
  input: AuditDeepSeekChatModesInput,
  mode: DeepSeekChatMode,
): string {
  switch (mode) {
    case 'instant':
      return input.instantPrompt ?? DEFAULT_AUDIT_PROMPTS.instant
    case 'expert':
      return input.expertPrompt ?? DEFAULT_AUDIT_PROMPTS.expert
    case 'vision':
      return input.visionPrompt ?? DEFAULT_AUDIT_PROMPTS.vision
  }
}

async function resolveVisionAuditFile(
  visionFile: string | undefined,
): Promise<{
  filePath: string
  cleanup: (() => Promise<void>) | null
}> {
  const provided = visionFile?.trim()
  if (provided) {
    return {
      filePath: resolve(process.cwd(), provided),
      cleanup: null,
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-vision-mode-audit-'))
  const filePath = join(tempDir, 'vision-audit-probe.png')
  await writeFile(filePath, Buffer.from(VISION_AUDIT_IMAGE_BASE64, 'base64'))
  return {
    filePath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  }
}

function isRequestedModeAlreadySettled(
  surface: DeepSeekChatModeAuditReport['defaultHomeSurface'],
  requestedMode: DeepSeekChatMode,
): boolean {
  return (
    surface.activeMode === requestedMode ||
    surface.heading?.toLowerCase().includes(requestedMode) === true
  )
}

function buildAuthoritySignals(input: {
  replyRun: Awaited<ReturnType<typeof runDeepSeekReplyOnPage>>
  transcriptRecovery: Awaited<ReturnType<typeof recoverDeepSeekSessionFromHistoryMessagesOnPage>>
  mappedSessionModeFact: DeepSeekChatModeFact | null
  storedSessionModeFact: DeepSeekChatModeFact | null
  exportDocumentModeFact: DeepSeekChatModeFact | null
}): DeepSeekChatModeSignalObservation[] {
  const firstCapture = input.replyRun.generationCaptures[0] ?? null
  const requestModelType = firstCapture
    ? extractDeepSeekRequestModelType(firstCapture.exchange.request.postData)
    : null
  const readyModelType = firstCapture
    ? extractDeepSeekReadyEventModelType(firstCapture.exchange.response.bodyText)
    : null
  const canonicalModelType = extractDeepSeekCanonicalGenerationContextModelType(
    input.replyRun.canonicalGenerationRuns[0],
  )
  const historyModelType = input.transcriptRecovery.capture
    ? extractDeepSeekHistoryMessagesModelType(input.transcriptRecovery.capture.response.bodyText)
    : null

  return [
    buildDeepSeekChatModeSignalObservation({
      layer: 'request-payload',
      rawModelType: requestModelType,
      note: 'Request payload model_type observed on the real DeepSeek generation request.',
    }),
    buildDeepSeekChatModeSignalObservation({
      layer: 'generation-ready-sse',
      rawModelType: readyModelType,
      note: 'SSE ready event model_type observed in the real DeepSeek generation stream.',
    }),
    buildDeepSeekChatModeSignalObservation({
      layer: 'canonical-generation-context',
      rawModelType: canonicalModelType,
      note:
        canonicalModelType === null
          ? 'Canonical generation context did not preserve model_type for this run.'
          : 'Canonical generation context preserved model_type.',
    }),
    buildDeepSeekChatModeSignalObservation({
      layer: 'history-messages-raw',
      rawModelType: historyModelType,
      note: 'history_messages raw chat_session.model_type observed from the captured response payload.',
    }),
    buildDeepSeekChatModeSignalObservation({
      layer: 'history-messages-mapped-session',
      rawModelType: input.mappedSessionModeFact?.rawModelType ?? null,
      note:
        input.mappedSessionModeFact
          ? `Mapped history session persisted model_type as ${input.mappedSessionModeFact.rawModelType}.`
          : 'mapHistoryMessagesEnvelopeToSession currently drops chat_session.model_type.',
    }),
    buildDeepSeekChatModeSignalObservation({
      layer: 'stored-session',
      rawModelType: input.storedSessionModeFact?.rawModelType ?? null,
      note:
        input.storedSessionModeFact
          ? `Stored session persisted model_type as ${input.storedSessionModeFact.rawModelType}.`
          : 'Stored session metadata currently lacks a persisted mode fact.',
    }),
    buildDeepSeekChatModeSignalObservation({
      layer: 'export-document',
      rawModelType: input.exportDocumentModeFact?.rawModelType ?? null,
      note:
        input.exportDocumentModeFact
          ? `Export document exposes model_type as ${input.exportDocumentModeFact.rawModelType}.`
          : 'Current branch/full-session export does not expose a mode fact.',
    }),
  ]
}

function extractModeFact(value: unknown): DeepSeekChatModeFact | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = (value as { modeFact?: DeepSeekChatModeFact | null }).modeFact
  if (!candidate || typeof candidate.rawModelType !== 'string' || !candidate.rawModelType.trim()) {
    return null
  }

  return {
    sourceLayer: candidate.sourceLayer,
    rawModelType: candidate.rawModelType,
    resolvedMode: candidate.resolvedMode,
    ...(candidate.derivedFromLayer ? { derivedFromLayer: candidate.derivedFromLayer } : {}),
  }
}

function countModeAuditCheckStatuses(
  report: Omit<DeepSeekChatModeAuditReport, 'releaseFingerprints' | 'compatibility'>,
  status: 'fail' | 'warn',
): number {
  return buildModeAuditCompatibilityStatuses(report).filter(candidate => candidate === status).length
}

function buildModeAuditCompatibilityStatuses(
  report: Omit<DeepSeekChatModeAuditReport, 'releaseFingerprints' | 'compatibility'>,
): Array<'pass' | 'fail' | 'warn'> {
  const instant = report.scenarios.find(scenario => scenario.requestedMode === 'instant') ?? null
  const expert = report.scenarios.find(scenario => scenario.requestedMode === 'expert') ?? null
  const vision = report.scenarios.find(scenario => scenario.requestedMode === 'vision') ?? null

  return [
    report.defaultHomeSurface.modeSelectorVisible &&
      report.defaultHomeSurface.availableModes.includes('instant') &&
      report.defaultHomeSurface.availableModes.includes('expert') &&
      report.defaultHomeSurface.availableModes.includes('vision') &&
      report.defaultHomeSurface.activeMode === 'instant'
      ? 'pass'
      : instant || expert || vision
        ? 'fail'
        : 'warn',
    instant && expert && vision ? 'pass' : 'warn',
    resolveModeAuditExpertFileStatus(instant, expert),
    resolveModeAuditVisionImageStatus(vision),
    resolveModeAuditSignalDeliveryStatus(report.scenarios),
  ]
}

function resolveModeAuditExpertFileStatus(
  instant: DeepSeekChatModeAuditScenarioReport | null,
  expert: DeepSeekChatModeAuditScenarioReport | null,
): 'pass' | 'fail' | 'warn' {
  if (!instant || !expert) {
    return 'warn'
  }

  const instantHasFileInput = [
    instant.homeCapabilities.fileInput,
    instant.sessionCapabilities.fileInput,
    instant.reopenedSessionCapabilities.fileInput,
  ].some(Boolean)
  const expertFileInputs = [
    expert.homeCapabilities.fileInput,
    expert.sessionCapabilities.fileInput,
    expert.reopenedSessionCapabilities.fileInput,
  ]

  if (!instantHasFileInput) {
    return 'fail'
  }
  if (expertFileInputs.every(value => value === false)) {
    return 'pass'
  }
  if (expertFileInputs.every(Boolean)) {
    return 'pass'
  }
  if (expertFileInputs.some(Boolean)) {
    return 'fail'
  }
  return 'warn'
}

function resolveModeAuditVisionImageStatus(
  vision: DeepSeekChatModeAuditScenarioReport | null,
): 'pass' | 'fail' | 'warn' {
  if (!vision) {
    return 'warn'
  }

  const evidence = vision.fileEvidence
  if (!evidence || evidence.requestedFiles.length === 0) {
    return 'fail'
  }

  const mountedIds = new Set(evidence.mountedFileIds)
  const refIds = new Set(evidence.requestRefFileIds)
  const mountedRefIds = [...mountedIds].filter(fileId => refIds.has(fileId))
  if (
    evidence.uploadedFileIds.length > 0 &&
    evidence.mountedFileIds.length > 0 &&
    evidence.requestRefFileIds.length > 0 &&
    mountedRefIds.length > 0
  ) {
    return 'pass'
  }

  return 'fail'
}

function resolveModeAuditSignalDeliveryStatus(
  scenarios: DeepSeekChatModeAuditScenarioReport[],
): 'pass' | 'fail' | 'warn' {
  if (scenarios.length === 0) {
    return 'warn'
  }

  for (const scenario of scenarios) {
    for (const layer of [
      'request-payload',
      'generation-ready-sse',
      'canonical-generation-context',
      'history-messages-raw',
      'history-messages-mapped-session',
      'stored-session',
      'export-document',
    ] as const) {
      const observation = scenario.authoritySignals.find(candidate => candidate.layer === layer)
      if (!observation?.observed || observation.resolvedMode !== scenario.requestedMode) {
        return 'fail'
      }
    }
  }

  return 'pass'
}

function buildModeAuditFileEvidence(input: {
  replyRun: Awaited<ReturnType<typeof runDeepSeekReplyOnPage>>
  requestedFiles: string[]
}): DeepSeekChatModeAuditScenarioReport['fileEvidence'] {
  const uploadedFileIds =
    input.replyRun.fileUpload?.files
      .filter(file => file.uploaded && file.fileId)
      .map(file => file.fileId as string) ?? []
  const mountedFileIds =
    input.replyRun.fileUpload?.files
      .filter(file => file.mounted && file.fileId)
      .map(file => file.fileId as string) ?? []
  const requestRefFileIds = input.replyRun.generationObservations.flatMap(
    observation => observation.requestRefFileIds ?? [],
  )
  const requestedFiles =
    input.requestedFiles.length > 0
      ? input.requestedFiles
      : input.replyRun.fileUpload?.requestedPaths ?? []

  return {
    requestedFiles,
    uploadedFileIds: [...new Set(uploadedFileIds)].sort(),
    mountedFileIds: [...new Set(mountedFileIds)].sort(),
    requestRefFileIds: [...new Set(requestRefFileIds)].sort(),
    note:
      requestedFiles.length === 0
        ? 'No file was requested for this text-mode audit scenario.'
        : 'Vision/image audit scenario keeps local upload IDs and generation request ref_file_ids together as release evidence.',
  }
}
