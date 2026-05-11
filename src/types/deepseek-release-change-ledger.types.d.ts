import type { DeepSeekReleaseBoundaryReport } from './deepseek-release-boundary.types.js'
import type {
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from './deepseek-release-diff.types.js'
import type { DeepSeekReleaseRevalidationReport } from './deepseek-release-revalidation.types.js'
import type { DeepSeekReleaseTriageReport } from './deepseek-release-triage.types.js'

export type DeepSeekReleaseChangeLedgerStatus =
  | 'confirmed'
  | 'removed'
  | 'changed'
  | 'unresolved'

export type DeepSeekReleaseChangeLedgerSurface =
  | 'home'
  | 'composer'
  | 'session'
  | 'message-action'
  | 'search'
  | 'file'
  | 'mode'
  | 'api'
  | 'output'
  | 'runtime'
  | 'other'

export interface DeepSeekReleaseObservationEntry {
  id: string
  status: DeepSeekReleaseChangeLedgerStatus
  surface: DeepSeekReleaseChangeLedgerSurface
  scope: 'home' | 'composer' | 'session' | 'message-action' | 'release-window' | 'other'
  title: string
  detail: string
  confidence: 'high' | 'medium' | 'low'
  evidencePaths?: string[] | undefined
  followUpTaskIds?: string[] | undefined
}

export interface DeepSeekReleaseObservationUnresolvedItem {
  id: string
  question: string
  surfaces: DeepSeekReleaseChangeLedgerSurface[]
  relatedEntryIds?: string[] | undefined
  detail: string
  followUpTaskIds?: string[] | undefined
}

export interface DeepSeekReleaseObservationSeed {
  capturedAt: string
  source:
    | 'manual-browser-observation'
    | 'manual-codebase-observation'
    | 'manual-hybrid-observation'
  releaseContext?: {
    url?: string | undefined
    note?: string | undefined
  } | undefined
  entries: DeepSeekReleaseObservationEntry[]
  unresolvedMatrix?: DeepSeekReleaseObservationUnresolvedItem[] | undefined
}

export interface DeepSeekReleaseChangeLedgerEntry {
  id: string
  source:
    | 'manual-observation'
    | 'release-diff'
    | 'release-boundaries'
    | 'release-triage'
    | 'release-revalidate'
    | 'endpoint-audit'
    | 'derived'
  status: DeepSeekReleaseChangeLedgerStatus
  surface: DeepSeekReleaseChangeLedgerSurface
  title: string
  detail: string
  relatedScenarios: DeepSeekReleaseComparableScenario[]
  evidencePaths: string[]
  followUpTaskIds: string[]
}

export interface DeepSeekReleaseChangeLedgerUnresolvedItem {
  id: string
  question: string
  surfaces: DeepSeekReleaseChangeLedgerSurface[]
  relatedEntryIds: string[]
  detail: string
  followUpTaskIds: string[]
}

export interface DeepSeekReleaseChangeLedgerReport {
  generatedAt: string
  releaseWindow: {
    fingerprintStatus: DeepSeekReleaseDiffReport['fingerprintSummary']['status']
    oldCompositeFingerprints: string[]
    newCompositeFingerprints: string[]
  }
  summary: {
    confirmedCount: number
    removedCount: number
    changedCount: number
    unresolvedCount: number
  }
  entries: DeepSeekReleaseChangeLedgerEntry[]
  unresolvedMatrix: DeepSeekReleaseChangeLedgerUnresolvedItem[]
  notes: string[]
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  revalidationReport: DeepSeekReleaseRevalidationReport
}
