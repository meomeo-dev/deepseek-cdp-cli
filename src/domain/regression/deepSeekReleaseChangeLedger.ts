import { DEEPSEEK_ENDPOINT_AUDIT_REGISTRY } from '../../infrastructure/deepseek/deepSeekEndpointAuditRegistry.js'
import type { DeepSeekReleaseBoundaryReport } from '../../types/deepseek-release-boundary.types.js'
import type { DeepSeekReleaseDiffReport } from '../../types/deepseek-release-diff.types.js'
import type {
  DeepSeekReleaseChangeLedgerEntry,
  DeepSeekReleaseChangeLedgerReport,
  DeepSeekReleaseChangeLedgerSurface,
  DeepSeekReleaseChangeLedgerUnresolvedItem,
  DeepSeekReleaseObservationSeed,
} from '../../types/deepseek-release-change-ledger.types.js'
import type { DeepSeekReleaseRevalidationReport } from '../../types/deepseek-release-revalidation.types.js'
import type { DeepSeekReleaseTriageReport } from '../../types/deepseek-release-triage.types.js'

export function buildDeepSeekReleaseChangeLedgerReport(input: {
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  revalidationReport: DeepSeekReleaseRevalidationReport
  observationSeeds?: DeepSeekReleaseObservationSeed[] | undefined
}): DeepSeekReleaseChangeLedgerReport {
  const entries: DeepSeekReleaseChangeLedgerEntry[] = [
    ...buildManualObservationEntries(input.observationSeeds ?? []),
    ...buildDiffEntries(input.diffReport),
    ...buildBoundaryEntries(input.boundaryReport),
    ...buildRevalidationEntries(input.revalidationReport),
    ...buildEndpointAuditEntries(),
  ]
  const unresolvedMatrix = buildUnresolvedMatrix(entries, input.observationSeeds ?? [])
  const notes = buildNotes(input.diffReport, input.boundaryReport, input.revalidationReport)

  return {
    generatedAt: new Date().toISOString(),
    releaseWindow: {
      fingerprintStatus: input.diffReport.fingerprintSummary.status,
      oldCompositeFingerprints: input.diffReport.fingerprintSummary.baselineCompositeFingerprints,
      newCompositeFingerprints: input.diffReport.fingerprintSummary.currentCompositeFingerprints,
    },
    summary: {
      confirmedCount: entries.filter(entry => entry.status === 'confirmed').length,
      removedCount: entries.filter(entry => entry.status === 'removed').length,
      changedCount: entries.filter(entry => entry.status === 'changed').length,
      unresolvedCount: entries.filter(entry => entry.status === 'unresolved').length,
    },
    entries,
    unresolvedMatrix,
    notes,
    diffReport: input.diffReport,
    boundaryReport: input.boundaryReport,
    triageReport: input.triageReport,
    revalidationReport: input.revalidationReport,
  }
}

function buildManualObservationEntries(
  observationSeeds: DeepSeekReleaseObservationSeed[],
): DeepSeekReleaseChangeLedgerEntry[] {
  return observationSeeds.flatMap(seed =>
    seed.entries.map(entry => ({
      id: entry.id,
      source: 'manual-observation',
      status: entry.status,
      surface: entry.surface,
      title: entry.title,
      detail: entry.detail,
      relatedScenarios: [],
      evidencePaths: entry.evidencePaths ?? [],
      followUpTaskIds: entry.followUpTaskIds ?? [],
    })),
  )
}

