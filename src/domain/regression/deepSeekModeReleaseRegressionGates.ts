import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekChatModeAuditScenarioReport } from '../../types/deepseek-mode-audit.types.js'
import type {
  DeepSeekModeReleaseRegressionCheck,
  DeepSeekModeReleaseRegressionFailureClass,
  DeepSeekModeReleaseRegressionInput,
  DeepSeekModeReleaseRegressionReport,
} from '../../types/deepseek-mode-release-regression.types.js'

export function evaluateDeepSeekModeReleaseRegression(
  input: DeepSeekModeReleaseRegressionInput,
): DeepSeekModeReleaseRegressionReport {
  const instantScenario = findScenario(input, 'instant')
  const expertScenario = findScenario(input, 'expert')
  const visionScenario = findScenario(input, 'vision')
  const expertFileCapabilityFact = resolveExpertFileCapabilityFact(input, expertScenario)

  const checks: DeepSeekModeReleaseRegressionCheck[] = [
    createCheck({
      id: 'mode-audit-core-current-window',
      passed:
        input.modeAudit.defaultHomeSurface.activeMode === 'instant' &&
        hasModes(input.modeAudit.defaultHomeSurface.availableModes, ['instant', 'expert']) &&
        instantScenario !== null &&
        expertScenario !== null &&
        readAuthorityRawModelType(instantScenario, 'request-payload') === 'default' &&
        readAuthorityRawModelType(instantScenario, 'generation-ready-sse') === 'default' &&
        readAuthorityRawModelType(instantScenario, 'history-messages-raw') === 'default' &&
        readAuthorityRawModelType(expertScenario, 'request-payload') === 'expert' &&
        readAuthorityRawModelType(expertScenario, 'generation-ready-sse') === 'expert' &&
        readAuthorityRawModelType(expertScenario, 'history-messages-raw') === 'expert',
      failureClass: 'mode_surface_drift',
      passMessage:
        'Current mode-audit artifact still proves Instant/Expert mode facts through authoritative request/SSE/history signals.',
      failMessage:
        'Mode-audit drifted: current window no longer proves Instant/Expert through authoritative signals.',
      evidence: {
        compatibilityStatus: input.modeAudit.compatibility.status,
        defaultHomeMode: input.modeAudit.defaultHomeSurface.activeMode,
        availableModes: input.modeAudit.defaultHomeSurface.availableModes,
        instantRequestModelType:
          instantScenario && readAuthorityRawModelType(instantScenario, 'request-payload'),
        expertRequestModelType:
          expertScenario && readAuthorityRawModelType(expertScenario, 'request-payload'),
      },
    }),
    createCheck({
      id: 'mode-audit-vision-image-current-window',
      passed:
        input.modeAudit.defaultHomeSurface.activeMode === 'instant' &&
        hasModes(input.modeAudit.defaultHomeSurface.availableModes, ['instant', 'expert', 'vision']) &&
        visionScenario !== null &&
        hasRawModeSignals(visionScenario, 'vision') &&
        hasDeliveryModeFacts(visionScenario, 'vision') &&
        hasVisionImageFileEvidence(visionScenario),
      failureClass: 'mode_surface_drift',
      passMessage:
        'Current mode-audit artifact proves Vision as a first-class image scenario with model_type=vision and ref_file_ids evidence.',
      failMessage:
        'Mode-audit drifted: current window no longer proves Vision image mode through UI, request/SSE/history, delivery, and file evidence.',
      evidence: {
        compatibilityStatus: input.modeAudit.compatibility.status,
        availableModes: input.modeAudit.defaultHomeSurface.availableModes,
        visionRequestModelType:
          visionScenario && readAuthorityRawModelType(visionScenario, 'request-payload'),
        visionReadyModelType:
          visionScenario && readAuthorityRawModelType(visionScenario, 'generation-ready-sse'),
        visionHistoryModelType:
          visionScenario && readAuthorityRawModelType(visionScenario, 'history-messages-raw'),
        visionStoredMode:
          visionScenario?.deliverySurfaces.storedSessionModeFact?.resolvedMode ?? null,
        visionExportMode:
          visionScenario?.deliverySurfaces.exportDocumentModeFact?.resolvedMode ?? null,
        visionFileEvidence: visionScenario?.fileEvidence ?? null,
      },
    }),
    createCheck({
      id: 'instant-controls-default',
      passed:
        input.instantDefaultControls.routeKind === 'home' &&
        input.instantDefaultControls.composerInput.found &&
        input.instantDefaultControls.sendOrStopButton.state === 'send' &&
        input.instantDefaultControls.deepThinkToggle.state === 'on' &&
        input.instantDefaultControls.searchToggle.state === 'on' &&
        input.instantDefaultControls.fileButton.found,
      failureClass: 'composer_toggle_drift',
      passMessage:
        'Instant default controls still expose composer input, send, DeepThink/Search on, and a file button on home.',
      failMessage:
        'Instant default controls drifted: home surface no longer matches the expected default control set.',
      evidence: summarizeSnapshot(input.instantDefaultControls),
    }),
    createCheck({
      id: 'instant-controls-toggle-off',
      passed:
        input.instantTogglesOffControls.routeKind === 'home' &&
        input.instantTogglesOffControls.sendOrStopButton.state === 'send' &&
        input.instantTogglesOffControls.deepThinkToggle.state === 'off' &&
        input.instantTogglesOffControls.searchToggle.state === 'off' &&
        input.instantTogglesOffControls.fileButton.found,
      failureClass: 'composer_toggle_drift',
      passMessage:
        'Instant controls still settle to a stable toggle-off permutation while preserving send and file controls.',
      failMessage:
        'Instant toggle-off permutation drifted: DeepThink/Search no longer settle off as expected.',
      evidence: summarizeSnapshot(input.instantTogglesOffControls),
    }),
    createCheck({
      id: 'expert-controls-default',
      passed:
        input.expertDefaultControls.routeKind === 'home' &&
        input.expertDefaultControls.composerInput.found &&
        input.expertDefaultControls.sendOrStopButton.state === 'send' &&
        input.expertDefaultControls.deepThinkToggle.state === 'on' &&
        input.expertDefaultControls.searchToggle.state === 'on',
      failureClass: 'composer_toggle_drift',
      passMessage:
        'Expert default controls still expose composer input, send, and DeepThink/Search on at home.',
      failMessage:
        'Expert default controls drifted: home surface no longer exposes the expected send and toggle controls.',
      evidence: summarizeSnapshot(input.expertDefaultControls),
    }),
    createCheck({
      id: 'expert-controls-toggle-off',
      passed:
        input.expertTogglesOffControls.routeKind === 'home' &&
        input.expertTogglesOffControls.sendOrStopButton.state === 'send' &&
        input.expertTogglesOffControls.deepThinkToggle.state === 'off' &&
        input.expertTogglesOffControls.searchToggle.state === 'off',
      failureClass: 'composer_toggle_drift',
      passMessage:
        'Expert controls still settle to a stable toggle-off permutation without losing the send control.',
      failMessage:
        'Expert toggle-off permutation drifted: DeepThink/Search no longer settle off as expected.',
      evidence: summarizeSnapshot(input.expertTogglesOffControls),
    }),
    createCheck({
      id: 'expert-file-capability-delta',
      passed:
        expertFileCapabilityFact === 'confirmed-present' ||
        expertFileCapabilityFact === 'confirmed-missing',
      failureClass: 'capability_boundary_drift',
      passMessage:
        expertFileCapabilityFact === 'confirmed-missing'
          ? 'Expert file capability is confirmed-missing on the audited surfaces; current release evidence keeps Expert attachments temporarily disabled.'
          : 'Expert file capability is explicitly confirmed-present on the audited surfaces; attachment-aware Expert mode can be re-enabled.',
      failMessage:
        'Expert file capability is inconsistent or unresolved across the audited surfaces; the current release window cannot safely choose an Expert attachment contract.',
      evidence: {
        capabilityFact: expertFileCapabilityFact,
        homeFileInputFound: expertScenario?.homeSurface.fileInput.found ?? null,
        sessionFileInputFound: expertScenario?.sessionSurface.fileInput.found ?? null,
        reopenedFileInputFound: expertScenario?.reopenedSessionSurface.fileInput.found ?? null,
        expertDefaultFileButtonFound: input.expertDefaultControls.fileButton.found,
        expertToggleOffFileButtonFound: input.expertTogglesOffControls.fileButton.found,
      },
    }),
    createCheck({
      id: 'vision-controls-default',
      passed:
        input.visionDefaultControls.routeKind === 'home' &&
        input.visionDefaultControls.composerInput.found &&
        input.visionDefaultControls.sendOrStopButton.state === 'send' &&
        input.visionDefaultControls.fileButton.found,
      failureClass: 'composer_toggle_drift',
      passMessage:
        'Vision default controls still expose composer input, send, and a file affordance; Search may be hidden or unavailable in this mode.',
      failMessage:
        'Vision default controls drifted: image mode no longer exposes the expected composer/send/file surface.',
      evidence: summarizeSnapshot(input.visionDefaultControls),
    }),
    createStopCycleCheck(input.instantStopCycle),
    createStopCycleCheck(input.expertStopCycle),
  ]

  return {
    scenario: 'release-mode-controls',
    ok: checks.every(check => check.status === 'pass'),
    checks,
  }
}

