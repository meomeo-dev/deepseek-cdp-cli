import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { buildDeepSeekReleaseBoundaryReport } from '../../domain/regression/deepSeekReleaseAdapterBoundaries.js'
import { buildDeepSeekReleaseAuditReport } from '../../domain/regression/deepSeekReleaseAudit.js'
import { buildDeepSeekReleaseChangeLedgerReport } from '../../domain/regression/deepSeekReleaseChangeLedger.js'
import { buildDeepSeekReleaseDiffReport } from '../../domain/regression/deepSeekReleaseDiff.js'
import {
  resolveDeepSeekReleaseFamilyFingerprint,
  resolveDeepSeekReleaseWindowFingerprint,
} from '../../domain/regression/deepSeekReleaseFingerprint.js'
import { buildDeepSeekReleaseHandoffMatrixReport } from '../../domain/regression/deepSeekReleaseHandoffMatrix.js'
import { buildDeepSeekReleaseRevalidationReport } from '../../domain/regression/deepSeekReleaseRevalidation.js'
import { buildDeepSeekReleaseTriageReport } from '../../domain/regression/deepSeekReleaseTriage.js'
import {
  buildDeepSeekReleaseArtifactSourceProvenance,
  resolveDeepSeekReleaseComparableEvidenceRoot,
  resolveDeepSeekReleaseEvidenceRoots,
  resolveDeepSeekReleaseTriageEvidenceRoot,
} from '../../shared/deepSeekReleaseEvidencePaths.js'
import type { DeepSeekReleaseAuditReport } from '../../types/deepseek-release-audit.types.js'
import type { DeepSeekReleaseArtifactSourceProvenance } from '../../types/deepseek-release-evidence.types.js'
import type { DeepSeekReleaseFingerprint } from '../../types/deepseek-release-fingerprint.types.js'
import type { DeepSeekEndpointDriftAuditReport } from '../../types/deepseek-endpoint-drift-audit.types.js'
import type { DeepSeekOutputDriftAuditReport } from '../../types/deepseek-output-drift-audit.types.js'
import type { DeepSeekSelectorDriftAuditReport } from '../../types/deepseek-selector-drift-audit.types.js'
import { selectDeepSeekReleaseArtifacts } from './selectDeepSeekReleaseArtifacts.js'

type LoadedSupplementalAuditArtifact<TArtifact> = {
  scenario: 'selector-drift-audit' | 'endpoint-drift-audit' | 'output-drift-audit'
  path: string
  provenance: DeepSeekReleaseArtifactSourceProvenance
  generatedAt: string | null
  primaryWindowFingerprint: string | null
  primaryFingerprint: string | null
  compatibilityStatus: string | null
  failureCount: number
  warningCount: number
  artifact: TArtifact
}

type LoadedSupplementalAuditArtifactUnion =
  | LoadedSupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport>
  | LoadedSupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport>
  | LoadedSupplementalAuditArtifact<DeepSeekOutputDriftAuditReport>

type SupplementalAuditScenario = LoadedSupplementalAuditArtifactUnion['scenario']

interface LoadedSupplementalAuditArtifacts {
  'selector-drift-audit'?: LoadedSupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
  'endpoint-drift-audit'?: LoadedSupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
  'output-drift-audit'?: LoadedSupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
}