function buildDiffEntries(
  diffReport: DeepSeekReleaseDiffReport,
): DeepSeekReleaseChangeLedgerEntry[] {
  const entries: DeepSeekReleaseChangeLedgerEntry[] = []

  for (const scenario of diffReport.layers.ui.scenarios.filter(item => item.status === 'changed')) {
    if (scenario.scenario === 'release-core') {
      entries.push({
        id: `diff:${scenario.scenario}:ui-home-composer`,
        source: 'release-diff',
        status: 'changed',
        surface: 'home',
        title: 'Release-core UI shell changed against the known-good baseline',
        detail:
          'The release-core UI fingerprint changed. This usually means the home/composer shell, route shell, or message action surface moved and needs investigation beyond generic UI drift.',
        relatedScenarios: [scenario.scenario],
        evidencePaths: collectDiffArtifactPaths(diffReport, scenario.scenario),
        followUpTaskIds: ['B65I', 'B65J'],
      })
    } else if (scenario.scenario === 'release-message-actions') {
      entries.push({
        id: `diff:${scenario.scenario}:ui-message-actions`,
        source: 'release-diff',
        status: 'changed',
        surface: 'message-action',
        title: 'Message action surface changed against the known-good baseline',
        detail:
          'The message-action UI fingerprint changed. This may indicate new inline actions, moved menus, or changed hover behavior.',
        relatedScenarios: [scenario.scenario],
        evidencePaths: collectDiffArtifactPaths(diffReport, scenario.scenario),
        followUpTaskIds: ['B65L'],
      })
    } else {
      entries.push({
        id: `diff:${scenario.scenario}:ui`,
        source: 'release-diff',
        status: 'changed',
        surface: 'composer',
        title: `${scenario.scenario} UI surface changed against the known-good baseline`,
        detail:
          'The release diff recorded a UI-layer change for this scenario. It should be reviewed in the change ledger instead of being left as a generic UI drift note.',
        relatedScenarios: [scenario.scenario],
        evidencePaths: collectDiffArtifactPaths(diffReport, scenario.scenario),
        followUpTaskIds: ['B65J', 'B65L'],
      })
    }
  }

  for (const scenario of diffReport.layers.api.scenarios.filter(item => item.status === 'changed')) {
    entries.push({
      id: `diff:${scenario.scenario}:api`,
      source: 'release-diff',
      status: 'changed',
      surface: 'api',
      title: `${scenario.scenario} API signature changed against the known-good baseline`,
      detail:
        'The audited API fingerprint changed for this scenario. This should be tracked as an explicit release change rather than being folded into a generic compatibility warning.',
      relatedScenarios: [scenario.scenario],
      evidencePaths: collectDiffArtifactPaths(diffReport, scenario.scenario),
      followUpTaskIds: ['B65J', 'B65L'],
    })
  }

  for (const scenario of diffReport.layers.output.scenarios.filter(item => item.status === 'changed')) {
    entries.push({
      id: `diff:${scenario.scenario}:output`,
      source: 'release-diff',
      status: 'changed',
      surface: 'output',
      title: `${scenario.scenario} output/render surface changed against the known-good baseline`,
      detail:
        'The output quirk fingerprint changed for this scenario, so text/json/export presentation must be reviewed as a first-class release change.',
      relatedScenarios: [scenario.scenario],
      evidencePaths: collectDiffArtifactPaths(diffReport, scenario.scenario),
      followUpTaskIds: ['B65J', 'B65L'],
    })
  }

  return dedupeEntries(entries)
}

