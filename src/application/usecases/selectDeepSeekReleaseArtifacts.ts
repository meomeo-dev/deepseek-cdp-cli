import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  resolveDeepSeekReleaseFamilyFingerprint,
  resolveDeepSeekReleaseWindowFingerprint,
} from '../../domain/regression/deepSeekReleaseFingerprint.js'
import {
  buildDeepSeekReleaseArtifactSourceProvenance,
  resolveDeepSeekReleaseArtifactSourceProvenanceFromFile,
  resolveDeepSeekReleaseComparableEvidenceRoot,
  resolveDeepSeekReleaseEvidenceRoots,
} from '../../shared/deepSeekReleaseEvidencePaths.js'
import type { DeepSeekComparableArtifact } from '../../types/deepseek-release-diff.types.js'
import type {
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseComparableScenario,
} from '../../types/deepseek-release-diff.types.js'
import type { DeepSeekReleaseArtifactSourceProvenance } from '../../types/deepseek-release-evidence.types.js'
import type { DeepSeekSelectedReleaseArtifacts } from '../../types/deepseek-release-triage.types.js'

const DEFAULT_RELEASE_SCENARIOS: DeepSeekReleaseComparableScenario[] = [
  'release-core',
  'mode-audit',
  'release-search-and-fact-check',
  'release-message-actions',
  'release-browser-runtime-governance',
]

export async function selectDeepSeekReleaseArtifacts(input: {
  artifactsDir: string
  currentArtifactFiles?: string[] | undefined
  baselineArtifactFiles?: string[] | undefined
  cwd?: string | undefined
}): Promise<DeepSeekSelectedReleaseArtifacts> {
  const cwd = input.cwd ?? process.cwd()
  const requestedComparableRoot = resolveDeepSeekReleaseComparableEvidenceRoot(
    input.artifactsDir,
    cwd,
  )
  const explicitCurrentArtifacts = await loadArtifactsFromExplicitFiles(
    input.currentArtifactFiles,
    cwd,
  )
  const explicitBaselineArtifacts = await loadArtifactsFromExplicitFiles(
    input.baselineArtifactFiles,
    cwd,
  )
  const primaryCandidateArtifacts = await collectComparableArtifacts(
    requestedComparableRoot.path,
    buildDeepSeekReleaseArtifactSourceProvenance('primary', requestedComparableRoot),
  )
  const legacyFallbackCandidateArtifacts = await collectLegacyFallbackComparableArtifacts({
    requestedComparableRoot,
    cwd,
  })

  const selectedScenarios = new Set<DeepSeekReleaseComparableScenario>(DEFAULT_RELEASE_SCENARIOS)
  for (const artifact of explicitCurrentArtifacts) {
    selectedScenarios.add(artifact.descriptor.scenario)
  }
  for (const artifact of explicitBaselineArtifacts) {
    selectedScenarios.add(artifact.descriptor.scenario)
  }

  const scenarios = [...selectedScenarios]
  const currentArtifacts = buildSelectedArtifactMap({
    scenarios,
    explicitArtifacts: explicitCurrentArtifacts,
    primaryCandidates: primaryCandidateArtifacts,
    fallbackCandidates: legacyFallbackCandidateArtifacts,
    selector: 'latest',
  })
  const baselineArtifacts = buildSelectedArtifactMap({
    scenarios,
    explicitArtifacts: explicitBaselineArtifacts,
    primaryCandidates: primaryCandidateArtifacts,
    fallbackCandidates: legacyFallbackCandidateArtifacts,
    selector: 'latest-known-good',
    excludePaths: new Set(
      Object.values(currentArtifacts)
        .flatMap(artifact => artifact?.descriptor.path ?? []),
    ),
  })

  return {
    scenarios,
    requestedComparableRoot,
    currentArtifacts,
    baselineArtifacts,
  }
}

