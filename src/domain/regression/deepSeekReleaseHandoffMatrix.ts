import { resolve } from 'node:path'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekChatModeAuditReport } from '../../types/deepseek-mode-audit.types.js'
import type {
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseComparableScenario,
} from '../../types/deepseek-release-diff.types.js'
import type {
  BuildDeepSeekReleaseHandoffMatrixInput,
  DeepSeekReleaseHandoffEntryStatus,
  DeepSeekReleaseHandoffHistoricalAuthority,
  DeepSeekReleaseHandoffMatrixEntry,
  DeepSeekReleaseHandoffMatrixReport,
  DeepSeekReleaseHandoffModeCoverage,
  DeepSeekReleaseHandoffPermutation,
  DeepSeekReleaseHandoffPrerequisite,
  DeepSeekReleaseModeSurfaceSummary,
} from '../../types/deepseek-release-handoff.types.js'
import type { DeepSeekReleaseCompatibilityStatus } from '../../types/deepseek-release-fingerprint.types.js'
import { resolveDeepSeekAuthoritativeCurrentWindow } from './deepSeekReleaseCurrentWindow.js'

const FALLBACK_MODES: DeepSeekChatMode[] = ['instant', 'expert', 'vision']

const HANDOFF_CURRENT_WINDOW_TASK_IDS: Partial<
  Record<DeepSeekReleaseComparableScenario, string>
> = {
  'release-core': 'B66',
  'mode-audit': 'B66B',
  'release-search-and-fact-check': 'B66A',
  'release-message-actions': 'B67',
  'release-browser-runtime-governance': 'B67A',
}

type ModeStrategy = 'all-audited-modes' | 'search-capable-modes' | 'mode-agnostic'

interface HandoffEntryDefinition {
  id: string
  taskId: string
  wave: 'wave21' | 'wave22'
  kind: 'gate' | 'audit'
  label: string
  scenarios: DeepSeekReleaseComparableScenario[]
  modeStrategy: ModeStrategy
  futureTask: boolean
  commands: (artifactRootDir: string) => string[]
  focus: (
    mode: DeepSeekReleaseHandoffModeCoverage,
    modeSurface: DeepSeekReleaseModeSurfaceSummary,
  ) => string
}