function buildBoundaryEntries(
  boundaryReport: DeepSeekReleaseBoundaryReport,
): DeepSeekReleaseChangeLedgerEntry[] {
  const entries: DeepSeekReleaseChangeLedgerEntry[] = []

  for (const boundary of boundaryReport.adapterBoundaries) {
    if (boundary.status === 'adapted') {
      entries.push({
        id: `boundary:${boundary.boundaryId}:adapted`,
        source: 'release-boundaries',
        status: 'changed',
        surface: mapBoundaryToSurface(boundary.boundaryId),
        title: `${boundary.label} is adapted on the current release window`,
        detail:
          boundary.reasons[0] ??
          'This adapter boundary observed change against the baseline but is green on the current release window, so it should be tracked as an adapted change rather than a silent success.',
        relatedScenarios: boundary.ownedScenarios,
        evidencePaths: boundary.currentArtifactPaths,
        followUpTaskIds: ['B65J', 'B65L'],
      })
    }

    if (boundary.status === 'drifted' || boundary.status === 'observation-pending') {
      entries.push({
        id: `boundary:${boundary.boundaryId}:${boundary.status}`,
        source: 'release-boundaries',
        status: 'unresolved',
        surface: mapBoundaryToSurface(boundary.boundaryId),
        title: `${boundary.label} remains ${boundary.status}`,
        detail:
          boundary.reasons[0] ??
          `${boundary.label} still lacks enough evidence to be treated as clean on the current release window.`,
        relatedScenarios: boundary.ownedScenarios,
        evidencePaths: boundary.currentArtifactPaths,
        followUpTaskIds: ['B65J', 'B65L'],
      })
    }
  }

  if (boundaryReport.integration.status !== 'verified') {
    entries.push({
      id: `boundary:integration:${boundaryReport.integration.status}`,
      source: 'release-boundaries',
      status: 'unresolved',
      surface: 'other',
      title: `Integration boundary remains ${boundaryReport.integration.status}`,
      detail:
        boundaryReport.integration.reasons[0] ??
        'Cross-layer integration has not yet been fully revalidated on the current DeepSeek release window.',
      relatedScenarios: ['release-core', 'release-search-and-fact-check', 'release-message-actions'],
      evidencePaths: boundaryReport.integration.currentArtifactPaths,
      followUpTaskIds: ['B65L'],
    })
  }

  return dedupeEntries(entries)
}

function buildRevalidationEntries(
  revalidationReport: DeepSeekReleaseRevalidationReport,
): DeepSeekReleaseChangeLedgerEntry[] {
  const entries: DeepSeekReleaseChangeLedgerEntry[] = []

  if (revalidationReport.readiness === 'ready-for-wave21') {
    entries.push({
      id: 'revalidation:wave21-ready',
      source: 'release-revalidate',
      status: 'confirmed',
      surface: 'runtime',
      title: 'Current release window is ready to enter Wave 21',
      detail:
        'Layer-specific probes and the targeted gate are complete on the current release window, so this DeepSeek version can proceed to Wave 21 real-browser regression.',
      relatedScenarios: revalidationReport.impact.affectedScenarios,
      evidencePaths: [],
      followUpTaskIds: ['B65L'],
    })
  }

  for (const item of revalidationReport.unrevalidatedItems) {
    entries.push({
      id: `revalidate:${item.id}`,
      source: 'release-revalidate',
      status: 'unresolved',
      surface: 'other',
      title: item.label,
      detail: item.reason,
      relatedScenarios: item.scenario ? [item.scenario] : [],
      evidencePaths: [],
      followUpTaskIds: [],
    })
  }

  return dedupeEntries(entries)
}

function buildEndpointAuditEntries(): DeepSeekReleaseChangeLedgerEntry[] {
  const entries: DeepSeekReleaseChangeLedgerEntry[] = []

  for (const record of Object.values(DEEPSEEK_ENDPOINT_AUDIT_REGISTRY)) {
    if (
      record.unconfirmedFields.some(field =>
        field.toLowerCase().includes('model_type'),
      )
    ) {
      entries.push({
        id: `endpoint:${record.endpoint}:model-type-unmodeled`,
        source: 'endpoint-audit',
        status: 'unresolved',
        surface: 'mode',
        title: `${record.endpoint} still leaves non-default model_type semantics unmodeled`,
        detail:
          'The audited endpoint registry already records that non-default model_type semantics remain unmodeled. This is a concrete blocker for any new Instant/Expert/Vision mode-surface investigation and should be carried into the change ledger explicitly.',
        relatedScenarios: ['release-core', 'release-message-actions'],
        evidencePaths: record.fixturePaths,
        followUpTaskIds: ['B65I', 'B65J'],
      })
    }
  }

  return dedupeEntries(entries)
}

