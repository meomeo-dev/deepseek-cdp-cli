import type { DeepSeekReleaseChangeLedgerReport } from '../../types/deepseek-release-change-ledger.types.js'
import type {
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from '../../types/deepseek-release-diff.types.js'
import type { DeepSeekReleaseHandoffMatrixReport } from '../../types/deepseek-release-handoff.types.js'
import type { DeepSeekReleaseBoundaryReport } from '../../types/deepseek-release-boundary.types.js'
import type { DeepSeekReleaseRevalidationReport } from '../../types/deepseek-release-revalidation.types.js'
import type { DeepSeekReleaseTriageReport } from '../../types/deepseek-release-triage.types.js'
import type {
  DeepSeekReleaseAuditBoundaryItem,
  DeepSeekReleaseAuditEvidenceClassification,
  DeepSeekReleaseAuditEvidenceEntry,
  DeepSeekReleaseAuditFreshnessStatus,
  DeepSeekReleaseAuditGateStatus,
  DeepSeekReleaseAuditReport,
  DeepSeekReleaseAuditSupplementalScenario,
} from '../../types/deepseek-release-audit.types.js'
import type {
  DeepSeekEndpointDriftAuditReport,
} from '../../types/deepseek-endpoint-drift-audit.types.js'
import type {
  DeepSeekOutputDriftAuditReport,
} from '../../types/deepseek-output-drift-audit.types.js'
import type {
  DeepSeekSelectorDriftAuditReport,
} from '../../types/deepseek-selector-drift-audit.types.js'
import { resolveDeepSeekAuthoritativeCurrentWindow } from './deepSeekReleaseCurrentWindow.js'

interface SupplementalAuditArtifact<TArtifact> {
  scenario: DeepSeekReleaseAuditSupplementalScenario
  path: string
  generatedAt: string | null
  primaryWindowFingerprint: string | null
  primaryFingerprint: string | null
  compatibilityStatus: string | null
  failureCount: number
  warningCount: number
  artifact: TArtifact
}

interface ReleaseAuditEvidenceDefinition {
  taskId: string
  label: string
  wave: 'wave21' | 'wave22'
  kind: 'gate' | 'audit'
  source: 'comparable' | 'supplemental'
  scenario: DeepSeekReleaseComparableScenario | DeepSeekReleaseAuditSupplementalScenario
}

const RELEASE_AUDIT_EVIDENCE_DEFINITIONS: ReleaseAuditEvidenceDefinition[] = [
  {
    taskId: 'B66',
    label: '首页、会话恢复、输出模式与 browser runtime 行为真机回归',
    wave: 'wave21',
    kind: 'gate',
    source: 'comparable',
    scenario: 'release-core',
  },
  {
    taskId: 'B66A',
    label: '搜索 / 事实核查 / 限流重试 / 引用渲染真机回归',
    wave: 'wave21',
    kind: 'gate',
    source: 'comparable',
    scenario: 'release-search-and-fact-check',
  },
  {
    taskId: 'B66B',
    label: 'mode-audit、composer controls 状态切换与 permutation freeze 真机回归',
    wave: 'wave21',
    kind: 'gate',
    source: 'comparable',
    scenario: 'mode-audit',
  },
  {
    taskId: 'B67',
    label: 'message actions、continue、导出、delete-session 与 runtime 复用真机回归',
    wave: 'wave21',
    kind: 'gate',
    source: 'comparable',
    scenario: 'release-message-actions',
  },
  {
    taskId: 'B67A',
    label: 'browser runtime 运维、idle watchdog、并行 runtime 与端口冲突真机回归',
    wave: 'wave21',
    kind: 'gate',
    source: 'comparable',
    scenario: 'release-browser-runtime-governance',
  },
  {
    taskId: 'B69',
    label: 'selector drift audit baseline',
    wave: 'wave22',
    kind: 'audit',
    source: 'supplemental',
    scenario: 'selector-drift-audit',
  },
  {
    taskId: 'B70',
    label: 'endpoint drift audit baseline',
    wave: 'wave22',
    kind: 'audit',
    source: 'supplemental',
    scenario: 'endpoint-drift-audit',
  },
  {
    taskId: 'B70A',
    label: '输出契约、引用渲染与导出格式漂移审计',
    wave: 'wave22',
    kind: 'audit',
    source: 'supplemental',
    scenario: 'output-drift-audit',
  },
]

const ACCEPTED_B66A_WARNING_IDS = new Set([
  'rate-limit-output',
  'auto-retry-cooldown-replay',
  'ui-retry-confirmed-path',
  'ui-retry-unresolved-boundaries',
])

const ACCEPTED_B69_WARNING_IDS = new Set([
  'message-action-selector-family',
  'search-retry-fixture-baseline',
])

const ACCEPTED_B70_WARNING_IDS = new Set([
  'search-rate-limit-hint-close-baseline',
])

const EXPECTED_B66A_SURFACES = ['home', 'session.expert', 'session.instant'] as const

type DeepSeekReleaseAuditSurfaceKey = (typeof EXPECTED_B66A_SURFACES)[number]

export function buildDeepSeekReleaseAuditReport(input: {
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  revalidationReport: DeepSeekReleaseRevalidationReport
  handoffMatrixReport: DeepSeekReleaseHandoffMatrixReport
  changeLedgerReport: DeepSeekReleaseChangeLedgerReport
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  selectorDriftAudit?: SupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
  endpointDriftAudit?: SupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
  outputDriftAudit?: SupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
}): DeepSeekReleaseAuditReport {
  const authoritativeWindow = resolveAuthoritativeReleaseWindow(input)
  const authoritativeFingerprints = authoritativeWindow.primaryFingerprint
    ? [authoritativeWindow.primaryFingerprint]
    : authoritativeWindow.candidateFingerprints
  const evidenceEntries = RELEASE_AUDIT_EVIDENCE_DEFINITIONS.map(definition =>
    buildEvidenceEntry(definition, input, authoritativeFingerprints),
  )

  const currentProofInventory = evidenceEntries.filter(
    entry => entry.classification === 'current-proof',
  )
  const currentAuditEvidence = evidenceEntries.filter(
    entry => entry.classification === 'current-audit-evidence',
  )
  const baselineOnlyEvidence = evidenceEntries.filter(
    entry => entry.classification === 'baseline-only',
  )
  const publishGate = buildPublishGate(evidenceEntries)
  const unresolvedBoundaries = buildUnresolvedBoundaries(input)
  const notes = buildReleaseAuditNotes(
    input,
    authoritativeWindow.source,
    authoritativeFingerprints,
    evidenceEntries,
  )

  return {
    generatedAt: new Date().toISOString(),
    authoritativeCurrentWindow: authoritativeWindow,
    releaseWindow: {
      fingerprintStatus: input.diffReport.fingerprintSummary.status,
      authoritativeSource: authoritativeWindow.source,
      authoritativeCompositeFingerprints: authoritativeFingerprints,
      oldCompositeFingerprints: input.diffReport.fingerprintSummary.baselineCompositeFingerprints,
      selectedCurrentCompositeFingerprints:
        input.diffReport.fingerprintSummary.currentCompositeFingerprints,
    },
    summary: {
      passCount: evidenceEntries.filter(entry => entry.gateStatus === 'pass').length,
      failCount: evidenceEntries.filter(entry => entry.gateStatus === 'fail').length,
      unknownCount: evidenceEntries.filter(entry => entry.gateStatus === 'unknown').length,
      notYetRecheckedCount: evidenceEntries.filter(
        entry => entry.gateStatus === 'not-yet-rechecked',
      ).length,
    },
    publishGate,
    currentProofInventory,
    currentAuditEvidence,
    baselineOnlyEvidence,
    artifactFreshness: {
      authoritativeSource: authoritativeWindow.source,
      authoritativeCompositeFingerprints: authoritativeFingerprints,
      currentProofCount: currentProofInventory.length,
      currentAuditEvidenceCount: currentAuditEvidence.length,
      baselineOnlyCount: baselineOnlyEvidence.length,
      missingCount: evidenceEntries.filter(entry => entry.classification === 'missing').length,
      entries: evidenceEntries,
    },
    unresolvedBoundaries,
    notes,
    diffReport: input.diffReport,
    boundaryReport: input.boundaryReport,
    triageReport: input.triageReport,
    revalidationReport: input.revalidationReport,
    handoffMatrixReport: input.handoffMatrixReport,
    changeLedgerReport: input.changeLedgerReport,
  }
}

function resolveAuthoritativeReleaseWindow(input: {
  diffReport: DeepSeekReleaseDiffReport
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  selectorDriftAudit?: SupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
  endpointDriftAudit?: SupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
  outputDriftAudit?: SupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
}) {
  const supportEntries = RELEASE_AUDIT_EVIDENCE_DEFINITIONS.flatMap(definition => {
    if (definition.source === 'comparable') {
      const artifact = input.currentArtifacts[
        definition.scenario as DeepSeekReleaseComparableScenario
      ]
      if (!artifact?.descriptor.path || !artifact.descriptor.primaryWindowFingerprint) {
        return []
      }
      return [{
        taskId: definition.taskId,
        scenario: definition.scenario,
        kind: definition.kind,
        artifactPath: artifact.descriptor.path,
        generatedAt: artifact.descriptor.generatedAt,
        primaryWindowFingerprint: artifact.descriptor.primaryWindowFingerprint,
        primaryReleaseFamilyFingerprint: artifact.descriptor.primaryFingerprint,
      }]
    }

    const supplementalArtifact = resolveSupplementalArtifact(
      input,
      definition.scenario as DeepSeekReleaseAuditSupplementalScenario,
    )
    if (!supplementalArtifact?.path || !supplementalArtifact.primaryWindowFingerprint) {
      return []
    }
    return [{
      taskId: definition.taskId,
      scenario: definition.scenario,
      kind: definition.kind,
      artifactPath: supplementalArtifact.path,
      generatedAt: supplementalArtifact.generatedAt,
      primaryWindowFingerprint: supplementalArtifact.primaryWindowFingerprint,
      primaryReleaseFamilyFingerprint: supplementalArtifact.primaryFingerprint,
    }]
  })

  return resolveDeepSeekAuthoritativeCurrentWindow({
    selectedFingerprintStatus: input.diffReport.fingerprintSummary.status,
    supportEntries,
  })
}

function buildEvidenceEntry(
  definition: ReleaseAuditEvidenceDefinition,
  input: {
    currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
    baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
    selectorDriftAudit?: SupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
    endpointDriftAudit?: SupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
    outputDriftAudit?: SupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
  },
  authoritativeFingerprints: string[],
): DeepSeekReleaseAuditEvidenceEntry {
  if (definition.source === 'comparable') {
    const artifact = input.currentArtifacts[
      definition.scenario as DeepSeekReleaseComparableScenario
    ]
    const baselineArtifact = input.baselineArtifacts[
      definition.scenario as DeepSeekReleaseComparableScenario
    ]
    const compatibility = readCompatibilityRecord(artifact?.artifact)
    const primaryWindowFingerprint = artifact?.descriptor.primaryWindowFingerprint ?? null
    const primaryFingerprint = artifact?.descriptor.primaryFingerprint ?? null
    const classification = resolveClassification({
      kind: 'gate',
      artifactPath: artifact?.descriptor.path ?? null,
      primaryWindowFingerprint,
      authoritativeFingerprints,
    })
    const freshnessStatus = resolveFreshnessStatus(classification, primaryWindowFingerprint)
    const warningCount = compatibility?.warningCount ?? countCheckStatuses(artifact?.artifact, 'warn')
    const failureCount = compatibility?.failureCount ?? countCheckStatuses(artifact?.artifact, 'fail')
    const acceptedWarnings = resolveAcceptedWarningDisposition({
      taskId: definition.taskId,
      classification,
      artifact: artifact?.artifact,
      warningCount,
      failureCount,
    })
    const gateStatus = resolveGateStatus({
      classification,
      warningCount,
      failureCount,
      warningsAccepted: acceptedWarnings.accepted,
    })

    return {
      taskId: definition.taskId,
      label: definition.label,
      wave: definition.wave,
      kind: definition.kind,
      scenario: definition.scenario,
      artifactPath: artifact?.descriptor.path ?? null,
      baselineArtifactPaths: baselineArtifact?.descriptor.path
        ? [baselineArtifact.descriptor.path]
        : [],
      generatedAt: artifact?.descriptor.generatedAt ?? null,
      compatibilityStatus: artifact?.descriptor.compatibilityStatus ?? null,
      primaryWindowFingerprint,
      primaryFingerprint,
      currentWindowFingerprintMatched:
        primaryWindowFingerprint !== null &&
        authoritativeFingerprints.includes(primaryWindowFingerprint),
      classification,
      freshnessStatus,
      gateStatus,
      failureCount,
      warningCount,
      reasons: buildEvidenceReasons({
        classification,
        kind: 'gate',
        primaryWindowFingerprint,
        authoritativeFingerprints,
        warningCount,
        failureCount,
        acceptedWarningReasons: acceptedWarnings.reasons,
      }),
    }
  }

  const supplementalArtifact = resolveSupplementalArtifact(input, definition.scenario as DeepSeekReleaseAuditSupplementalScenario)
  const supplementalPrimaryWindowFingerprint = supplementalArtifact?.primaryWindowFingerprint ?? null
  const classification = resolveClassification({
    kind: 'audit',
    artifactPath: supplementalArtifact?.path ?? null,
    primaryWindowFingerprint: supplementalPrimaryWindowFingerprint,
    authoritativeFingerprints,
  })
  const freshnessStatus = resolveFreshnessStatus(
    classification,
    supplementalPrimaryWindowFingerprint,
  )
  const warningCount = supplementalArtifact?.warningCount ?? null
  const failureCount = supplementalArtifact?.failureCount ?? null
  const supplementalPrimaryFingerprint = supplementalArtifact?.primaryFingerprint ?? null
  const acceptedWarnings = resolveAcceptedWarningDisposition({
    taskId: definition.taskId,
    classification,
    artifact: supplementalArtifact?.artifact,
    warningCount,
    failureCount,
  })
  const gateStatus = resolveGateStatus({
    classification,
    warningCount,
    failureCount,
    warningsAccepted: acceptedWarnings.accepted,
  })

  return {
    taskId: definition.taskId,
    label: definition.label,
    wave: definition.wave,
    kind: definition.kind,
    scenario: definition.scenario,
    artifactPath: supplementalArtifact?.path ?? null,
    baselineArtifactPaths: [],
    generatedAt: supplementalArtifact?.generatedAt ?? null,
    compatibilityStatus: supplementalArtifact?.compatibilityStatus ?? null,
    primaryWindowFingerprint: supplementalPrimaryWindowFingerprint,
    primaryFingerprint: supplementalPrimaryFingerprint,
    currentWindowFingerprintMatched:
      supplementalPrimaryWindowFingerprint !== null &&
      authoritativeFingerprints.includes(supplementalPrimaryWindowFingerprint),
    classification,
    freshnessStatus,
    gateStatus,
    failureCount,
    warningCount,
    reasons: buildEvidenceReasons({
      classification,
      kind: 'audit',
      primaryWindowFingerprint: supplementalPrimaryWindowFingerprint,
      authoritativeFingerprints,
      warningCount,
      failureCount,
      acceptedWarningReasons: acceptedWarnings.reasons,
    }),
  }
}

function resolveSupplementalArtifact(
  input: {
    selectorDriftAudit?: SupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
    endpointDriftAudit?: SupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
    outputDriftAudit?: SupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
  },
  scenario: DeepSeekReleaseAuditSupplementalScenario,
) {
  if (scenario === 'selector-drift-audit') {
    return input.selectorDriftAudit
  }
  if (scenario === 'endpoint-drift-audit') {
    return input.endpointDriftAudit
  }
  return input.outputDriftAudit
}

function resolveClassification(input: {
  kind: 'gate' | 'audit'
  artifactPath: string | null
  primaryWindowFingerprint: string | null
  authoritativeFingerprints: string[]
}): DeepSeekReleaseAuditEvidenceClassification {
  if (!input.artifactPath) {
    return 'missing'
  }
  if (!input.primaryWindowFingerprint) {
    return 'baseline-only'
  }
  if (!input.authoritativeFingerprints.includes(input.primaryWindowFingerprint)) {
    return 'baseline-only'
  }
  return input.kind === 'gate' ? 'current-proof' : 'current-audit-evidence'
}

function resolveFreshnessStatus(
  classification: DeepSeekReleaseAuditEvidenceClassification,
  primaryWindowFingerprint: string | null,
): DeepSeekReleaseAuditFreshnessStatus {
  if (classification === 'missing') {
    return 'missing'
  }
  if (!primaryWindowFingerprint) {
    return 'missing-release-fingerprint'
  }
  return classification === 'baseline-only' ? 'stale-window' : 'current-window'
}

function resolveGateStatus(input: {
  classification: DeepSeekReleaseAuditEvidenceClassification
  warningCount: number | null
  failureCount: number | null
  warningsAccepted: boolean
}): DeepSeekReleaseAuditGateStatus {
  if (input.classification === 'missing' || input.classification === 'baseline-only') {
    return 'not-yet-rechecked'
  }
  if ((input.failureCount ?? 0) > 0) {
    return 'fail'
  }
  if ((input.warningCount ?? 0) > 0 && !input.warningsAccepted) {
    return 'unknown'
  }
  return 'pass'
}

function buildEvidenceReasons(input: {
  classification: DeepSeekReleaseAuditEvidenceClassification
  kind: 'gate' | 'audit'
  primaryWindowFingerprint: string | null
  authoritativeFingerprints: string[]
  warningCount: number | null
  failureCount: number | null
  acceptedWarningReasons: string[]
}): string[] {
  const reasons: string[] = []

  if (input.classification === 'missing') {
    reasons.push('No artifact is available for this evidence family.')
  } else if (!input.primaryWindowFingerprint) {
    reasons.push('The selected artifact has no current-window fingerprint, so it cannot be promoted as current evidence.')
  } else if (!input.authoritativeFingerprints.includes(input.primaryWindowFingerprint)) {
    reasons.push(
      `Artifact current-window fingerprint ${input.primaryWindowFingerprint} does not match the authoritative current release window (${input.authoritativeFingerprints.join(', ')}).`,
    )
  } else if (input.kind === 'audit') {
    reasons.push('This artifact is current audit evidence: it informs the publish gate but does not promote compatibility on its own.')
  } else {
    reasons.push('This artifact qualifies as current proof for the authoritative release window.')
  }

  if ((input.failureCount ?? 0) > 0) {
    reasons.push('At least one check failed inside the selected artifact.')
  } else if (input.acceptedWarningReasons.length > 0) {
    reasons.push(...input.acceptedWarningReasons)
  } else if ((input.warningCount ?? 0) > 0) {
    reasons.push('The selected artifact remains warning-bearing, so the publish gate keeps it unknown.')
  }

  return reasons
}

function buildPublishGate(
  entries: DeepSeekReleaseAuditEvidenceEntry[],
): DeepSeekReleaseAuditReport['publishGate'] {
  const passTaskIds = entries
    .filter(entry => entry.gateStatus === 'pass')
    .map(entry => entry.taskId)
    .sort()
  const failTaskIds = entries
    .filter(entry => entry.gateStatus === 'fail')
    .map(entry => entry.taskId)
    .sort()
  const unknownTaskIds = entries
    .filter(entry => entry.gateStatus === 'unknown')
    .map(entry => entry.taskId)
    .sort()
  const notYetRecheckedTaskIds = entries
    .filter(entry => entry.gateStatus === 'not-yet-rechecked')
    .map(entry => entry.taskId)
    .sort()

  return {
    status:
      failTaskIds.length > 0
        ? 'fail'
        : notYetRecheckedTaskIds.length > 0
          ? 'not-yet-rechecked'
          : unknownTaskIds.length > 0
            ? 'unknown'
            : 'pass',
    passTaskIds,
    failTaskIds,
    unknownTaskIds,
    notYetRecheckedTaskIds,
  }
}

function buildUnresolvedBoundaries(input: {
  selectorDriftAudit?: SupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
  endpointDriftAudit?: SupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
  changeLedgerReport: DeepSeekReleaseChangeLedgerReport
  revalidationReport: DeepSeekReleaseRevalidationReport
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
}): DeepSeekReleaseAuditBoundaryItem[] {
  const boundaries: DeepSeekReleaseAuditBoundaryItem[] = []
  const searchArtifact = input.currentArtifacts['release-search-and-fact-check']

  if (
    hasCheckStatus(searchArtifact?.artifact, 'rate-limit-output', 'warn') ||
    hasCheckStatus(searchArtifact?.artifact, 'auto-retry-cooldown-replay', 'warn') ||
    input.endpointDriftAudit?.artifact.searchRateLimitBaseline.currentWindowStatus === 'observation-pending'
  ) {
    boundaries.push({
      id: 'rate-limit-observation-pending',
      category: 'rate_limit_observation_pending',
      status: 'warn',
      label: 'Search rate-limit live reproduction remains observation-pending',
      detail:
        'Current release auditing keeps the rate-limit surface fixture-backed/observation-pending instead of forcing fresh pressure on the live site.',
      evidencePaths: [
        ...(searchArtifact?.descriptor.path ? [searchArtifact.descriptor.path] : []),
        ...(input.endpointDriftAudit?.path ? [input.endpointDriftAudit.path] : []),
      ],
      sourceTaskIds: ['B66A', 'B70'],
    })
  }

  if (
    hasCheckStatus(searchArtifact?.artifact, 'ui-retry-unresolved-boundaries', 'warn') ||
    hasCheckStatus(input.selectorDriftAudit?.artifact, 'search-retry-fixture-baseline', 'warn')
  ) {
    boundaries.push({
      id: 'search-only-confirmed-retry-boundary',
      category: 'search_only_confirmed',
      status: 'warn',
      label: 'Only the search-path retry surface is confirmed',
      detail:
        'Search-path retry remains the only confirmed retry control path; generic reply failure/rate-limit retry UI is still unresolved and must not be over-claimed.',
      evidencePaths: [
        ...(searchArtifact?.descriptor.path ? [searchArtifact.descriptor.path] : []),
        ...(input.selectorDriftAudit?.path ? [input.selectorDriftAudit.path] : []),
      ],
      sourceTaskIds: ['B66A', 'B69'],
    })
  }

  const pendingInternalAuditEndpoints =
    input.endpointDriftAudit?.artifact.registry.endpoints
      .filter(entry => entry.evidenceStatus === 'pending_internal_audit')
      .map(entry => entry.endpoint)
      .sort() ?? []
  if (pendingInternalAuditEndpoints.length > 0) {
    boundaries.push({
      id: 'pending-internal-audit-endpoints',
      category: 'pending_internal_audit',
      status: 'warn',
      label: 'Some catalogued endpoints still remain pending internal audit',
      detail: `Pending internal audit endpoints: ${pendingInternalAuditEndpoints.join(', ')}.`,
      evidencePaths: input.endpointDriftAudit?.path ? [input.endpointDriftAudit.path] : [],
      sourceTaskIds: ['B70'],
    })
  }

  for (const boundary of input.revalidationReport.residualBoundaries) {
    boundaries.push({
      id: `general-unresolved:${boundary.boundaryId}`,
      category: 'general_unresolved',
      status: boundary.status === 'drifted' ? 'unknown' : 'warn',
      label: boundary.label,
      detail: boundary.reasons.join(' '),
      evidencePaths: [],
      sourceTaskIds: [],
    })
  }

  return dedupeBoundaryItems(boundaries)
}

function buildReleaseAuditNotes(
  input: {
    diffReport: DeepSeekReleaseDiffReport
    handoffMatrixReport: DeepSeekReleaseHandoffMatrixReport
    selectorDriftAudit?: SupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
    endpointDriftAudit?: SupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
    outputDriftAudit?: SupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
  },
  authoritativeSource: 'selected-current-gates' | 'selected-current-audits' | 'selected-current-artifacts',
  authoritativeFingerprints: string[],
  entries: DeepSeekReleaseAuditEvidenceEntry[],
): string[] {
  const notes = [
    authoritativeSource === 'selected-current-gates'
      ? `Current release gates anchor the authoritative current window at fingerprint(s): ${authoritativeFingerprints.join(', ')}.`
      : authoritativeSource === 'selected-current-audits'
        ? `Current audit artifacts anchor the authoritative current window at fingerprint(s): ${authoritativeFingerprints.join(', ')}.`
        : `No dedicated gate/audit anchor was available, so the release audit falls back to the selected current artifacts: ${authoritativeFingerprints.join(', ')}.`,
    'Current proof and current audit evidence are split deliberately: selector/endpoint/output audits inform the publish gate without being promoted to compatibility passes.',
  ]

  const staleCurrentEntries = entries
    .filter(entry => entry.classification === 'baseline-only')
    .map(entry => `${entry.taskId}:${entry.primaryFingerprint ?? 'no-fingerprint'}`)
  if (staleCurrentEntries.length > 0) {
    notes.push(
      `Some selected latest artifacts are now baseline-only against the authoritative window: ${staleCurrentEntries.join(', ')}.`,
    )
  }
  if (input.outputDriftAudit) {
    notes.push(
      'If a future citation/rendering change breaks this release audit, classify it as output drift first before assuming a local regression.',
    )
  }
  if (
    input.diffReport.capabilityMatrix.capabilities.some(
      capability => capability.capabilityId === 'vision-image-mode-current-window',
    )
  ) {
    notes.push(
      'Vision image mode is tracked as a release-diff capability through mode-audit, including selector availability, model_type=vision signals, export modeFact, and upload/ref_file_ids evidence.',
    )
  }
  if (
    entries.some(
      entry =>
        entry.taskId === 'B66A' &&
        entry.gateStatus === 'pass' &&
        (entry.warningCount ?? 0) > 0 &&
        (entry.failureCount ?? 0) === 0,
    )
  ) {
    notes.push(
      'Warning-only search/rate-limit observations (including rate_limit_observation_pending) remain accepted publish-gate boundaries when they stay inside one current release window and the observed release families map cleanly to the expected home/session.instant/session.expert surfaces.',
    )
  }
  if (input.handoffMatrixReport.wave22.entries.some(entry => entry.taskId === 'B71')) {
    notes.push(
      'release-handoff-matrix remains a planning-oriented report; this release-audit is the first place where B69/B70/B70A current artifacts are consumed as publish-gate evidence.',
    )
  }
  if (input.diffReport.fingerprintSummary.status !== 'same') {
    notes.push(
      `Selected comparable artifacts still span a ${input.diffReport.fingerprintSummary.status} fingerprint window, so freshness must be read from the authoritative current window instead of the raw selection list alone.`,
    )
    notes.push(
      'If DeepSeek ships again during reruns, freeze the new evidence window and rerun release-handoff-matrix, release-revalidate, and release-audit against that newly anchored current window instead of manually merging conclusions across windows.',
    )
  }

  return notes
}

function readCompatibilityRecord(
  artifact: unknown,
): {
  status: string | null
  evidenceKind: string | null
  failureCount: number
  warningCount: number
  releaseWindowFingerprints: string[]
} | null {
  if (!isPlainObject(artifact)) {
    return null
  }
  const compatibility = artifact['compatibility']
  if (!isPlainObject(compatibility)) {
    return null
  }

  return {
    status: readOptionalString(compatibility['status']),
    evidenceKind: readOptionalString(compatibility['evidenceKind']),
    failureCount: readOptionalNumber(compatibility['failureCount']) ?? 0,
    warningCount: readOptionalNumber(compatibility['warningCount']) ?? 0,
    releaseWindowFingerprints: readStringArray(compatibility['releaseWindowFingerprints']),
  }
}

function resolveAcceptedWarningDisposition(input: {
  taskId: string
  classification: DeepSeekReleaseAuditEvidenceClassification
  artifact: unknown
  warningCount: number | null
  failureCount: number | null
}): { accepted: boolean; reasons: string[] } {
  if (
    input.classification === 'missing' ||
    input.classification === 'baseline-only' ||
    (input.failureCount ?? 0) > 0 ||
    (input.warningCount ?? 0) === 0
  ) {
    return { accepted: false, reasons: [] }
  }

  if (input.taskId === 'B66A') {
    return resolveAcceptedB66AMultiFamilyWarnings(input.artifact)
  }
  if (input.taskId === 'B69') {
    return resolveAcceptedKnownWarningSet(
      input.artifact,
      ACCEPTED_B69_WARNING_IDS,
      'Selector drift audit warnings are limited to the accepted observation boundaries: message-action-selector-family, search-retry-fixture-baseline.',
    )
  }
  if (input.taskId === 'B70') {
    return resolveAcceptedKnownWarningSet(
      input.artifact,
      ACCEPTED_B70_WARNING_IDS,
      'Endpoint drift audit warnings are limited to the accepted observation boundary search-rate-limit-hint-close-baseline; they stay as current audit evidence, not a publish blocker.',
    )
  }

  return { accepted: false, reasons: [] }
}

function resolveAcceptedB66AMultiFamilyWarnings(
  artifact: unknown,
): { accepted: boolean; reasons: string[] } {
  const compatibility = readCompatibilityRecord(artifact)
  if (
    compatibility?.evidenceKind !== 'multi-fingerprint-observed' ||
    compatibility.releaseWindowFingerprints.length !== 1
  ) {
    return { accepted: false, reasons: [] }
  }

  const warningIds = readChecks(artifact)
    .filter(check => check.status === 'warn')
    .map(check => check.id)
    .sort()
  if (
    warningIds.length === 0 ||
    warningIds.some(checkId => !ACCEPTED_B66A_WARNING_IDS.has(checkId))
  ) {
    return { accepted: false, reasons: [] }
  }

  const surfaceFamilies = collectB66ASurfaceFamilies(artifact)
  if (!surfaceFamilies) {
    return { accepted: false, reasons: [] }
  }

  return {
    accepted: true,
    reasons: [
      `The current search/fact-check gate stays inside one release window (${compatibility.releaseWindowFingerprints[0]}), and its release-family split maps cleanly to the expected surfaces: ${formatSurfaceFamilies(surfaceFamilies)}.`,
      `Warning-bearing checks are limited to accepted search/retry observation boundaries: ${warningIds.join(', ')}.`,
    ],
  }
}

function resolveAcceptedKnownWarningSet(
  artifact: unknown,
  acceptedWarningIds: ReadonlySet<string>,
  reason: string,
): { accepted: boolean; reasons: string[] } {
  const warningIds = readChecks(artifact)
    .filter(check => check.status === 'warn')
    .map(check => check.id)
    .sort()
  if (
    warningIds.length === 0 ||
    warningIds.some(checkId => !acceptedWarningIds.has(checkId))
  ) {
    return { accepted: false, reasons: [] }
  }
  return {
    accepted: true,
    reasons: [reason],
  }
}

function collectB66ASurfaceFamilies(
  artifact: unknown,
): Map<DeepSeekReleaseAuditSurfaceKey, string> | null {
  const releaseFingerprints = readReleaseFingerprints(artifact)
  if (releaseFingerprints.length === 0) {
    return null
  }

  const surfaceFamilies = new Map<DeepSeekReleaseAuditSurfaceKey, Set<string>>()
  for (const fingerprint of releaseFingerprints) {
    const surface = resolveB66ASurfaceKey(fingerprint)
    if (!surface || !fingerprint.releaseFamilyFingerprint) {
      return null
    }
    const existing = surfaceFamilies.get(surface) ?? new Set<string>()
    existing.add(fingerprint.releaseFamilyFingerprint)
    surfaceFamilies.set(surface, existing)
  }

  for (const surface of EXPECTED_B66A_SURFACES) {
    const families = surfaceFamilies.get(surface)
    if (!families || families.size !== 1) {
      return null
    }
  }
  if (surfaceFamilies.size !== EXPECTED_B66A_SURFACES.length) {
    return null
  }

  return new Map(
    EXPECTED_B66A_SURFACES.map(surface => [
      surface,
      [...(surfaceFamilies.get(surface) ?? new Set<string>())][0] ?? '',
    ]),
  )
}

function resolveB66ASurfaceKey(input: {
  routeKind: string | null
  availableModes: string[]
}): DeepSeekReleaseAuditSurfaceKey | null {
  if (input.routeKind === 'home') {
    return 'home'
  }

  if (input.routeKind !== 'session') {
    return null
  }

  if (input.availableModes.length !== 1) {
    return null
  }
  if (input.availableModes[0] === 'instant') {
    return 'session.instant'
  }
  if (input.availableModes[0] === 'expert') {
    return 'session.expert'
  }
  return null
}

function formatSurfaceFamilies(
  surfaceFamilies: Map<DeepSeekReleaseAuditSurfaceKey, string>,
): string {
  return EXPECTED_B66A_SURFACES
    .map(surface => `${surface}=${surfaceFamilies.get(surface) ?? 'missing'}`)
    .join(', ')
}

function hasCheckStatus(
  artifact: unknown,
  checkId: string,
  status: 'warn' | 'fail',
): boolean {
  return readChecks(artifact).some(
    check =>
      check.id === checkId &&
      check.status === status,
  )
}

function countCheckStatuses(
  artifact: unknown,
  status: 'warn' | 'fail',
): number {
  return readChecks(artifact).filter(check => check.status === status).length
}

function readChecks(
  artifact: unknown,
): Array<{ id: string; status: string }> {
  if (!isPlainObject(artifact)) {
    return []
  }
  const directChecks = readCheckArray(artifact['checks'])
  if (directChecks.length > 0) {
    return directChecks
  }
  const report = artifact['report']
  if (!isPlainObject(report)) {
    return []
  }
  return readCheckArray(report['checks'])
}

function readCheckArray(value: unknown): Array<{ id: string; status: string }> {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(isPlainObject)
    .map(item => ({
      id: readOptionalString(item['id']) ?? '',
      status: readOptionalString(item['status']) ?? '',
    }))
    .filter(item => item.id.length > 0 && item.status.length > 0)
}

function readReleaseFingerprints(
  artifact: unknown,
): Array<{
  routeKind: string | null
  availableModes: string[]
  releaseFamilyFingerprint: string | null
}> {
  if (!isPlainObject(artifact) || !Array.isArray(artifact['releaseFingerprints'])) {
    return []
  }

  return artifact['releaseFingerprints']
    .filter(isPlainObject)
    .map(fingerprint => {
      const uiFingerprint = isPlainObject(fingerprint['uiFingerprint'])
        ? fingerprint['uiFingerprint']
        : null
      const modeSurfaceProjection = isPlainObject(uiFingerprint?.['modeSurfaceProjection'])
        ? uiFingerprint['modeSurfaceProjection']
        : null
      return {
        routeKind: uiFingerprint ? readOptionalString(uiFingerprint['routeKind']) : null,
        availableModes: readStringArray(modeSurfaceProjection?.['availableModes']),
        releaseFamilyFingerprint: readOptionalString(fingerprint['releaseFamilyFingerprint']),
      }
    })
}

function dedupeBoundaryItems(
  items: DeepSeekReleaseAuditBoundaryItem[],
): DeepSeekReleaseAuditBoundaryItem[] {
  const seen = new Map<string, DeepSeekReleaseAuditBoundaryItem>()
  for (const item of items) {
    const existing = seen.get(item.id)
    if (!existing) {
      seen.set(item.id, {
        ...item,
        evidencePaths: [...new Set(item.evidencePaths)].sort(),
        sourceTaskIds: [...new Set(item.sourceTaskIds)].sort(),
      })
      continue
    }

    existing.evidencePaths = [...new Set([...existing.evidencePaths, ...item.evidencePaths])].sort()
    existing.sourceTaskIds = [...new Set([...existing.sourceTaskIds, ...item.sourceTaskIds])].sort()
    existing.detail = existing.detail.length >= item.detail.length ? existing.detail : item.detail
  }

  return [...seen.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0).sort()
    : []
}
