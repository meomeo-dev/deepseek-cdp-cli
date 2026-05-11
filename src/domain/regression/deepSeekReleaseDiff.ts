import type { DeepSeekChatModeAuditReport } from '../../types/deepseek-mode-audit.types.js'
import {
  resolveDeepSeekReleaseFamilyFingerprint,
  resolveDeepSeekReleaseWindowFingerprint,
} from './deepSeekReleaseFingerprint.js'
import type { DeepSeekReleaseFingerprint } from '../../types/deepseek-release-fingerprint.types.js'
import type {
  DeepSeekComparableArtifact,
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseApiLayerDiff,
  DeepSeekReleaseArtifactPair,
  DeepSeekReleaseCapabilityArea,
  DeepSeekReleaseCapabilityMatrix,
  DeepSeekReleaseCapabilityRow,
  DeepSeekReleaseCapabilityStatus,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
  DeepSeekReleaseDiffStatus,
  DeepSeekReleaseFingerprintComparisonSummary,
  DeepSeekReleaseLayerChange,
  DeepSeekReleaseLayerGroupSummary,
  DeepSeekReleaseOutputLayerDiff,
  DeepSeekReleaseRuntimeLayerDiff,
  DeepSeekReleaseUiLayerDiff,
} from '../../types/deepseek-release-diff.types.js'

const SCENARIO_ORDER: DeepSeekReleaseComparableScenario[] = [
  'release-core',
  'mode-audit',
  'search-success',
  'search-ui-retry-probe',
  'release-search-and-fact-check',
  'release-message-actions',
  'release-browser-runtime-governance',
]

const CAPABILITY_DEFINITIONS: Array<{
  capabilityId: string
  area: DeepSeekReleaseCapabilityArea
  label: string
  scenario: DeepSeekReleaseComparableScenario
  checkIds: string[]
}> = [
  {
    capabilityId: 'runtime-core-lifecycle',
    area: 'runtime',
    label: 'Core browser runtime lifecycle',
    scenario: 'release-core',
    checkIds: [
      'attach-plan',
      'ephemeral-plan',
      'warm-plan',
      'warm-runtime-start',
      'warm-runtime-status',
    ],
  },
  {
    capabilityId: 'home-entry',
    area: 'core',
    label: 'Home entry and composer readiness',
    scenario: 'release-core',
    checkIds: ['attach-home', 'ephemeral-home'],
  },
  {
    capabilityId: 'session-restore',
    area: 'core',
    label: 'Session creation and restore authority',
    scenario: 'release-core',
    checkIds: ['session-created', 'session-restore'],
  },
  {
    capabilityId: 'cli-openai-stream',
    area: 'output',
    label: 'CLI OpenAI responses stream output',
    scenario: 'release-core',
    checkIds: ['cli-openai-responses-stream'],
  },
  {
    capabilityId: 'interactive-entrypoint',
    area: 'core',
    label: 'Interactive entrypoint delivery',
    scenario: 'release-core',
    checkIds: ['interactive-entrypoint'],
  },
  {
    capabilityId: 'rpc-entrypoint',
    area: 'core',
    label: 'RPC entrypoint delivery',
    scenario: 'release-core',
    checkIds: ['rpc-entrypoint'],
  },
  {
    capabilityId: 'mode-selector-surface',
    area: 'mode',
    label: 'Instant/Expert/Vision selector surface',
    scenario: 'mode-audit',
    checkIds: ['mode-selector-surface'],
  },
  {
    capabilityId: 'instant-expert-capability-matrix',
    area: 'mode',
    label: 'Core Instant/Expert capability matrix availability',
    scenario: 'mode-audit',
    checkIds: ['instant-expert-capability-matrix'],
  },
  {
    capabilityId: 'vision-image-mode-current-window',
    area: 'mode',
    label: 'Vision image mode current-window evidence',
    scenario: 'mode-audit',
    checkIds: ['vision-image-file-evidence'],
  },
  {
    capabilityId: 'expert-file-capability-delta',
    area: 'mode',
    label: 'Expert file capability delta',
    scenario: 'mode-audit',
    checkIds: ['expert-file-capability-delta'],
  },
  {
    capabilityId: 'authoritative-mode-signal-delivery',
    area: 'mode',
    label: 'Authoritative mode signal delivery',
    scenario: 'mode-audit',
    checkIds: ['authoritative-mode-signal-delivery'],
  },
  {
    capabilityId: 'search-success',
    area: 'search',
    label: 'Search success gate',
    scenario: 'release-search-and-fact-check',
    checkIds: ['search-success-gate'],
  },
  {
    capabilityId: 'fact-check-template',
    area: 'search',
    label: 'Fact-check template contract',
    scenario: 'release-search-and-fact-check',
    checkIds: ['fact-check-template'],
  },
  {
    capabilityId: 'fact-check-output',
    area: 'search',
    label: 'Fact-check live output',
    scenario: 'release-search-and-fact-check',
    checkIds: ['fact-check-live-output'],
  },
  {
    capabilityId: 'fact-check-surfaces-export',
    area: 'export',
    label: 'Fact-check output surfaces and export',
    scenario: 'release-search-and-fact-check',
    checkIds: ['fact-check-surfaces-and-export'],
  },
  {
    capabilityId: 'rate-limit-output',
    area: 'search',
    label: 'Search rate-limit output contract',
    scenario: 'release-search-and-fact-check',
    checkIds: ['rate-limit-output'],
  },
  {
    capabilityId: 'auto-retry-cooldown-replay',
    area: 'runtime',
    label: 'API cooldown replay retry',
    scenario: 'release-search-and-fact-check',
    checkIds: ['auto-retry-cooldown-replay'],
  },
  {
    capabilityId: 'ui-retry-confirmed-path',
    area: 'search',
    label: 'Search-path UI retry control',
    scenario: 'release-search-and-fact-check',
    checkIds: ['ui-retry-confirmed-path', 'ui-retry-unresolved-boundaries'],
  },
  {
    capabilityId: 'reference-rendering',
    area: 'output',
    label: 'Reference rendering and suspected citation handling',
    scenario: 'release-search-and-fact-check',
    checkIds: ['reference-rendering'],
  },
  {
    capabilityId: 'mutation-runtime-reuse',
    area: 'runtime',
    label: 'Mutation warm runtime reuse',
    scenario: 'release-message-actions',
    checkIds: ['warm-runtime-start', 'warm-runtime-status'],
  },
  {
    capabilityId: 'seeded-session',
    area: 'mutation',
    label: 'Mutation seeded session baseline',
    scenario: 'release-message-actions',
    checkIds: ['search-seeded-session'],
  },
  {
    capabilityId: 'edit-message',
    area: 'mutation',
    label: 'Edit message branch materialization',
    scenario: 'release-message-actions',
    checkIds: ['edit-message'],
  },
  {
    capabilityId: 'regenerate-message',
    area: 'mutation',
    label: 'Regenerate message branch materialization',
    scenario: 'release-message-actions',
    checkIds: ['regenerate-message'],
  },
  {
    capabilityId: 'branch-catalog',
    area: 'mutation',
    label: 'Branch catalog lineage',
    scenario: 'release-message-actions',
    checkIds: ['branch-catalog'],
  },
  {
    capabilityId: 'mutation-branch-export',
    area: 'export',
    label: 'Mutation branch export provenance',
    scenario: 'release-message-actions',
    checkIds: ['mutation-branch-export'],
  },
  {
    capabilityId: 'full-session-export',
    area: 'export',
    label: 'Full session export provenance',
    scenario: 'release-message-actions',
    checkIds: ['full-session-export'],
  },
  {
    capabilityId: 'continue-preflight',
    area: 'mutation',
    label: 'Continue target preflight',
    scenario: 'release-message-actions',
    checkIds: ['prepare-continue-target'],
  },
  {
    capabilityId: 'continue-message',
    area: 'mutation',
    label: 'Continue message delivery',
    scenario: 'release-message-actions',
    checkIds: ['continue-message'],
  },
  {
    capabilityId: 'continue-export',
    area: 'export',
    label: 'Continue export provenance',
    scenario: 'release-message-actions',
    checkIds: ['continue-export'],
  },
  {
    capabilityId: 'delete-session',
    area: 'mutation',
    label: 'Delete session flow',
    scenario: 'release-message-actions',
    checkIds: ['delete-session'],
  },
  {
    capabilityId: 'managed-runtime-start-list-status',
    area: 'runtime',
    label: 'Managed runtime start/list/status',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['managed-runtime-start-list-status'],
  },
  {
    capabilityId: 'browser-id-reuse',
    area: 'runtime',
    label: 'Business-command browserId reuse',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['browser-id-reuse'],
  },
  {
    capabilityId: 'busy-runtime-guard',
    area: 'runtime',
    label: 'Busy runtime stop/restart fail-closed guard',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['busy-runtime-guard'],
  },
  {
    capabilityId: 'managed-runtime-restart-stop',
    area: 'runtime',
    label: 'Managed runtime restart and stop lifecycle',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['managed-runtime-restart-stop'],
  },
  {
    capabilityId: 'idle-watchdog-auto-cleanup',
    area: 'runtime',
    label: 'Idle watchdog auto cleanup',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['idle-watchdog-auto-cleanup'],
  },
  {
    capabilityId: 'attach-stop-fail-closed',
    area: 'runtime',
    label: 'Attach runtime stop fail-closed',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['attach-stop-fail-closed'],
  },
  {
    capabilityId: 'cleanup-stale-forgets-attach-metadata',
    area: 'runtime',
    label: 'cleanup-stale forgets dead attach metadata',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['cleanup-stale-forgets-attach-metadata'],
  },
  {
    capabilityId: 'cdp-url-conflict-guidance',
    area: 'runtime',
    label: 'Fixed CDP URL conflict guidance',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['cdp-url-conflict-guidance'],
  },
  {
    capabilityId: 'parallel-multi-runtime',
    area: 'runtime',
    label: 'Parallel multi-runtime execution path',
    scenario: 'release-browser-runtime-governance',
    checkIds: ['parallel-multi-runtime'],
  },
]

