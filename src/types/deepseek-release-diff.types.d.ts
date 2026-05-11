import type { DeepSeekBrowserRuntimeReleaseRegressionCommandReport } from './deepseek-browser-runtime-release-regression.types.js'
import type { DeepSeekCoreRegressionCommandReport } from './deepseek-core-regression.types.js'
import type { DeepSeekMutationReleaseRegressionCommandReport } from './deepseek-mutation-release-regression.types.js'
import type { DeepSeekReleaseArtifactSourceProvenance } from './deepseek-release-evidence.types.js'
import type { DeepSeekChatModeAuditReport } from './deepseek-mode-audit.types.js'
import type {
  DeepSeekReleaseCompatibilityStatus,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type {
  DeepSeekSearchRegressionCommandReport,
  DeepSeekSearchUiRetryProbeReport,
} from './deepseek-search-regression.types.js'
import type { DeepSeekSearchReleaseRegressionCommandReport } from './deepseek-search-release-regression.types.js'

export type DeepSeekReleaseComparableScenario =
  | 'release-core'
  | 'mode-audit'
  | 'search-success'
  | 'search-ui-retry-probe'
  | 'release-search-and-fact-check'
  | 'release-message-actions'
  | 'release-browser-runtime-governance'

export type DeepSeekReleaseCapabilityStatus =
  | 'pass'
  | 'fail'
  | 'unknown'
  | 'not-yet-rechecked'

export type DeepSeekReleaseDiffStatus =
  | 'same'
  | 'changed'
  | 'baseline-missing'
  | 'fingerprint-unavailable'
  | 'current-missing'

export type DeepSeekReleaseCapabilityArea =
  | 'core'
  | 'mode'
  | 'search'
  | 'mutation'
  | 'export'
  | 'runtime'
  | 'output'

export interface DeepSeekReleaseArtifactDescriptor {
  path: string
  scenario: DeepSeekReleaseComparableScenario
  provenance: DeepSeekReleaseArtifactSourceProvenance
  generatedAt: string | null
  compatibilityStatus: DeepSeekReleaseCompatibilityStatus | null
  primaryWindowFingerprint: string | null
  primaryFingerprint: string | null
  rawPrimaryFingerprint: string | null
}

export interface DeepSeekReleaseArtifactPair {
  scenario: DeepSeekReleaseComparableScenario
  current: DeepSeekReleaseArtifactDescriptor | null
  baseline: DeepSeekReleaseArtifactDescriptor | null
}

export interface DeepSeekReleaseLayerChange {
  field: string
  baseline: unknown
  current: unknown
}

export interface DeepSeekReleaseUiLayerDiff {
  scenario: DeepSeekReleaseComparableScenario
  status: DeepSeekReleaseDiffStatus
  currentFingerprint: string | null
  baselineFingerprint: string | null
  entryDocumentFingerprintChanged: boolean
  staticAssetFingerprintChanged: boolean
  routeShellFingerprintChanged: boolean
  modeSurfaceFingerprintChanged: boolean
  composerFingerprintChanged: boolean
  messageActionFingerprintChanged: boolean
  addedStaticAssets: string[]
  removedStaticAssets: string[]
  routeShellChanges: DeepSeekReleaseLayerChange[]
  modeSurfaceChanges: DeepSeekReleaseLayerChange[]
  composerChanges: DeepSeekReleaseLayerChange[]
  addedMessageActionSignatures: string[]
  removedMessageActionSignatures: string[]
}

export interface DeepSeekReleaseApiSignatureChange {
  endpoint: string
  baselineSignature: string | null
  currentSignature: string | null
  baselineEvidenceStatus: string | null
  currentEvidenceStatus: string | null
}

export interface DeepSeekReleaseApiLayerDiff {
  scenario: DeepSeekReleaseComparableScenario
  status: DeepSeekReleaseDiffStatus
  currentFingerprint: string | null
  baselineFingerprint: string | null
  confirmedEndpointDelta: number | null
  pendingEndpointDelta: number | null
  addedEndpoints: string[]
  removedEndpoints: string[]
  changedEndpoints: DeepSeekReleaseApiSignatureChange[]
}

export interface DeepSeekReleaseOutputQuirkChange {
  id: string
  baselineStatus: string | null
  currentStatus: string | null
}

export interface DeepSeekReleaseOutputLayerDiff {
  scenario: DeepSeekReleaseComparableScenario
  status: DeepSeekReleaseDiffStatus
  currentFingerprint: string | null
  baselineFingerprint: string | null
  addedQuirks: string[]
  removedQuirks: string[]
  changedQuirks: DeepSeekReleaseOutputQuirkChange[]
}

export interface DeepSeekReleaseRuntimeLayerDiff {
  scenario: DeepSeekReleaseComparableScenario
  status: DeepSeekReleaseDiffStatus
  changes: DeepSeekReleaseLayerChange[]
}

export interface DeepSeekReleaseLayerGroupSummary<TLayer> {
  changedScenarioCount: number
  sameScenarioCount: number
  baselineMissingScenarioCount: number
  fingerprintUnavailableScenarioCount: number
  currentMissingScenarioCount: number
  scenarios: TLayer[]
}

export interface DeepSeekReleaseCapabilityRow {
  capabilityId: string
  area: DeepSeekReleaseCapabilityArea
  label: string
  scenario: DeepSeekReleaseComparableScenario
  checkIds: string[]
  status: DeepSeekReleaseCapabilityStatus
  currentArtifactPath: string | null
  baselineArtifactPath: string | null
  currentFingerprint: string | null
  baselineFingerprint: string | null
  notes: string[]
}

export interface DeepSeekReleaseCapabilityMatrix {
  summary: {
    passCount: number
    failCount: number
    unknownCount: number
    notYetRecheckedCount: number
  }
  capabilities: DeepSeekReleaseCapabilityRow[]
}

export interface DeepSeekReleaseFingerprintComparisonSummary {
  currentReleaseWindowFingerprints: string[]
  baselineReleaseWindowFingerprints: string[]
  currentCompositeFingerprints: string[]
  baselineCompositeFingerprints: string[]
  currentRawCompositeFingerprints: string[]
  baselineRawCompositeFingerprints: string[]
  currentReleaseFamilyFingerprints: string[]
  baselineReleaseFamilyFingerprints: string[]
  currentUniqueFingerprintCount: number
  baselineUniqueFingerprintCount: number
  status: 'same' | 'changed' | 'mixed' | 'baseline-missing'
}

export interface DeepSeekReleaseDiffReport {
  generatedAt: string
  artifactPairs: DeepSeekReleaseArtifactPair[]
  fingerprintSummary: DeepSeekReleaseFingerprintComparisonSummary
  layers: {
    ui: DeepSeekReleaseLayerGroupSummary<DeepSeekReleaseUiLayerDiff>
    api: DeepSeekReleaseLayerGroupSummary<DeepSeekReleaseApiLayerDiff>
    output: DeepSeekReleaseLayerGroupSummary<DeepSeekReleaseOutputLayerDiff>
    runtime: DeepSeekReleaseLayerGroupSummary<DeepSeekReleaseRuntimeLayerDiff>
  }
  capabilityMatrix: DeepSeekReleaseCapabilityMatrix
}

export type DeepSeekComparableArtifact =
  | DeepSeekBrowserRuntimeReleaseRegressionCommandReport
  | DeepSeekCoreRegressionCommandReport
  | DeepSeekChatModeAuditReport
  | DeepSeekSearchRegressionCommandReport
  | DeepSeekSearchUiRetryProbeReport
  | DeepSeekSearchReleaseRegressionCommandReport
  | DeepSeekMutationReleaseRegressionCommandReport

export interface DeepSeekLoadedComparableArtifact {
  descriptor: DeepSeekReleaseArtifactDescriptor
  artifact: DeepSeekComparableArtifact
  releaseFingerprints: DeepSeekReleaseFingerprint[]
}