export async function describeDeepSeekReleaseAudit(input: {
  artifactsDir: string
  currentArtifactFiles?: string[] | undefined
  baselineArtifactFiles?: string[] | undefined
  artifactRootDir?: string | undefined
  repairNotes?: string[] | undefined
  docsUpdated?: boolean | undefined
  outputFile?: string | undefined
  cwd?: string | undefined
}): Promise<DeepSeekReleaseAuditReport> {
  const cwd = input.cwd ?? process.cwd()
  const selection = await selectDeepSeekReleaseArtifacts({
    artifactsDir: input.artifactsDir,
    currentArtifactFiles: input.currentArtifactFiles,
    baselineArtifactFiles: input.baselineArtifactFiles,
    cwd,
  })
  const requestedComparableRoot = resolveDeepSeekReleaseComparableEvidenceRoot(
    input.artifactsDir,
    cwd,
  )
  const recommendedArtifactRoot = resolveDeepSeekReleaseTriageEvidenceRoot(
    input.artifactRootDir,
    {
      cwd,
      preferManagedDefault: false,
    },
  )

  const diffReport = buildDeepSeekReleaseDiffReport({
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
  })
  const boundaryReport = buildDeepSeekReleaseBoundaryReport({
    diffReport,
  })
  const triageReport = buildDeepSeekReleaseTriageReport({
    diffReport,
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
    recommendedArtifactRootDir: recommendedArtifactRoot.path,
    recommendedArtifactRoot,
  })
  const revalidationReport = buildDeepSeekReleaseRevalidationReport({
    diffReport,
    boundaryReport,
    triageReport,
    repairNotes: input.repairNotes,
    docsUpdated: input.docsUpdated ?? true,
  })
  const handoffMatrixReport = buildDeepSeekReleaseHandoffMatrixReport({
    diffReport,
    boundaryReport,
    triageReport,
    revalidationReport,
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
    artifactRootDir: triageReport.evidence.recommendedArtifactRootDir,
  })
  const changeLedgerReport = buildDeepSeekReleaseChangeLedgerReport({
    diffReport,
    boundaryReport,
    triageReport,
    revalidationReport,
  })

  const supplementalArtifacts = await loadLatestSupplementalAuditArtifacts({
    requestedComparableRoot,
    cwd,
  })

  const report = buildDeepSeekReleaseAuditReport({
    diffReport,
    boundaryReport,
    triageReport,
    revalidationReport,
    handoffMatrixReport,
    changeLedgerReport,
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
    selectorDriftAudit: supplementalArtifacts['selector-drift-audit'],
    endpointDriftAudit: supplementalArtifacts['endpoint-drift-audit'],
    outputDriftAudit: supplementalArtifacts['output-drift-audit'],
  })

  if (input.outputFile) {
    const outputFile = resolve(cwd, input.outputFile)
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}

async function loadLatestSupplementalAuditArtifacts(input: {
  requestedComparableRoot: ReturnType<typeof resolveDeepSeekReleaseComparableEvidenceRoot>
  cwd: string
}): Promise<LoadedSupplementalAuditArtifacts> {
  const selected: LoadedSupplementalAuditArtifacts = {}
  const primaryCandidates = await collectSupplementalAuditArtifacts(
    input.requestedComparableRoot.path,
    buildDeepSeekReleaseArtifactSourceProvenance('primary', input.requestedComparableRoot),
  )
  const legacyFallbackCandidates = await collectLegacyFallbackSupplementalAuditArtifacts(input)

  const selectorLatest = selectLatestSupplementalAuditArtifact({
    scenario: 'selector-drift-audit',
    primaryCandidates,
    fallbackCandidates: legacyFallbackCandidates,
  })
  if (selectorLatest) {
    selected['selector-drift-audit'] = selectorLatest
  }

  const endpointLatest = selectLatestSupplementalAuditArtifact({
    scenario: 'endpoint-drift-audit',
    primaryCandidates,
    fallbackCandidates: legacyFallbackCandidates,
  })
  if (endpointLatest) {
    selected['endpoint-drift-audit'] = endpointLatest
  }

  const outputLatest = selectLatestSupplementalAuditArtifact({
    scenario: 'output-drift-audit',
    primaryCandidates,
    fallbackCandidates: legacyFallbackCandidates,
  })
  if (outputLatest) {
    selected['output-drift-audit'] = outputLatest
  }

  return selected
}

async function collectLegacyFallbackSupplementalAuditArtifacts(input: {
  requestedComparableRoot: ReturnType<typeof resolveDeepSeekReleaseComparableEvidenceRoot>
  cwd: string
}): Promise<
  LoadedSupplementalAuditArtifactUnion[]
> {
  if (input.requestedComparableRoot.kind !== 'managed') {
    return []
  }

  const roots = resolveDeepSeekReleaseEvidenceRoots(input.cwd)
  return collectSupplementalAuditArtifacts(roots.legacyComparableDir, {
    selectionSource: 'legacy-fallback',
    root: {
      kind: 'legacy',
      role: 'comparable',
      path: roots.legacyComparableDir,
    },
  })
}

async function collectSupplementalAuditArtifacts(
  artifactsDir: string,
  provenance: DeepSeekReleaseArtifactSourceProvenance,
): Promise<LoadedSupplementalAuditArtifactUnion[]> {
  const candidates: LoadedSupplementalAuditArtifactUnion[] = []

  for (const file of await walkJsonFiles(artifactsDir)) {
    const loaded = await loadSupplementalAuditArtifact(file, provenance)
    if (loaded) {
      candidates.push(loaded)
    }
  }

  return candidates
}

function selectLatestSupplementalAuditArtifact(input: {
  scenario: 'selector-drift-audit'
  primaryCandidates: LoadedSupplementalAuditArtifactUnion[]
  fallbackCandidates: LoadedSupplementalAuditArtifactUnion[]
}): LoadedSupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport> | undefined
function selectLatestSupplementalAuditArtifact(input: {
  scenario: 'endpoint-drift-audit'
  primaryCandidates: LoadedSupplementalAuditArtifactUnion[]
  fallbackCandidates: LoadedSupplementalAuditArtifactUnion[]
}): LoadedSupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport> | undefined
function selectLatestSupplementalAuditArtifact(input: {
  scenario: 'output-drift-audit'
  primaryCandidates: LoadedSupplementalAuditArtifactUnion[]
  fallbackCandidates: LoadedSupplementalAuditArtifactUnion[]
}): LoadedSupplementalAuditArtifact<DeepSeekOutputDriftAuditReport> | undefined
function selectLatestSupplementalAuditArtifact(input: {
  scenario: SupplementalAuditScenario
  primaryCandidates: LoadedSupplementalAuditArtifactUnion[]
  fallbackCandidates: LoadedSupplementalAuditArtifactUnion[]
}): LoadedSupplementalAuditArtifactUnion | undefined {
  const primary = filterSupplementalScenarioCandidates(input.primaryCandidates, input.scenario)[0]
  if (primary) {
    return primary
  }
  return filterSupplementalScenarioCandidates(input.fallbackCandidates, input.scenario)[0]
}

function filterSupplementalScenarioCandidates<TScenario extends SupplementalAuditScenario>(
  candidates: LoadedSupplementalAuditArtifactUnion[],
  scenario: TScenario,
): Array<Extract<LoadedSupplementalAuditArtifactUnion, { scenario: TScenario }>> {
  return candidates
    .filter(
      (
        candidate,
      ): candidate is Extract<LoadedSupplementalAuditArtifactUnion, { scenario: TScenario }> =>
        candidate.scenario === scenario,
    )
    .sort(compareSupplementalArtifactsByGeneratedAtDesc)
}

async function walkJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const path = resolve(root, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await walkJsonFiles(path)))
        continue
      }
      if (entry.isFile() && extname(entry.name) === '.json') {
        files.push(path)
      }
    }
    return files.sort()
  } catch {
    return []
  }
}

