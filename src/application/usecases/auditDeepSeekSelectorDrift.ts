import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  resolveIsolatedManagedChromeOptions,
  withIsolatedManagedBrowserRuntime,
} from '../services/browserRuntimeIsolation.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'
import { auditDeepSeekChatModes } from './auditDeepSeekChatModes.js'
import { captureDeepSeekReleaseFingerprintOnPage } from '../../infrastructure/deepseek/deepSeekReleaseFingerprint.js'
import { waitForStableDeepSeekMessageActionSnapshot } from '../../infrastructure/deepseek/deepSeekMessageActionControls.js'
import { deleteDeepSeekSessionOnPage } from '../../infrastructure/deepseek/deepSeekDeleteSessionFlow.js'
import { captureDeepSeekSidebarSessionAudit } from '../../infrastructure/deepseek/deepSeekSelectorDriftAudit.js'
import { buildDeepSeekReleaseCompatibilityRecord } from '../../domain/regression/deepSeekReleaseFingerprint.js'
import type { ManagedChromeRuntimeHandle } from '../../domain/browser/managedChrome.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'
import type { DeepSeekChatModeAuditReport } from '../../types/deepseek-mode-audit.types.js'
import type {
  AuditDeepSeekSelectorDriftInput,
  DeepSeekSelectorDriftAuditCheck,
  DeepSeekSelectorDriftAuditCheckStatus,
  DeepSeekSelectorDriftAuditReport,
  DeepSeekSelectorDriftCleanupEntry,
  DeepSeekSelectorDriftPrimarySessionAudit,
  DeepSeekSelectorDriftSearchRetryBaseline,
} from '../../types/deepseek-selector-drift-audit.types.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'

const DEFAULT_SEARCH_RETRY_FIXTURE_FILE =
  'test/fixtures/deepseek-search-ui-retry/search-ui-retry.parallel5.click.real.fixture.json'
const DELETE_ALLOW_OPTION = '--allow-destructive-delete-session'

export async function auditDeepSeekSelectorDrift(
  input: AuditDeepSeekSelectorDriftInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'selector-drift-audit' }),
): Promise<DeepSeekSelectorDriftAuditReport> {
  try {
    const isolatedModeAuditChrome = await resolveIsolatedManagedChromeOptions({
      chrome: input,
      purpose: 'audit',
    })
    const modeAudit = await auditDeepSeekChatModes(
      {
        ...isolatedModeAuditChrome,
        url: input.url,
        waitUntil: input.waitUntil,
        instantPrompt: input.instantPrompt,
        expertPrompt: input.expertPrompt,
        visionPrompt: input.visionPrompt,
        visionFile: input.visionFile,
        outputFile: undefined,
      },
      logger.child('mode-audit'),
    )

    const expertScenario = requireModeAuditScenario(modeAudit, 'expert')
    const instantScenario = requireModeAuditScenario(modeAudit, 'instant')
    const visionScenario = requireModeAuditScenario(modeAudit, 'vision')
    const primarySession = await auditPrimarySelectorSession(
      input,
      {
        requestedMode: 'expert',
        finalUrl: expertScenario.finalUrl,
        sessionId: expertScenario.sessionId,
      },
      logger.child('primary-session'),
    )
    const instantCleanup = await cleanupSecondaryAuditSession(
      input,
      {
        requestedMode: 'instant',
        finalUrl: instantScenario.finalUrl,
        sessionId: instantScenario.sessionId,
      },
      logger.child('cleanup:instant'),
    )
    const visionCleanup = await cleanupSecondaryAuditSession(
      input,
      {
        requestedMode: 'vision',
        finalUrl: visionScenario.finalUrl,
        sessionId: visionScenario.sessionId,
      },
      logger.child('cleanup:vision'),
    )
    const searchRetryBaseline = await readDeepSeekSearchRetryBaselineFixture(
      input.searchRetryFixtureFile,
    )

    const releaseFingerprints = dedupeReleaseFingerprints([
      ...modeAudit.releaseFingerprints,
      primarySession.releaseFingerprint,
    ])
    const cleanupEntries = [
      primarySessionCleanupEntry(primarySession),
      instantCleanup,
      visionCleanup,
    ]
    const checks = buildDeepSeekSelectorDriftChecks({
      modeAudit,
      primarySession,
      searchRetryBaseline,
    })

    const report: DeepSeekSelectorDriftAuditReport = {
      scenario: 'selector-drift-audit',
      capturedAt: new Date().toISOString(),
      requestedUrl: input.url,
      releaseFingerprints,
      compatibility: buildDeepSeekReleaseCompatibilityRecord({
        artifactKind: 'audit',
        releaseFingerprints,
        failureCount: countCheckStatus(checks, 'fail'),
        warningCount: countCheckStatus(checks, 'warn'),
      }),
      modeAudit,
      primarySession,
      searchRetryBaseline,
      cleanup: cleanupEntries,
      checks,
    }

    if (input.outputFile) {
      const outputFile = resolve(process.cwd(), input.outputFile)
      await mkdir(dirname(outputFile), { recursive: true })
      await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }

    return report
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek selector drift audit failed',
      error,
      context: {
        url: input.url,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        outputFile: input.outputFile ?? null,
      },
    })
    throw error
  }
}

