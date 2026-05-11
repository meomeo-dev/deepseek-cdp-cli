import type { DeepSeekChatMode } from './deepseek-chat-mode.types.js'
import type { DeepSeekReleaseBoundaryReport } from './deepseek-release-boundary.types.js'
import type { DeepSeekReleaseCurrentWindowResolution } from './deepseek-release-current-window.types.js'
import type {
  DeepSeekLoadedComparableArtifact,
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from './deepseek-release-diff.types.js'
import type { DeepSeekReleaseRevalidationReport } from './deepseek-release-revalidation.types.js'
import type { DeepSeekReleaseTriageReport } from './deepseek-release-triage.types.js'

export type DeepSeekReleaseHandoffWave = 'wave21' | 'wave22'

export type DeepSeekReleaseHandoffModeCoverage = DeepSeekChatMode | 'mode-agnostic'

export type DeepSeekReleaseHandoffEntryStatus =
  | 'covered-by-current-artifact'
  | 'pending-rerun'
  | 'blocked'
  | 'mode-observation-pending'

export type DeepSeekReleaseHandoffHistoricalAuthority =
  | 'baseline-only'
  | 'superseded-by-current-artifact'
  | 'not-available'

export type DeepSeekReleaseHandoffExpertFileStatus =
  | 'confirmed-missing'
  | 'confirmed-present'
  | 'unresolved'

export interface DeepSeekReleaseHandoffModeFactMapping {
  mode: DeepSeekChatMode
  requestModelType: string | null
  readyModelType: string | null
  historyModelType: string | null
}

export interface DeepSeekReleaseModeSurfaceSummary {
  defaultMode: DeepSeekChatMode | null
  observedModes: DeepSeekChatMode[]
  searchCapableModes: DeepSeekChatMode[]
  expertFileStatus: DeepSeekReleaseHandoffExpertFileStatus
  modeSelectorVisible: boolean | null
  factMappings: DeepSeekReleaseHandoffModeFactMapping[]
  notes: string[]
}

export interface DeepSeekReleaseHandoffPrerequisite {
  id: 'mode-audit'
  label: string
  status: DeepSeekReleaseHandoffEntryStatus
  historicalAuthority: DeepSeekReleaseHandoffHistoricalAuthority
  reasons: string[]
  commands: string[]
  currentArtifactPaths: string[]
  baselineArtifactPaths: string[]
}

export interface DeepSeekReleaseHandoffPermutation {
  id: string
  mode: DeepSeekReleaseHandoffModeCoverage
  label: string
  focus: string
}

export interface DeepSeekReleaseHistoricalGateInvalidation {
  id: string
  taskId: string
  label: string
  affectedModes: DeepSeekReleaseHandoffModeCoverage[]
  reasons: string[]
  baselineArtifactPaths: string[]
}

export interface DeepSeekReleaseHandoffMatrixEntry {
  id: string
  taskId: string
  wave: DeepSeekReleaseHandoffWave
  kind: 'gate' | 'audit'
  label: string
  scenarios: DeepSeekReleaseComparableScenario[]
  modeCoverage: DeepSeekReleaseHandoffModeCoverage[]
  requiredPermutations: DeepSeekReleaseHandoffPermutation[]
  status: DeepSeekReleaseHandoffEntryStatus
  historicalAuthority: DeepSeekReleaseHandoffHistoricalAuthority
  reasons: string[]
  commands: string[]
  currentArtifactPaths: string[]
  baselineArtifactPaths: string[]
}

export interface DeepSeekReleaseHandoffMatrixSection {
  rerunRequiredCount: number
  coveredCount: number
  blockedCount: number
  entries: DeepSeekReleaseHandoffMatrixEntry[]
}

export interface DeepSeekReleaseHandoffMatrixReport {
  generatedAt: string
  authoritativeCurrentWindow: DeepSeekReleaseCurrentWindowResolution
  releaseWindow: {
    fingerprintStatus: DeepSeekReleaseDiffReport['fingerprintSummary']['status']
    oldCompositeFingerprints: string[]
    newCompositeFingerprints: string[]
  }
  summary: {
    historicalInvalidationCount: number
    futureTaskCount: number
    modeCoverage: DeepSeekReleaseHandoffModeCoverage[]
  }
  modeSurface: DeepSeekReleaseModeSurfaceSummary
  prerequisites: DeepSeekReleaseHandoffPrerequisite[]
  historicalInvalidations: DeepSeekReleaseHistoricalGateInvalidation[]
  wave21: DeepSeekReleaseHandoffMatrixSection
  wave22: DeepSeekReleaseHandoffMatrixSection
  notes: string[]
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  revalidationReport: DeepSeekReleaseRevalidationReport
}

export interface BuildDeepSeekReleaseHandoffMatrixInput {
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  revalidationReport: DeepSeekReleaseRevalidationReport
  currentArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  baselineArtifacts: Partial<Record<DeepSeekReleaseComparableScenario, DeepSeekLoadedComparableArtifact>>
  artifactRootDir: string
}
