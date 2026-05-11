import { dirname, resolve } from 'node:path'
import type {
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from '../../types/deepseek-release-diff.types.js'
import type {
  DeepSeekReleaseTriageBlockingItem,
  DeepSeekReleaseTriageDisposition,
  DeepSeekReleaseTriageEvidenceArtifact,
  DeepSeekReleaseTriageNextStep,
  DeepSeekReleaseTriageRepairLane,
  DeepSeekReleaseTriageReport,
} from '../../types/deepseek-release-triage.types.js'
import type { DeepSeekReleaseEvidenceRootDescriptor } from '../../types/deepseek-release-evidence.types.js'

const SCENARIO_ORDER: DeepSeekReleaseComparableScenario[] = [
  'release-core',
  'mode-audit',
  'search-success',
  'search-ui-retry-probe',
  'release-search-and-fact-check',
  'release-message-actions',
  'release-browser-runtime-governance',
]

const LAYER_ORDER = ['ui', 'api', 'output', 'runtime'] as const

const SCENARIO_CAPTURE_PLAN: Record<
  DeepSeekReleaseComparableScenario,
  {
    label: string
    command: (artifactRootDir: string) => string
    artifactPaths: (artifactRootDir: string) => string[]
  }
> = {
  'release-core': {
    label: 'Core release gate',
    command: artifactRootDir =>
      `node --import tsx scripts/deepseek-core-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-core-regression-gate.real.json'),
      )} --verbose`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-core-regression-gate.real.json'),
      resolve(artifactRootDir, 'deepseek-core-regression-session-store'),
    ],
  },
  'mode-audit': {
    label: 'Mode surface audit',
    command: artifactRootDir =>
      `npm run dev -- mode-audit --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-mode-audit.real.json'),
      )} --verbose`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-mode-audit.real.json'),
    ],
  },
  'search-success': {
    label: 'Search success regression gate',
    command: artifactRootDir =>
      `node --import tsx scripts/deepseek-search-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-search-regression-gate.real.json'),
      )} --verbose`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-search-regression-gate.real.json'),
    ],
  },
  'search-ui-retry-probe': {
    label: 'Search UI retry probe',
    command: artifactRootDir =>
      `node --import tsx scripts/deepseek-search-ui-retry-probe.ts --attempts 10 --concurrency 5 --click-retry --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-search-ui-retry-probe.real.json'),
      )} --verbose`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-search-ui-retry-probe.real.json'),
    ],
  },
  'release-search-and-fact-check': {
    label: 'Search release gate',
    command: artifactRootDir =>
      `node --import tsx scripts/deepseek-search-release-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-search-release-regression-gate.real.json'),
      )} --verbose`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-search-release-regression-gate.real.json'),
      resolve(artifactRootDir, 'deepseek-search-regression-gate.real.json'),
      resolve(artifactRootDir, 'deepseek-search-ui-retry-probe.real.json'),
    ],
  },
  'release-message-actions': {
    label: 'Mutation release gate',
    command: artifactRootDir =>
      `node --import tsx scripts/deepseek-mutation-release-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-mutation-release-regression-gate.real.json'),
      )} --verbose`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-mutation-release-regression-gate.real.json'),
      resolve(artifactRootDir, 'deepseek-mutation-release-regression-session-store'),
    ],
  },
  'release-browser-runtime-governance': {
    label: 'Browser runtime governance release gate',
    command: artifactRootDir =>
      `node --import tsx scripts/deepseek-browser-runtime-release-regression-gate.ts --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-browser-runtime-release-regression-gate.real.json'),
      )} --headless`,
    artifactPaths: artifactRootDir => [
      resolve(artifactRootDir, 'deepseek-browser-runtime-release-regression-gate.real.json'),
      resolve(
        artifactRootDir,
        'deepseek-browser-runtime-release-regression-gate.real.artifacts',
      ),
    ],
  },
}