async function auditPrimarySelectorSession(
  input: AuditDeepSeekSelectorDriftInput,
  target: {
    requestedMode: DeepSeekChatMode
    finalUrl: string
    sessionId: string
  },
  logger: RuntimeLogger,
): Promise<DeepSeekSelectorDriftPrimarySessionAudit> {
  return runIsolatedSelectorAuditStep(
    {
      chrome: input,
      operation: 'selector-drift-audit',
      logger,
    },
    async ({ runtime }) =>
      withBrowserPageLease(
        {
          runtime,
          timeoutMs: input.timeoutMs,
        },
        async ({ page, goto }) => {
          await goto(target.finalUrl, input.waitUntil)
          await page.waitForSelector('body')

          const releaseFingerprint = await captureDeepSeekReleaseFingerprintOnPage(page, {
            targetUrl: target.finalUrl,
            waitUntil: input.waitUntil,
            captureMessageActions: true,
          })
          const messageActions = await waitForStableDeepSeekMessageActionSnapshot(page, {
            timeoutMs: input.timeoutMs,
          })
          const sidebar = await captureDeepSeekSidebarSessionAudit(page, {
            sessionId: target.sessionId,
            timeoutMs: input.timeoutMs,
          })

          let deleteSession = null
          try {
            deleteSession = await deleteDeepSeekSessionOnPage(
              page,
              {
                requestedSessionId: target.sessionId,
                authoritativeSessionId: target.sessionId,
                finalUrl: target.finalUrl,
                sessionFile: `memory://selector-drift-audit/${target.sessionId}.json`,
                timeoutMs: input.timeoutMs,
                actionLabel: buildDeleteActionLabel(target.sessionId),
                allowOptionName: DELETE_ALLOW_OPTION,
                confirmationText: buildDeleteConfirmationText(target.sessionId),
              },
              logger.child('delete-session'),
            ).then(result => result.capture)
          } catch (error) {
            logger.error('Primary selector drift delete cleanup failed', {
              sessionId: target.sessionId,
              error: error instanceof Error ? error.message : String(error),
            })
          }

          return {
            requestedMode: target.requestedMode,
            finalUrl: target.finalUrl,
            sessionId: target.sessionId,
            releaseFingerprint,
            messageActions,
            sidebar,
            deleteSession,
          }
        },
      ),
  )
}