function createStopCycleCheck(
  observation: DeepSeekModeReleaseRegressionInput['instantStopCycle'],
): DeepSeekModeReleaseRegressionCheck {
  return createCheck({
    id: `${observation.chatMode}-send-stop-send`,
    passed:
      observation.beforeSendSnapshot.sendOrStopButton.state === 'send' &&
      observation.beforeSendSnapshot.deepThinkToggle.state === 'on' &&
      observation.beforeSendSnapshot.searchToggle.state === 'on' &&
      observation.generationResponseObserved &&
      observation.stopModeObserved &&
      observation.stopClickIssued &&
      observation.liveSettlementStatus === 'stopped' &&
      observation.stopAcknowledged &&
      observation.afterStopSnapshot.sendOrStopButton.state === 'send' &&
      observation.targetStatus === 'resumable' &&
      observation.continueCommandAvailable,
    failureClass: 'composer_stop_cycle_drift',
    passMessage:
      `${capitalize(observation.chatMode)} still proves a real send->stop->send cycle and leaves a resumable target behind.`,
    failMessage:
      `${capitalize(observation.chatMode)} send->stop->send cycle drifted: live stop evidence or resumable recovery is missing.`,
    evidence: {
      sessionId: observation.sessionId,
      finalUrl: observation.finalUrl,
      beforeSend: summarizeSnapshot(observation.beforeSendSnapshot),
      afterStop: summarizeSnapshot(observation.afterStopSnapshot),
      generationResponseObserved: observation.generationResponseObserved,
      stopModeObserved: observation.stopModeObserved,
      stopClickIssued: observation.stopClickIssued,
      liveSettlementStatus: observation.liveSettlementStatus,
      liveSettlementSource: observation.liveSettlementSource,
      stopAcknowledged: observation.stopAcknowledged,
      targetStatus: observation.targetStatus,
      continueCommandAvailable: observation.continueCommandAvailable,
    },
  })
}