async function loadArtifactsFromExplicitFiles(
  files: string[] | undefined,
  cwd: string,
): Promise<DeepSeekLoadedComparableArtifact[]> {
  const loaded: DeepSeekLoadedComparableArtifact[] = []
  for (const file of files ?? []) {
    const resolvedFile = resolve(cwd, file)
    const artifact = await loadComparableArtifactFromFile(
      resolvedFile,
      resolveDeepSeekReleaseArtifactSourceProvenanceFromFile(resolvedFile, {
        selectionSource: 'explicit',
        cwd,
      }),
    )
    if (!artifact) {
      throw new Error(`File is not a comparable DeepSeek release artifact: ${file}`)
    }
    loaded.push(artifact)
  }
  return loaded
}

async function collectLegacyFallbackComparableArtifacts(input: {
  requestedComparableRoot: DeepSeekSelectedReleaseArtifacts['requestedComparableRoot']
  cwd: string
}): Promise<DeepSeekLoadedComparableArtifact[]> {
  if (input.requestedComparableRoot.kind !== 'managed') {
    return []
  }

  const roots = resolveDeepSeekReleaseEvidenceRoots(input.cwd)
  return collectComparableArtifacts(roots.legacyComparableDir, {
    selectionSource: 'legacy-fallback',
    root: {
      kind: 'legacy',
      role: 'comparable',
      path: roots.legacyComparableDir,
    },
  })
}

async function collectComparableArtifacts(
  artifactsDir: string,
  provenance: DeepSeekReleaseArtifactSourceProvenance,
): Promise<DeepSeekLoadedComparableArtifact[]> {
  const candidates: DeepSeekLoadedComparableArtifact[] = []
  for (const file of await walkJsonFiles(artifactsDir)) {
    const artifact = await loadComparableArtifactFromFile(file, provenance)
    if (artifact) {
      candidates.push(artifact)
    }
  }
  return candidates
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

async function loadComparableArtifactFromFile(
  file: string,
  provenance: DeepSeekReleaseArtifactSourceProvenance,
): Promise<DeepSeekLoadedComparableArtifact | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }

  const artifact = parseComparableArtifact(parsed)
  if (!artifact) {
    return null
  }

  return {
    descriptor: buildArtifactDescriptor(file, artifact, provenance),
    artifact: artifact.value,
    releaseFingerprints: artifact.releaseFingerprints,
  }
}

function buildArtifactDescriptor(
  file: string,
  artifact: {
    scenario: DeepSeekReleaseComparableScenario
    generatedAt: unknown
    compatibility: unknown
    releaseFingerprints: DeepSeekLoadedComparableArtifact['releaseFingerprints']
    value: DeepSeekComparableArtifact
  },
  provenance: DeepSeekReleaseArtifactSourceProvenance,
): DeepSeekLoadedComparableArtifact['descriptor'] {
  const derivedPrimaryWindowFingerprint = derivePrimaryReleaseWindowFingerprint(
    artifact.releaseFingerprints,
  )
  const derivedPrimaryFingerprint = derivePrimaryReleaseFamilyFingerprint(
    artifact.releaseFingerprints,
  )
  const derivedRawPrimaryFingerprint =
    artifact.releaseFingerprints.length === 1
      ? artifact.releaseFingerprints[0]?.compositeFingerprint ?? null
      : null

  return {
    path: file,
    scenario: artifact.scenario,
    provenance,
    generatedAt: readString(artifact.generatedAt),
    compatibilityStatus:
      readCompatibilityStatus(artifact.compatibility) ??
      deriveLegacyCompatibilityStatus(artifact.value),
    primaryWindowFingerprint:
      derivedPrimaryWindowFingerprint ??
      readStringFromObject(artifact.compatibility, 'primaryReleaseWindowFingerprint'),
    primaryFingerprint:
      derivedPrimaryFingerprint ??
      readStringFromObject(artifact.compatibility, 'primaryReleaseFamilyFingerprint'),
    rawPrimaryFingerprint:
      readStringFromObject(artifact.compatibility, 'primaryRawFingerprint') ??
      derivedRawPrimaryFingerprint,
  }
}