function buildUnresolvedMatrix(
  entries: DeepSeekReleaseChangeLedgerEntry[],
  observationSeeds: DeepSeekReleaseObservationSeed[],
): DeepSeekReleaseChangeLedgerUnresolvedItem[] {
  const matrix: DeepSeekReleaseChangeLedgerUnresolvedItem[] = []

  for (const seed of observationSeeds) {
    for (const item of seed.unresolvedMatrix ?? []) {
      matrix.push({
        id: item.id,
        question: item.question,
        surfaces: item.surfaces,
        relatedEntryIds: item.relatedEntryIds ?? [],
        detail: item.detail,
        followUpTaskIds: item.followUpTaskIds ?? [],
      })
    }
  }

  const modelTypeEntry = entries.find(entry => entry.id.includes('model-type-unmodeled'))
  if (modelTypeEntry) {
    matrix.push({
      id: 'mode-authoritative-signal',
      question:
        '新的 Instant / Expert / Vision 模式是否会在 generation stream、history_messages、stored session 或 export 中留下可消费的权威模式信号？',
      surfaces: ['mode', 'api', 'output', 'session'],
      relatedEntryIds: [modelTypeEntry.id],
      detail:
        '当前 endpoint audit 已明确 non-default model_type semantics remain unmodeled，因此模式权威信号仍是未解决问题，必须先做真实样本审计。',
      followUpTaskIds: ['B65I', 'B65J'],
    })
  }

  return dedupeUnresolvedMatrix(matrix)
}

function buildNotes(
  diffReport: DeepSeekReleaseDiffReport,
  boundaryReport: DeepSeekReleaseBoundaryReport,
  revalidationReport: DeepSeekReleaseRevalidationReport,
): string[] {
  const notes: string[] = []

  notes.push(
    `Fingerprint status for the selected release window is ${diffReport.fingerprintSummary.status}.`,
  )
  if (boundaryReport.adapterBoundaries.some(boundary => boundary.status === 'adapted')) {
    notes.push(
      'At least one adapter boundary is already adapted on the current release window, so the change ledger should separate "changed but adapted" from unresolved drift.',
    )
  }
  if (revalidationReport.readiness === 'observation-pending') {
    notes.push(
      'Revalidation still reports observation-pending, so unresolved ledger items should be treated as real blockers rather than soft notes.',
    )
  }

  return notes
}

function collectDiffArtifactPaths(
  diffReport: DeepSeekReleaseDiffReport,
  scenario: DeepSeekReleaseDiffReport['artifactPairs'][number]['scenario'],
): string[] {
  const pair = diffReport.artifactPairs.find(candidate => candidate.scenario === scenario)
  return [pair?.current?.path, pair?.baseline?.path].filter((value): value is string => Boolean(value))
}

function mapBoundaryToSurface(
  boundaryId: DeepSeekReleaseBoundaryReport['adapterBoundaries'][number]['boundaryId'],
): DeepSeekReleaseChangeLedgerSurface {
  if (boundaryId === 'ui-adapter') {
    return 'composer'
  }
  if (boundaryId === 'api-contract') {
    return 'api'
  }
  return 'output'
}

function dedupeEntries(
  entries: DeepSeekReleaseChangeLedgerEntry[],
): DeepSeekReleaseChangeLedgerEntry[] {
  const map = new Map<string, DeepSeekReleaseChangeLedgerEntry>()
  for (const entry of entries) {
    map.set(entry.id, entry)
  }
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function dedupeUnresolvedMatrix(
  matrix: DeepSeekReleaseChangeLedgerUnresolvedItem[],
): DeepSeekReleaseChangeLedgerUnresolvedItem[] {
  const map = new Map<string, DeepSeekReleaseChangeLedgerUnresolvedItem>()
  for (const item of matrix) {
    map.set(item.id, item)
  }
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id))
}