export function buildDeepSeekReleaseTriageReport(input: {
  diffReport: DeepSeekReleaseDiffReport
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  recommendedArtifactRootDir: string
  recommendedArtifactRoot: DeepSeekReleaseEvidenceRootDescriptor
}): DeepSeekReleaseTriageReport {
  const currentEvidence = buildEvidenceArtifacts('current', input.currentArtifacts)
  const baselineEvidence = buildEvidenceArtifacts('baseline', input.baselineArtifacts)
  const blockingList = buildBlockingList(input.diffReport)
  const impactedLayers = resolveImpactedLayers(input.diffReport)
  const disposition = resolveDisposition(input.diffReport, impactedLayers)
  const repairLane = resolveRepairLane(disposition, impactedLayers)
  const affectedScenarios = collectAffectedScenarios(blockingList)
  const notes = buildNotes(input.diffReport, disposition, repairLane)

  return {
    generatedAt: new Date().toISOString(),
    disposition,
    repairLane,
    probableReleaseChange:
      input.diffReport.fingerprintSummary.status === 'changed' ||
      input.diffReport.fingerprintSummary.status === 'mixed' ||
      impactedLayers.length > 0,
    impactedLayers,
    blockingList,
    evidence: {
      recommendedArtifactRootDir: input.recommendedArtifactRootDir,
      recommendedArtifactRoot: input.recommendedArtifactRoot,
      currentArtifacts: currentEvidence,
      baselineArtifacts: baselineEvidence,
    },
    nextSteps: buildNextSteps({
      diffReport: input.diffReport,
      disposition,
      repairLane,
      impactedLayers,
      blockingList,
      affectedScenarios,
      currentEvidence,
      baselineEvidence,
      artifactRootDir: input.recommendedArtifactRootDir,
    }),
    notes,
    diffReport: input.diffReport,
  }
}

