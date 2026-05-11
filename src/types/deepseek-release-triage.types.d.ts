import type {
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from './deepseek-release-diff.types.js'
import type {
  DeepSeekReleaseArtifactSourceProvenance,
  DeepSeekReleaseEvidenceRootDescriptor,
} from './deepseek-release-evidence.types.js'

export type DeepSeekReleaseTriageDisposition =
  | 'ui-drift'
  | 'api-drift'
  | 'output-drift'
  | 'runtime-drift'
  | 'mixed'
  | 'observation-pending'

export type DeepSeekReleaseTriageRepairLane =
  | 'ui-adapter'
  | 'api-parser'
  | 'output-adapter'
  | 'runtime-service'
  | 'mixed-investigation'
  | 'evidence-freeze'

export type DeepSeekReleaseTriageBlockingSeverity =
  | 'blocking'
  | 'warning'
  | 'recheck'

export type DeepSeekReleaseTriageBlockingLayer =
  | 'ui'
  | 'api'
  | 'output'
  | 'runtime'
  | 'capability'

export type DeepSeekReleaseTriagePhase =
  | 'freeze-evidence'
  | 'minimal-probe'
  | 'adapter-fix'
  | 'targeted-regression'
  | 'full-regression'
  | 'docs-update'

export interface DeepSeekReleaseTriageEvidenceArtifact {
  role: 'current' | 'baseline'
  scenario: DeepSeekReleaseComparableScenario
  path: string
  provenance: DeepSeekReleaseArtifactSourceProvenance
  generatedAt: string | null
  compatibilityStatus: string | null
  primaryWindowFingerprint: string | null
  primaryFingerprint: string | null
  nestedArtifactPaths: string[]
}

export interface DeepSeekReleaseTriageBlockingItem {
  id: string
  severity: DeepSeekReleaseTriageBlockingSeverity
  layer: DeepSeekReleaseTriageBlockingLayer
  scenario: DeepSeekReleaseComparableScenario
  label: string
  reason: string
  currentArtifactPath: string | null
  baselineArtifactPath: string | null
  capabilityId?: string | null | undefined
}

export interface DeepSeekReleaseTriageNextStep {
  id: string
  phase: DeepSeekReleaseTriagePhase
  title: string
  rationale: string
  commands: string[]
  artifactPaths: string[]
}

export interface DeepSeekReleaseTriageReport {
  generatedAt: string
  disposition: DeepSeekReleaseTriageDisposition
  repairLane: DeepSeekReleaseTriageRepairLane
  probableReleaseChange: boolean
  impactedLayers: Array<'ui' | 'api' | 'output' | 'runtime'>
  blockingList: DeepSeekReleaseTriageBlockingItem[]
  evidence: {
    recommendedArtifactRootDir: string
    recommendedArtifactRoot: DeepSeekReleaseEvidenceRootDescriptor
    currentArtifacts: DeepSeekReleaseTriageEvidenceArtifact[]
    baselineArtifacts: DeepSeekReleaseTriageEvidenceArtifact[]
  }
  nextSteps: DeepSeekReleaseTriageNextStep[]
  notes: string[]
  diffReport: DeepSeekReleaseDiffReport
}

export interface DeepSeekSelectedReleaseArtifacts {
  scenarios: DeepSeekReleaseComparableScenario[]
  requestedComparableRoot: DeepSeekReleaseEvidenceRootDescriptor
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
}