function findScenario(
  input: DeepSeekModeReleaseRegressionInput,
  requestedMode: DeepSeekChatMode,
): DeepSeekChatModeAuditScenarioReport | null {
  return input.modeAudit.scenarios.find(scenario => scenario.requestedMode === requestedMode) ?? null
}

function readAuthorityRawModelType(
  scenario: DeepSeekChatModeAuditScenarioReport,
  layer: 'request-payload' | 'generation-ready-sse' | 'history-messages-raw',
): string | null {
  return scenario.authoritySignals.find(signal => signal.layer === layer)?.rawModelType ?? null
}

function hasModes(availableModes: DeepSeekChatMode[], expectedModes: DeepSeekChatMode[]): boolean {
  return expectedModes.every(mode => availableModes.includes(mode))
}

function hasRawModeSignals(
  scenario: DeepSeekChatModeAuditScenarioReport,
  expectedRawModelType: string,
): boolean {
  return (
    readAuthorityRawModelType(scenario, 'request-payload') === expectedRawModelType &&
    readAuthorityRawModelType(scenario, 'generation-ready-sse') === expectedRawModelType &&
    readAuthorityRawModelType(scenario, 'history-messages-raw') === expectedRawModelType
  )
}

function hasDeliveryModeFacts(
  scenario: DeepSeekChatModeAuditScenarioReport,
  expectedMode: DeepSeekChatMode,
): boolean {
  return [
    scenario.deliverySurfaces.mappedSessionModeFact?.resolvedMode,
    scenario.deliverySurfaces.storedSessionModeFact?.resolvedMode,
    scenario.deliverySurfaces.exportDocumentModeFact?.resolvedMode,
  ].every(mode => mode === expectedMode)
}