export function buildDeepSeekReleaseDiffReport(input: {
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
}): DeepSeekReleaseDiffReport {
  const artifactPairs = buildArtifactPairs(input.currentArtifacts, input.baselineArtifacts)
  const layers = {
    ui: buildLayerGroupSummary(artifactPairs, pair => buildUiLayerDiff(pair, input.currentArtifacts, input.baselineArtifacts)),
    api: buildLayerGroupSummary(artifactPairs, pair => buildApiLayerDiff(pair, input.currentArtifacts, input.baselineArtifacts)),
    output: buildLayerGroupSummary(artifactPairs, pair => buildOutputLayerDiff(pair, input.currentArtifacts, input.baselineArtifacts)),
    runtime: buildLayerGroupSummary(
      artifactPairs.filter(pair => hasRuntimeProjection(input.currentArtifacts[pair.scenario]?.artifact) || hasRuntimeProjection(input.baselineArtifacts[pair.scenario]?.artifact)),
      pair => buildRuntimeLayerDiff(pair, input.currentArtifacts, input.baselineArtifacts),
    ),
  }

  return {
    generatedAt: new Date().toISOString(),
    artifactPairs,
    fingerprintSummary: buildFingerprintComparisonSummary(input.currentArtifacts, input.baselineArtifacts),
    layers,
    capabilityMatrix: buildCapabilityMatrix(artifactPairs, input.currentArtifacts, input.baselineArtifacts),
  }
}

