import type {
  DeepSeekReleaseArtifactDescriptor,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from '../../types/deepseek-release-diff.types.js'
import type {
  DeepSeekReleaseAdapterBoundaryId,
  DeepSeekReleaseAdapterBoundaryReport,
  DeepSeekReleaseBoundaryCapabilitySignal,
  DeepSeekReleaseBoundaryLayerSignal,
  DeepSeekReleaseBoundaryReport,
  DeepSeekReleaseIntegrationBoundaryReport,
} from '../../types/deepseek-release-boundary.types.js'

const RELEASE_SCENARIOS: DeepSeekReleaseComparableScenario[] = [
  'release-core',
  'mode-audit',
  'release-search-and-fact-check',
  'release-message-actions',
  'release-browser-runtime-governance',
]

const ADAPTER_BOUNDARY_DEFINITIONS: Array<{
  boundaryId: DeepSeekReleaseAdapterBoundaryId
  label: string
  description: string
  ownedScenarios: DeepSeekReleaseComparableScenario[]
  ownedLayers: Array<'ui' | 'api' | 'output'>
  ownedCapabilityIds: string[]
  ownedModulePaths: string[]
  ownedSpecPaths: string[]
}> = [
  {
    boundaryId: 'ui-adapter',
    label: 'UI Adapter Boundary',
    description:
      'Owns DeepSeek control discovery, selector stability, and page-action entry surfaces without claiming parser or renderer correctness.',
    ownedScenarios: [
      'release-core',
      'mode-audit',
      'search-ui-retry-probe',
      'release-search-and-fact-check',
      'release-message-actions',
    ],
    ownedLayers: ['ui'],
    ownedCapabilityIds: [
      'home-entry',
      'mode-selector-surface',
      'instant-expert-capability-matrix',
      'vision-image-mode-current-window',
      'expert-file-capability-delta',
      'authoritative-mode-signal-delivery',
      'ui-retry-confirmed-path',
      'edit-message',
      'regenerate-message',
      'continue-preflight',
      'continue-message',
      'delete-session',
    ],
    ownedModulePaths: [
      'src/infrastructure/deepseek/deepSeekComposerControls.ts',
      'src/infrastructure/deepseek/deepSeekComposerInteractions.ts',
      'src/infrastructure/deepseek/deepSeekComposerMode.ts',
      'src/infrastructure/deepseek/deepSeekChatModeControls.ts',
      'src/infrastructure/deepseek/deepSeekChatModeInteractions.ts',
      'src/infrastructure/deepseek/deepSeekChatModeSignal.ts',
      'src/infrastructure/deepseek/deepSeekMessageActionControls.ts',
      'src/infrastructure/deepseek/deepSeekRetryUiAudit.ts',
      'src/infrastructure/deepseek/deepSeekRetryUiFlow.ts',
      'src/infrastructure/deepseek/deepSeekEditMessageFlow.ts',
      'src/infrastructure/deepseek/deepSeekRegenerateMessageFlow.ts',
      'src/infrastructure/deepseek/deepSeekContinueMessageFlow.ts',
      'src/infrastructure/deepseek/deepSeekContinueTargetFlow.ts',
    ],
    ownedSpecPaths: [
      'specs/deepseek/deepseek-dom-controls.spec.yml',
      'specs/deepseek/deepseek-chat-mode-audit.spec.yml',
      'specs/deepseek/deepseek-search-ui-retry-control.spec.yml',
      'specs/deepseek/deepseek-search-ui-retry-boundary.spec.yml',
      'specs/deepseek/deepseek-continue-target.spec.yml',
    ],
  },
  {
    boundaryId: 'api-contract',
    label: 'API Contract Boundary',
    description:
      'Owns audited endpoint contracts plus parser / mapper behavior for canonical generation, history recovery, and native search artifacts.',
    ownedScenarios: [
      'release-core',
      'search-success',
      'release-search-and-fact-check',
      'release-message-actions',
    ],
    ownedLayers: ['api'],
    ownedCapabilityIds: [
      'session-restore',
      'search-success',
      'rate-limit-output',
      'seeded-session',
    ],
    ownedModulePaths: [
      'src/infrastructure/deepseek/deepSeekGenerationStreamParser.ts',
      'src/infrastructure/deepseek/generationRunAccumulator.ts',
      'src/infrastructure/deepseek/historyMessagesMapper.ts',
      'src/infrastructure/deepseek/deepSeekSessionSearchMapping.ts',
      'src/infrastructure/deepseek/deepSeekHistoryMessages.ts',
      'src/infrastructure/deepseek/deepSeekEndpointAuditRegistry.ts',
      'src/application/services/deepSeekReplyArtifacts.ts',
    ],
    ownedSpecPaths: [
      'specs/deepseek/deepseek-generation-stream.spec.yml',
      'specs/deepseek/deepseek-history-messages-mapping.spec.yml',
      'specs/deepseek/deepseek-search-output-audit.spec.yml',
      'specs/deepseek/deepseek-search-reference-mapping.spec.yml',
      'specs/deepseek/deepseek-release-fingerprint.spec.yml',
    ],
  },
  {
    boundaryId: 'output-adapter',
    label: 'Output Adapter Boundary',
    description:
      'Owns CLI / interactive / RPC rendering, OpenAI compatibility adapters, and export presentation without claiming selector or endpoint drift.',
    ownedScenarios: [
      'release-core',
      'release-search-and-fact-check',
      'release-message-actions',
    ],
    ownedLayers: ['output'],
    ownedCapabilityIds: [
      'cli-openai-stream',
      'interactive-entrypoint',
      'rpc-entrypoint',
      'fact-check-surfaces-export',
      'reference-rendering',
      'mutation-branch-export',
      'full-session-export',
      'continue-export',
    ],
    ownedModulePaths: [
      'src/application/services/deepSeekReplyOutputOrchestrator.ts',
      'src/interfaces/cli/deepSeekCliOutput.ts',
      'src/interfaces/rpc/deepSeekRpcOutput.ts',
      'src/domain/session/sessionExport.ts',
      'src/domain/session/sessionExportSnapshot.ts',
      'src/domain/session/sessionExportProvenance.ts',
      'src/infrastructure/deepseek/openaiResponsesAdapter.ts',
      'src/infrastructure/deepseek/openaiResponsesAdapterShared.ts',
      'src/infrastructure/deepseek/openaiChatCompletionsAdapter.ts',
      'src/infrastructure/deepseek/openaiChatCompletionsAdapterShared.ts',
    ],
    ownedSpecPaths: [
      'specs/deepseek/deepseek-output-modes.spec.yml',
      'specs/deepseek/deepseek-reply-delivery.spec.yml',
      'specs/deepseek/deepseek-branch-export.spec.yml',
      'specs/deepseek/deepseek-session-export.spec.yml',
      'specs/deepseek/deepseek-interactive-output.spec.yml',
      'specs/rpc/rpc-streaming-output.spec.yml',
    ],
  },
]

const INTEGRATION_MODULE_PATHS = [
  'src/application/services/executeDeepSeekReply.ts',
  'src/interfaces/cli/program.ts',
  'src/interfaces/interactive/repl.ts',
  'src/interfaces/rpc/jsonRpcServer.ts',
  'src/application/usecases/exportConversation.ts',
]

const INTEGRATION_SPEC_PATHS = [
  'specs/deepseek/deepseek-reply-delivery.spec.yml',
  'specs/deepseek/deepseek-interactive-output.spec.yml',
  'specs/rpc/rpc-streaming-output.spec.yml',
]

type InitialBoundaryStatus =
  | 'green'
  | 'drifted'
  | 'observation-pending'
  | 'not-observed'

interface PreliminaryBoundaryAssessment {
  report: Omit<DeepSeekReleaseAdapterBoundaryReport, 'status'>
  initialStatus: InitialBoundaryStatus
}

export function buildDeepSeekReleaseBoundaryReport(input: {
  diffReport: DeepSeekReleaseDiffReport
}): DeepSeekReleaseBoundaryReport {
  const preliminary = ADAPTER_BOUNDARY_DEFINITIONS.map(definition =>
    assessAdapterBoundary(definition, input.diffReport),
  )
  const integration = buildIntegrationBoundary(input.diffReport, preliminary)

  const adapterBoundaries = preliminary.map(item => ({
    ...item.report,
    status: finalizeAdapterBoundaryStatus(item.initialStatus, integration.status),
  }))

  return {
    generatedAt: new Date().toISOString(),
    source: {
      currentArtifacts: collectDescriptors(input.diffReport.artifactPairs, 'current'),
      baselineArtifacts: collectDescriptors(input.diffReport.artifactPairs, 'baseline'),
      fingerprintSummary: input.diffReport.fingerprintSummary,
    },
    adapterBoundaries,
    integration,
  }
}

function assessAdapterBoundary(
  definition: (typeof ADAPTER_BOUNDARY_DEFINITIONS)[number],
  diffReport: DeepSeekReleaseDiffReport,
): PreliminaryBoundaryAssessment {
  const layerSignals = collectLayerSignals(definition, diffReport)
  const capabilitySignals = collectCapabilitySignals(definition, diffReport)
  const currentArtifactPaths = collectArtifactPaths(
    diffReport,
    definition.ownedScenarios,
    'current',
  )
  const baselineArtifactPaths = collectArtifactPaths(
    diffReport,
    definition.ownedScenarios,
    'baseline',
  )
  const reasons: string[] = []
  const hasChangedLayer = layerSignals.some(signal => signal.status === 'changed')
  const hasFailedCapability = capabilitySignals.some(signal => signal.status === 'fail')
  const hasIncompleteLayerEvidence = layerSignals.some(
    signal =>
      signal.status === 'fingerprint-unavailable' ||
      signal.status === 'baseline-missing' ||
      signal.status === 'current-missing',
  )
  const hasPendingCapability = capabilitySignals.some(
    signal => signal.status === 'unknown' || signal.status === 'not-yet-rechecked',
  )

  let initialStatus: InitialBoundaryStatus
  if (currentArtifactPaths.length === 0 && capabilitySignals.length === 0 && layerSignals.length === 0) {
    initialStatus = 'not-observed'
    reasons.push('No current release artifact touched this boundary.')
  } else if (hasFailedCapability) {
    initialStatus = 'drifted'
    reasons.push(
      `${definition.label} owns one or more failed capabilities in the current regression evidence.`,
    )
    if (hasChangedLayer) {
      reasons.push(
        `${definition.label} also observed release-layer changes against the baseline fingerprint window, so the adapter still needs repair before it can be marked adapted.`,
      )
    }
  } else if (hasIncompleteLayerEvidence || hasPendingCapability) {
    initialStatus = 'observation-pending'
    if (layerSignals.some(signal => signal.status === 'fingerprint-unavailable')) {
      reasons.push(
        'Selected artifacts for this boundary predate release fingerprint capture, so the layer comparison is incomplete.',
      )
    }
    if (
      layerSignals.some(
        signal => signal.status === 'baseline-missing' || signal.status === 'current-missing',
      )
    ) {
      reasons.push(
        'This boundary is missing either a current or known-good baseline artifact for at least one owned scenario.',
      )
    }
    if (hasPendingCapability) {
      reasons.push(
        `${definition.label} still has owned capabilities that remain unknown or not yet rechecked.`,
      )
    }
  } else {
    initialStatus = 'green'
    if (hasChangedLayer) {
      reasons.push(
        `${definition.label} observed release-layer changes against the baseline fingerprint window, but its owned capabilities are green in the current evidence window, so the adapter can be treated as adapted.`,
      )
    } else {
      reasons.push(
        `${definition.label} owns only green layer signals and green capability signals in the selected evidence window.`,
      )
    }
  }

  return {
    initialStatus,
    report: {
      boundaryId: definition.boundaryId,
      label: definition.label,
      description: definition.description,
      ownedScenarios: definition.ownedScenarios,
      ownedLayers: definition.ownedLayers,
      ownedCapabilityIds: definition.ownedCapabilityIds,
      ownedModulePaths: definition.ownedModulePaths,
      ownedSpecPaths: definition.ownedSpecPaths,
      currentArtifactPaths,
      baselineArtifactPaths,
      layerSignals,
      capabilitySignals,
      reasons,
    },
  }
}

function buildIntegrationBoundary(
  diffReport: DeepSeekReleaseDiffReport,
  boundaries: PreliminaryBoundaryAssessment[],
): DeepSeekReleaseIntegrationBoundaryReport {
  const currentArtifactPaths = collectArtifactPaths(diffReport, RELEASE_SCENARIOS, 'current')
  const baselineArtifactPaths = collectArtifactPaths(diffReport, RELEASE_SCENARIOS, 'baseline')
  const pendingBoundaryIds = boundaries
    .filter(item => item.initialStatus === 'green' || item.initialStatus === 'drifted')
    .map(item => item.report.boundaryId)
  const driftedBoundaryIds = boundaries
    .filter(item => item.initialStatus === 'drifted')
    .map(item => item.report.boundaryId)
  const observationPendingBoundaryIds = boundaries
    .filter(
      item =>
        item.initialStatus === 'observation-pending' || item.initialStatus === 'not-observed',
    )
    .map(item => item.report.boundaryId)

  const unownedCapabilityIds = diffReport.capabilityMatrix.capabilities
    .map(capability => capability.capabilityId)
    .filter(capabilityId => !isCapabilityOwnedByAdapterBoundary(capabilityId))

  const reasons: string[] = []
  let status: DeepSeekReleaseIntegrationBoundaryReport['status']

  if (
    currentArtifactPaths.length === 0 ||
    observationPendingBoundaryIds.length > 0
  ) {
    status = 'observation-pending'
    if (currentArtifactPaths.length === 0) {
      reasons.push('No current release-gate artifacts were selected for integration revalidation.')
    }
    if (observationPendingBoundaryIds.length > 0) {
      reasons.push(
        `At least one adapter boundary still lacks clean evidence: ${observationPendingBoundaryIds.join(', ')}.`,
      )
    }
  } else if (
    driftedBoundaryIds.length === 0 &&
    diffReport.capabilityMatrix.summary.failCount === 0 &&
    diffReport.capabilityMatrix.summary.unknownCount === 0 &&
    diffReport.capabilityMatrix.summary.notYetRecheckedCount === 0 &&
    currentArtifactPaths.length === RELEASE_SCENARIOS.length
  ) {
    status = 'verified'
    reasons.push(
      'All adapter boundaries are green and the full release integration scenarios are covered by current artifacts.',
    )
  } else {
    status = 'pending-verification'
    reasons.push(
      'Adapter boundaries can now be evaluated independently, but the combined release surface still requires a full integration rerun.',
    )
    if (driftedBoundaryIds.length > 0) {
      reasons.push(
        `Integration remains pending because one or more adapter boundaries still drifted: ${driftedBoundaryIds.join(', ')}.`,
      )
    }
    if (diffReport.capabilityMatrix.summary.failCount > 0) {
      reasons.push(
        'Capability matrix still records failed end-to-end capabilities, so integration cannot be promoted to verified yet.',
      )
    }
    if (
      diffReport.capabilityMatrix.summary.unknownCount > 0 ||
      diffReport.capabilityMatrix.summary.notYetRecheckedCount > 0
    ) {
      reasons.push(
        'Some end-to-end capabilities are still waiting for a full release rerun, so integration stays pending-verification.',
      )
    }
    if (currentArtifactPaths.length < RELEASE_SCENARIOS.length) {
      reasons.push(
        'Not every release integration scenario has been rerun in the selected current artifact set.',
      )
    }
  }

  return {
    boundaryId: 'integration',
    label: 'Integration Boundary',
    description:
      'Owns the cross-layer claim that UI controls, API parser / mapper, and output adapters have all been revalidated together.',
    status,
    requiredAdapterBoundaryIds: ADAPTER_BOUNDARY_DEFINITIONS.map(
      definition => definition.boundaryId,
    ),
    ownedCapabilityIds: unownedCapabilityIds,
    ownedModulePaths: INTEGRATION_MODULE_PATHS,
    ownedSpecPaths: INTEGRATION_SPEC_PATHS,
    currentArtifactPaths,
    baselineArtifactPaths,
    pendingBoundaryIds,
    driftedBoundaryIds,
    reasons,
  }
}

function finalizeAdapterBoundaryStatus(
  initialStatus: InitialBoundaryStatus,
  integrationStatus: DeepSeekReleaseIntegrationBoundaryReport['status'],
): DeepSeekReleaseAdapterBoundaryReport['status'] {
  if (initialStatus === 'green') {
    return integrationStatus === 'verified' ? 'verified' : 'adapted'
  }
  if (initialStatus === 'drifted') {
    return 'drifted'
  }
  if (initialStatus === 'not-observed') {
    return 'not-observed'
  }
  return 'observation-pending'
}

function collectLayerSignals(
  definition: (typeof ADAPTER_BOUNDARY_DEFINITIONS)[number],
  diffReport: DeepSeekReleaseDiffReport,
): DeepSeekReleaseBoundaryLayerSignal[] {
  return definition.ownedLayers.flatMap(layer =>
    diffReport.layers[layer].scenarios
      .filter(scenario => definition.ownedScenarios.includes(scenario.scenario))
      .map(scenario => ({
        layer,
        scenario: scenario.scenario,
        status: scenario.status,
      })),
  )
}

function collectCapabilitySignals(
  definition: (typeof ADAPTER_BOUNDARY_DEFINITIONS)[number],
  diffReport: DeepSeekReleaseDiffReport,
): DeepSeekReleaseBoundaryCapabilitySignal[] {
  return diffReport.capabilityMatrix.capabilities
    .filter(capability => definition.ownedCapabilityIds.includes(capability.capabilityId))
    .filter(capability => capability.currentArtifactPath !== null)
    .map(capability => ({
      capabilityId: capability.capabilityId,
      scenario: capability.scenario,
      status: capability.status,
    }))
}

function collectArtifactPaths(
  diffReport: DeepSeekReleaseDiffReport,
  scenarios: DeepSeekReleaseComparableScenario[],
  kind: 'current' | 'baseline',
): string[] {
  return [...new Set(
    diffReport.artifactPairs
      .filter(pair => scenarios.includes(pair.scenario))
      .flatMap(pair => pair[kind]?.path ?? []),
  )].sort()
}

function collectDescriptors(
  pairs: DeepSeekReleaseDiffReport['artifactPairs'],
  kind: 'current' | 'baseline',
): DeepSeekReleaseArtifactDescriptor[] {
  return pairs
    .flatMap(pair => (pair[kind] ? [pair[kind]] : []))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function isCapabilityOwnedByAdapterBoundary(capabilityId: string): boolean {
  return ADAPTER_BOUNDARY_DEFINITIONS.some(definition =>
    definition.ownedCapabilityIds.includes(capabilityId),
  )
}