const HANDOFF_ENTRY_DEFINITIONS: HandoffEntryDefinition[] = [
  {
    id: 'wave21:b66-release-core',
    taskId: 'B66',
    wave: 'wave21',
    kind: 'gate',
    label: '首页、会话恢复、输出模式与 browser runtime 行为真机回归',
    scenarios: ['release-core'],
    modeStrategy: 'all-audited-modes',
    futureTask: false,
    commands: artifactRootDir => [
      `node --import tsx scripts/deepseek-core-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-core-regression-gate.mode-aware.json'),
      )} --verbose`,
    ],
    focus: mode =>
      mode === 'mode-agnostic'
        ? 'Cover the release-core gate once on the current runtime surface.'
        : `Run the release-core gate on ${mode} and verify home entry, session restore, stream/buffered output, and runtime reuse on the current fingerprint window.`,
  },
  {
    id: 'wave21:b66a-search-fact-check',
    taskId: 'B66A',
    wave: 'wave21',
    kind: 'gate',
    label: '搜索 / 事实核查 / 限流重试 / 引用渲染真机回归',
    scenarios: ['release-search-and-fact-check'],
    modeStrategy: 'search-capable-modes',
    futureTask: false,
    commands: artifactRootDir => [
      `node --import tsx scripts/deepseek-search-release-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-search-release-regression-gate.mode-aware.json'),
      )} --verbose`,
    ],
    focus: mode =>
      mode === 'mode-agnostic'
        ? 'Rerun the search/fact-check release gate on the current release window.'
        : `Run deep research / fact-check / citation rendering / rate-limit retry checks on ${mode}, using only modes whose current capability matrix still exposes Search + DeepThink.`,
  },
  {
    id: 'wave21:b67-mutation-export-delete',
    taskId: 'B67',
    wave: 'wave21',
    kind: 'gate',
    label: 'message actions、continue、导出、delete-session 与 runtime 复用真机回归',
    scenarios: ['release-message-actions'],
    modeStrategy: 'all-audited-modes',
    futureTask: false,
    commands: artifactRootDir => [
      `node --import tsx scripts/deepseek-mutation-release-regression-gate.ts --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-mutation-release-regression-gate.mode-aware.json'),
      )} --verbose`,
    ],
    focus: (mode, modeSurface) =>
      mode === 'expert' && modeSurface.expertFileStatus === 'confirmed-missing'
        ? 'Run edit/regenerate/continue/export/delete on Expert, but keep file upload out of scope because DeepSeek currently hides Expert attachments.'
        : mode === 'expert' && modeSurface.expertFileStatus === 'confirmed-present'
          ? 'Run edit/regenerate/continue/export/delete on Expert and re-enable attachment-aware export/render assertions because Expert exposes a real file input.'
          : mode === 'vision'
            ? 'Run edit/regenerate/continue/export/delete on Vision with an image upload, confirming modeFact=vision and local upload provenance survive stored session and export.'
        : mode === 'mode-agnostic'
          ? 'Rerun mutation/export/delete on the current release window.'
          : `Run edit/regenerate/continue/export/delete on ${mode}, confirming mutation persistence, export fidelity, and delete-session cleanup on the current mode surface.`,
  },
  {
    id: 'wave21:b67a-runtime-governance',
    taskId: 'B67A',
    wave: 'wave21',
    kind: 'gate',
    label: 'browser runtime 运维、idle watchdog、并行 runtime 与端口冲突真机回归',
    scenarios: ['release-browser-runtime-governance'],
    modeStrategy: 'mode-agnostic',
    futureTask: false,
    commands: artifactRootDir => [
      `node --import tsx scripts/deepseek-browser-runtime-release-regression-gate.ts --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-browser-runtime-release-regression-gate.real.json'),
      )} --headless`,
    ],
    focus: () =>
      'Runtime governance is mode-agnostic: verify warm reuse, idle cleanup, busy-runtime protection, and actionable port-conflict errors once per current release window.',
  },
  {
    id: 'wave21:b67b-cli-ux',
    taskId: 'B67B',
    wave: 'wave21',
    kind: 'gate',
    label: 'CLI UX 审查、--help 信息架构与参数说明收口',
    scenarios: [],
    modeStrategy: 'mode-agnostic',
    futureTask: true,
    commands: () => [
      'npm run dev -- --help',
      'npm run dev -- reply --help',
      'npm run dev -- browser --help',
    ],
    focus: () =>
      'CLI UX is mode-agnostic but must explicitly explain --chat-mode, mode-aware attachment behavior, and release/runtime command grouping.',
  },
  {
    id: 'wave22:b69-selector-drift',
    taskId: 'B69',
    wave: 'wave22',
    kind: 'audit',
    label: 'selector drift audit baseline',
    scenarios: ['release-core', 'mode-audit', 'release-message-actions'],
    modeStrategy: 'all-audited-modes',
    futureTask: true,
    commands: artifactRootDir => [
      `npm run dev -- selector-drift-audit --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-selector-drift-audit.json'),
      )} --verbose`,
    ],
    focus: mode =>
      mode === 'expert'
        ? 'Audit home/session selector families on Expert and confirm send icon is never misclassified as File.'
        : mode === 'mode-agnostic'
          ? 'Audit selector families once on the current shell.'
          : `Audit selector families on ${mode}, including mode selector visibility, composer controls, and message actions.`,
  },
  {
    id: 'wave22:b70-endpoint-drift',
    taskId: 'B70',
    wave: 'wave22',
    kind: 'audit',
    label: 'endpoint drift audit baseline',
    scenarios: ['release-core', 'mode-audit', 'release-search-and-fact-check', 'release-message-actions'],
    modeStrategy: 'all-audited-modes',
    futureTask: true,
    commands: artifactRootDir => [
      `npm run dev -- endpoint-drift-audit --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-endpoint-drift-audit.json'),
      )} --verbose`,
    ],
    focus: mode =>
      mode === 'mode-agnostic'
        ? 'Audit endpoint registry evidence, authoritative model_type signal delivery, and pending internal audit boundaries without mixing output drift into the conclusion.'
        : `Re-audit request payload / SSE ready / history_messages / mutation endpoints on ${mode}, especially the authoritative model_type signal path.`,
  },
  {
    id: 'wave22:b70a-output-drift',
    taskId: 'B70A',
    wave: 'wave22',
    kind: 'audit',
    label: '输出契约、引用渲染与导出格式漂移审计',
    scenarios: ['release-search-and-fact-check', 'release-message-actions'],
    modeStrategy: 'all-audited-modes',
    futureTask: true,
    commands: artifactRootDir => [
      `npm run dev -- output-drift-audit --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-output-drift-audit.json'),
      )} --verbose`,
    ],
    focus: (mode, modeSurface) =>
      mode === 'expert' && modeSurface.expertFileStatus === 'confirmed-missing'
        ? 'Audit text/json/export on Expert while preserving the temporary “Expert attachments disabled” boundary instead of fabricating attachment output.'
        : mode === 'expert' && modeSurface.expertFileStatus === 'confirmed-present'
          ? 'Audit text/json/export on Expert with attachment-aware rendering back in scope, rather than carrying forward a disabled-attachment baseline.'
          : mode === 'vision'
            ? 'Audit Vision image output/export drift with modeFact=vision and upload provenance in scope, without claiming OpenAI HTTP image input support.'
        : mode === 'mode-agnostic'
          ? 'Audit output/render drift on the current release window.'
          : `Audit text/json/export drift on ${mode}, including citations, searches, response references, and mode fact persistence.`,
  },
  {
    id: 'wave22:b71-release-audit',
    taskId: 'B71',
    wave: 'wave22',
    kind: 'audit',
    label: 'release audit report 与发布门禁',
    scenarios: [
      'release-core',
      'mode-audit',
      'release-search-and-fact-check',
      'release-message-actions',
      'release-browser-runtime-governance',
    ],
    modeStrategy: 'all-audited-modes',
    futureTask: false,
    commands: artifactRootDir => [
      `npm run dev -- release-audit --output ${quoteShell(resolve(artifactRootDir, 'release-audit.json'))}`,
    ],
    focus: mode =>
      mode === 'mode-agnostic'
        ? 'The final release audit must aggregate all current release evidence, unresolved boundaries, and future-task gaps before claiming publishable stability.'
        : `Aggregate current ${mode} evidence into the final release audit so old mode-less gate passes cannot stand in for the new mode surface.`,
  },
]