async function cleanupSecondaryAuditSession(
  input: AuditDeepSeekSelectorDriftInput,
  target: {
    requestedMode: DeepSeekChatMode
    finalUrl: string
    sessionId: string
  },
  logger: RuntimeLogger,
): Promise<DeepSeekSelectorDriftCleanupEntry> {
  try {
    await runIsolatedSelectorAuditStep(
      {
        chrome: input,
        operation: 'selector-drift-audit-cleanup',
        logger,
      },
      async ({ runtime }) =>
        withBrowserPageLease(
          {
            runtime,
            timeoutMs: input.timeoutMs,
          },
          async ({ page, goto }) => {
            await goto(target.finalUrl, input.waitUntil)
            await page.waitForSelector('body')
            await deleteDeepSeekSessionOnPage(
              page,
              {
                requestedSessionId: target.sessionId,
                authoritativeSessionId: target.sessionId,
                finalUrl: target.finalUrl,
                sessionFile: `memory://selector-drift-audit/${target.sessionId}.json`,
                timeoutMs: input.timeoutMs,
                actionLabel: buildDeleteActionLabel(target.sessionId),
                allowOptionName: DELETE_ALLOW_OPTION,
                confirmationText: buildDeleteConfirmationText(target.sessionId),
              },
              logger.child('delete-session'),
            )
          },
        ),
    )

    return {
      requestedMode: target.requestedMode,
      sessionId: target.sessionId,
      finalUrl: target.finalUrl,
      status: 'deleted',
      errorMessage: null,
    }
  } catch (error) {
    return {
      requestedMode: target.requestedMode,
      sessionId: target.sessionId,
      finalUrl: target.finalUrl,
      status: 'delete-failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function readDeepSeekSearchRetryBaselineFixture(
  fixtureFile: string | undefined,
): Promise<DeepSeekSelectorDriftSearchRetryBaseline> {
  const resolvedFixture = resolve(process.cwd(), fixtureFile ?? DEFAULT_SEARCH_RETRY_FIXTURE_FILE)
  const raw = await readFile(resolvedFixture, 'utf8')
  const payload = JSON.parse(raw) as {
    generatedAt?: unknown
    summary?: {
      uiRetryObservedCount?: unknown
      uiRetryClickedCount?: unknown
    }
    matrix?: Array<{
      condition?: unknown
      status?: unknown
      notes?: unknown
    }>
    attempts?: Array<{
      targetMessageId?: unknown
      resolvedUiTargetMessageId?: unknown
      retryUiAction?: {
        controlKind?: unknown
      }
    }>
  }

  const searchRateLimitStatus = normalizeSearchRateLimitStatus(
    payload.matrix?.find(item => item.condition === 'search-rate-limit')?.status,
  )
  const firstAttempt = payload.attempts?.find(item => item.retryUiAction?.controlKind) ?? null
  const observedControlKind =
    firstAttempt?.retryUiAction?.controlKind === 'icon-button' ||
    firstAttempt?.retryUiAction?.controlKind === 'inline-button'
      ? firstAttempt.retryUiAction.controlKind
      : null
  const canonicalMessageIdDeltaObserved =
    typeof firstAttempt?.targetMessageId === 'string' &&
    typeof firstAttempt?.resolvedUiTargetMessageId === 'string' &&
    firstAttempt.targetMessageId !== firstAttempt.resolvedUiTargetMessageId

  return {
    source: 'fixture',
    fixtureFile: resolvedFixture,
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : null,
    currentWindowStatus: 'observation-pending',
    searchRateLimitStatus,
    uiRetryObservedCount: readNonNegativeNumber(payload.summary?.uiRetryObservedCount),
    uiRetryClickedCount: readNonNegativeNumber(payload.summary?.uiRetryClickedCount),
    observedControlKind,
    canonicalMessageIdDeltaObserved,
    notes: [
      'Current release window keeps search retry as fixture-backed selector baseline to avoid forcing new rate-limit samples.',
      ...(Array.isArray(payload.matrix)
        ? payload.matrix
            .filter(item => item.condition !== 'search-rate-limit')
            .flatMap(item => normalizeStringArray(item.notes))
        : []),
    ],
  }
}

export function buildDeepSeekSelectorDriftChecks(input: {
  modeAudit: DeepSeekChatModeAuditReport
  primarySession: DeepSeekSelectorDriftPrimarySessionAudit
  searchRetryBaseline: DeepSeekSelectorDriftSearchRetryBaseline
}): DeepSeekSelectorDriftAuditCheck[] {
  const checks: DeepSeekSelectorDriftAuditCheck[] = []
  const modeScenarios = input.modeAudit.scenarios
  const expertScenario = requireModeAuditScenario(input.modeAudit, 'expert')
  const requiredModes: DeepSeekChatMode[] = ['instant', 'expert', 'vision']

  checks.push({
    id: 'mode-surface-three-mode-radio',
    area: 'mode-surface',
    status:
      input.modeAudit.defaultHomeSurface.modeSelectorVisible &&
      requiredModes.every(mode => input.modeAudit.defaultHomeSurface.availableModes.includes(mode))
        ? 'pass'
        : 'fail',
    summary:
      'Default home mode selector exposes Instant, Expert, and Vision as the expected three-mode radio surface.',
    notes: [
      `visible=${String(input.modeAudit.defaultHomeSurface.modeSelectorVisible)}`,
      `availableModes=${input.modeAudit.defaultHomeSurface.availableModes.join(',') || 'none'}`,
    ],
  })

  checks.push({
    id: 'mode-surface-home-session-reopen',
    area: 'mode-surface',
    status:
      requiredModes.every(mode => modeScenarios.some(scenario => scenario.requestedMode === mode)) &&
      modeScenarios.every(
        scenario =>
          scenario.homeSurface.routeKind === 'home' &&
          scenario.sessionSurface.routeKind === 'session' &&
          scenario.reopenedSessionSurface.routeKind === 'session',
      )
        ? 'pass'
        : 'fail',
    summary: 'Captured home/session/reopen selector families for Instant, Expert, and Vision.',
    notes: modeScenarios.flatMap(scenario => [
      `${scenario.requestedMode}: home=${scenario.homeSurface.routeKind}, session=${scenario.sessionSurface.routeKind}, reopened=${scenario.reopenedSessionSurface.routeKind}`,
    ]),
  })

  const expertFileInputMissing = [
    expertScenario.homeSurface.fileInput.found,
    expertScenario.sessionSurface.fileInput.found,
    expertScenario.reopenedSessionSurface.fileInput.found,
  ].some(found => found !== true)
  checks.push({
    id: 'expert-real-file-input-current-fact',
    area: 'mode-surface',
    status: expertFileInputMissing ? 'warn' : 'pass',
    summary: expertFileInputMissing
      ? 'Expert currently lacks a real file input on at least one surface because DeepSeek is temporarily hiding Expert attachments.'
      : 'Expert keeps a real file input across home/session/reopened surfaces.',
    notes: [
      `home=${String(expertScenario.homeSurface.fileInput.found)}`,
      `session=${String(expertScenario.sessionSurface.fileInput.found)}`,
      `reopened=${String(expertScenario.reopenedSessionSurface.fileInput.found)}`,
    ],
  })

  const falsePositiveSurfaceNotes = [
    {
      label: 'home',
      fileButton: expertScenario.homeSurface.composerSnapshot.fileButton.found,
      fileInput: expertScenario.homeSurface.fileInput.found,
    },
    {
      label: 'session',
      fileButton: expertScenario.sessionSurface.composerSnapshot.fileButton.found,
      fileInput: expertScenario.sessionSurface.fileInput.found,
    },
    {
      label: 'reopened',
      fileButton: expertScenario.reopenedSessionSurface.composerSnapshot.fileButton.found,
      fileInput: expertScenario.reopenedSessionSurface.fileInput.found,
    },
  ]
  const falsePositiveDetected = falsePositiveSurfaceNotes.some(
    item => item.fileButton === true && item.fileInput !== true,
  )
  checks.push({
    id: 'expert-file-button-backed-by-real-input',
    area: 'mode-surface',
    status: falsePositiveDetected ? 'warn' : 'pass',
    summary: falsePositiveDetected
      ? 'Expert still shows a file affordance without a real input on at least one surface; Expert attachment flow remains temporarily disabled.'
      : 'Expert file affordance is backed by a real input instead of a send-icon false positive.',
    notes: falsePositiveSurfaceNotes.map(
      item => `${item.label}: fileButton=${String(item.fileButton)}, fileInput=${String(item.fileInput)}`,
    ),
  })

  const messageActionRoles = new Set(
    input.primarySession.messageActions.items
      .filter(item => item.actions.length > 0)
      .map(item => item.role),
  )
  const messageActionControlKinds = new Set(
    input.primarySession.messageActions.items.flatMap(item =>
      item.actions
        .map(action => action.controlKind)
        .filter(
          (controlKind): controlKind is 'icon-button' | 'inline-button' =>
            controlKind === 'icon-button' || controlKind === 'inline-button',
        ),
    ),
  )
  checks.push({
    id: 'message-action-selector-family',
    area: 'main-path-selector',
    status:
      input.primarySession.messageActions.items.length === 0
        ? 'fail'
        : messageActionControlKinds.size < 2 || messageActionRoles.size < 2
          ? 'warn'
          : 'pass',
    summary:
      input.primarySession.messageActions.items.length === 0
        ? 'No message action selector snapshot was captured on the audited session shell.'
        : messageActionControlKinds.size < 2 || messageActionRoles.size < 2
          ? 'Message action selector snapshot exists, but only a partial role/control-kind family was observed.'
          : 'Message action selector families cover both user/assistant roles and icon/inline controls.',
    notes: [
      `roles=${[...messageActionRoles].sort().join(',') || 'none'}`,
      `controlKinds=${[...messageActionControlKinds].sort().join(',') || 'none'}`,
    ],
  })

  const sidebarDeleteOptionObserved = input.primarySession.sidebar.menuOptions.some(
    option => ['delete', '删除'].includes(option.label?.toLowerCase() ?? ''),
  )
  checks.push({
    id: 'sidebar-hover-and-delete-secondary-path',
    area: 'main-path-selector',
    status:
      input.primarySession.sidebar.hoverControls.length > 0 &&
      input.primarySession.sidebar.overflowMenuObserved &&
      sidebarDeleteOptionObserved &&
      input.primarySession.sidebar.deleteDialogObserved &&
      input.primarySession.deleteSession !== null
        ? 'pass'
        : 'fail',
    summary:
      input.primarySession.deleteSession !== null
        ? 'Sidebar hover actions, overflow menu, delete dialog, and delete request path were all captured.'
        : 'Sidebar or delete-session selector path is incomplete on the current release window.',
    notes: [
      `hoverControls=${String(input.primarySession.sidebar.hoverControls.length)}`,
      `overflowMenuObserved=${String(input.primarySession.sidebar.overflowMenuObserved)}`,
      `deleteOptionObserved=${String(sidebarDeleteOptionObserved)}`,
      `deleteDialogObserved=${String(input.primarySession.sidebar.deleteDialogObserved)}`,
      `deleteRequestCaptured=${String(input.primarySession.deleteSession !== null)}`,
    ],
  })

  checks.push({
    id: 'search-retry-fixture-baseline',
    area: 'retry-path-selector',
    status:
      input.searchRetryBaseline.searchRateLimitStatus === 'observed' &&
      input.searchRetryBaseline.uiRetryObservedCount > 0
        ? 'warn'
        : 'fail',
    summary:
      input.searchRetryBaseline.searchRateLimitStatus === 'observed' &&
      input.searchRetryBaseline.uiRetryObservedCount > 0
        ? 'Search retry stays fixture-backed and observation-pending on the current release window.'
        : 'Search retry selector baseline is missing or incomplete.',
    notes: [
      `fixture=${input.searchRetryBaseline.fixtureFile}`,
      `currentWindowStatus=${input.searchRetryBaseline.currentWindowStatus}`,
      `uiRetryObservedCount=${String(input.searchRetryBaseline.uiRetryObservedCount)}`,
      `observedControlKind=${input.searchRetryBaseline.observedControlKind ?? 'none'}`,
      `canonicalMessageIdDeltaObserved=${String(input.searchRetryBaseline.canonicalMessageIdDeltaObserved)}`,
      ...input.searchRetryBaseline.notes,
    ],
  })

  return checks
}

function primarySessionCleanupEntry(
  primarySession: DeepSeekSelectorDriftPrimarySessionAudit,
): DeepSeekSelectorDriftCleanupEntry {
  return {
    requestedMode: primarySession.requestedMode,
    sessionId: primarySession.sessionId,
    finalUrl: primarySession.finalUrl,
    status: primarySession.deleteSession ? 'deleted' : 'delete-failed',
    errorMessage: primarySession.deleteSession ? null : 'Primary audited session was not deleted.',
  }
}

function requireModeAuditScenario(
  report: DeepSeekChatModeAuditReport,
  requestedMode: DeepSeekChatMode,
) {
  const scenario = report.scenarios.find(item => item.requestedMode === requestedMode)
  if (!scenario) {
    throw new Error(`Mode audit did not return the ${requestedMode} scenario.`)
  }
  return scenario
}

function dedupeReleaseFingerprints<T extends { compositeFingerprint: string }>(
  fingerprints: T[],
): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const fingerprint of fingerprints) {
    if (seen.has(fingerprint.compositeFingerprint)) {
      continue
    }
    seen.add(fingerprint.compositeFingerprint)
    deduped.push(fingerprint)
  }
  return deduped
}