function hasVisionImageFileEvidence(scenario: DeepSeekChatModeAuditScenarioReport): boolean {
  const evidence = scenario.fileEvidence
  if (!evidence) {
    return false
  }

  const mountedIds = new Set(evidence.mountedFileIds)
  const refIds = new Set(evidence.requestRefFileIds)
  return (
    evidence.requestedFiles.length > 0 &&
    evidence.uploadedFileIds.length > 0 &&
    mountedIds.size > 0 &&
    refIds.size > 0 &&
    [...mountedIds].some(fileId => refIds.has(fileId))
  )
}

function resolveExpertFileCapabilityFact(
  input: DeepSeekModeReleaseRegressionInput,
  scenario: DeepSeekChatModeAuditScenarioReport | null,
): 'confirmed-missing' | 'confirmed-present' | 'inconsistent' | 'unresolved' {
  if (!scenario) {
    return 'unresolved'
  }

  const fileInputObservations = [
    scenario.homeSurface.fileInput.found,
    scenario.sessionSurface.fileInput.found,
    scenario.reopenedSessionSurface.fileInput.found,
  ]
  const fileButtonObservations = [
    input.expertDefaultControls.fileButton.found,
    input.expertTogglesOffControls.fileButton.found,
  ]

  const fileInputPresentEverywhere = fileInputObservations.every(Boolean)
  const fileInputMissingEverywhere = fileInputObservations.every(value => value === false)
  const fileButtonMissingEverywhere = fileButtonObservations.every(value => value === false)

  if (fileInputPresentEverywhere) {
    return 'confirmed-present'
  }
  if (fileInputMissingEverywhere && fileButtonMissingEverywhere) {
    return 'confirmed-missing'
  }
  if (
    fileInputObservations.some(value => value === true) ||
    fileButtonObservations.some(value => value === true)
  ) {
    return 'inconsistent'
  }

  return 'unresolved'
}

function summarizeSnapshot(snapshot: DeepSeekModeReleaseRegressionInput['instantDefaultControls']) {
  return {
    routeKind: snapshot.routeKind,
    pageUrl: snapshot.pageUrl,
    composerInputFound: snapshot.composerInput.found,
    sendOrStopState: snapshot.sendOrStopButton.state ?? null,
    deepThinkState: snapshot.deepThinkToggle.state ?? null,
    searchState: snapshot.searchToggle.state ?? null,
    fileButtonFound: snapshot.fileButton.found,
  }
}

function createCheck(input: {
  id: string
  passed: boolean
  failureClass: Exclude<DeepSeekModeReleaseRegressionFailureClass, 'ok'>
  passMessage: string
  failMessage: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekModeReleaseRegressionCheck {
  return {
    id: input.id,
    status: input.passed ? 'pass' : 'fail',
    failureClass: input.passed ? 'ok' : input.failureClass,
    message: input.passed ? input.passMessage : input.failMessage,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}