export function buildDeepSeekReleaseHandoffMatrixReport(
  input: BuildDeepSeekReleaseHandoffMatrixInput,
): DeepSeekReleaseHandoffMatrixReport {
  const authoritativeCurrentWindow = resolveAuthoritativeReleaseWindow(input)
  const modeAuditArtifact = isCurrentReleaseQualifiedArtifact(
    input.currentArtifacts['mode-audit'],
    authoritativeCurrentWindow.primaryFingerprint,
  )
    ? input.currentArtifacts['mode-audit']
    : undefined
  const modeSurface = buildModeSurfaceSummary(modeAuditArtifact)
  const modeAuditPrerequisite = buildModeAuditPrerequisite(
    modeSurface,
    input.currentArtifacts['mode-audit'],
    input.baselineArtifacts['mode-audit'],
    input.artifactRootDir,
    authoritativeCurrentWindow.primaryFingerprint,
  )
  const prerequisites = [modeAuditPrerequisite]

  const historicalInvalidations = buildHistoricalInvalidations(
    input,
    modeSurface,
  )
  const wave21Entries = HANDOFF_ENTRY_DEFINITIONS.filter(entry => entry.wave === 'wave21').map(
    entry =>
      buildMatrixEntry(
        entry,
        input,
        modeSurface,
        modeAuditPrerequisite.status,
        authoritativeCurrentWindow.primaryFingerprint,
      ),
  )
  const wave22Entries = HANDOFF_ENTRY_DEFINITIONS.filter(entry => entry.wave === 'wave22').map(
    entry =>
      buildMatrixEntry(
        entry,
        input,
        modeSurface,
        modeAuditPrerequisite.status,
        authoritativeCurrentWindow.primaryFingerprint,
      ),
  )

  return {
    generatedAt: new Date().toISOString(),
    authoritativeCurrentWindow,
    releaseWindow: {
      fingerprintStatus: input.diffReport.fingerprintSummary.status,
      oldCompositeFingerprints: input.diffReport.fingerprintSummary.baselineCompositeFingerprints,
      newCompositeFingerprints: input.diffReport.fingerprintSummary.currentCompositeFingerprints,
    },
    summary: {
      historicalInvalidationCount: historicalInvalidations.length,
      futureTaskCount: HANDOFF_ENTRY_DEFINITIONS.filter(entry => entry.futureTask).length,
      modeCoverage: resolveModeCoverage('all-audited-modes', modeSurface),
    },
    modeSurface,
    prerequisites,
    historicalInvalidations,
    wave21: buildMatrixSection(wave21Entries),
    wave22: buildMatrixSection(wave22Entries),
    notes: buildNotes(input, modeSurface, modeAuditPrerequisite),
    diffReport: input.diffReport,
    boundaryReport: input.boundaryReport,
    triageReport: input.triageReport,
    revalidationReport: input.revalidationReport,
  }
}