async function loadSupplementalAuditArtifact(
  file: string,
  provenance: DeepSeekReleaseArtifactSourceProvenance,
): Promise<
  | LoadedSupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport>
  | LoadedSupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport>
  | LoadedSupplementalAuditArtifact<DeepSeekOutputDriftAuditReport>
  | null
> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }

  if (!isPlainObject(parsed)) {
    return null
  }
  const scenario = parsed['scenario']
  if (
    scenario !== 'selector-drift-audit' &&
    scenario !== 'endpoint-drift-audit' &&
    scenario !== 'output-drift-audit'
  ) {
    return null
  }

  const compatibility = isPlainObject(parsed['compatibility']) ? parsed['compatibility'] : null
  const releaseFingerprints = readReleaseFingerprints(parsed['releaseFingerprints'])
  const derivedPrimaryWindowFingerprint = derivePrimaryReleaseWindowFingerprint(releaseFingerprints)
  const derivedPrimaryFingerprint = derivePrimaryReleaseFamilyFingerprint(releaseFingerprints)

  const baseFields = {
    path: file,
    provenance,
    generatedAt:
      readOptionalString(parsed['capturedAt']) ??
      readOptionalString(parsed['generatedAt']) ??
      readOptionalString(compatibility?.['generatedAt']) ??
      null,
    primaryWindowFingerprint:
      derivedPrimaryWindowFingerprint ??
      readOptionalString(compatibility?.['primaryReleaseWindowFingerprint']) ??
      null,
    primaryFingerprint:
      derivedPrimaryFingerprint ??
      readOptionalString(compatibility?.['primaryReleaseFamilyFingerprint']) ??
      null,
    compatibilityStatus: readOptionalString(compatibility?.['status']),
    failureCount:
      readOptionalNumber(compatibility?.['failureCount']) ??
      countSupplementalCheckStatuses(parsed, 'fail'),
    warningCount:
      readOptionalNumber(compatibility?.['warningCount']) ??
      countSupplementalCheckStatuses(parsed, 'warn'),
  }

  if (scenario === 'selector-drift-audit') {
    return {
      ...baseFields,
      scenario: 'selector-drift-audit',
      artifact: parsed as unknown as DeepSeekSelectorDriftAuditReport,
    }
  }
  if (scenario === 'endpoint-drift-audit') {
    return {
      ...baseFields,
      scenario: 'endpoint-drift-audit',
      artifact: parsed as unknown as DeepSeekEndpointDriftAuditReport,
    }
  }
  return {
    ...baseFields,
    scenario: 'output-drift-audit',
    artifact: parsed as unknown as DeepSeekOutputDriftAuditReport,
  }
}

