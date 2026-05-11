import type {
  DeepSeekReleaseArtifactDescriptor,
  DeepSeekReleaseCapabilityStatus,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseFingerprintComparisonSummary,
} from './deepseek-release-diff.types.js'

export type DeepSeekReleaseAdapterBoundaryId =
  | 'ui-adapter'
  | 'api-contract'
  | 'output-adapter'

export type DeepSeekReleaseAdapterBoundaryStatus =
  | 'verified'
  | 'adapted'
  | 'drifted'
  | 'observation-pending'
  | 'not-observed'

export type DeepSeekReleaseIntegrationBoundaryStatus =
  | 'verified'
  | 'pending-verification'
  | 'observation-pending'

export interface DeepSeekReleaseBoundaryCapabilitySignal {
  capabilityId: string
  scenario: DeepSeekReleaseComparableScenario
  status: DeepSeekReleaseCapabilityStatus
}

export interface DeepSeekReleaseBoundaryLayerSignal {
  layer: 'ui' | 'api' | 'output'
  scenario: DeepSeekReleaseComparableScenario
  status: 'same' | 'changed' | 'baseline-missing' | 'fingerprint-unavailable' | 'current-missing'
}

export interface DeepSeekReleaseAdapterBoundaryReport {
  boundaryId: DeepSeekReleaseAdapterBoundaryId
  label: string
  description: string
  status: DeepSeekReleaseAdapterBoundaryStatus
  ownedScenarios: DeepSeekReleaseComparableScenario[]
  ownedLayers: Array<'ui' | 'api' | 'output'>
  ownedCapabilityIds: string[]
  ownedModulePaths: string[]
  ownedSpecPaths: string[]
  currentArtifactPaths: string[]
  baselineArtifactPaths: string[]
  layerSignals: DeepSeekReleaseBoundaryLayerSignal[]
  capabilitySignals: DeepSeekReleaseBoundaryCapabilitySignal[]
  reasons: string[]
}

export interface DeepSeekReleaseIntegrationBoundaryReport {
  boundaryId: 'integration'
  label: string
  description: string
  status: DeepSeekReleaseIntegrationBoundaryStatus
  requiredAdapterBoundaryIds: DeepSeekReleaseAdapterBoundaryId[]
  ownedCapabilityIds: string[]
  ownedModulePaths: string[]
  ownedSpecPaths: string[]
  currentArtifactPaths: string[]
  baselineArtifactPaths: string[]
  pendingBoundaryIds: DeepSeekReleaseAdapterBoundaryId[]
  driftedBoundaryIds: DeepSeekReleaseAdapterBoundaryId[]
  reasons: string[]
}

export interface DeepSeekReleaseBoundaryReport {
  generatedAt: string
  source: {
    currentArtifacts: DeepSeekReleaseArtifactDescriptor[]
    baselineArtifacts: DeepSeekReleaseArtifactDescriptor[]
    fingerprintSummary: DeepSeekReleaseFingerprintComparisonSummary
  }
  adapterBoundaries: DeepSeekReleaseAdapterBoundaryReport[]
  integration: DeepSeekReleaseIntegrationBoundaryReport
}