function resolveAuthoritativeReleaseWindow(
  input: BuildDeepSeekReleaseHandoffMatrixInput,
) {
  const supportEntries = Object.entries(input.currentArtifacts).flatMap(([scenario, artifact]) => {
    const comparableScenario = scenario as DeepSeekReleaseComparableScenario
    if (
      !artifact?.descriptor.path ||
      !artifact.descriptor.primaryWindowFingerprint ||
      !HANDOFF_CURRENT_WINDOW_TASK_IDS[comparableScenario]
    ) {
      return []
    }
    return [{
      taskId: HANDOFF_CURRENT_WINDOW_TASK_IDS[comparableScenario] ?? null,
      scenario: comparableScenario,
      kind: 'gate' as const,
      artifactPath: artifact.descriptor.path,
      generatedAt: artifact.descriptor.generatedAt,
      primaryWindowFingerprint: artifact.descriptor.primaryWindowFingerprint,
      primaryReleaseFamilyFingerprint: artifact.descriptor.primaryFingerprint,
    }]
  })

  return resolveDeepSeekAuthoritativeCurrentWindow({
    selectedFingerprintStatus: input.diffReport.fingerprintSummary.status,
    supportEntries,
  })
}

function buildModeSurfaceSummary(
  artifact: DeepSeekLoadedComparableArtifact | undefined,
): DeepSeekReleaseModeSurfaceSummary {
  const report = extractModeAuditReport(artifact)
  if (!report) {
    return {
      defaultMode: null,
      observedModes: [],
      searchCapableModes: [],
      expertFileStatus: 'unresolved',
      modeSelectorVisible: null,
      factMappings: [],
      notes: [
        'No current mode-audit artifact is selected for this release window.',
        'Mode-aware handoff therefore fail-closes to Instant, Expert, and Vision until a fresh mode audit is captured.',
      ],
    }
  }

  const observedModes = [...new Set([
    ...report.defaultHomeSurface.availableModes,
    ...report.scenarios.map(scenario => scenario.requestedMode),
  ])].sort()
  const searchCapableModes = report.scenarios
    .filter(
      scenario =>
        scenario.sessionCapabilities.deepThink && scenario.sessionCapabilities.search,
    )
    .map(scenario => scenario.requestedMode)
    .sort()
  const expertScenario = report.scenarios.find(scenario => scenario.requestedMode === 'expert')
  const expertFileStatus = !expertScenario
    ? 'unresolved'
    : expertScenario.homeCapabilities.fileInput ||
        expertScenario.sessionCapabilities.fileInput ||
        expertScenario.reopenedSessionCapabilities.fileInput
      ? 'confirmed-present'
      : 'confirmed-missing'

  return {
    defaultMode: report.defaultHomeSurface.activeMode,
    observedModes,
    searchCapableModes,
    expertFileStatus,
    modeSelectorVisible: report.defaultHomeSurface.modeSelectorVisible,
    factMappings: report.scenarios.map(scenario => ({
      mode: scenario.requestedMode,
      requestModelType: readRawModelType(scenario, 'request-payload'),
      readyModelType: readRawModelType(scenario, 'generation-ready-sse'),
      historyModelType: readRawModelType(scenario, 'history-messages-raw'),
    })),
    notes: buildModeSurfaceNotes(report, expertFileStatus),
  }
}

