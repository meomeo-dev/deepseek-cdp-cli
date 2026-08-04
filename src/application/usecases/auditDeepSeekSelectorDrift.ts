import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  resolveIsolatedManagedChromeOptions,
  withIsolatedManagedBrowserRuntime,
} from '../services/browserRuntimeIsolation.js'
import {
  buildDeepSeekSelectorAuditSessionTargets,
  cleanupRemainingSelectorAuditTargets,
  orderSelectorAuditCleanupEntries,
  planDeepSeekSelectorAuditTargets,
  recordUnavailableTargetCleanupEntries,
  withDeepSeekSelectorAuditFailureCleanup,
  type DeepSeekSelectorAuditSessionTarget,
  type DeepSeekSelectorAuditTargetPlan,
} from '../services/deepSeekSelectorAuditSessionLifecycle.js'
import { withBrowserPageLease } from '../services/withBrowserPageLease.js'
import { auditDeepSeekChatModes } from './auditDeepSeekChatModes.js'
import { captureDeepSeekReleaseFingerprintOnPage } from '../../infrastructure/deepseek/deepSeekReleaseFingerprint.js'
import { waitForStableDeepSeekMessageActionSnapshot } from '../../infrastructure/deepseek/deepSeekMessageActionControls.js'
import { deleteDeepSeekSessionOnPage } from '../../infrastructure/deepseek/deepSeekDeleteSessionFlow.js'
import { captureDeepSeekSidebarSessionAudit } from '../../infrastructure/deepseek/deepSeekSelectorDriftAudit.js'
import { waitForStableDeepSeekComposerSnapshot } from '../../infrastructure/deepseek/deepSeekComposerControls.js'
import { discoverDeepSeekOnlineSessionCatalogOnPage } from '../../infrastructure/deepseek/deepSeekOnlineSessionCatalog.js'
import { buildDeepSeekReleaseCompatibilityRecord } from '../../domain/regression/deepSeekReleaseFingerprint.js'
import type { ManagedChromeRuntimeHandle } from '../../domain/browser/managedChrome.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'
import type { DeepSeekChatModeAuditReport } from '../../types/deepseek-mode-audit.types.js'
import type { DeepSeekComposerSnapshot } from '../../types/deepseek-controls.types.js'
import type {
  AuditDeepSeekSelectorDriftInput,
  DeepSeekSelectorDriftAuditCheck,
  DeepSeekSelectorDriftAuditCheckStatus,
  DeepSeekSelectorDriftAuditReport,
  DeepSeekSelectorDriftCleanupEntry,
  DeepSeekSelectorDriftPrimarySessionAudit,
  DeepSeekSelectorDriftSearchRetryBaseline,
  DeepSeekSelectorDriftTargetResolution,
} from '../../types/deepseek-selector-drift-audit.types.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'

const DEFAULT_SEARCH_RETRY_FIXTURE_FILE =
  'test/fixtures/deepseek-search-ui-retry/search-ui-retry.parallel5.click.real.fixture.json'
const DELETE_ALLOW_OPTION = '--allow-destructive-delete-session'
const SELECTOR_TARGET_CATALOG_MAX_ATTEMPTS = 3
const SELECTOR_TARGET_CATALOG_RETRY_DELAY_MS = 750

