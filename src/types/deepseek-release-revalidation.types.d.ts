import type {
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from './deepseek-release-diff.types.js'
import type { DeepSeekReleaseBoundaryReport } from './deepseek-release-boundary.types.js'
import type { DeepSeekReleaseCurrentWindowResolution } from './deepseek-release-current-window.types.js'
import type {
  DeepSeekReleaseTriageDisposition,
  DeepSeekReleaseTriageRepairLane,
  DeepSeekReleaseTriageReport,
} from './deepseek-release-triage.types.js'

export type DeepSeekReleaseRevalidationStageId =
  | 'fingerprint-change-confirmed'
  | 'diff-report'
  | 'layer-specific-probes'
  | 'targeted-gate'
  | 'full-release-regression'
  | 'docs-spec-update'

export type DeepSeekReleaseRevalidationStageStatus =
  | 'completed'
  | 'pending'
  | 'blocked'
  | 'not-required'

export type DeepSeekReleaseRevalidationReadiness =
  | 'observation-pending'
  | 'blocked'
  | 'ready-for-wave21'
  | 'ready-for-wave22'
  | 'completed'

export interface DeepSeekReleaseRevalidationRepairItem {
  id: string
  source: 'derived' | 'manual-note'
  lane: DeepSeekReleaseTriageRepairLane | 'docs-update'
  label: string
  relatedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>
  relatedScenarios: DeepSeekReleaseComparableScenario[]
  note?: string | null | undefined
}

export interface DeepSeekReleaseResidualBoundary {
  boundaryId: string
  label: string
  status: string
  reasons: string[]
}

export interface DeepSeekReleaseUnrevalidatedItem {
  id: string
  type: 'capability' | 'scenario' | 'boundary' | 'docs'
  label: string
  scenario?: DeepSeekReleaseComparableScenario | null | undefined
  status: string
  reason: string
}

export interface DeepSeekReleaseLayerProbeStatus {
  layer: 'ui' | 'api' | 'output' | 'runtime'
  status: DeepSeekReleaseRevalidationStageStatus
  reason: string
  artifactPaths: string[]
}

export interface DeepSeekReleaseRevalidationStage {
  id: DeepSeekReleaseRevalidationStageId
  title: string
  status: DeepSeekReleaseRevalidationStageStatus
  rationale: string
  commands: string[]
  artifactPaths: string[]
}

export interface DeepSeekReleaseRevalidationReport {
  generatedAt: string
  readiness: DeepSeekReleaseRevalidationReadiness
  authoritativeCurrentWindow: DeepSeekReleaseCurrentWindowResolution
  releaseWindow: {
    fingerprintStatus: DeepSeekReleaseDiffReport['fingerprintSummary']['status']
    oldCompositeFingerprints: string[]
    newCompositeFingerprints: string[]
    oldArtifactPaths: string[]
    newArtifactPaths: string[]
  }
  impact: {
    disposition: DeepSeekReleaseTriageDisposition
    repairLane: DeepSeekReleaseTriageRepairLane
    impactedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>
    affectedScenarios: DeepSeekReleaseComparableScenario[]
    blockingItemIds: string[]
  }
  waveReadiness: {
    wave21EntryAllowed: boolean
    wave22AuditAllowed: boolean
  }
  layerProbeStatus: DeepSeekReleaseLayerProbeStatus[]
  repairItems: DeepSeekReleaseRevalidationRepairItem[]
  residualBoundaries: DeepSeekReleaseResidualBoundary[]
  unrevalidatedItems: DeepSeekReleaseUnrevalidatedItem[]
  stages: DeepSeekReleaseRevalidationStage[]
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
}