function buildModeAuditPrerequisite(
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
  currentArtifact: DeepSeekLoadedComparableArtifact | undefined,
  baselineArtifact: DeepSeekLoadedComparableArtifact | undefined,
  artifactRootDir: string,
  authoritativeWindowFingerprint: string | null,
): DeepSeekReleaseHandoffPrerequisite {
  const currentPaths = currentArtifact ? [currentArtifact.descriptor.path] : []
  const baselinePaths = baselineArtifact ? [baselineArtifact.descriptor.path] : []
  const currentArtifactQualified = isCurrentReleaseQualifiedArtifact(
    currentArtifact,
    authoritativeWindowFingerprint,
  )
  const compatibilityStatus = currentArtifactQualified
    ? currentArtifact.descriptor.compatibilityStatus
    : null

  let status: DeepSeekReleaseHandoffEntryStatus
  if (compatibilityStatus === 'known-good') {
    status = 'covered-by-current-artifact'
  } else if (compatibilityStatus === 'known-bad') {
    status = 'blocked'
  } else if (currentArtifact) {
    status = 'pending-rerun'
  } else {
    status = 'mode-observation-pending'
  }

  return {
    id: 'mode-audit',
    label: 'Current mode surface must be observed before Wave 21 / Wave 22 reuse decisions are trusted.',
    status,
    historicalAuthority:
      status === 'covered-by-current-artifact'
        ? 'superseded-by-current-artifact'
        : baselinePaths.length > 0 || (currentArtifact && !currentArtifactQualified)
          ? 'baseline-only'
          : 'not-available',
    reasons: [
      ...(status === 'covered-by-current-artifact'
        ? ['A current mode-audit artifact already covers the current release window.']
        : []),
      ...(status === 'blocked'
        ? ['The current mode-audit artifact is known-bad on this release window and must be repaired before mode-aware handoff can be trusted.']
        : []),
      ...(status === 'pending-rerun'
        ? ['A current mode-audit artifact exists, but it is not yet promoted to known-good on this release window.']
        : []),
      ...(status === 'mode-observation-pending'
        ? ['No current mode-audit artifact is available, so mode-aware handoff must fail-closed.']
        : []),
      ...(currentArtifact && !currentArtifactQualified
        ? ['A selected mode-audit artifact exists, but it predates release fingerprint capture or lacks current-window fingerprint evidence, so it cannot be promoted as current proof.']
        : []),
      ...modeSurface.notes,
    ],
    commands: [
      `npm run dev -- mode-audit --clone-chrome-profile --output ${quoteShell(
        resolve(artifactRootDir, 'deepseek-mode-audit.handoff.json'),
      )} --verbose`,
    ],
    currentArtifactPaths: currentPaths,
    baselineArtifactPaths: baselinePaths,
  }
}

function buildHistoricalInvalidations(
  input: BuildDeepSeekReleaseHandoffMatrixInput,
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
) {
  const invalidations = HANDOFF_ENTRY_DEFINITIONS.flatMap(definition => {
    if (definition.scenarios.length === 0) {
      return []
    }

    const baselineArtifactPaths = collectScenarioArtifactPaths(
      definition.scenarios,
      input.baselineArtifacts,
    )
    if (baselineArtifactPaths.length === 0) {
      return []
    }

    if (
      input.diffReport.fingerprintSummary.status === 'same' &&
      !hasModeSensitiveDrift(definition.scenarios, input)
    ) {
      return []
    }

    return [
      {
        id: `historical:${definition.taskId}`,
        taskId: definition.taskId,
        label: definition.label,
        affectedModes: resolveModeCoverage(definition.modeStrategy, modeSurface),
        reasons: buildHistoricalInvalidationReasons(definition.scenarios, input, modeSurface),
        baselineArtifactPaths,
      },
    ]
  })

  return invalidations
}

function buildMatrixEntry(
  definition: HandoffEntryDefinition,
  input: BuildDeepSeekReleaseHandoffMatrixInput,
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
  prerequisiteStatus: DeepSeekReleaseHandoffEntryStatus,
  authoritativeWindowFingerprint: string | null,
): DeepSeekReleaseHandoffMatrixEntry {
  const modeCoverage = resolveModeCoverage(definition.modeStrategy, modeSurface)
  const currentArtifacts = definition.scenarios
    .map(scenario => input.currentArtifacts[scenario])
    .filter((artifact): artifact is DeepSeekLoadedComparableArtifact => Boolean(artifact))
  const qualifiedCurrentArtifacts = currentArtifacts.filter(artifact =>
    isCurrentReleaseQualifiedArtifact(artifact, authoritativeWindowFingerprint),
  )
  const currentArtifactPaths = collectScenarioArtifactPaths(
    definition.scenarios,
    input.currentArtifacts,
  )
  const qualifiedCurrentArtifactPaths = qualifiedCurrentArtifacts
    .map(artifact => artifact.descriptor.path)
    .sort()
  const baselineArtifactPaths = collectScenarioArtifactPaths(
    definition.scenarios,
    input.baselineArtifacts,
  )
  const currentCompatibilityStatuses = qualifiedCurrentArtifacts
    .map(artifact => artifact.descriptor.compatibilityStatus)
    .filter(
      (status): status is DeepSeekReleaseCompatibilityStatus =>
        status === 'known-good' || status === 'known-bad' || status === 'pending',
    )
  const hasUnqualifiedCurrentArtifacts = currentArtifacts.some(
    artifact => !isCurrentReleaseQualifiedArtifact(artifact, authoritativeWindowFingerprint),
  )
  const artifactCoveredModes = collectComparableArtifactCoveredModes(
    definition.scenarios,
    input.currentArtifacts,
  )
  const requiredArtifactModes = modeCoverage.filter(
    (mode): mode is DeepSeekChatMode => isDeepSeekChatMode(mode),
  )
  const artifactModeCoverageSatisfied =
    !requiresExplicitArtifactModeCoverage(definition) ||
    requiredArtifactModes.every(mode => artifactCoveredModes.includes(mode))

  const status = resolveEntryStatus({
    definition,
    currentArtifactPaths: qualifiedCurrentArtifactPaths,
    currentCompatibilityStatuses,
    prerequisiteStatus,
    artifactModeCoverageSatisfied,
  })

  return {
    id: definition.id,
    taskId: definition.taskId,
    wave: definition.wave,
    kind: definition.kind,
    label: definition.label,
    scenarios: definition.scenarios,
    modeCoverage,
    requiredPermutations: modeCoverage.map(mode => ({
      id: `${definition.taskId}:${mode}`,
      mode,
      label: mode === 'mode-agnostic' ? 'Mode-agnostic' : `${capitalize(mode)} path`,
      focus: definition.focus(mode, modeSurface),
    }) satisfies DeepSeekReleaseHandoffPermutation),
    status,
    historicalAuthority: resolveHistoricalAuthority(
      status,
      baselineArtifactPaths,
      hasUnqualifiedCurrentArtifacts,
    ),
    reasons: buildEntryReasons(
      definition,
      input,
      modeSurface,
      status,
      prerequisiteStatus,
      hasUnqualifiedCurrentArtifacts,
      artifactModeCoverageSatisfied,
    ),
    commands: definition.commands(input.artifactRootDir),
    currentArtifactPaths,
    baselineArtifactPaths,
  }
}