function derivePrimaryReleaseWindowFingerprint(
  releaseFingerprints: DeepSeekLoadedComparableArtifact['releaseFingerprints'],
): string | null {
  const fingerprints = [...new Set(releaseFingerprints.map(resolveDeepSeekReleaseWindowFingerprint))].sort()
  if (fingerprints.length !== 1) {
    return null
  }
  return fingerprints[0] ?? null
}

function derivePrimaryReleaseFamilyFingerprint(
  releaseFingerprints: DeepSeekLoadedComparableArtifact['releaseFingerprints'],
): string | null {
  const fingerprints = [...new Set(releaseFingerprints.map(resolveDeepSeekReleaseFamilyFingerprint))].sort()
  if (fingerprints.length !== 1) {
    return null
  }
  return fingerprints[0] ?? null
}

function buildSelectedArtifactMap(input: {
  scenarios: DeepSeekReleaseComparableScenario[]
  explicitArtifacts: DeepSeekLoadedComparableArtifact[]
  primaryCandidates: DeepSeekLoadedComparableArtifact[]
  fallbackCandidates: DeepSeekLoadedComparableArtifact[]
  selector: 'latest' | 'latest-known-good'
  excludePaths?: Set<string> | undefined
}): Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>> {
  const selected: Partial<
    Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>
  > = {}
  const explicitMap = new Map(
    input.explicitArtifacts.map(artifact => [artifact.descriptor.scenario, artifact]),
  )

  for (const scenario of input.scenarios) {
    const explicit = explicitMap.get(scenario)
    if (explicit) {
      selected[scenario] = explicit
      continue
    }

    const primaryCandidates = buildScenarioCandidates({
      scenario,
      candidates: input.primaryCandidates,
      selector: input.selector,
      excludePaths: input.excludePaths,
    })
    if (primaryCandidates[0]) {
      selected[scenario] = primaryCandidates[0]
      continue
    }

    const fallbackCandidates = buildScenarioCandidates({
      scenario,
      candidates: input.fallbackCandidates,
      selector: input.selector,
      excludePaths: input.excludePaths,
    })
    if (fallbackCandidates[0]) {
      selected[scenario] = fallbackCandidates[0]
    }
  }

  return selected
}

function buildScenarioCandidates(input: {
  scenario: DeepSeekReleaseComparableScenario
  candidates: DeepSeekLoadedComparableArtifact[]
  selector: 'latest' | 'latest-known-good'
  excludePaths?: Set<string> | undefined
}): DeepSeekLoadedComparableArtifact[] {
  return input.candidates
    .filter(artifact => artifact.descriptor.scenario === input.scenario)
    .filter(
      artifact =>
        !(input.excludePaths?.has(artifact.descriptor.path) ?? false) &&
        (input.selector === 'latest' ||
          artifact.descriptor.compatibilityStatus === 'known-good'),
    )
    .sort(compareArtifactsByGeneratedAtDesc)
}

function compareArtifactsByGeneratedAtDesc(
  left: DeepSeekLoadedComparableArtifact,
  right: DeepSeekLoadedComparableArtifact,
): number {
  const leftTime = Date.parse(left.descriptor.generatedAt ?? '')
  const rightTime = Date.parse(right.descriptor.generatedAt ?? '')
  const leftScore = Number.isFinite(leftTime) ? leftTime : 0
  const rightScore = Number.isFinite(rightTime) ? rightTime : 0
  return rightScore - leftScore
}