function buildArtifactPairs(
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseArtifactPair[] {
  return SCENARIO_ORDER
    .filter(scenario => currentArtifacts[scenario] || baselineArtifacts[scenario])
    .map(scenario => ({
      scenario,
      current: currentArtifacts[scenario]?.descriptor ?? null,
      baseline: baselineArtifacts[scenario]?.descriptor ?? null,
    }))
}

function buildFingerprintComparisonSummary(
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseFingerprintComparisonSummary {
  const currentCompositeFingerprints = collectCompositeFingerprints(currentArtifacts)
  const baselineCompositeFingerprints = collectCompositeFingerprints(baselineArtifacts)

  return {
    currentReleaseWindowFingerprints: collectReleaseWindowFingerprints(currentArtifacts),
    baselineReleaseWindowFingerprints: collectReleaseWindowFingerprints(baselineArtifacts),
    currentCompositeFingerprints,
    baselineCompositeFingerprints,
    currentRawCompositeFingerprints: collectRawCompositeFingerprints(currentArtifacts),
    baselineRawCompositeFingerprints: collectRawCompositeFingerprints(baselineArtifacts),
    currentReleaseFamilyFingerprints: currentCompositeFingerprints,
    baselineReleaseFamilyFingerprints: baselineCompositeFingerprints,
    currentUniqueFingerprintCount: currentCompositeFingerprints.length,
    baselineUniqueFingerprintCount: baselineCompositeFingerprints.length,
    status:
      baselineCompositeFingerprints.length === 0
        ? 'baseline-missing'
        : currentCompositeFingerprints.length > 1 || baselineCompositeFingerprints.length > 1
          ? 'mixed'
          : currentCompositeFingerprints[0] === baselineCompositeFingerprints[0]
            ? 'same'
            : 'changed',
  }
}

function collectCompositeFingerprints(
  artifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): string[] {
  return [...new Set(
    Object.values(artifacts)
      .flatMap(artifact => artifact?.releaseFingerprints ?? [])
      .map(resolveDeepSeekReleaseFamilyFingerprint),
  )].sort()
}

function collectReleaseWindowFingerprints(
  artifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): string[] {
  return [...new Set(
    Object.values(artifacts)
      .flatMap(artifact => artifact?.releaseFingerprints ?? [])
      .map(resolveDeepSeekReleaseWindowFingerprint),
  )].sort()
}

function collectRawCompositeFingerprints(
  artifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): string[] {
  return [...new Set(
    Object.values(artifacts)
      .flatMap(artifact => artifact?.releaseFingerprints ?? [])
      .map(fingerprint => fingerprint.compositeFingerprint),
  )].sort()
}

function buildLayerGroupSummary<TLayer extends { status: DeepSeekReleaseDiffStatus }>(
  pairs: DeepSeekReleaseArtifactPair[],
  buildLayer: (pair: DeepSeekReleaseArtifactPair) => TLayer,
): DeepSeekReleaseLayerGroupSummary<TLayer> {
  const scenarios = pairs.map(buildLayer)
  return {
    changedScenarioCount: scenarios.filter(item => item.status === 'changed').length,
    sameScenarioCount: scenarios.filter(item => item.status === 'same').length,
    baselineMissingScenarioCount: scenarios.filter(item => item.status === 'baseline-missing').length,
    fingerprintUnavailableScenarioCount: scenarios.filter(
      item => item.status === 'fingerprint-unavailable',
    ).length,
    currentMissingScenarioCount: scenarios.filter(item => item.status === 'current-missing').length,
    scenarios,
  }
}

function buildUiLayerDiff(
  pair: DeepSeekReleaseArtifactPair,
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseUiLayerDiff {
  const currentFingerprint = resolvePrimaryFingerprint(currentArtifacts[pair.scenario])
  const baselineFingerprint = resolvePrimaryFingerprint(baselineArtifacts[pair.scenario])

  if (!pair.current || !currentFingerprint) {
    if (pair.current && !currentFingerprint) {
      return createEmptyUiLayerDiff(pair.scenario, 'fingerprint-unavailable')
    }
    return createEmptyUiLayerDiff(pair.scenario, 'current-missing')
  }
  if (!pair.baseline || !baselineFingerprint) {
    if (pair.baseline && !baselineFingerprint) {
      return createEmptyUiLayerDiff(
        pair.scenario,
        'fingerprint-unavailable',
        currentFingerprint,
      )
    }
    return createEmptyUiLayerDiff(
      pair.scenario,
      'baseline-missing',
      currentFingerprint,
      baselineFingerprint,
    )
  }

  const routeShellChanges = diffPlainObjects(
    readReleaseFamilyRouteShellProjectionFromFingerprint(baselineFingerprint),
    readReleaseFamilyRouteShellProjectionFromFingerprint(currentFingerprint),
    'routeShell',
  )
  const baselineModeSurfaceProjection = readModeSurfaceProjectionFromFingerprint(baselineFingerprint)
  const currentModeSurfaceProjection = readModeSurfaceProjectionFromFingerprint(currentFingerprint)
  const modeSurfaceChanges = diffPlainObjects(
    baselineModeSurfaceProjection,
    currentModeSurfaceProjection,
    'modeSurface',
  )
  const composerChanges = diffPlainObjects(
    baselineFingerprint.uiFingerprint.composerSignature,
    currentFingerprint.uiFingerprint.composerSignature,
    'composer',
  )

  return {
    scenario: pair.scenario,
    status: hasLayerChanges(
      currentFingerprint.uiFingerprint.releaseFamilyFingerprint,
      baselineFingerprint.uiFingerprint.releaseFamilyFingerprint,
      routeShellChanges,
      modeSurfaceChanges,
      composerChanges,
      compareStringArrays(
        readReleaseFamilyAssetPathsFromFingerprint(baselineFingerprint),
        readReleaseFamilyAssetPathsFromFingerprint(currentFingerprint),
      ).added,
      compareStringArrays(
        readReleaseFamilyAssetPathsFromFingerprint(baselineFingerprint),
        readReleaseFamilyAssetPathsFromFingerprint(currentFingerprint),
      ).removed,
    )
      ? 'changed'
      : 'same',
    currentFingerprint: currentFingerprint.releaseFamilyFingerprint,
    baselineFingerprint: baselineFingerprint.releaseFamilyFingerprint,
    entryDocumentFingerprintChanged:
      currentFingerprint.uiFingerprint.entryDocumentFingerprint !==
      baselineFingerprint.uiFingerprint.entryDocumentFingerprint,
    staticAssetFingerprintChanged:
      currentFingerprint.uiFingerprint.releaseFamilyAssetFingerprint !==
      baselineFingerprint.uiFingerprint.releaseFamilyAssetFingerprint,
    routeShellFingerprintChanged:
      currentFingerprint.uiFingerprint.releaseFamilyRouteShellFingerprint !==
      baselineFingerprint.uiFingerprint.releaseFamilyRouteShellFingerprint,
    modeSurfaceFingerprintChanged:
      readModeSurfaceFingerprintFromFingerprint(currentFingerprint) !==
      readModeSurfaceFingerprintFromFingerprint(baselineFingerprint),
    composerFingerprintChanged:
      currentFingerprint.uiFingerprint.composerFingerprint !==
      baselineFingerprint.uiFingerprint.composerFingerprint,
    messageActionFingerprintChanged:
      currentFingerprint.uiFingerprint.messageActionFingerprint !==
      baselineFingerprint.uiFingerprint.messageActionFingerprint,
    addedStaticAssets: compareStringArrays(
      readReleaseFamilyAssetPathsFromFingerprint(baselineFingerprint),
      readReleaseFamilyAssetPathsFromFingerprint(currentFingerprint),
    ).added,
    removedStaticAssets: compareStringArrays(
      readReleaseFamilyAssetPathsFromFingerprint(baselineFingerprint),
      readReleaseFamilyAssetPathsFromFingerprint(currentFingerprint),
    ).removed,
    routeShellChanges,
    modeSurfaceChanges,
    composerChanges,
    addedMessageActionSignatures: compareStringArrays(
      baselineFingerprint.uiFingerprint.messageActionSignatures,
      currentFingerprint.uiFingerprint.messageActionSignatures,
    ).added,
    removedMessageActionSignatures: compareStringArrays(
      baselineFingerprint.uiFingerprint.messageActionSignatures,
      currentFingerprint.uiFingerprint.messageActionSignatures,
    ).removed,
  }
}

function buildApiLayerDiff(
  pair: DeepSeekReleaseArtifactPair,
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseApiLayerDiff {
  const currentFingerprint = resolvePrimaryFingerprint(currentArtifacts[pair.scenario])
  const baselineFingerprint = resolvePrimaryFingerprint(baselineArtifacts[pair.scenario])

  if (!pair.current || !currentFingerprint) {
    if (pair.current && !currentFingerprint) {
      return createEmptyApiLayerDiff(pair.scenario, 'fingerprint-unavailable')
    }
    return createEmptyApiLayerDiff(pair.scenario, 'current-missing')
  }
  if (!pair.baseline || !baselineFingerprint) {
    if (pair.baseline && !baselineFingerprint) {
      return createEmptyApiLayerDiff(
        pair.scenario,
        'fingerprint-unavailable',
        currentFingerprint,
      )
    }
    return createEmptyApiLayerDiff(pair.scenario, 'baseline-missing', currentFingerprint, baselineFingerprint)
  }

  const baselineMap = new Map(
    baselineFingerprint.apiFingerprint.endpointSignatures.map(signature => [signature.endpoint, signature]),
  )
  const currentMap = new Map(
    currentFingerprint.apiFingerprint.endpointSignatures.map(signature => [signature.endpoint, signature]),
  )
  const endpoints = [...new Set([...baselineMap.keys(), ...currentMap.keys()])].sort()
  const addedEndpoints: string[] = []
  const removedEndpoints: string[] = []
  const changedEndpoints: DeepSeekReleaseApiLayerDiff['changedEndpoints'] = []

  for (const endpoint of endpoints) {
    const baselineEntry = baselineMap.get(endpoint) ?? null
    const currentEntry = currentMap.get(endpoint) ?? null
    if (!baselineEntry && currentEntry) {
      addedEndpoints.push(endpoint)
      continue
    }
    if (baselineEntry && !currentEntry) {
      removedEndpoints.push(endpoint)
      continue
    }
    if (
      baselineEntry &&
      currentEntry &&
      (baselineEntry.signature !== currentEntry.signature ||
        baselineEntry.evidenceStatus !== currentEntry.evidenceStatus)
    ) {
      changedEndpoints.push({
        endpoint,
        baselineSignature: baselineEntry.signature,
        currentSignature: currentEntry.signature,
        baselineEvidenceStatus: baselineEntry.evidenceStatus,
        currentEvidenceStatus: currentEntry.evidenceStatus,
      })
    }
  }

  return {
    scenario: pair.scenario,
    status:
      addedEndpoints.length > 0 ||
      removedEndpoints.length > 0 ||
      changedEndpoints.length > 0 ||
      currentFingerprint.apiFingerprint.fingerprint !== baselineFingerprint.apiFingerprint.fingerprint
        ? 'changed'
        : 'same',
    currentFingerprint: currentFingerprint.apiFingerprint.fingerprint,
    baselineFingerprint: baselineFingerprint.apiFingerprint.fingerprint,
    confirmedEndpointDelta:
      currentFingerprint.apiFingerprint.confirmedEndpointCount -
      baselineFingerprint.apiFingerprint.confirmedEndpointCount,
    pendingEndpointDelta:
      currentFingerprint.apiFingerprint.pendingEndpointCount -
      baselineFingerprint.apiFingerprint.pendingEndpointCount,
    addedEndpoints,
    removedEndpoints,
    changedEndpoints,
  }
}

function buildOutputLayerDiff(
  pair: DeepSeekReleaseArtifactPair,
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseOutputLayerDiff {
  const currentFingerprint = resolvePrimaryFingerprint(currentArtifacts[pair.scenario])
  const baselineFingerprint = resolvePrimaryFingerprint(baselineArtifacts[pair.scenario])

  if (!pair.current || !currentFingerprint) {
    if (pair.current && !currentFingerprint) {
      return createEmptyOutputLayerDiff(pair.scenario, 'fingerprint-unavailable')
    }
    return createEmptyOutputLayerDiff(pair.scenario, 'current-missing')
  }
  if (!pair.baseline || !baselineFingerprint) {
    if (pair.baseline && !baselineFingerprint) {
      return createEmptyOutputLayerDiff(
        pair.scenario,
        'fingerprint-unavailable',
        currentFingerprint,
      )
    }
    return createEmptyOutputLayerDiff(pair.scenario, 'baseline-missing', currentFingerprint, baselineFingerprint)
  }

  const baselineMap = new Map(
    baselineFingerprint.outputFingerprint.quirks.map(quirk => [quirk.id, quirk]),
  )
  const currentMap = new Map(
    currentFingerprint.outputFingerprint.quirks.map(quirk => [quirk.id, quirk]),
  )
  const quirkIds = [...new Set([...baselineMap.keys(), ...currentMap.keys()])].sort()
  const addedQuirks: string[] = []
  const removedQuirks: string[] = []
  const changedQuirks: DeepSeekReleaseOutputLayerDiff['changedQuirks'] = []

  for (const quirkId of quirkIds) {
    const baselineQuirk = baselineMap.get(quirkId) ?? null
    const currentQuirk = currentMap.get(quirkId) ?? null
    if (!baselineQuirk && currentQuirk) {
      addedQuirks.push(quirkId)
      continue
    }
    if (baselineQuirk && !currentQuirk) {
      removedQuirks.push(quirkId)
      continue
    }
    if (
      baselineQuirk &&
      currentQuirk &&
      baselineQuirk.status !== currentQuirk.status
    ) {
      changedQuirks.push({
        id: quirkId,
        baselineStatus: baselineQuirk.status,
        currentStatus: currentQuirk.status,
      })
    }
  }

  return {
    scenario: pair.scenario,
    status:
      addedQuirks.length > 0 ||
      removedQuirks.length > 0 ||
      changedQuirks.length > 0 ||
      currentFingerprint.outputFingerprint.fingerprint !== baselineFingerprint.outputFingerprint.fingerprint
        ? 'changed'
        : 'same',
    currentFingerprint: currentFingerprint.outputFingerprint.fingerprint,
    baselineFingerprint: baselineFingerprint.outputFingerprint.fingerprint,
    addedQuirks,
    removedQuirks,
    changedQuirks,
  }
}

function buildRuntimeLayerDiff(
  pair: DeepSeekReleaseArtifactPair,
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseRuntimeLayerDiff {
  const currentProjection = buildRuntimeProjection(currentArtifacts[pair.scenario]?.artifact)
  const baselineProjection = buildRuntimeProjection(baselineArtifacts[pair.scenario]?.artifact)

  if (!pair.current || !currentProjection) {
    if (pair.current && !currentProjection) {
      return {
        scenario: pair.scenario,
        status: 'fingerprint-unavailable',
        changes: [],
      }
    }
    return {
      scenario: pair.scenario,
      status: 'current-missing',
      changes: [],
    }
  }
  if (!pair.baseline || !baselineProjection) {
    if (pair.baseline && !baselineProjection) {
      return {
        scenario: pair.scenario,
        status: 'fingerprint-unavailable',
        changes: [],
      }
    }
    return {
      scenario: pair.scenario,
      status: 'baseline-missing',
      changes: [],
    }
  }

  const changes = diffPlainObjects(baselineProjection, currentProjection, 'runtime')
  return {
    scenario: pair.scenario,
    status: changes.length > 0 ? 'changed' : 'same',
    changes,
  }
}

function buildCapabilityMatrix(
  artifactPairs: DeepSeekReleaseArtifactPair[],
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseCapabilityMatrix {
  const pairMap = new Map(artifactPairs.map(pair => [pair.scenario, pair]))
  const capabilities = CAPABILITY_DEFINITIONS.map(definition => {
    const current = currentArtifacts[definition.scenario]
    const baseline = baselineArtifacts[definition.scenario]
    const pair = pairMap.get(definition.scenario) ?? {
      scenario: definition.scenario,
      current: current?.descriptor ?? null,
      baseline: baseline?.descriptor ?? null,
    }
    return buildCapabilityRow(definition, pair, current)
  })

  return {
    summary: {
      passCount: capabilities.filter(capability => capability.status === 'pass').length,
      failCount: capabilities.filter(capability => capability.status === 'fail').length,
      unknownCount: capabilities.filter(capability => capability.status === 'unknown').length,
      notYetRecheckedCount: capabilities.filter(
        capability => capability.status === 'not-yet-rechecked',
      ).length,
    },
    capabilities,
  }
}

function buildCapabilityRow(
  definition: (typeof CAPABILITY_DEFINITIONS)[number],
  pair: DeepSeekReleaseArtifactPair,
  current: DeepSeekLoadedComparableArtifact | undefined,
): DeepSeekReleaseCapabilityRow {
  const notes: string[] = []
  let status: DeepSeekReleaseCapabilityStatus

  if (!current) {
    status = 'not-yet-rechecked'
    notes.push('No current artifact was provided for this scenario.')
  } else {
    const checkStatuses = definition.checkIds.map(checkId =>
      resolveArtifactCheckStatus(current.artifact, checkId),
    )
    if (checkStatuses.every(checkStatus => checkStatus === 'pass')) {
      status = 'pass'
    } else if (checkStatuses.some(checkStatus => checkStatus === 'fail')) {
      status = 'fail'
    } else if (checkStatuses.some(checkStatus => checkStatus === 'warn' || checkStatus === 'missing')) {
      status = 'unknown'
      if (checkStatuses.some(checkStatus => checkStatus === 'warn')) {
        notes.push('Current artifact reported warning / unresolved evidence for at least one related check.')
      }
      if (checkStatuses.some(checkStatus => checkStatus === 'missing')) {
        notes.push('Current artifact did not expose one or more expected check ids.')
      }
    } else {
      status = 'unknown'
    }
  }

  if (pair.current?.primaryFingerprint && pair.baseline?.primaryFingerprint && pair.current.primaryFingerprint !== pair.baseline.primaryFingerprint) {
    notes.push('Current fingerprint differs from the baseline known-good fingerprint for this scenario.')
  }
  if (!pair.current?.primaryFingerprint && current) {
    notes.push('Current artifact predates release fingerprint capture; layered UI/API/output diff is unavailable for this scenario.')
  }
  if (pair.baseline && !pair.baseline.primaryFingerprint) {
    notes.push('Baseline artifact predates release fingerprint capture; layered UI/API/output diff is unavailable for this scenario.')
  }
  if (!pair.baseline) {
    notes.push('No baseline known-good artifact was found for this scenario.')
  }
  notes.push(...buildArtifactSpecificCapabilityNotes(definition.capabilityId, current?.artifact))

  return {
    capabilityId: definition.capabilityId,
    area: definition.area,
    label: definition.label,
    scenario: definition.scenario,
    checkIds: definition.checkIds,
    status,
    currentArtifactPath: pair.current?.path ?? null,
    baselineArtifactPath: pair.baseline?.path ?? null,
    currentFingerprint: pair.current?.primaryFingerprint ?? null,
    baselineFingerprint: pair.baseline?.primaryFingerprint ?? null,
    notes,
  }
}

interface ComparableArtifactCheck {
  id: string
  status: 'pass' | 'fail' | 'warn'
}

function resolveArtifactCheckStatus(
  artifact: DeepSeekComparableArtifact,
  checkId: string,
): 'pass' | 'fail' | 'warn' | 'missing' {
  const checks = extractArtifactChecks(artifact)
  const check = checks.find(candidate => candidate.id === checkId)
  if (!check) {
    return 'missing'
  }
  return check.status
}

function extractArtifactChecks(
  artifact: DeepSeekComparableArtifact,
): ComparableArtifactCheck[] {
  if ('report' in artifact && artifact.scenario === 'release-core') {
    return artifact.report.checks
  }
  if ('requestedUrl' in artifact && 'defaultHomeSurface' in artifact) {
    return buildModeAuditChecks(artifact)
  }
  if ('report' in artifact && artifact.scenario === 'search-success') {
    return artifact.report.checks
  }
  if ('report' in artifact && artifact.scenario === 'release-search-and-fact-check') {
    return artifact.report.checks
  }
  if ('report' in artifact && artifact.scenario === 'release-message-actions') {
    return artifact.report.checks
  }
  if ('report' in artifact && artifact.scenario === 'release-browser-runtime-governance') {
    return artifact.report.checks
  }
  if ('attempts' in artifact && 'matrix' in artifact) {
    return []
  }
  return []
}

function buildModeAuditChecks(artifact: DeepSeekChatModeAuditReport): ComparableArtifactCheck[] {
  const instant = artifact.scenarios.find(scenario => scenario.requestedMode === 'instant') ?? null
  const expert = artifact.scenarios.find(scenario => scenario.requestedMode === 'expert') ?? null
  const vision = artifact.scenarios.find(scenario => scenario.requestedMode === 'vision') ?? null
  return [
    {
      id: 'mode-selector-surface',
      status:
        artifact.defaultHomeSurface.modeSelectorVisible &&
          hasRequiredModes(artifact.defaultHomeSurface.availableModes) &&
          artifact.defaultHomeSurface.activeMode === 'instant'
          ? 'pass'
          : instant || expert || vision
            ? 'fail'
            : 'warn',
    },
    {
      id: 'instant-expert-capability-matrix',
      status: instant && expert ? 'pass' : 'warn',
    },
    {
      id: 'vision-image-file-evidence',
      status: resolveVisionImageFileEvidenceStatus(vision),
    },
    {
      id: 'expert-file-capability-delta',
      status: resolveExpertFileCapabilityDeltaStatus(instant, expert),
    },
    {
      id: 'authoritative-mode-signal-delivery',
      status: resolveAuthoritativeModeSignalDeliveryStatus(artifact.scenarios),
    },
  ]
}

function resolveExpertFileCapabilityDeltaStatus(
  instant: DeepSeekChatModeAuditReport['scenarios'][number] | null,
  expert: DeepSeekChatModeAuditReport['scenarios'][number] | null,
): ComparableArtifactCheck['status'] {
  if (!instant || !expert) {
    return 'warn'
  }
  const instantFileInputs = [
    instant.homeCapabilities.fileInput,
    instant.sessionCapabilities.fileInput,
    instant.reopenedSessionCapabilities.fileInput,
  ]
  const expertFileInputs = [
    expert.homeCapabilities.fileInput,
    expert.sessionCapabilities.fileInput,
    expert.reopenedSessionCapabilities.fileInput,
  ]
  const instantHasFileInput = instantFileInputs.some(Boolean)
  const expertHasFileInput = expertFileInputs.some(Boolean)
  const expertMissingFileInputEverywhere = expertFileInputs.every(value => value === false)

  if (!instantHasFileInput) {
    return 'fail'
  }
  if (expertHasFileInput) {
    return 'pass'
  }
  if (expertMissingFileInputEverywhere) {
    return 'fail'
  }
  return 'warn'
}

function resolveVisionImageFileEvidenceStatus(
  vision: DeepSeekChatModeAuditReport['scenarios'][number] | null,
): ComparableArtifactCheck['status'] {
  if (!vision) {
    return 'warn'
  }

  const evidence = vision.fileEvidence
  if (!evidence || evidence.requestedFiles.length === 0) {
    return 'fail'
  }

  const mountedIds = new Set(evidence.mountedFileIds)
  const refIds = new Set(evidence.requestRefFileIds)
  return evidence.uploadedFileIds.length > 0 &&
    evidence.mountedFileIds.length > 0 &&
    evidence.requestRefFileIds.length > 0 &&
    [...mountedIds].some(fileId => refIds.has(fileId))
    ? 'pass'
    : 'fail'
}

function resolveAuthoritativeModeSignalDeliveryStatus(
  scenarios: DeepSeekChatModeAuditReport['scenarios'],
): ComparableArtifactCheck['status'] {
  if (scenarios.length === 0) {
    return 'warn'
  }
  for (const scenario of scenarios) {
    const expectedLayers = [
      'request-payload',
      'generation-ready-sse',
      'canonical-generation-context',
      'history-messages-raw',
      'history-messages-mapped-session',
      'stored-session',
      'export-document',
    ] as const
    for (const layer of expectedLayers) {
      const observation = scenario.authoritySignals.find(candidate => candidate.layer === layer)
      if (!observation?.observed || observation.resolvedMode !== scenario.requestedMode) {
        return 'fail'
      }
    }
  }
  return 'pass'
}

function hasRequiredModes(availableModes: string[]): boolean {
  return (
    availableModes.includes('instant') &&
    availableModes.includes('expert') &&
    availableModes.includes('vision')
  )
}

function buildArtifactSpecificCapabilityNotes(
  capabilityId: string,
  artifact: DeepSeekComparableArtifact | undefined,
): string[] {
  if (!artifact || !('requestedUrl' in artifact && 'defaultHomeSurface' in artifact)) {
    return []
  }

  const instant = artifact.scenarios.find(scenario => scenario.requestedMode === 'instant') ?? null
  const expert = artifact.scenarios.find(scenario => scenario.requestedMode === 'expert') ?? null
  const vision = artifact.scenarios.find(scenario => scenario.requestedMode === 'vision') ?? null
  if (capabilityId === 'mode-selector-surface') {
    return [
      `Default home surface reports activeMode=${artifact.defaultHomeSurface.activeMode ?? 'unknown'} and availableModes=${artifact.defaultHomeSurface.availableModes.join(',') || 'none'}.`,
    ]
  }
  if (capabilityId === 'vision-image-mode-current-window') {
    if (!vision) {
      return ['Vision scenario is missing from the current mode-audit artifact.']
    }
    const evidence = vision.fileEvidence
    return [
      `Vision raw model_type signals = request:${readModeAuditRawModelType(vision, 'request-payload') ?? 'missing'}, ready:${readModeAuditRawModelType(vision, 'generation-ready-sse') ?? 'missing'}, history:${readModeAuditRawModelType(vision, 'history-messages-raw') ?? 'missing'}.`,
      evidence
        ? `Vision file evidence requested=${evidence.requestedFiles.length}, uploaded=${evidence.uploadedFileIds.length}, mounted=${evidence.mountedFileIds.length}, requestRef=${evidence.requestRefFileIds.length}.`
        : 'Vision file evidence is missing from the current mode-audit artifact.',
    ]
  }
  if (capabilityId === 'expert-file-capability-delta' && expert) {
    return [
      `Expert fileInput observed on home/session/reopened = ${String(expert.homeCapabilities.fileInput)}/${String(expert.sessionCapabilities.fileInput)}/${String(expert.reopenedSessionCapabilities.fileInput)}.`,
      ...(instant
        ? [
            `Instant fileInput observed on home/session/reopened = ${String(instant.homeCapabilities.fileInput)}/${String(instant.sessionCapabilities.fileInput)}/${String(instant.reopenedSessionCapabilities.fileInput)}.`,
          ]
        : []),
    ]
  }
  if (capabilityId === 'authoritative-mode-signal-delivery') {
    return artifact.scenarios.map(
      scenario =>
        `${scenario.requestedMode} authority layers = ${scenario.authoritySignals
          .map(observation => `${observation.layer}:${observation.resolvedMode ?? 'missing'}`)
          .join(', ')}.`,
    )
  }
  return []
}

function readModeAuditRawModelType(
  scenario: DeepSeekChatModeAuditReport['scenarios'][number],
  layer: 'request-payload' | 'generation-ready-sse' | 'history-messages-raw',
): string | null {
  return scenario.authoritySignals.find(signal => signal.layer === layer)?.rawModelType ?? null
}

function hasRuntimeProjection(artifact: DeepSeekComparableArtifact | undefined): boolean {
  return buildRuntimeProjection(artifact) !== null
}

function buildRuntimeProjection(
  artifact: DeepSeekComparableArtifact | undefined,
): Record<string, unknown> | null {
  if (!artifact) {
    return null
  }
  if ('report' in artifact && artifact.scenario === 'release-core') {
    return {
      attachPlan: {
        mode: artifact.observations.attachPlan.mode,
        browserRuntimeMode: artifact.observations.attachPlan.browserRuntimeMode,
        executionDisposition: artifact.observations.attachPlan.executionDisposition,
      },
      ephemeralPlan: {
        mode: artifact.observations.ephemeralPlan.mode,
        browserRuntimeMode: artifact.observations.ephemeralPlan.browserRuntimeMode,
        executionDisposition: artifact.observations.ephemeralPlan.executionDisposition,
      },
      warmPlan: {
        mode: artifact.observations.warmPlan.mode,
        browserRuntimeMode: artifact.observations.warmPlan.browserRuntimeMode,
        executionDisposition: artifact.observations.warmPlan.executionDisposition,
      },
      warmRuntimeStart: {
        mode: artifact.observations.warmRuntimeStart.mode,
        owner: artifact.observations.warmRuntimeStart.owner,
        purpose: artifact.observations.warmRuntimeStart.purpose,
      },
      warmRuntimeStatus: {
        mode: artifact.observations.warmRuntimeStatus.mode,
        owner: artifact.observations.warmRuntimeStatus.owner,
        state: artifact.observations.warmRuntimeStatus.state,
      },
    }
  }
  if ('report' in artifact && artifact.scenario === 'release-message-actions') {
    return {
      warmRuntimeStart: {
        mode: artifact.observations.warmRuntimeStart.mode,
        owner: artifact.observations.warmRuntimeStart.owner,
        purpose: artifact.observations.warmRuntimeStart.purpose,
      },
      warmRuntimeStatus: {
        mode: artifact.observations.warmRuntimeStatus.mode,
        owner: artifact.observations.warmRuntimeStatus.owner,
        state: artifact.observations.warmRuntimeStatus.state,
      },
    }
  }
  if ('report' in artifact && artifact.scenario === 'release-browser-runtime-governance') {
    return {
      primaryRuntimeStart: {
        mode: artifact.observations.primaryRuntimeStart.mode,
        owner: artifact.observations.primaryRuntimeStart.owner,
        purpose: artifact.observations.primaryRuntimeStart.purpose,
        state: artifact.observations.primaryRuntimeStart.state,
      },
      primaryRuntimeStatus: {
        mode: artifact.observations.primaryRuntimeStatus.mode,
        owner: artifact.observations.primaryRuntimeStatus.owner,
        state: artifact.observations.primaryRuntimeStatus.state,
        busy: artifact.observations.primaryRuntimeStatus.busy,
      },
      busyGuard: {
        runtimeObservedBusy: artifact.observations.busyGuard.runtimeObservedBusy,
        stopRejected: artifact.observations.busyGuard.stopRejected,
        restartRejected: artifact.observations.busyGuard.restartRejected,
        releasedToIdle: artifact.observations.busyGuard.releasedToIdle,
      },
      idleWatchdog: {
        cleanedByWatchdog: artifact.observations.idleWatchdog.cleanedByWatchdog,
      },
      attachRuntime: {
        registered: artifact.observations.attachRuntime.registered,
        stopRejected: artifact.observations.attachRuntime.stopRejected,
        cleanupForgotten: artifact.observations.attachRuntime.cleanupForgotten,
      },
      cdpUrlConflict: {
        rejected: artifact.observations.cdpUrlConflict.rejected,
        actionable: artifact.observations.cdpUrlConflict.actionable,
      },
      parallelRuntimes: {
        distinctRuntimeCount: artifact.observations.parallelRuntimes.distinctRuntimeCount,
        concurrentBusyCount: artifact.observations.parallelRuntimes.concurrentBusyCount,
        releasedCleanly: artifact.observations.parallelRuntimes.releasedCleanly,
      },
    }
  }
  return null
}

function resolvePrimaryFingerprint(
  artifact: DeepSeekLoadedComparableArtifact | undefined,
): DeepSeekReleaseFingerprint | null {
  if (!artifact) {
    return null
  }
  const primaryFingerprint = artifact.descriptor.primaryFingerprint
  const rawPrimaryFingerprint = artifact.descriptor.rawPrimaryFingerprint
  if (!primaryFingerprint) {
    return artifact.releaseFingerprints[0] ?? null
  }

  const rawMatch = rawPrimaryFingerprint
    ? artifact.releaseFingerprints.find(
        fingerprint => fingerprint.compositeFingerprint === rawPrimaryFingerprint,
      )
    : null
  if (rawMatch) {
    return rawMatch
  }

  return (
    artifact.releaseFingerprints.find(
      fingerprint =>
        fingerprint.compositeFingerprint === primaryFingerprint ||
        resolveDeepSeekReleaseFamilyFingerprint(fingerprint) === primaryFingerprint,
    ) ??
    artifact.releaseFingerprints[0] ??
    null
  )
}

function readModeSurfaceProjectionFromFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): {
  heading: string | null
  modeSelectorVisible: boolean
  availableModes: string[]
  activeMode: string | null
} {
  const projection = fingerprint.uiFingerprint['modeSurfaceProjection']
  if (!isPlainObject(projection)) {
    return {
      heading: null,
      modeSelectorVisible: false,
      availableModes: [],
      activeMode: null,
    }
  }

  return {
    heading: typeof projection['heading'] === 'string' && projection['heading'].trim()
      ? projection['heading']
      : null,
    modeSelectorVisible: projection['modeSelectorVisible'] === true,
    availableModes: Array.isArray(projection['availableModes'])
      ? projection['availableModes'].filter(value => typeof value === 'string').sort()
      : [],
    activeMode: typeof projection['activeMode'] === 'string' ? projection['activeMode'] : null,
  }
}

function readReleaseFamilyRouteShellProjectionFromFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): {
  normalizedRoute: string
  routeKind: string
  bodyClassTokens: string[]
  rootIds: string[]
  hasHeader: boolean
  hasSidebar: boolean
  hasComposerInput: boolean
} {
  const projection = fingerprint.uiFingerprint['releaseFamilyRouteShellProjection']
  if (isPlainObject(projection)) {
    return {
      normalizedRoute:
        typeof projection['normalizedRoute'] === 'string' ? projection['normalizedRoute'] : 'unknown',
      routeKind: typeof projection['routeKind'] === 'string' ? projection['routeKind'] : 'unknown',
      bodyClassTokens: Array.isArray(projection['bodyClassTokens'])
        ? projection['bodyClassTokens'].filter((item): item is string => typeof item === 'string')
        : [],
      rootIds: Array.isArray(projection['rootIds'])
        ? projection['rootIds'].filter((item): item is string => typeof item === 'string')
        : [],
      hasHeader: projection['hasHeader'] === true,
      hasSidebar: projection['hasSidebar'] === true,
      hasComposerInput: projection['hasComposerInput'] === true,
    }
  }

  const legacyProjection = fingerprint.uiFingerprint['routeShellProjection']
  if (isPlainObject(legacyProjection)) {
    return {
      normalizedRoute:
        typeof legacyProjection['normalizedRoute'] === 'string'
          ? legacyProjection['normalizedRoute']
          : 'unknown',
      routeKind:
        typeof legacyProjection['routeKind'] === 'string' ? legacyProjection['routeKind'] : 'unknown',
      bodyClassTokens: Array.isArray(legacyProjection['bodyClassTokens'])
        ? legacyProjection['bodyClassTokens'].filter((item): item is string => typeof item === 'string')
        : [],
      rootIds: Array.isArray(legacyProjection['rootIds'])
        ? legacyProjection['rootIds'].filter((item): item is string => typeof item === 'string')
        : [],
      hasHeader: legacyProjection['hasHeader'] === true,
      hasSidebar: legacyProjection['hasSidebar'] === true,
      hasComposerInput: legacyProjection['hasComposerInput'] === true,
    }
  }

  return {
    normalizedRoute: 'unknown',
    routeKind: 'unknown',
    bodyClassTokens: [],
    rootIds: [],
    hasHeader: false,
    hasSidebar: false,
    hasComposerInput: false,
  }
}

function readReleaseFamilyAssetPathsFromFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): string[] {
  const paths = fingerprint.uiFingerprint['releaseFamilyAssetPaths']
  if (Array.isArray(paths) && paths.every(item => typeof item === 'string')) {
    return [...paths]
  }

  const entryLinkedAssetPaths = fingerprint.uiFingerprint['entryLinkedAssetPaths']
  if (
    Array.isArray(entryLinkedAssetPaths) &&
    entryLinkedAssetPaths.every(item => typeof item === 'string')
  ) {
    return [...entryLinkedAssetPaths]
  }

  const staticAssetPaths = fingerprint.uiFingerprint['staticAssetPaths']
  if (Array.isArray(staticAssetPaths) && staticAssetPaths.every(item => typeof item === 'string')) {
    return [...staticAssetPaths]
  }

  return []
}

function readModeSurfaceFingerprintFromFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): string {
  const stored = fingerprint.uiFingerprint['modeSurfaceFingerprint']
  if (typeof stored === 'string' && stored.trim()) {
    return stored
  }
  return serializeComparableValue(readModeSurfaceProjectionFromFingerprint(fingerprint))
}

function createEmptyUiLayerDiff(
  scenario: DeepSeekReleaseComparableScenario,
  status: DeepSeekReleaseDiffStatus,
  currentFingerprint: DeepSeekReleaseFingerprint | null = null,
  baselineFingerprint: DeepSeekReleaseFingerprint | null = null,
): DeepSeekReleaseUiLayerDiff {
  return {
    scenario,
    status,
    currentFingerprint: currentFingerprint?.uiFingerprint.fingerprint ?? null,
    baselineFingerprint: baselineFingerprint?.uiFingerprint.fingerprint ?? null,
    entryDocumentFingerprintChanged: false,
    staticAssetFingerprintChanged: false,
    routeShellFingerprintChanged: false,
    modeSurfaceFingerprintChanged: false,
    composerFingerprintChanged: false,
    messageActionFingerprintChanged: false,
    addedStaticAssets: [],
    removedStaticAssets: [],
    routeShellChanges: [],
    modeSurfaceChanges: [],
    composerChanges: [],
    addedMessageActionSignatures: [],
    removedMessageActionSignatures: [],
  }
}

function createEmptyApiLayerDiff(
  scenario: DeepSeekReleaseComparableScenario,
  status: DeepSeekReleaseDiffStatus,
  currentFingerprint: DeepSeekReleaseFingerprint | null = null,
  baselineFingerprint: DeepSeekReleaseFingerprint | null = null,
): DeepSeekReleaseApiLayerDiff {
  return {
    scenario,
    status,
    currentFingerprint: currentFingerprint?.apiFingerprint.fingerprint ?? null,
    baselineFingerprint: baselineFingerprint?.apiFingerprint.fingerprint ?? null,
    confirmedEndpointDelta: null,
    pendingEndpointDelta: null,
    addedEndpoints: [],
    removedEndpoints: [],
    changedEndpoints: [],
  }
}

function createEmptyOutputLayerDiff(
  scenario: DeepSeekReleaseComparableScenario,
  status: DeepSeekReleaseDiffStatus,
  currentFingerprint: DeepSeekReleaseFingerprint | null = null,
  baselineFingerprint: DeepSeekReleaseFingerprint | null = null,
): DeepSeekReleaseOutputLayerDiff {
  return {
    scenario,
    status,
    currentFingerprint: currentFingerprint?.outputFingerprint.fingerprint ?? null,
    baselineFingerprint: baselineFingerprint?.outputFingerprint.fingerprint ?? null,
    addedQuirks: [],
    removedQuirks: [],
    changedQuirks: [],
  }
}

function compareStringArrays(
  baseline: string[],
  current: string[],
): {
  added: string[]
  removed: string[]
} {
  const baselineSet = new Set(baseline)
  const currentSet = new Set(current)
  return {
    added: current.filter(item => !baselineSet.has(item)),
    removed: baseline.filter(item => !currentSet.has(item)),
  }
}

function diffPlainObjects(
  baseline: object,
  current: object,
  prefix: string,
): DeepSeekReleaseLayerChange[] {
  const baselineRecord = baseline as Record<string, unknown>
  const currentRecord = current as Record<string, unknown>
  const keys = [...new Set([...Object.keys(baselineRecord), ...Object.keys(currentRecord)])].sort()
  const changes: DeepSeekReleaseLayerChange[] = []

  for (const key of keys) {
    const baselineValue = baselineRecord[key]
    const currentValue = currentRecord[key]
    const field = `${prefix}.${key}`
    if (isPlainObject(baselineValue) && isPlainObject(currentValue)) {
      changes.push(...diffPlainObjects(baselineValue, currentValue, field))
      continue
    }
    if (serializeComparableValue(baselineValue) !== serializeComparableValue(currentValue)) {
      changes.push({
        field,
        baseline: baselineValue,
        current: currentValue,
      })
    }
  }

  return changes
}

function hasLayerChanges(
  currentFingerprint: string,
  baselineFingerprint: string,
  ...changes: Array<DeepSeekReleaseLayerChange[] | string[]>
): boolean {
  if (currentFingerprint !== baselineFingerprint) {
    return true
  }
  return changes.some(change => change.length > 0)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serializeComparableValue(value: unknown): string {
  return JSON.stringify(value)
}