function buildMatrixSection(entries: DeepSeekReleaseHandoffMatrixEntry[]) {
  return {
    rerunRequiredCount: entries.filter(
      entry => entry.status === 'pending-rerun' || entry.status === 'mode-observation-pending',
    ).length,
    coveredCount: entries.filter(entry => entry.status === 'covered-by-current-artifact').length,
    blockedCount: entries.filter(entry => entry.status === 'blocked').length,
    entries,
  }
}

function resolveEntryStatus(input: {
  definition: HandoffEntryDefinition
  currentArtifactPaths: string[]
  currentCompatibilityStatuses: DeepSeekReleaseCompatibilityStatus[]
  prerequisiteStatus: DeepSeekReleaseHandoffEntryStatus
  artifactModeCoverageSatisfied: boolean
}): DeepSeekReleaseHandoffEntryStatus {
  if (
    input.definition.modeStrategy !== 'mode-agnostic' &&
    input.prerequisiteStatus !== 'covered-by-current-artifact'
  ) {
    return 'mode-observation-pending'
  }

  if (input.definition.futureTask) {
    return 'pending-rerun'
  }

  if (input.currentCompatibilityStatuses.includes('known-bad')) {
    return 'blocked'
  }

  if (!input.artifactModeCoverageSatisfied) {
    return 'pending-rerun'
  }

  if (
    input.currentCompatibilityStatuses.length > 0 &&
    input.currentCompatibilityStatuses.every(status => status === 'known-good') &&
    (input.definition.scenarios.length === 0 || input.currentArtifactPaths.length > 0)
  ) {
    return 'covered-by-current-artifact'
  }

  return 'pending-rerun'
}

function resolveHistoricalAuthority(
  status: DeepSeekReleaseHandoffEntryStatus,
  baselineArtifactPaths: string[],
  hasUnqualifiedCurrentArtifacts = false,
): DeepSeekReleaseHandoffHistoricalAuthority {
  if (status === 'covered-by-current-artifact') {
    return 'superseded-by-current-artifact'
  }
  if (baselineArtifactPaths.length > 0 || hasUnqualifiedCurrentArtifacts) {
    return 'baseline-only'
  }
  return 'not-available'
}