function countSupplementalCheckStatuses(
  artifact: Record<string, unknown>,
  status: 'warn' | 'fail',
): number {
  const checks = Array.isArray(artifact['checks']) ? artifact['checks'] : []
  return checks.filter(
    item =>
      isPlainObject(item) &&
      item['status'] === status,
  ).length
}

function compareSupplementalArtifactsByGeneratedAtDesc(
  left:
    | LoadedSupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport>
    | LoadedSupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport>
    | LoadedSupplementalAuditArtifact<DeepSeekOutputDriftAuditReport>,
  right:
    | LoadedSupplementalAuditArtifact<DeepSeekSelectorDriftAuditReport>
    | LoadedSupplementalAuditArtifact<DeepSeekEndpointDriftAuditReport>
    | LoadedSupplementalAuditArtifact<DeepSeekOutputDriftAuditReport>,
): number {
  const leftTime = Date.parse(left.generatedAt ?? '')
  const rightTime = Date.parse(right.generatedAt ?? '')
  const leftScore = Number.isFinite(leftTime) ? leftTime : 0
  const rightScore = Number.isFinite(rightTime) ? rightTime : 0
  return rightScore - leftScore
}

function readReleaseFingerprints(value: unknown): DeepSeekReleaseFingerprint[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is DeepSeekReleaseFingerprint => {
    if (!isPlainObject(item)) {
      return false
    }
    return typeof item['compositeFingerprint'] === 'string'
  })
}

function derivePrimaryReleaseFamilyFingerprint(
  releaseFingerprints: DeepSeekReleaseFingerprint[],
): string | null {
  const fingerprints = [...new Set(releaseFingerprints.map(resolveDeepSeekReleaseFamilyFingerprint))].sort()
  if (fingerprints.length !== 1) {
    return null
  }
  return fingerprints[0] ?? null
}

function derivePrimaryReleaseWindowFingerprint(
  releaseFingerprints: DeepSeekReleaseFingerprint[],
): string | null {
  const fingerprints = [...new Set(releaseFingerprints.map(resolveDeepSeekReleaseWindowFingerprint))].sort()
  if (fingerprints.length !== 1) {
    return null
  }
  return fingerprints[0] ?? null
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