function buildEvidenceArtifacts(
  role: 'current' | 'baseline',
  artifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekReleaseTriageEvidenceArtifact[] {
  return SCENARIO_ORDER.flatMap(scenario => {
    const artifact = artifacts[scenario]
    if (!artifact) {
      return []
    }
    return [
      {
        role,
        scenario,
        path: artifact.descriptor.path,
        provenance: artifact.descriptor.provenance,
        generatedAt: artifact.descriptor.generatedAt,
        compatibilityStatus: artifact.descriptor.compatibilityStatus,
        primaryWindowFingerprint: artifact.descriptor.primaryWindowFingerprint,
        primaryFingerprint: artifact.descriptor.primaryFingerprint,
        nestedArtifactPaths: extractArtifactPaths(artifact),
      },
    ]
  })
}

function extractArtifactPaths(artifact: DeepSeekLoadedComparableArtifact): string[] {
  const nestedPaths = new Set<string>()

  if ('artifacts' in artifact.artifact && isPlainObject(artifact.artifact.artifacts)) {
    for (const value of Object.values(artifact.artifact.artifacts)) {
      if (typeof value === 'string' && value.trim()) {
        nestedPaths.add(resolve(dirname(artifact.descriptor.path), value))
      }
    }
  }

  if ('runtime' in artifact.artifact && isPlainObject(artifact.artifact.runtime)) {
    const sessionStoreDir =
      'sessionStoreDir' in artifact.artifact.runtime
        ? artifact.artifact.runtime['sessionStoreDir']
        : null
    if (typeof sessionStoreDir === 'string' && sessionStoreDir.trim()) {
      nestedPaths.add(resolve(dirname(artifact.descriptor.path), sessionStoreDir))
    }
  }

  return [...nestedPaths].sort()
}

function buildBlockingList(
  diffReport: DeepSeekReleaseDiffReport,
): DeepSeekReleaseTriageBlockingItem[] {
  const items: DeepSeekReleaseTriageBlockingItem[] = []

  for (const layerName of LAYER_ORDER) {
    for (const scenario of diffReport.layers[layerName].scenarios) {
      if (scenario.status === 'same') {
        continue
      }
      items.push({
        id: `${layerName}:${scenario.scenario}:${scenario.status}`,
        severity: mapLayerSeverity(scenario.status),
        layer: layerName,
        scenario: scenario.scenario,
        label: `${layerName.toUpperCase()} layer ${scenario.status}`,
        reason: describeLayerReason(layerName, scenario.status),
        currentArtifactPath:
          diffReport.artifactPairs.find(pair => pair.scenario === scenario.scenario)?.current?.path ??
          null,
        baselineArtifactPath:
          diffReport.artifactPairs.find(pair => pair.scenario === scenario.scenario)?.baseline?.path ??
          null,
      })
    }
  }

  for (const capability of diffReport.capabilityMatrix.capabilities) {
    if (capability.status === 'pass') {
      continue
    }
    items.push({
      id: `capability:${capability.capabilityId}:${capability.status}`,
      severity:
        capability.status === 'fail'
          ? 'blocking'
          : capability.status === 'unknown'
            ? 'warning'
            : 'recheck',
      layer: 'capability',
      scenario: capability.scenario,
      label: `Capability ${capability.label}`,
      reason:
        capability.notes[0] ??
        `Capability is currently ${capability.status}.`,
      currentArtifactPath: capability.currentArtifactPath,
      baselineArtifactPath: capability.baselineArtifactPath,
      capabilityId: capability.capabilityId,
    })
  }

  return items.sort(compareBlockingItems)
}

function compareBlockingItems(
  left: DeepSeekReleaseTriageBlockingItem,
  right: DeepSeekReleaseTriageBlockingItem,
): number {
  const severityScore = { blocking: 0, warning: 1, recheck: 2 }
  const scenarioScore = SCENARIO_ORDER.reduce<Record<string, number>>((acc, scenario, index) => {
    acc[scenario] = index
    return acc
  }, {})
  return (
    severityScore[left.severity] - severityScore[right.severity] ||
    (scenarioScore[left.scenario] ?? 99) - (scenarioScore[right.scenario] ?? 99) ||
    left.id.localeCompare(right.id)
  )
}

function resolveImpactedLayers(
  diffReport: DeepSeekReleaseDiffReport,
): Array<'ui' | 'api' | 'output' | 'runtime'> {
  const impacted = new Set<typeof LAYER_ORDER[number]>()

  for (const layerName of LAYER_ORDER) {
    if (diffReport.layers[layerName].changedScenarioCount > 0) {
      impacted.add(layerName)
    }
  }

  if (impacted.size === 0) {
    for (const capability of diffReport.capabilityMatrix.capabilities) {
      if (capability.status !== 'fail') {
        continue
      }
      const mappedLayer = mapCapabilityAreaToLayer(capability.area)
      if (mappedLayer) {
        impacted.add(mappedLayer)
      }
    }
  }

  return LAYER_ORDER.filter(layer => impacted.has(layer))
}

function resolveDisposition(
  diffReport: DeepSeekReleaseDiffReport,
  impactedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>,
): DeepSeekReleaseTriageDisposition {
  if (impactedLayers.length > 1) {
    return 'mixed'
  }
  if (impactedLayers[0] === 'ui') {
    return 'ui-drift'
  }
  if (impactedLayers[0] === 'api') {
    return 'api-drift'
  }
  if (impactedLayers[0] === 'output') {
    return 'output-drift'
  }
  if (impactedLayers[0] === 'runtime') {
    return 'runtime-drift'
  }

  if (
    diffReport.fingerprintSummary.status === 'baseline-missing' ||
    diffReport.fingerprintSummary.status === 'mixed' ||
    hasObservationPendingSignal(diffReport)
  ) {
    return 'observation-pending'
  }

  return 'observation-pending'
}

function hasObservationPendingSignal(diffReport: DeepSeekReleaseDiffReport): boolean {
  return (
    diffReport.capabilityMatrix.summary.unknownCount > 0 ||
    diffReport.capabilityMatrix.summary.notYetRecheckedCount > 0 ||
    LAYER_ORDER.some(
      layerName =>
        diffReport.layers[layerName].baselineMissingScenarioCount > 0 ||
        diffReport.layers[layerName].currentMissingScenarioCount > 0 ||
        diffReport.layers[layerName].fingerprintUnavailableScenarioCount > 0,
    )
  )
}

function resolveRepairLane(
  disposition: DeepSeekReleaseTriageDisposition,
  impactedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>,
): DeepSeekReleaseTriageRepairLane {
  if (disposition === 'observation-pending') {
    return 'evidence-freeze'
  }

  const priorityOrder: Array<{
    layer: 'api' | 'ui' | 'output' | 'runtime'
    lane: DeepSeekReleaseTriageRepairLane
  }> = [
    { layer: 'api', lane: 'api-parser' },
    { layer: 'ui', lane: 'ui-adapter' },
    { layer: 'output', lane: 'output-adapter' },
    { layer: 'runtime', lane: 'runtime-service' },
  ]

  for (const candidate of priorityOrder) {
    if (impactedLayers.includes(candidate.layer)) {
      return candidate.lane
    }
  }

  return 'evidence-freeze'
}

function buildNotes(
  diffReport: DeepSeekReleaseDiffReport,
  disposition: DeepSeekReleaseTriageDisposition,
  repairLane: DeepSeekReleaseTriageRepairLane,
): string[] {
  const notes: string[] = []

  if (diffReport.fingerprintSummary.status === 'changed') {
    notes.push('Current and baseline DeepSeek composite fingerprints differ.')
  }
  if (diffReport.fingerprintSummary.status === 'mixed') {
    notes.push(
      'Multiple DeepSeek fingerprints were observed inside one comparison window; freeze evidence before choosing an adapter lane.',
    )
  }
  if (diffReport.fingerprintSummary.status === 'baseline-missing') {
    notes.push(
      'No known-good baseline artifact was found for at least one active scenario; triage can only classify the current evidence window.',
    )
  }
  if (
    LAYER_ORDER.some(
      layerName => diffReport.layers[layerName].fingerprintUnavailableScenarioCount > 0,
    )
  ) {
    notes.push(
      'Some selected artifacts predate release fingerprint capture; capability results remain usable, but layered diff for those scenarios stays fingerprint-unavailable.',
    )
  }
  if (disposition === 'mixed' && repairLane === 'api-parser') {
    notes.push(
      'Mixed impact includes API drift; parser / mapper repair should be prioritized before UI-only selector cleanup.',
    )
  }
  if (disposition === 'observation-pending') {
    notes.push(
      'Current evidence does not yet isolate a single UI/API/output/runtime lane; rerun the minimal probes and freeze fresh artifacts before editing adapters.',
    )
  }

  return notes
}

function buildNextSteps(input: {
  diffReport: DeepSeekReleaseDiffReport
  disposition: DeepSeekReleaseTriageDisposition
  repairLane: DeepSeekReleaseTriageRepairLane
  impactedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>
  blockingList: DeepSeekReleaseTriageBlockingItem[]
  affectedScenarios: DeepSeekReleaseComparableScenario[]
  currentEvidence: DeepSeekReleaseTriageEvidenceArtifact[]
  baselineEvidence: DeepSeekReleaseTriageEvidenceArtifact[]
  artifactRootDir: string
}): DeepSeekReleaseTriageNextStep[] {
  const evidenceArtifactPaths = [
    ...input.currentEvidence.flatMap(item => [item.path, ...item.nestedArtifactPaths]),
    ...input.baselineEvidence.flatMap(item => [item.path, ...item.nestedArtifactPaths]),
  ]
  const freezeCommands = [
    buildReproducibleTriageCommand(input.currentEvidence, input.baselineEvidence, input.artifactRootDir),
    buildReproducibleDiffCommand(input.currentEvidence, input.baselineEvidence, input.artifactRootDir),
  ]

  const minimalProbeCommands = buildMinimalProbeCommands(
    input.affectedScenarios,
    input.impactedLayers,
    input.artifactRootDir,
  )
  const minimalProbeArtifactPaths = collectScenarioArtifactRoots(
    input.affectedScenarios,
    input.artifactRootDir,
  )

  const targetedRegressionCommands = input.affectedScenarios.flatMap(scenario => [
    SCENARIO_CAPTURE_PLAN[scenario].command(input.artifactRootDir),
  ])
  const fullRegressionCommands = [
    SCENARIO_CAPTURE_PLAN['release-core'].command(input.artifactRootDir),
    SCENARIO_CAPTURE_PLAN['mode-audit'].command(input.artifactRootDir),
    SCENARIO_CAPTURE_PLAN['release-search-and-fact-check'].command(input.artifactRootDir),
    SCENARIO_CAPTURE_PLAN['release-message-actions'].command(input.artifactRootDir),
    SCENARIO_CAPTURE_PLAN['release-browser-runtime-governance'].command(input.artifactRootDir),
    SCENARIO_CAPTURE_PLAN['search-ui-retry-probe'].command(input.artifactRootDir),
    buildReproducibleDiffCommand(input.currentEvidence, input.baselineEvidence, input.artifactRootDir),
  ]

  return [
    {
      id: 'freeze-evidence',
      phase: 'freeze-evidence',
      title: 'Freeze the current evidence window',
      rationale:
        'Persist the exact current vs known-good comparison so later fixes do not overwrite the evidence that justified the triage decision.',
      commands: freezeCommands,
      artifactPaths: [...new Set(evidenceArtifactPaths)].sort(),
    },
    {
      id: 'minimal-probe',
      phase: 'minimal-probe',
      title: 'Run the minimal probes for the affected layers',
      rationale:
        'Reproduce the smallest probe set that can confirm whether the drift is UI, API, output, runtime, or still observation-pending.',
      commands: minimalProbeCommands,
      artifactPaths: minimalProbeArtifactPaths,
    },
    {
      id: 'adapter-fix',
      phase: 'adapter-fix',
      title: `Fix the ${input.repairLane} lane first`,
      rationale: describeRepairLaneRationale(input.disposition, input.repairLane),
      commands: ['npm run lint', 'npm run typecheck'],
      artifactPaths: [],
    },
    {
      id: 'targeted-regression',
      phase: 'targeted-regression',
      title: 'Re-run only the affected release gates',
      rationale:
        'Do not jump straight to the full release suite; first prove that the previously failing scenarios now pass against a single fresh fingerprint window.',
      commands: targetedRegressionCommands,
      artifactPaths: collectScenarioArtifactRoots(input.affectedScenarios, input.artifactRootDir),
    },
    {
      id: 'full-regression',
      phase: 'full-regression',
      title: 'Escalate to the full release regression suite',
      rationale:
        'Once the focused regression is green, rerun the full release comparison before declaring the upgrade adapted.',
      commands: fullRegressionCommands,
      artifactPaths: collectScenarioArtifactRoots(
        [
          'release-core',
          'mode-audit',
          'release-search-and-fact-check',
          'release-message-actions',
          'release-browser-runtime-governance',
          'search-ui-retry-probe',
        ],
        input.artifactRootDir,
      ),
    },
    {
      id: 'docs-update',
      phase: 'docs-update',
      title: 'Update the rollout plan, specs, README, and ops SOP',
      rationale:
        'Every DeepSeek upgrade must leave behind an explicit compatibility record, updated SOP notes, and the new known-good or known-bad fingerprint references.',
      commands: [],
      artifactPaths: [
        resolve(process.cwd(), 'tasks', 'TSK-V10_deepseek_chat_cdp_cli_bootstrap_PLAN.md'),
        resolve(process.cwd(), 'README.md'),
        resolve(process.cwd(), 'tasks', 'TSK-V10_deepseek_release_upgrade_SOP.md'),
      ],
    },
  ]
}

function buildReproducibleTriageCommand(
  currentEvidence: DeepSeekReleaseTriageEvidenceArtifact[],
  baselineEvidence: DeepSeekReleaseTriageEvidenceArtifact[],
  artifactRootDir: string,
): string {
  return [
    'npm run dev -- release-triage',
    ...currentEvidence.map(item => `--current-artifact ${quoteShell(item.path)}`),
    ...baselineEvidence.map(item => `--baseline-artifact ${quoteShell(item.path)}`),
    `--output ${quoteShell(resolve(artifactRootDir, 'release-triage.json'))}`,
  ].join(' ')
}

function buildReproducibleDiffCommand(
  currentEvidence: DeepSeekReleaseTriageEvidenceArtifact[],
  baselineEvidence: DeepSeekReleaseTriageEvidenceArtifact[],
  artifactRootDir: string,
): string {
  return [
    'npm run dev -- release-diff',
    ...currentEvidence.map(item => `--current-artifact ${quoteShell(item.path)}`),
    ...baselineEvidence.map(item => `--baseline-artifact ${quoteShell(item.path)}`),
    `--output ${quoteShell(resolve(artifactRootDir, 'release-diff.json'))}`,
  ].join(' ')
}

function buildMinimalProbeCommands(
  scenarios: DeepSeekReleaseComparableScenario[],
  impactedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>,
  artifactRootDir: string,
): string[] {
  const commands = new Set<string>()

  if (impactedLayers.includes('ui') || impactedLayers.length === 0) {
    commands.add('npm run dev -- inspect-home --clone-chrome-profile --headless')
    commands.add('npm run dev -- inspect-controls --clone-chrome-profile --headless')
  }
  if (impactedLayers.includes('runtime')) {
    commands.add('npm run dev -- browser list')
    commands.add('npm run dev -- browser cleanup-stale')
  }
  if (impactedLayers.includes('api')) {
    commands.add('npm run dev -- endpoints')
  }
  if (impactedLayers.includes('output')) {
    commands.add(
      'npm run dev -- reply --message "release triage smoke" --clone-chrome-profile --format text',
    )
  }

  for (const scenario of scenarios) {
    commands.add(SCENARIO_CAPTURE_PLAN[scenario].command(artifactRootDir))
    if (scenario === 'release-search-and-fact-check') {
      commands.add(SCENARIO_CAPTURE_PLAN['search-ui-retry-probe'].command(artifactRootDir))
    }
  }

  return [...commands]
}

function collectScenarioArtifactRoots(
  scenarios: DeepSeekReleaseComparableScenario[],
  artifactRootDir: string,
): string[] {
  return [...new Set(
    scenarios.flatMap(scenario => SCENARIO_CAPTURE_PLAN[scenario].artifactPaths(artifactRootDir)),
  )].sort()
}

function collectAffectedScenarios(
  blockingList: DeepSeekReleaseTriageBlockingItem[],
): DeepSeekReleaseComparableScenario[] {
  return SCENARIO_ORDER.filter(scenario =>
    blockingList.some(item => item.scenario === scenario),
  )
}

function describeRepairLaneRationale(
  disposition: DeepSeekReleaseTriageDisposition,
  repairLane: DeepSeekReleaseTriageRepairLane,
): string {
  if (repairLane === 'api-parser') {
    return disposition === 'mixed'
      ? 'API drift is present inside a mixed-impact window; stabilize parser / mapper contracts before chasing downstream UI or rendering fallout.'
      : 'The comparison isolated API schema or endpoint signature drift, so parser / mapper repair is the first blocking lane.'
  }
  if (repairLane === 'ui-adapter') {
    return 'The comparison isolated UI shell or selector drift, so control discovery and page-action adapters should be repaired before rerunning the release gates.'
  }
  if (repairLane === 'output-adapter') {
    return 'The DeepSeek behavior still executes, but rendering / export / compatibility output drifted; fix the output adapter lane before declaring the release healthy again.'
  }
  if (repairLane === 'runtime-service') {
    return 'The main drift is in browser lifecycle or runtime behavior, so runtime manager / lease / cleanup logic should be repaired first.'
  }
  return 'The evidence is still incomplete; freeze artifacts and rerun the minimal probes before picking an adapter lane.'
}

function mapLayerSeverity(
  status: DeepSeekReleaseDiffReport['layers']['ui']['scenarios'][number]['status'],
): DeepSeekReleaseTriageBlockingItem['severity'] {
  if (status === 'changed') {
    return 'blocking'
  }
  if (status === 'current-missing') {
    return 'recheck'
  }
  return 'warning'
}

function describeLayerReason(
  layer: 'ui' | 'api' | 'output' | 'runtime',
  status: DeepSeekReleaseDiffReport['layers']['ui']['scenarios'][number]['status'],
): string {
  if (status === 'changed') {
    return `${layer.toUpperCase()} comparison changed between the selected current and baseline artifacts.`
  }
  if (status === 'baseline-missing') {
    return `No known-good baseline artifact was selected for the ${layer.toUpperCase()} comparison.`
  }
  if (status === 'current-missing') {
    return `No current artifact was selected for the ${layer.toUpperCase()} comparison.`
  }
  return `The selected ${layer.toUpperCase()} artifact exists, but release fingerprint data is unavailable for layered comparison.`
}

function mapCapabilityAreaToLayer(
  area: DeepSeekReleaseDiffReport['capabilityMatrix']['capabilities'][number]['area'],
): 'ui' | 'api' | 'output' | 'runtime' | null {
  if (area === 'runtime') {
    return 'runtime'
  }
  if (area === 'mode') {
    return 'ui'
  }
  if (area === 'output' || area === 'export') {
    return 'output'
  }
  return null
}

function quoteShell(value: string): string {
  return JSON.stringify(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