function buildEntryReasons(
  definition: HandoffEntryDefinition,
  input: BuildDeepSeekReleaseHandoffMatrixInput,
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
  status: DeepSeekReleaseHandoffEntryStatus,
  prerequisiteStatus: DeepSeekReleaseHandoffEntryStatus,
  hasUnqualifiedCurrentArtifacts: boolean,
  artifactModeCoverageSatisfied: boolean,
): string[] {
  const reasons: string[] = []

  if (input.diffReport.fingerprintSummary.status !== 'same') {
    reasons.push(
      'The selected DeepSeek release window differs from the latest known-good baseline, so historical gate passes cannot be reused as current proof.',
    )
  }
  if (hasModeSensitiveDrift(definition.scenarios, input)) {
    reasons.push(
      'Mode-surface or mode capability drift is present for one or more related scenarios.',
    )
  }
  if (
    definition.modeStrategy !== 'mode-agnostic' &&
    prerequisiteStatus !== 'covered-by-current-artifact'
  ) {
    reasons.push(
      'A current mode-audit artifact is still missing or not green, so this handoff entry stays fail-closed.',
    )
  }
  if (definition.futureTask) {
    reasons.push(
      'This remains a future Wave task. The handoff matrix keeps it explicit instead of pretending there is already a dedicated finished gate.',
    )
  }
  if (hasUnqualifiedCurrentArtifacts) {
    reasons.push(
      'A selected artifact exists for this scenario, but it predates release fingerprint capture or lacks current-window fingerprint evidence, so it remains baseline-only rather than current proof.',
    )
  }
  if (requiresExplicitArtifactModeCoverage(definition) && !artifactModeCoverageSatisfied) {
    reasons.push(
      'The current artifact does not yet declare coverage for every required chat mode in this handoff entry, so this entry remains pending until mode-aware evidence is explicit.',
    )
  }
  if (status === 'covered-by-current-artifact') {
    reasons.push('A current artifact already covers this entry on the selected release window.')
  }
  if (status === 'blocked') {
    reasons.push('Current evidence marks this entry known-bad, so rerun alone is not enough before repair.')
  }
  if (status === 'pending-rerun' && definition.scenarios.length === 0) {
    reasons.push('No artifact-backed coverage exists yet; the task remains a queued handoff item.')
  }
  if (
    definition.taskId === 'B67' &&
    modeSurface.expertFileStatus === 'confirmed-missing'
  ) {
    reasons.push(
      'DeepSeek currently hides Expert attachments, so mutation/export coverage must preserve the temporary disabled boundary instead of forcing attachment flows.',
    )
  }
  return [...new Set(reasons)]
}

function isCurrentReleaseQualifiedArtifact(
  artifact: DeepSeekLoadedComparableArtifact | undefined,
  authoritativeWindowFingerprint: string | null,
): artifact is DeepSeekLoadedComparableArtifact {
  return Boolean(
    artifact &&
      authoritativeWindowFingerprint &&
      artifact.descriptor.primaryWindowFingerprint === authoritativeWindowFingerprint &&
      artifact.releaseFingerprints.length > 0,
  )
}

function requiresExplicitArtifactModeCoverage(definition: HandoffEntryDefinition): boolean {
  return definition.taskId === 'B66A' || definition.taskId === 'B67'
}

function collectComparableArtifactCoveredModes(
  scenarios: readonly DeepSeekReleaseComparableScenario[],
  artifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): DeepSeekChatMode[] {
  const coveredModes = scenarios.flatMap(scenario => {
    const artifact = artifacts[scenario]?.artifact
    if (!artifact || typeof artifact !== 'object') {
      return []
    }
    const candidate = (artifact as { coveredChatModes?: unknown }).coveredChatModes
    if (!Array.isArray(candidate)) {
      return []
    }
    return candidate.filter((mode): mode is DeepSeekChatMode => isDeepSeekChatMode(mode))
  })

  return [...new Set(coveredModes)].sort()
}

function buildNotes(
  input: BuildDeepSeekReleaseHandoffMatrixInput,
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
  prerequisite: DeepSeekReleaseHandoffPrerequisite,
): string[] {
  const notes = [
    'Old gate passes remain baseline-only unless a current artifact proves the same capability on the current fingerprint window.',
    'Mode-aware handoff distinguishes current mode facts from home-page labels; request payload, ready SSE, and history_messages model_type remain the authoritative sources.',
  ]

  if (modeSurface.expertFileStatus === 'confirmed-missing') {
    notes.push(
      'DeepSeek currently hides Expert attachments, so future gates must keep Expert file upload out of scope until the surface returns.',
    )
  } else if (modeSurface.expertFileStatus === 'confirmed-present') {
    notes.push(
      'Expert exposes a real file input on the selected current artifact, so future gates may bring attachment-aware assertions back into scope.',
    )
  }
  if (prerequisite.status !== 'covered-by-current-artifact') {
    notes.push(
      'Because mode-audit is not yet green on the selected release window, the matrix fail-closes to Instant, Expert, and Vision for any mode-sensitive gate.',
    )
  }
  if (!input.revalidationReport.waveReadiness.wave21EntryAllowed) {
    notes.push(
      'Wave 21 entry is still blocked at the revalidation layer; even a detailed handoff matrix does not override release-revalidate readiness.',
    )
  }
  if (!input.revalidationReport.waveReadiness.wave22AuditAllowed) {
    notes.push(
      'Wave 22 audit entry remains gated by full release reruns and docs/spec updates, even if some current gate artifacts already exist.',
    )
  }

  return notes
}

