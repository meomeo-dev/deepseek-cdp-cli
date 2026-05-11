import type {
  DeepSeekReleaseCurrentWindowCandidate,
  DeepSeekReleaseCurrentWindowResolution,
  DeepSeekReleaseCurrentWindowSource,
  DeepSeekReleaseCurrentWindowSupportEntry,
} from '../../types/deepseek-release-current-window.types.js'
import type { DeepSeekReleaseDiffReport } from '../../types/deepseek-release-diff.types.js'

export function resolveDeepSeekAuthoritativeCurrentWindow(input: {
  selectedFingerprintStatus: DeepSeekReleaseDiffReport['fingerprintSummary']['status']
  supportEntries: DeepSeekReleaseCurrentWindowSupportEntry[]
}): DeepSeekReleaseCurrentWindowResolution {
  const grouped = new Map<string, DeepSeekReleaseCurrentWindowSupportEntry[]>()
  for (const entry of input.supportEntries) {
    if (!entry.primaryWindowFingerprint) {
      continue
    }
    const existing = grouped.get(entry.primaryWindowFingerprint) ?? []
    existing.push(entry)
    grouped.set(entry.primaryWindowFingerprint, existing)
  }

  const candidates = [...grouped.entries()]
    .map(([fingerprint, supportEntries]) => buildCandidate(fingerprint, supportEntries))
    .sort(compareCandidates)

  const candidateFingerprints = candidates.map(candidate => candidate.fingerprint)
  if (candidates.length === 0) {
    return {
      status: 'unresolved',
      source: 'selected-current-artifacts',
      primaryFingerprint: null,
      candidateFingerprints,
      selectedFingerprintStatus: input.selectedFingerprintStatus,
      supportingTaskIds: [],
      supportingArtifactPaths: [],
      supportingEntries: [],
      candidates,
    }
  }

  const top = candidates[0]
  const runnerUp = candidates[1]
  const status =
    top && runnerUp && compareCandidates(top, runnerUp) === 0 ? 'mixed' : 'anchored'
  const source = resolveSource(top)

  return {
    status,
    source,
    primaryFingerprint: status === 'anchored' ? top?.fingerprint ?? null : null,
    candidateFingerprints,
    selectedFingerprintStatus: input.selectedFingerprintStatus,
    supportingTaskIds:
      status === 'anchored'
        ? [...new Set(
            (top?.supportEntries ?? [])
              .map(entry => entry.taskId)
              .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0),
          )].sort()
        : [],
    supportingArtifactPaths:
      status === 'anchored'
        ? [...new Set((top?.supportEntries ?? []).map(entry => entry.artifactPath))].sort()
        : [],
    supportingEntries: status === 'anchored' ? [...(top?.supportEntries ?? [])] : [],
    candidates,
  }
}

function buildCandidate(
  fingerprint: string,
  supportEntries: DeepSeekReleaseCurrentWindowSupportEntry[],
): DeepSeekReleaseCurrentWindowCandidate {
  const latestGeneratedAt = resolveLatestGeneratedAt(supportEntries)
  const latestGateGeneratedAt = resolveLatestGeneratedAt(
    supportEntries.filter(entry => entry.kind === 'gate'),
  )

  return {
    fingerprint,
    latestGeneratedAt,
    latestGateGeneratedAt,
    gateCount: supportEntries.filter(entry => entry.kind === 'gate').length,
    auditCount: supportEntries.filter(entry => entry.kind === 'audit').length,
    evidenceCount: supportEntries.length,
    supportEntries: [...supportEntries].sort(compareSupportEntries),
  }
}

function resolveSource(
  candidate: DeepSeekReleaseCurrentWindowCandidate | undefined,
): DeepSeekReleaseCurrentWindowSource {
  if (!candidate) {
    return 'selected-current-artifacts'
  }
  if (candidate.gateCount > 0) {
    return 'selected-current-gates'
  }
  if (candidate.auditCount > 0) {
    return 'selected-current-audits'
  }
  return 'selected-current-artifacts'
}

function compareCandidates(
  left: DeepSeekReleaseCurrentWindowCandidate,
  right: DeepSeekReleaseCurrentWindowCandidate,
): number {
  return (
    compareTimestampsDesc(left.latestGateGeneratedAt, right.latestGateGeneratedAt) ||
    right.gateCount - left.gateCount ||
    compareTimestampsDesc(left.latestGeneratedAt, right.latestGeneratedAt) ||
    right.evidenceCount - left.evidenceCount ||
    right.auditCount - left.auditCount ||
    left.fingerprint.localeCompare(right.fingerprint)
  )
}

function compareSupportEntries(
  left: DeepSeekReleaseCurrentWindowSupportEntry,
  right: DeepSeekReleaseCurrentWindowSupportEntry,
): number {
  return (
    compareTimestampsDesc(left.generatedAt, right.generatedAt) ||
    left.kind.localeCompare(right.kind) ||
    left.scenario.localeCompare(right.scenario) ||
    left.artifactPath.localeCompare(right.artifactPath)
  )
}

function resolveLatestGeneratedAt(
  entries: DeepSeekReleaseCurrentWindowSupportEntry[],
): string | null {
  const latest = [...entries].sort((left, right) =>
    compareTimestampsDesc(left.generatedAt, right.generatedAt),
  )[0]
  return latest?.generatedAt ?? null
}

function compareTimestampsDesc(
  left: string | null,
  right: string | null,
): number {
  const leftTime = Date.parse(left ?? '')
  const rightTime = Date.parse(right ?? '')
  const leftScore = Number.isFinite(leftTime) ? leftTime : 0
  const rightScore = Number.isFinite(rightTime) ? rightTime : 0
  return rightScore - leftScore
}
