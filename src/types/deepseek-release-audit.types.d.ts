import type { DeepSeekReleaseBoundaryReport } from './deepseek-release-boundary.types.js'
import type { DeepSeekReleaseChangeLedgerReport } from './deepseek-release-change-ledger.types.js'
import type { DeepSeekReleaseCurrentWindowResolution } from './deepseek-release-current-window.types.js'
import type {
  DeepSeekReleaseComparableScenario,
  DeepSeekReleaseDiffReport,
} from './deepseek-release-diff.types.js'
import type { DeepSeekReleaseHandoffMatrixReport } from './deepseek-release-handoff.types.js'
import type { DeepSeekReleaseRevalidationReport } from './deepseek-release-revalidation.types.js'
import type { DeepSeekReleaseTriageReport } from './deepseek-release-triage.types.js'

export type DeepSeekReleaseAuditSupplementalScenario =
  | 'selector-drift-audit'
  | 'endpoint-drift-audit'
  | 'output-drift-audit'

export type DeepSeekReleaseAuditEvidenceClassification =
  | 'current-proof'
  | 'current-audit-evidence'
  | 'baseline-only'
  | 'missing'

export type DeepSeekReleaseAuditFreshnessStatus =
  | 'current-window'
  | 'stale-window'
  | 'missing-release-fingerprint'
  | 'missing'

export type DeepSeekReleaseAuditGateStatus =
  | 'pass'
  | 'fail'
  | 'unknown'
  | 'not-yet-rechecked'

export type DeepSeekReleaseAuditBoundaryCategory =
  | 'rate_limit_observation_pending'
  | 'search_only_confirmed'
  | 'general_unresolved'
  | 'pending_internal_audit'

export interface DeepSeekReleaseAuditEvidenceEntry {
  taskId: string
  label: string
  wave: 'wave21' | 'wave22'
  kind: 'gate' | 'audit'
  scenario: DeepSeekReleaseComparableScenario | DeepSeekReleaseAuditSupplementalScenario
  artifactPath: string | null
  baselineArtifactPaths: string[]
  generatedAt: string | null
  compatibilityStatus: string | null
  primaryWindowFingerprint: string | null
  primaryFingerprint: string | null
  currentWindowFingerprintMatched: boolean
  classification: DeepSeekReleaseAuditEvidenceClassification
  freshnessStatus: DeepSeekReleaseAuditFreshnessStatus
  gateStatus: DeepSeekReleaseAuditGateStatus
  failureCount: number | null
  warningCount: number | null
  reasons: string[]
}

export interface DeepSeekReleaseAuditBoundaryItem {
  id: string
  category: DeepSeekReleaseAuditBoundaryCategory
  status: 'warn' | 'unknown'
  label: string
  detail: string
  evidencePaths: string[]
  sourceTaskIds: string[]
}

export interface DeepSeekReleaseAuditArtifactFreshness {
  authoritativeSource: DeepSeekReleaseCurrentWindowResolution['source']
  authoritativeCompositeFingerprints: string[]
  currentProofCount: number
  currentAuditEvidenceCount: number
  baselineOnlyCount: number
  missingCount: number
  entries: DeepSeekReleaseAuditEvidenceEntry[]
}

export interface DeepSeekReleaseAuditPublishGate {
  status: DeepSeekReleaseAuditGateStatus
  passTaskIds: string[]
  failTaskIds: string[]
  unknownTaskIds: string[]
  notYetRecheckedTaskIds: string[]
}

export interface DeepSeekReleaseAuditReport {
  generatedAt: string
  authoritativeCurrentWindow: DeepSeekReleaseCurrentWindowResolution
  releaseWindow: {
    fingerprintStatus: DeepSeekReleaseDiffReport['fingerprintSummary']['status']
    authoritativeSource: DeepSeekReleaseAuditArtifactFreshness['authoritativeSource']
    authoritativeCompositeFingerprints: string[]
    oldCompositeFingerprints: string[]
    selectedCurrentCompositeFingerprints: string[]
  }
  summary: {
    passCount: number
    failCount: number
    unknownCount: number
    notYetRecheckedCount: number
  }
  publishGate: DeepSeekReleaseAuditPublishGate
  currentProofInventory: DeepSeekReleaseAuditEvidenceEntry[]
  currentAuditEvidence: DeepSeekReleaseAuditEvidenceEntry[]
  baselineOnlyEvidence: DeepSeekReleaseAuditEvidenceEntry[]
  artifactFreshness: DeepSeekReleaseAuditArtifactFreshness
  unresolvedBoundaries: DeepSeekReleaseAuditBoundaryItem[]
  notes: string[]
  diffReport: DeepSeekReleaseDiffReport
  boundaryReport: DeepSeekReleaseBoundaryReport
  triageReport: DeepSeekReleaseTriageReport
  revalidationReport: DeepSeekReleaseRevalidationReport
  handoffMatrixReport: DeepSeekReleaseHandoffMatrixReport
  changeLedgerReport: DeepSeekReleaseChangeLedgerReport
}