function hasModeSensitiveDrift(
  scenarios: DeepSeekReleaseComparableScenario[],
  input: BuildDeepSeekReleaseHandoffMatrixInput,
): boolean {
  return scenarios.some(scenario => {
    const uiScenario = input.diffReport.layers.ui.scenarios.find(item => item.scenario === scenario)
    if (uiScenario && uiScenario.status === 'changed' && uiScenario.modeSurfaceFingerprintChanged) {
      return true
    }
    return input.diffReport.capabilityMatrix.capabilities.some(
      capability =>
        capability.area === 'mode' &&
        capability.scenario === scenario &&
        capability.status !== 'pass',
    )
  })
}

function buildHistoricalInvalidationReasons(
  scenarios: DeepSeekReleaseComparableScenario[],
  input: BuildDeepSeekReleaseHandoffMatrixInput,
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
): string[] {
  const reasons = []

  if (input.diffReport.fingerprintSummary.status !== 'same') {
    reasons.push('The current release fingerprint no longer matches the baseline gate window.')
  }
  if (hasModeSensitiveDrift(scenarios, input)) {
    reasons.push('Mode-surface drift means old mode-less or old-mode gate passes cannot be treated as current proof.')
  }
  if (modeSurface.expertFileStatus === 'confirmed-missing') {
    reasons.push('Expert attachment capability changed, so any historical gate that assumed a file control is baseline-only.')
  }

  return [...new Set(reasons)]
}

function collectScenarioArtifactPaths(
  scenarios: DeepSeekReleaseComparableScenario[],
  artifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>,
): string[] {
  return [...new Set(
    scenarios
      .map(scenario => artifacts[scenario]?.descriptor.path)
      .filter((path): path is string => typeof path === 'string'),
  )].sort()
}

function resolveModeCoverage(
  strategy: ModeStrategy,
  modeSurface: DeepSeekReleaseModeSurfaceSummary,
): DeepSeekReleaseHandoffModeCoverage[] {
  if (strategy === 'mode-agnostic') {
    return ['mode-agnostic']
  }

  const candidates =
    strategy === 'search-capable-modes' && modeSurface.searchCapableModes.length > 0
      ? modeSurface.searchCapableModes
      : modeSurface.observedModes.length > 0
        ? modeSurface.observedModes
        : FALLBACK_MODES

  return [...new Set(candidates)].sort()
}

function extractModeAuditReport(
  artifact: DeepSeekLoadedComparableArtifact | undefined,
): DeepSeekChatModeAuditReport | null {
  if (!artifact) {
    return null
  }
  if ('scenario' in artifact.artifact && artifact.artifact.scenario === 'mode-audit') {
    return artifact.artifact
  }
  return null
}

function readRawModelType(
  scenario: DeepSeekChatModeAuditReport['scenarios'][number],
  layer: 'request-payload' | 'generation-ready-sse' | 'history-messages-raw',
): string | null {
  return (
    scenario.authoritySignals.find(signal => signal.layer === layer)?.rawModelType ?? null
  )
}

function buildModeSurfaceNotes(
  report: DeepSeekChatModeAuditReport,
  expertFileStatus: DeepSeekReleaseModeSurfaceSummary['expertFileStatus'],
): string[] {
  const notes = [
    `Default home mode is ${report.defaultHomeSurface.activeMode ?? 'unknown'} on the selected current artifact.`,
  ]
  const visionScenario = report.scenarios.find(scenario => scenario.requestedMode === 'vision')

  if (expertFileStatus === 'confirmed-missing') {
    notes.push('Expert attachments are hidden on the selected current artifact.')
  } else if (expertFileStatus === 'confirmed-present') {
    notes.push('Expert exposes a real file input on the selected current artifact.')
  } else {
    notes.push('Expert file capability is still unresolved on the selected current artifact.')
  }
  if (!visionScenario) {
    notes.push('Vision image mode is not observed on the selected current artifact.')
  } else if (hasVisionFileEvidence(visionScenario)) {
    notes.push('Vision image mode has upload/mount/ref_file_ids evidence on the selected current artifact.')
  } else {
    notes.push(
      'Vision image mode is observed, but upload/ref_file_ids evidence is incomplete on the selected current artifact.',
    )
  }

  return notes
}

function isDeepSeekChatMode(mode: unknown): mode is DeepSeekChatMode {
  return mode === 'instant' || mode === 'expert' || mode === 'vision'
}

function hasVisionFileEvidence(
  scenario: DeepSeekChatModeAuditReport['scenarios'][number],
): boolean {
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

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