async function runIsolatedSelectorAuditStep<T>(
  input: {
    chrome: AuditDeepSeekSelectorDriftInput
    operation: string
    logger: RuntimeLogger
  },
  run: (context: {
    runtime: ManagedChromeRuntimeHandle
    chrome: ManagedChromeOptions
  }) => Promise<T>,
): Promise<T> {
  const maxAttempts = 2
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withIsolatedManagedBrowserRuntime(
        {
          chrome: input.chrome,
          purpose: 'audit',
          operation: input.operation,
          logger: input.logger,
        },
        run,
      )
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetriableIsolatedRuntimeBootstrapError(error)) {
        throw error
      }

      input.logger.info('Retrying isolated selector audit runtime bootstrap after transient failure', {
        operation: input.operation,
        attempt,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function buildDeleteActionLabel(sessionId: string): string {
  return `delete DeepSeek session ${sessionId}`
}

function buildDeleteConfirmationText(sessionId: string): string {
  return `DELETE SESSION ${sessionId}`
}

function countCheckStatus(
  checks: DeepSeekSelectorDriftAuditCheck[],
  status: DeepSeekSelectorDriftAuditCheckStatus,
): number {
  return checks.filter(check => check.status === status).length
}

function normalizeSearchRateLimitStatus(
  value: unknown,
): DeepSeekSelectorDriftSearchRetryBaseline['searchRateLimitStatus'] {
  if (value === 'observed' || value === 'unresolved' || value === 'not-applicable') {
    return value
  }
  return 'unresolved'
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isRetriableIsolatedRuntimeBootstrapError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return /Failed to fetch browser webSocket URL/i.test(error.message)
}
