import { resolve } from 'node:path'
import type {
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from '../../types/deepseek-release-diff.types.js'
import type { DeepSeekReleaseBoundaryReport } from '../../types/deepseek-release-boundary.types.js'
import { resolveDeepSeekAuthoritativeCurrentWindow } from './deepSeekReleaseCurrentWindow.js'
import type { DeepSeekReleaseTriageReport } from '../../types/deepseek-release-triage.types.js'
import type {
  DeepSeekReleaseLayerProbeStatus,
  DeepSeekReleaseRevalidationReadiness,
  DeepSeekReleaseRevalidationRepairItem,
  DeepSeekReleaseRevalidationReport,
  DeepSeekReleaseRevalidationStage,
  DeepSeekReleaseRevalidationStageStatus,
  DeepSeekReleaseResidualBoundary,
  DeepSeekReleaseUnrevalidatedItem,
} from '../../types/deepseek-release-revalidation.types.js'

const FULL_RELEASE_SCENARIOS: DeepSeekReleaseComparableScenario[] = [
  'release-core',
  'mode-audit',
  'release-search-and-fact-check',
  'release-message-actions',
  'release-browser-runtime-governance',
]

const REVALIDATION_SCENARIO_TASK_IDS: Partial<
  Record<DeepSeekReleaseComparableScenario, string>
> = {
  'release-core': 'B66',
  'mode-audit': 'B66B',
  'release-search-and-fact-check': 'B66A',
  'release-message-actions': 'B67',
  'release-browser-runtime-governance': 'B67A',
}

const DOC_TRACKED_PATHS = [
  'README.md',
  'tasks/TSK-V10_deepseek_chat_cdp_cli_bootstrap_PLAN.md',
  'tasks/TSK-V10_deepseek_release_upgrade_SOP.md',
]

const LAYER_BOUNDARY_MAP = {
  ui: 'ui-adapter',
  api: 'api-contract',
  output: 'output-adapter',
} as const

export function buildDeepSeekReleaseRevalidationReport(input: {
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  repairNotes?: string[] | undefined
  docsUpdated?: boolean | undefined
}): DeepSeekReleaseRevalidationReport {
  const authoritativeCurrentWindow = resolveAuthoritativeReleaseWindow(input.triageReport)
  const currentWindowFingerprint = authoritativeCurrentWindow.primaryFingerprint
  const currentEvidence = input.triageReport.evidence.currentArtifacts.filter(
    artifact =>
      currentWindowFingerprint !== null &&
      artifact.primaryWindowFingerprint === currentWindowFingerprint,
  )
  const affectedScenarios = collectAffectedScenarios(input.triageReport)
  const layerProbeStatus = buildLayerProbeStatus(input.diffReport, input.boundaryReport, input.triageReport)
  const repairItems = buildRepairItems(
    input.diffReport,
    input.triageReport,
    affectedScenarios,
    input.repairNotes ?? [],
  )
  const residualBoundaries = buildResidualBoundaries(input.boundaryReport)
  const unrevalidatedItems = buildUnrevalidatedItems(
    input.diffReport,
    input.boundaryReport,
    input.triageReport,
    Boolean(input.docsUpdated),
    currentEvidence,
  )
  const stages = buildStages({
    diffReport: input.diffReport,
    boundaryReport: input.boundaryReport,
    triageReport: input.triageReport,
    affectedScenarios,
    layerProbeStatus,
    docsUpdated: Boolean(input.docsUpdated),
    currentEvidence,
  })
  const readiness = resolveReadiness(stages)

  return {
    generatedAt: new Date().toISOString(),
    readiness,
    authoritativeCurrentWindow,
    releaseWindow: {
      fingerprintStatus: input.diffReport.fingerprintSummary.status,
      oldCompositeFingerprints: input.diffReport.fingerprintSummary.baselineCompositeFingerprints,
      newCompositeFingerprints: input.diffReport.fingerprintSummary.currentCompositeFingerprints,
      oldArtifactPaths: collectArtifactPaths(input.triageReport.evidence.baselineArtifacts),
      newArtifactPaths: collectArtifactPaths(currentEvidence),
    },
    impact: {
      disposition: input.triageReport.disposition,
      repairLane: input.triageReport.repairLane,
      impactedLayers: input.triageReport.impactedLayers,
      affectedScenarios,
      blockingItemIds: input.triageReport.blockingList.map(item => item.id),
    },
    waveReadiness: {
      wave21EntryAllowed:
        getStageStatus(stages, 'layer-specific-probes') === 'completed' &&
        getStageStatus(stages, 'targeted-gate') === 'completed',
      wave22AuditAllowed:
        getStageStatus(stages, 'full-release-regression') === 'completed' &&
        getStageStatus(stages, 'docs-spec-update') === 'completed',
    },
    layerProbeStatus,
    repairItems,
    residualBoundaries,
    unrevalidatedItems,
    stages,
    diffReport: input.diffReport,
    boundaryReport: input.boundaryReport,
    triageReport: input.triageReport,
  }
}

function resolveAuthoritativeReleaseWindow(
  triageReport: DeepSeekReleaseTriageReport,
) {
  return resolveDeepSeekAuthoritativeCurrentWindow({
    selectedFingerprintStatus: triageReport.diffReport.fingerprintSummary.status,
    supportEntries: triageReport.evidence.currentArtifacts
      .filter(artifact => artifact.primaryWindowFingerprint !== null)
      .map(artifact => ({
        taskId: REVALIDATION_SCENARIO_TASK_IDS[artifact.scenario] ?? null,
        scenario: artifact.scenario,
        kind: 'gate' as const,
        artifactPath: artifact.path,
        generatedAt: artifact.generatedAt,
        primaryWindowFingerprint: artifact.primaryWindowFingerprint as string,
        primaryReleaseFamilyFingerprint: artifact.primaryFingerprint,
      })),
  })
}

function buildLayerProbeStatus(
  diffReport: DeepSeekReleaseDiffReport,
  boundaryReport: DeepSeekReleaseBoundaryReport,
  triageReport: DeepSeekReleaseTriageReport,
): DeepSeekReleaseLayerProbeStatus[] {
  const statuses: DeepSeekReleaseLayerProbeStatus[] = []
  for (const layer of ['ui', 'api', 'output', 'runtime'] as const) {
    if (!triageReport.impactedLayers.includes(layer)) {
      statuses.push({
        layer,
        status: 'not-required',
        reason: `${layer} is not part of the currently impacted release layers.`,
        artifactPaths: [],
      })
      continue
    }

    if (layer === 'runtime') {
      statuses.push(buildRuntimeLayerProbeStatus(diffReport))
      continue
    }

    const boundary = boundaryReport.adapterBoundaries.find(
      candidate => candidate.boundaryId === LAYER_BOUNDARY_MAP[layer],
    )
    if (!boundary) {
      statuses.push({
        layer,
        status: 'pending',
        reason: `No adapter boundary report was produced for ${layer}.`,
        artifactPaths: [],
      })
      continue
    }

    if (boundary.status === 'verified' || boundary.status === 'adapted') {
      statuses.push({
        layer,
        status: 'completed',
        reason:
          boundary.status === 'verified'
            ? `${boundary.label} has already been verified against the selected release evidence.`
            : `${boundary.label} is adapted on the current fingerprint window and ready to feed the targeted gate.`,
        artifactPaths: boundary.currentArtifactPaths,
      })
      continue
    }

    if (boundary.status === 'drifted') {
      statuses.push({
        layer,
        status: 'blocked',
        reason: boundary.reasons[0] ?? `${boundary.label} still drifts against the current release window.`,
        artifactPaths: boundary.currentArtifactPaths,
      })
      continue
    }

    statuses.push({
      layer,
      status: 'pending',
      reason:
        boundary.reasons[0] ??
        `${boundary.label} still lacks the evidence needed to claim layer-specific revalidation.`,
      artifactPaths: boundary.currentArtifactPaths,
    })
  }

  return statuses
}

function buildRuntimeLayerProbeStatus(
  diffReport: DeepSeekReleaseDiffReport,
): DeepSeekReleaseLayerProbeStatus {
  const runtimeCapabilities = diffReport.capabilityMatrix.capabilities.filter(
    capability => capability.area === 'runtime' && capability.currentArtifactPath !== null,
  )
  const artifactPaths = [...new Set(runtimeCapabilities.flatMap(capability => capability.currentArtifactPath ?? []))]
    .sort()

  if (runtimeCapabilities.length === 0) {
    return {
      layer: 'runtime',
      status: 'pending',
      reason: 'No current runtime-focused evidence artifact has been rerun for this release window.',
      artifactPaths,
    }
  }

  if (runtimeCapabilities.some(capability => capability.status === 'fail')) {
    return {
      layer: 'runtime',
      status: 'blocked',
      reason: 'At least one runtime capability still fails in the selected current evidence window.',
      artifactPaths,
    }
  }

  if (
    runtimeCapabilities.some(
      capability => capability.status === 'unknown' || capability.status === 'not-yet-rechecked',
    )
  ) {
    return {
      layer: 'runtime',
      status: 'pending',
      reason: 'Runtime evidence exists, but one or more runtime capabilities remain unknown or not yet rechecked.',
      artifactPaths,
    }
  }

  return {
    layer: 'runtime',
    status: 'completed',
    reason: 'Runtime-focused checks are green in the selected current evidence window.',
    artifactPaths,
  }
}

function buildRepairItems(
  diffReport: DeepSeekReleaseDiffReport,
  triageReport: DeepSeekReleaseTriageReport,
  affectedScenarios: DeepSeekReleaseComparableScenario[],
  repairNotes: string[],
): DeepSeekReleaseRevalidationRepairItem[] {
  const items: DeepSeekReleaseRevalidationRepairItem[] = []

  const derivedLayers = [...new Set(
    triageReport.blockingList.flatMap(item => mapBlockingItemToLayers(item, diffReport)),
  )].sort()
  items.push({
    id: `lane:${triageReport.repairLane}`,
    source: 'derived',
    lane: triageReport.repairLane,
    label: `Primary repair lane: ${triageReport.repairLane}`,
    relatedLayers: derivedLayers,
    relatedScenarios: affectedScenarios,
    note:
      triageReport.notes[0] ??
      `Follow the ${triageReport.repairLane} lane before promoting this DeepSeek release window.`,
  })

  for (const item of triageReport.blockingList.filter(
    candidate => candidate.severity === 'blocking' || candidate.severity === 'warning',
  )) {
    items.push({
      id: `blocking:${item.id}`,
      source: 'derived',
      lane: triageReport.repairLane,
      label: item.label,
      relatedLayers: mapBlockingItemToLayers(item, diffReport),
      relatedScenarios: [item.scenario],
      note: item.reason,
    })
  }

  for (const [index, note] of repairNotes.entries()) {
    items.push({
      id: `manual-note:${index + 1}`,
      source: 'manual-note',
      lane: triageReport.repairLane,
      label: `Manual repair note ${index + 1}`,
      relatedLayers: derivedLayers,
      relatedScenarios: affectedScenarios,
      note,
    })
  }

  return items
}

function buildResidualBoundaries(
  boundaryReport: DeepSeekReleaseBoundaryReport,
): DeepSeekReleaseResidualBoundary[] {
  const residuals: DeepSeekReleaseResidualBoundary[] = []

  for (const boundary of boundaryReport.adapterBoundaries) {
    if (boundary.status === 'verified' || boundary.status === 'adapted') {
      continue
    }
    residuals.push({
      boundaryId: boundary.boundaryId,
      label: boundary.label,
      status: boundary.status,
      reasons: boundary.reasons,
    })
  }

  if (boundaryReport.integration.status !== 'verified') {
    residuals.push({
      boundaryId: boundaryReport.integration.boundaryId,
      label: boundaryReport.integration.label,
      status: boundaryReport.integration.status,
      reasons: boundaryReport.integration.reasons,
    })
  }

  return residuals
}

function buildUnrevalidatedItems(
  diffReport: DeepSeekReleaseDiffReport,
  boundaryReport: DeepSeekReleaseBoundaryReport,
  triageReport: DeepSeekReleaseTriageReport,
  docsUpdated: boolean,
  currentEvidence: DeepSeekReleaseTriageReport['evidence']['currentArtifacts'],
): DeepSeekReleaseUnrevalidatedItem[] {
  const items: DeepSeekReleaseUnrevalidatedItem[] = []

  for (const capability of diffReport.capabilityMatrix.capabilities) {
    if (capability.status !== 'unknown' && capability.status !== 'not-yet-rechecked') {
      continue
    }
    items.push({
      id: `capability:${capability.capabilityId}`,
      type: 'capability',
      label: capability.label,
      scenario: capability.scenario,
      status: capability.status,
      reason: capability.notes[0] ?? `Capability remains ${capability.status}.`,
    })
  }

  const currentScenarios = new Set(
    currentEvidence.map(artifact => artifact.scenario),
  )
  for (const scenario of FULL_RELEASE_SCENARIOS) {
    if (currentScenarios.has(scenario)) {
      continue
    }
    items.push({
      id: `scenario:${scenario}`,
      type: 'scenario',
      label: `Missing current full-release artifact for ${scenario}`,
      scenario,
      status: 'not-yet-rechecked',
      reason: 'This required release regression scenario has not yet been rerun on the current DeepSeek fingerprint window.',
    })
  }

  if (boundaryReport.integration.status !== 'verified') {
    items.push({
      id: 'boundary:integration',
      type: 'boundary',
      label: boundaryReport.integration.label,
      status: boundaryReport.integration.status,
      reason:
        boundaryReport.integration.reasons[0] ??
        'Cross-layer integration is still pending a full release rerun.',
    })
  }

  if (!docsUpdated && triageReport.probableReleaseChange) {
    items.push({
      id: 'docs:update',
      type: 'docs',
      label: 'README / plan / SOP update',
      status: 'pending',
      reason: 'Release-specific docs/spec updates have not yet been marked complete for this fingerprint window.',
    })
  }

  return items
}

function buildStages(input: {
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  affectedScenarios: DeepSeekReleaseComparableScenario[]
  layerProbeStatus: DeepSeekReleaseLayerProbeStatus[]
  docsUpdated: boolean
  currentEvidence: DeepSeekReleaseTriageReport['evidence']['currentArtifacts']
}): DeepSeekReleaseRevalidationStage[] {
  const currentArtifactPaths = collectArtifactPaths(input.currentEvidence)
  const baselineArtifactPaths = collectArtifactPaths(input.triageReport.evidence.baselineArtifacts)
  const artifactRootDir = input.triageReport.evidence.recommendedArtifactRootDir

  const fingerprintStage = buildStage(
    'fingerprint-change-confirmed',
    'Confirm Old/New Fingerprints',
    resolveFingerprintStageStatus(input.diffReport),
    input.diffReport.fingerprintSummary.status === 'same'
      ? 'The selected old/new evidence window is explicit and currently resolves to the same composite fingerprint.'
      : input.diffReport.fingerprintSummary.status === 'changed'
        ? 'The selected old/new evidence window resolves to distinct composite fingerprints.'
        : input.diffReport.fingerprintSummary.status === 'mixed'
          ? 'The selected evidence window resolves to multiple composite fingerprints, so the release window is mixed and needs extra care.'
          : 'The selected evidence window still lacks a complete old/new fingerprint pair.',
    [
      buildReleaseReportCommand('release-diff', artifactRootDir, input.triageReport),
      buildReleaseReportCommand('release-boundaries', artifactRootDir, input.triageReport),
      buildReleaseReportCommand('release-triage', artifactRootDir, input.triageReport),
    ],
    [...baselineArtifactPaths, ...currentArtifactPaths],
  )

  const diffStage = buildStage(
    'diff-report',
    'Freeze Diff And Impact Report',
    input.diffReport.artifactPairs.length === 0 ? 'blocked' : 'completed',
    input.diffReport.artifactPairs.length === 0
      ? 'No comparable release artifacts were selected, so the diff report cannot anchor this revalidation window.'
      : 'Layer diff, capability matrix, boundary split, and triage report have all been frozen for this release window.',
    [
      buildReleaseReportCommand('release-diff', artifactRootDir, input.triageReport),
      buildReleaseReportCommand('release-boundaries', artifactRootDir, input.triageReport),
      buildReleaseReportCommand('release-triage', artifactRootDir, input.triageReport),
    ],
    [...baselineArtifactPaths, ...currentArtifactPaths],
  )

  const layerSpecificStageStatus = resolveLayerStageStatus(
    input.triageReport.probableReleaseChange,
    input.layerProbeStatus,
  )
  const layerSpecificStage = buildStage(
    'layer-specific-probes',
    'Pass Layer-Specific Probes',
    layerSpecificStageStatus,
    describeLayerSpecificStage(layerSpecificStageStatus, input.layerProbeStatus),
    collectCommandsByPhase(input.triageReport, 'minimal-probe'),
    collectLayerArtifactPaths(input.layerProbeStatus),
  )

  const targetedGateStage = buildTargetedGateStage(
    input.diffReport,
    input.triageReport,
    input.affectedScenarios,
    input.currentEvidence,
  )

  const fullReleaseStage = buildFullReleaseStage(
    input.diffReport,
    input.boundaryReport,
    input.triageReport,
    input.currentEvidence,
  )

  const docsStage = buildStage(
    'docs-spec-update',
    'Update Docs / Spec / Ledger',
    !input.triageReport.probableReleaseChange
      ? 'not-required'
      : fullReleaseStage.status !== 'completed'
        ? 'pending'
        : input.docsUpdated
          ? 'completed'
          : 'pending',
    !input.triageReport.probableReleaseChange
      ? 'No probable DeepSeek release change is currently flagged, so release-specific doc updates are not required.'
      : fullReleaseStage.status !== 'completed'
        ? 'Full release regression is not complete yet, so docs/spec updates cannot be promoted to complete.'
        : input.docsUpdated
          ? 'Docs/spec/ops updates have been explicitly marked complete for this release window.'
          : 'Docs/spec/ops updates are still pending for this release window.',
    [],
    DOC_TRACKED_PATHS.map(path => resolve(process.cwd(), path)),
  )

  return [
    fingerprintStage,
    diffStage,
    layerSpecificStage,
    targetedGateStage,
    fullReleaseStage,
    docsStage,
  ]
}

function buildTargetedGateStage(
  diffReport: DeepSeekReleaseDiffReport,
  triageReport: DeepSeekReleaseTriageReport,
  affectedScenarios: DeepSeekReleaseComparableScenario[],
  currentEvidence: DeepSeekReleaseTriageReport['evidence']['currentArtifacts'],
): DeepSeekReleaseRevalidationStage {
  const targetedScenarios = [...new Set(affectedScenarios)].sort()
  const currentScenarioSet = new Set(
    currentEvidence.map(artifact => artifact.scenario),
  )
  const missingScenarios = targetedScenarios.filter(scenario => !currentScenarioSet.has(scenario))
  const targetedCapabilities = diffReport.capabilityMatrix.capabilities.filter(capability =>
    targetedScenarios.includes(capability.scenario),
  )
  const targetedArtifactPaths = currentEvidence
    .filter(artifact => targetedScenarios.includes(artifact.scenario))
    .map(artifact => artifact.path)

  let status: DeepSeekReleaseRevalidationStageStatus
  let rationale: string
  if (!triageReport.probableReleaseChange) {
    status = 'not-required'
    rationale = 'No probable release change is currently flagged, so a targeted release gate is not required.'
  } else if (targetedScenarios.length === 0) {
    status = 'pending'
    rationale = 'The current release window has no explicit affected scenario list yet, so the targeted gate cannot be considered complete.'
  } else if (targetedCapabilities.some(capability => capability.status === 'fail')) {
    status = 'blocked'
    rationale = 'At least one affected scenario still fails its targeted current-release capability checks.'
  } else if (
    missingScenarios.length > 0 ||
    targetedCapabilities.some(
      capability => capability.status === 'unknown' || capability.status === 'not-yet-rechecked',
    )
  ) {
    status = 'pending'
    rationale =
      missingScenarios.length > 0
        ? `The targeted gate still misses current artifacts for: ${missingScenarios.join(', ')}.`
        : 'The targeted gate has current artifacts, but one or more affected capabilities remain unknown or not yet rechecked.'
  } else {
    status = 'completed'
    rationale = 'All affected scenarios are green in the current release window, so the targeted gate is complete.'
  }

  return buildStage(
    'targeted-gate',
    'Pass Targeted Gate',
    status,
    rationale,
    collectCommandsByPhase(triageReport, 'targeted-regression'),
    targetedArtifactPaths,
  )
}

function buildFullReleaseStage(
  diffReport: DeepSeekReleaseDiffReport,
  boundaryReport: DeepSeekReleaseBoundaryReport,
  triageReport: DeepSeekReleaseTriageReport,
  currentEvidence: DeepSeekReleaseTriageReport['evidence']['currentArtifacts'],
): DeepSeekReleaseRevalidationStage {
  const currentScenarioSet = new Set(
    currentEvidence.map(artifact => artifact.scenario),
  )
  const missingScenarios = FULL_RELEASE_SCENARIOS.filter(
    scenario => !currentScenarioSet.has(scenario),
  )
  const fullReleaseCapabilities = diffReport.capabilityMatrix.capabilities.filter(capability =>
    FULL_RELEASE_SCENARIOS.includes(capability.scenario),
  )
  const fullReleaseArtifactPaths = currentEvidence
    .filter(artifact => FULL_RELEASE_SCENARIOS.includes(artifact.scenario))
    .map(artifact => artifact.path)
  const driftedAdapterBoundaries = boundaryReport.adapterBoundaries.filter(
    boundary => boundary.status === 'drifted',
  )

  let status: DeepSeekReleaseRevalidationStageStatus
  let rationale: string
  if (!triageReport.probableReleaseChange) {
    status = 'not-required'
    rationale = 'No probable release change is currently flagged, so a full release regression rerun is not required.'
  } else if (boundaryReport.integration.status === 'verified') {
    status = 'completed'
    rationale = 'The full release surface is green and the integration boundary has been revalidated together.'
  } else if (
    fullReleaseCapabilities.some(capability => capability.status === 'fail') ||
    driftedAdapterBoundaries.length > 0
  ) {
    status = 'blocked'
    rationale =
      driftedAdapterBoundaries.length > 0
        ? `The full release surface is still blocked by drifted adapter boundaries: ${driftedAdapterBoundaries.map(boundary => boundary.boundaryId).join(', ')}.`
        : 'At least one full-release capability still fails in the current evidence window.'
  } else if (
    missingScenarios.length > 0 ||
    fullReleaseCapabilities.some(
      capability => capability.status === 'unknown' || capability.status === 'not-yet-rechecked',
    )
  ) {
    status = 'pending'
    rationale =
      missingScenarios.length > 0
        ? `The full release rerun still misses current artifacts for: ${missingScenarios.join(', ')}.`
        : 'The full release surface has been rerun only partially; at least one capability remains unknown or not yet rechecked.'
  } else {
    status = 'pending'
    rationale =
      boundaryReport.integration.reasons[0] ??
      'The full release surface is close to green, but the integration boundary is not verified yet.'
  }

  return buildStage(
    'full-release-regression',
    'Pass Full Release Regression',
    status,
    rationale,
    collectCommandsByPhase(triageReport, 'full-regression'),
    fullReleaseArtifactPaths,
  )
}

function resolveReadiness(
  stages: DeepSeekReleaseRevalidationStage[],
): DeepSeekReleaseRevalidationReadiness {
  const fingerprintStage = getStageStatus(stages, 'fingerprint-change-confirmed')
  const layerStage = getStageStatus(stages, 'layer-specific-probes')
  const targetedStage = getStageStatus(stages, 'targeted-gate')
  const fullStage = getStageStatus(stages, 'full-release-regression')
  const docsStage = getStageStatus(stages, 'docs-spec-update')

  if (
    fingerprintStage === 'blocked' ||
    fingerprintStage === 'pending' ||
    getStageStatus(stages, 'diff-report') === 'blocked'
  ) {
    return 'observation-pending'
  }

  if (layerStage === 'blocked' || targetedStage === 'blocked' || fullStage === 'blocked') {
    return 'blocked'
  }

  if (docsStage === 'completed') {
    return 'completed'
  }

  if (fullStage === 'completed') {
    return 'ready-for-wave22'
  }

  if (layerStage === 'completed' && targetedStage === 'completed') {
    return 'ready-for-wave21'
  }

  return 'observation-pending'
}

function collectAffectedScenarios(
  triageReport: DeepSeekReleaseTriageReport,
): DeepSeekReleaseComparableScenario[] {
  return [...new Set(
    triageReport.blockingList
      .filter(item => item.currentArtifactPath !== null)
      .map(item => item.scenario),
  )].sort()
}

function mapBlockingItemToLayers(
  item: DeepSeekReleaseTriageReport['blockingList'][number],
  diffReport: DeepSeekReleaseDiffReport,
): Array<'ui' | 'api' | 'output' | 'runtime'> {
  if (item.layer === 'ui' || item.layer === 'api' || item.layer === 'output' || item.layer === 'runtime') {
    return [item.layer]
  }
  if (!item.capabilityId) {
    return []
  }
  const capability = diffReport.capabilityMatrix.capabilities.find(
    candidate => candidate.capabilityId === item.capabilityId,
  )
  if (!capability) {
    return []
  }
  if (capability.area === 'runtime') {
    return ['runtime']
  }
  if (capability.area === 'mode') {
    return ['ui']
  }
  if (capability.area === 'output' || capability.area === 'export') {
    return ['output']
  }
  return []
}

function resolveLayerStageStatus(
  probableReleaseChange: boolean,
  layerProbeStatus: DeepSeekReleaseLayerProbeStatus[],
): DeepSeekReleaseRevalidationStageStatus {
  if (!probableReleaseChange) {
    return 'not-required'
  }

  const requiredLayers = layerProbeStatus.filter(layer => layer.status !== 'not-required')
  if (requiredLayers.some(layer => layer.status === 'blocked')) {
    return 'blocked'
  }
  if (requiredLayers.some(layer => layer.status === 'pending') || requiredLayers.length === 0) {
    return 'pending'
  }
  return 'completed'
}

function describeLayerSpecificStage(
  status: DeepSeekReleaseRevalidationStageStatus,
  layerProbeStatus: DeepSeekReleaseLayerProbeStatus[],
): string {
  const requiredLayers = layerProbeStatus.filter(layer => layer.status !== 'not-required')
  if (status === 'not-required') {
    return 'No probable release change is currently flagged, so layer-specific probes are not required.'
  }
  if (requiredLayers.length === 0) {
    return 'No impacted layers have been identified yet for the current release window.'
  }
  if (status === 'completed') {
    return `All impacted layers are green in the current release window: ${requiredLayers.map(layer => layer.layer).join(', ')}.`
  }
  if (status === 'blocked') {
    return requiredLayers
      .filter(layer => layer.status === 'blocked')
      .map(layer => `${layer.layer}: ${layer.reason}`)
      .join(' ')
  }
  return requiredLayers
    .filter(layer => layer.status === 'pending')
    .map(layer => `${layer.layer}: ${layer.reason}`)
    .join(' ')
}

function collectLayerArtifactPaths(
  layerProbeStatus: DeepSeekReleaseLayerProbeStatus[],
): string[] {
  return [...new Set(
    layerProbeStatus.flatMap(layer => layer.artifactPaths),
  )].sort()
}

function collectCommandsByPhase(
  triageReport: DeepSeekReleaseTriageReport,
  phase:
    | 'freeze-evidence'
    | 'minimal-probe'
    | 'adapter-fix'
    | 'targeted-regression'
    | 'full-regression'
    | 'docs-update',
): string[] {
  return triageReport.nextSteps
    .filter(step => step.phase === phase)
    .flatMap(step => step.commands)
}

function buildReleaseReportCommand(
  commandName: 'release-diff' | 'release-boundaries' | 'release-triage',
  artifactRootDir: string,
  triageReport: DeepSeekReleaseTriageReport,
): string {
  const explicitArgs = [
    ...triageReport.evidence.currentArtifacts.map(
      artifact => `--current-artifact ${quoteShell(artifact.path)}`,
    ),
    ...triageReport.evidence.baselineArtifacts.map(
      artifact => `--baseline-artifact ${quoteShell(artifact.path)}`,
    ),
  ].join(' ')
  return `npm run dev -- ${commandName} ${explicitArgs} --output ${quoteShell(resolve(artifactRootDir, `${commandName}.json`))}`.trim()
}

function resolveFingerprintStageStatus(
  diffReport: DeepSeekReleaseDiffReport,
): DeepSeekReleaseRevalidationStageStatus {
  if (
    diffReport.fingerprintSummary.currentCompositeFingerprints.length === 0 ||
    diffReport.fingerprintSummary.baselineCompositeFingerprints.length === 0
  ) {
    return 'blocked'
  }
  return 'completed'
}

function collectArtifactPaths(
  artifacts: Array<{ path: string }>,
): string[] {
  return [...new Set(artifacts.map(artifact => artifact.path))].sort()
}

function buildStage(
  id: DeepSeekReleaseRevalidationStage['id'],
  title: string,
  status: DeepSeekReleaseRevalidationStageStatus,
  rationale: string,
  commands: string[],
  artifactPaths: string[],
): DeepSeekReleaseRevalidationStage {
  return {
    id,
    title,
    status,
    rationale,
    commands,
    artifactPaths: [...new Set(artifactPaths)].sort(),
  }
}

function getStageStatus(
  stages: DeepSeekReleaseRevalidationStage[],
  id: DeepSeekReleaseRevalidationStage['id'],
): DeepSeekReleaseRevalidationStageStatus {
  return stages.find(stage => stage.id === id)?.status ?? 'pending'
}

function quoteShell(value: string): string {
  return JSON.stringify(value)
}
