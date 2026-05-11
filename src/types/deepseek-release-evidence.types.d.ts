export type DeepSeekReleaseEvidenceRootKind =
  | 'managed'
  | 'legacy'
  | 'custom'

export type DeepSeekReleaseEvidenceRootRole =
  | 'comparable'
  | 'triage'

export type DeepSeekReleaseArtifactSelectionSource =
  | 'explicit'
  | 'primary'
  | 'legacy-fallback'

export interface DeepSeekReleaseEvidenceRootDescriptor {
  kind: DeepSeekReleaseEvidenceRootKind
  role: DeepSeekReleaseEvidenceRootRole
  path: string
}

export interface DeepSeekReleaseArtifactSourceProvenance {
  selectionSource: DeepSeekReleaseArtifactSelectionSource
  root: DeepSeekReleaseEvidenceRootDescriptor
}

export interface DeepSeekResolvedReleaseEvidenceRoots {
  managedComparableDir: string
  managedTriageDir: string
  legacyComparableDir: string
  legacyTriageDir: string
}
