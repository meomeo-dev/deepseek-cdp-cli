import type { DeepSeekReleaseDiffReport } from './deepseek-release-diff.types.js'

export type DeepSeekReleaseCurrentWindowStatus =
  | 'anchored'
  | 'mixed'
  | 'unresolved'

export type DeepSeekReleaseCurrentWindowSource =
  | 'selected-current-gates'
  | 'selected-current-audits'
  | 'selected-current-artifacts'

export interface DeepSeekReleaseCurrentWindowSupportEntry {
  taskId: string | null
  scenario: string
  kind: 'gate' | 'audit'
  artifactPath: string
  generatedAt: string | null
  primaryWindowFingerprint: string
  primaryReleaseFamilyFingerprint: string | null
}

export interface DeepSeekReleaseCurrentWindowCandidate {
  fingerprint: string
  latestGeneratedAt: string | null
  latestGateGeneratedAt: string | null
  gateCount: number
  auditCount: number
  evidenceCount: number
  supportEntries: DeepSeekReleaseCurrentWindowSupportEntry[]
}

export interface DeepSeekReleaseCurrentWindowResolution {
  status: DeepSeekReleaseCurrentWindowStatus
  source: DeepSeekReleaseCurrentWindowSource
  primaryFingerprint: string | null
  candidateFingerprints: string[]
  selectedFingerprintStatus: DeepSeekReleaseDiffReport['fingerprintSummary']['status']
  supportingTaskIds: string[]
  supportingArtifactPaths: string[]
  supportingEntries: DeepSeekReleaseCurrentWindowSupportEntry[]
  candidates: DeepSeekReleaseCurrentWindowCandidate[]
}