export async function auditDeepSeekSelectorDrift(
  input: AuditDeepSeekSelectorDriftInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'selector-drift-audit' }),
): Promise<DeepSeekSelectorDriftAuditReport> {
  const cleanupEntriesBySessionId = new Map<string, DeepSeekSelectorDriftCleanupEntry>()

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
    const targets = buildDeepSeekSelectorAuditSessionTargets(modeAudit)

    return await withDeepSeekSelectorAuditFailureCleanup({
      targets,
      cleanupEntriesBySessionId,
      cleanup: target =>
        cleanupSecondaryAuditSession(
          input,
          target,
          logger.child(`failure-cleanup:${target.requestedMode}`),
        ),
      run: () =>
        runSelectorAuditAfterModeAudit({
          input,
          modeAudit,
          targets,
          cleanupEntriesBySessionId,
          logger,
        }),
    })
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

async function runSelectorAuditAfterModeAudit(input: {
  input: AuditDeepSeekSelectorDriftInput
  modeAudit: DeepSeekChatModeAuditReport
  targets: DeepSeekSelectorAuditSessionTarget[]
  cleanupEntriesBySessionId: Map<string, DeepSeekSelectorDriftCleanupEntry>
  logger: RuntimeLogger
}): Promise<DeepSeekSelectorDriftAuditReport> {
  const targetPlan = await resolveSelectorAuditTargetPlan(
    input.input,
    input.targets,
    input.logger.child('target-resolution'),
  )
  recordUnavailableTargetCleanupEntries(
    targetPlan,
    input.cleanupEntriesBySessionId,
  )

  const primaryResult = await auditFirstAvailablePrimarySession({
    input: input.input,
    targetPlan,
    logger: input.logger.child('primary-session'),
  })
  input.cleanupEntriesBySessionId.set(
    primaryResult.target.sessionId,
    primarySessionCleanupEntry(primaryResult.session),
  )

  await cleanupRemainingSelectorAuditTargets({
    targets: input.targets,
    cleanupEntriesBySessionId: input.cleanupEntriesBySessionId,
    cleanup: target =>
      cleanupSecondaryAuditSession(
        input.input,
        target,
        input.logger.child(`cleanup:${target.requestedMode}`),
      ),
  })

  const cleanupEntries = orderSelectorAuditCleanupEntries(
    input.targets,
    primaryResult.target,
    input.cleanupEntriesBySessionId,
  )
  const searchRetryBaseline = await readDeepSeekSearchRetryBaselineFixture(
    input.input.searchRetryFixtureFile,
  )
  const releaseFingerprints = dedupeReleaseFingerprints([
    ...input.modeAudit.releaseFingerprints,
    primaryResult.session.releaseFingerprint,
  ])
  const checks = buildDeepSeekSelectorDriftChecks({
    modeAudit: input.modeAudit,
    primarySession: primaryResult.session,
    searchRetryBaseline,
    cleanup: cleanupEntries,
  })
  const targetResolution: DeepSeekSelectorDriftTargetResolution = {
    ...targetPlan.resolution,
    selectedPrimaryMode: primaryResult.target.requestedMode,
  }

  const report: DeepSeekSelectorDriftAuditReport = {
    scenario: 'selector-drift-audit',
    capturedAt: new Date().toISOString(),
    requestedUrl: input.input.url,
    releaseFingerprints,
    compatibility: buildDeepSeekReleaseCompatibilityRecord({
      artifactKind: 'audit',
      releaseFingerprints,
      failureCount: countCheckStatus(checks, 'fail'),
      warningCount: countCheckStatus(checks, 'warn'),
    }),
    modeAudit: input.modeAudit,
    targetResolution,
    primarySession: primaryResult.session,
    searchRetryBaseline,
    cleanup: cleanupEntries,
    checks,
  }

  if (input.input.outputFile) {
    const outputFile = resolve(process.cwd(), input.input.outputFile)
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}

async function resolveSelectorAuditTargetPlan(
  input: AuditDeepSeekSelectorDriftInput,
  targets: DeepSeekSelectorAuditSessionTarget[],
  logger: RuntimeLogger,
): Promise<DeepSeekSelectorAuditTargetPlan> {
  return runIsolatedSelectorAuditStep(
    {
      chrome: input,
      operation: 'selector-drift-audit-target-resolution',
      logger,
    },
    async ({ runtime }) =>
      withBrowserPageLease(
        {
          runtime,
          timeoutMs: input.timeoutMs,
        },
        async ({ page, goto }) => {
          const catalogSessionIds = new Set<string>()
          const routeConfirmedSessionIds = new Set<string>()
          let catalogAttempts = 0
          let catalogPartial = false

          for (
            let attempt = 1;
            attempt <= SELECTOR_TARGET_CATALOG_MAX_ATTEMPTS;
            attempt += 1
          ) {
            catalogAttempts = attempt
            try {
              const catalog = await discoverDeepSeekOnlineSessionCatalogOnPage(
                page,
                {
                  requestedUrl: input.url,
                  timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
                  waitUntil: input.waitUntil,
                },
                logger.child(`catalog:${String(attempt)}`),
              )
              catalogPartial ||= catalog.partial
              for (const session of catalog.sessions) {
                catalogSessionIds.add(session.sessionId)
              }
            } catch (error) {
              logger.info('Selector target catalog attempt did not settle', {
                attempt,
                error: describeUnknownError(error),
              })
            }

            if (targets.every(target => catalogSessionIds.has(target.sessionId))) {
              break
            }
            if (attempt < SELECTOR_TARGET_CATALOG_MAX_ATTEMPTS) {
              await delay(SELECTOR_TARGET_CATALOG_RETRY_DELAY_MS)
            }
          }

          for (const target of targets) {
            if (catalogSessionIds.has(target.sessionId)) {
              continue
            }

            try {
              await goto(target.finalUrl, input.waitUntil)
              await page.waitForSelector('body', {
                timeout: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
              })
              const snapshot = await waitForStableDeepSeekComposerSnapshot(page, {
                timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
              })
              if (isExpectedSelectorAuditSession(snapshot, target)) {
                routeConfirmedSessionIds.add(target.sessionId)
              }
              logger.info('Probed selector audit seed session route', {
                requestedMode: target.requestedMode,
                expectedSessionId: target.sessionId,
                actualRouteKind: snapshot.routeKind,
                actualSessionId: snapshot.sessionId,
                pageUrl: snapshot.pageUrl,
              })
            } catch (error) {
              logger.info('Selector audit seed session route probe failed', {
                requestedMode: target.requestedMode,
                sessionId: target.sessionId,
                error: describeUnknownError(error),
              })
            }
          }

          return planDeepSeekSelectorAuditTargets({
            targets,
            catalogSessionIds,
            routeConfirmedSessionIds,
            catalogAttempts,
            catalogPartial,
          })
        },
      ),
  )
}

async function auditFirstAvailablePrimarySession(input: {
  input: AuditDeepSeekSelectorDriftInput
  targetPlan: DeepSeekSelectorAuditTargetPlan
  logger: RuntimeLogger
}): Promise<{
  target: DeepSeekSelectorAuditSessionTarget
  session: DeepSeekSelectorDriftPrimarySessionAudit
}> {
  let lastSessionEntryError: Error | null = null

  for (const target of input.targetPlan.availableTargets) {
    try {
      return {
        target,
        session: await auditPrimarySelectorSession(
          input.input,
          target,
          input.logger.child(target.requestedMode),
        ),
      }
    } catch (error) {
      if (!isSelectorAuditStageError(error, 'session-entry')) {
        throw error
      }

      lastSessionEntryError = error
      input.logger.info('Falling back after selector seed session route expired', {
        requestedMode: target.requestedMode,
        sessionId: target.sessionId,
        error: describeUnknownError(error),
      })
    }
  }

  if (lastSessionEntryError) {
    throw lastSessionEntryError
  }
  throw new Error('No available selector audit seed session could be selected.')
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
          logger.info('Primary selector audit navigating to target session', {
            sessionId: target.sessionId,
            finalUrl: target.finalUrl,
          })
          await goto(target.finalUrl, input.waitUntil)
          await page.waitForSelector('body', {
            timeout: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
          })

          await runSelectorAuditStage('session-entry', async () => {
            const snapshot = await waitForStableDeepSeekComposerSnapshot(page, {
              timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
            })
            assertExpectedSelectorAuditSession(snapshot, target)
          })

          logger.info('Primary selector audit capturing release fingerprint', {
            sessionId: target.sessionId,
          })
          const releaseFingerprint = await runSelectorAuditStage(
            'release-fingerprint',
            () =>
              captureDeepSeekReleaseFingerprintOnPage(page, {
                targetUrl: target.finalUrl,
                waitUntil: input.waitUntil,
                captureMessageActions: true,
                stableComposerTimeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
              }),
          )

          await runSelectorAuditStage('session-entry', async () => {
            const snapshot = await waitForStableDeepSeekComposerSnapshot(page, {
              timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
            })
            assertExpectedSelectorAuditSession(snapshot, target)
          })

          logger.info('Primary selector audit capturing message actions', {
            sessionId: target.sessionId,
          })
          const messageActions = await runSelectorAuditStage(
            'message-actions',
            () =>
              waitForStableDeepSeekMessageActionSnapshot(page, {
                timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
              }),
          )

          logger.info('Primary selector audit capturing sidebar selectors', {
            sessionId: target.sessionId,
          })
          const sidebar = await runSelectorAuditStage(
            'sidebar-selectors',
            () =>
              captureDeepSeekSidebarSessionAudit(page, {
                sessionId: target.sessionId,
                timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
              }),
          )

          let deleteSession = null
          try {
            logger.info('Primary selector audit deleting audited session', {
              sessionId: target.sessionId,
            })
            deleteSession = await runSelectorAuditStage(
              'primary-delete-session',
              () =>
                deleteDeepSeekSessionOnPage(
                  page,
                  {
                    requestedSessionId: target.sessionId,
                    authoritativeSessionId: target.sessionId,
                    finalUrl: target.finalUrl,
                    sessionFile: `memory://selector-drift-audit/${target.sessionId}.json`,
                    timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
                    actionLabel: buildDeleteActionLabel(target.sessionId),
                    allowOptionName: DELETE_ALLOW_OPTION,
                    confirmationText: buildDeleteConfirmationText(target.sessionId),
                  },
                  logger.child('delete-session'),
                ),
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
            logger.info('Secondary selector cleanup navigating to target session', {
              requestedMode: target.requestedMode,
              sessionId: target.sessionId,
              finalUrl: target.finalUrl,
            })
            await goto(target.finalUrl, input.waitUntil)
            await page.waitForSelector('body', {
              timeout: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
            })
            await deleteDeepSeekSessionOnPage(
              page,
              {
                requestedSessionId: target.sessionId,
                authoritativeSessionId: target.sessionId,
                finalUrl: target.finalUrl,
                sessionFile: `memory://selector-drift-audit/${target.sessionId}.json`,
                timeoutMs: resolveSelectorAuditStepTimeoutMs(input.timeoutMs),
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
  cleanup?: DeepSeekSelectorDriftCleanupEntry[] | undefined
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
      input.modeAudit.defaultHomeSurface.availableModes.includes('instant') &&
      input.modeAudit.defaultHomeSurface.availableModes.includes('expert') &&
      requiredModes.every(mode => modeScenarios.some(scenario => scenario.requestedMode === mode))
        ? 'pass'
        : 'fail',
    summary:
      'Default home exposes the text-mode selector and the audit proves Instant, Expert, and Vision scenarios.',
    notes: [
      `visible=${String(input.modeAudit.defaultHomeSurface.modeSelectorVisible)}`,
      `availableModes=${input.modeAudit.defaultHomeSurface.availableModes.join(',') || 'none'}`,
      `scenarioModes=${modeScenarios.map(scenario => scenario.requestedMode).join(',') || 'none'}`,
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

  if (input.cleanup) {
    const deleteFailures = input.cleanup.filter(
      entry => entry.status === 'delete-failed',
    )
    const skipped = input.cleanup.filter(entry => entry.status === 'skipped')
    checks.push({
      id: 'audit-session-cleanup',
      area: 'main-path-selector',
      status: deleteFailures.length > 0 ? 'fail' : skipped.length > 0 ? 'warn' : 'pass',
      summary:
        deleteFailures.length > 0
          ? 'At least one selector audit seed session could not be deleted.'
          : skipped.length > 0
            ? 'Unavailable selector audit seed sessions were skipped after catalog and route probes.'
            : 'All selector audit seed sessions were deleted.',
      notes: input.cleanup.map(
        entry =>
          `${entry.requestedMode}: sessionId=${entry.sessionId}, ` +
          `status=${entry.status}, error=${entry.errorMessage ?? 'none'}`,
      ),
    })
  }

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

async function runSelectorAuditStage<T>(
  stage: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new DeepSeekSelectorAuditStageError(stage, message, error)
  }
}

class DeepSeekSelectorAuditStageError extends Error {
  public readonly stage: string

  public constructor(stage: string, message: string, cause: unknown) {
    super(`DeepSeek selector drift audit failed at ${stage}: ${message}`, {
      cause,
    })
    this.name = 'DeepSeekSelectorAuditStageError'
    this.stage = stage
  }
}

function isSelectorAuditStageError(
  error: unknown,
  stage: string,
): error is DeepSeekSelectorAuditStageError {
  return error instanceof DeepSeekSelectorAuditStageError && error.stage === stage
}

function isExpectedSelectorAuditSession(
  snapshot: DeepSeekComposerSnapshot,
  target: DeepSeekSelectorAuditSessionTarget,
): boolean {
  return snapshot.routeKind === 'session' && snapshot.sessionId === target.sessionId
}

function assertExpectedSelectorAuditSession(
  snapshot: DeepSeekComposerSnapshot,
  target: DeepSeekSelectorAuditSessionTarget,
): void {
  if (isExpectedSelectorAuditSession(snapshot, target)) {
    return
  }

  throw new Error(
    `Expected session ${target.sessionId}, but the settled page resolved ` +
      `route=${snapshot.routeKind}, sessionId=${snapshot.sessionId ?? 'none'}, ` +
      `url=${snapshot.pageUrl}.`,
  )
}

function resolveSelectorAuditStepTimeoutMs(timeoutMs: number): number {
  return Math.max(5_000, Math.min(timeoutMs, 30_000))
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

function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRetriableIsolatedRuntimeBootstrapError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return /Failed to fetch browser webSocket URL/i.test(error.message)
}