function parseComparableArtifact(input: unknown): {
  scenario: DeepSeekReleaseComparableScenario
  generatedAt: unknown
  compatibility: unknown
  releaseFingerprints: DeepSeekLoadedComparableArtifact['releaseFingerprints']
  value: DeepSeekComparableArtifact
} | null {
  if (!isPlainObject(input)) {
    return null
  }

  if (
    input['scenario'] === 'release-core' &&
    isPlainObject(input['report'])
  ) {
    return {
      scenario: 'release-core',
      generatedAt: input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: readReleaseFingerprints(input['releaseFingerprints']),
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }
  if (
    (input['scenario'] === 'mode-audit' || !('scenario' in input)) &&
    isPlainObject(input['defaultHomeSurface']) &&
    Array.isArray(input['scenarios']) &&
    typeof input['requestedUrl'] === 'string'
  ) {
    return {
      scenario: 'mode-audit',
      generatedAt: input['capturedAt'] ?? input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: readReleaseFingerprints(input['releaseFingerprints']),
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }
  if (
    input['scenario'] === 'search-success' &&
    isPlainObject(input['report'])
  ) {
    return {
      scenario: 'search-success',
      generatedAt: input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: readReleaseFingerprints(input['releaseFingerprints']),
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }
  if (
    input['scenario'] === 'release-search-and-fact-check' &&
    isPlainObject(input['report'])
  ) {
    return {
      scenario: 'release-search-and-fact-check',
      generatedAt: input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: readReleaseFingerprints(input['releaseFingerprints']),
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }
  if (
    input['scenario'] === 'release-message-actions' &&
    isPlainObject(input['report'])
  ) {
    return {
      scenario: 'release-message-actions',
      generatedAt: input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: readReleaseFingerprints(input['releaseFingerprints']),
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }
  if (
    input['scenario'] === 'release-browser-runtime-governance' &&
    isPlainObject(input['report'])
  ) {
    return {
      scenario: 'release-browser-runtime-governance',
      generatedAt: input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: readReleaseFingerprints(input['releaseFingerprints']),
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }
  if (
    Array.isArray(input['releaseFingerprints']) &&
    isPlainObject(input['compatibility']) &&
    Array.isArray(input['attempts']) &&
    Array.isArray(input['matrix']) &&
    typeof input['clickRetry'] === 'boolean'
  ) {
    return {
      scenario: 'search-ui-retry-probe',
      generatedAt: input['generatedAt'],
      compatibility: input['compatibility'],
      releaseFingerprints: input['releaseFingerprints'] as DeepSeekLoadedComparableArtifact['releaseFingerprints'],
      value: input as unknown as DeepSeekComparableArtifact,
    }
  }

  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readReleaseFingerprints(
  value: unknown,
): DeepSeekLoadedComparableArtifact['releaseFingerprints'] {
  return Array.isArray(value)
    ? (value as DeepSeekLoadedComparableArtifact['releaseFingerprints'])
    : []
}

function readCompatibilityStatus(
  value: unknown,
): DeepSeekLoadedComparableArtifact['descriptor']['compatibilityStatus'] {
  if (!isPlainObject(value)) {
    return null
  }
  const status = value['status']
  return status === 'known-good' || status === 'known-bad' || status === 'pending'
    ? status
    : null
}

function deriveLegacyCompatibilityStatus(
  artifact: DeepSeekComparableArtifact,
): DeepSeekLoadedComparableArtifact['descriptor']['compatibilityStatus'] {
  const checks = readLegacyChecks(artifact)
  if (checks.length === 0) {
    return null
  }
  if (checks.some(check => check.status === 'fail')) {
    return 'known-bad'
  }
  if (checks.some(check => check.status === 'warn')) {
    return 'pending'
  }
  if (checks.every(check => check.status === 'pass')) {
    return 'known-good'
  }
  return null
}

function readLegacyChecks(
  artifact: DeepSeekComparableArtifact,
): Array<{ status: 'pass' | 'fail' | 'warn' }> {
  if (!('report' in artifact) || !Array.isArray(artifact.report?.checks)) {
    return []
  }
  return artifact.report.checks.flatMap(check => {
    if (
      isPlainObject(check) &&
      (check['status'] === 'pass' ||
        check['status'] === 'fail' ||
        check['status'] === 'warn')
    ) {
      return [{ status: check['status'] }]
    }
    return []
  })
}

function readStringFromObject(value: unknown, key: string): string | null {
  if (!isPlainObject(value)) {
    return null
  }
  return readString(value[key])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
