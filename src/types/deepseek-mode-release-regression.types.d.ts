import type { DeepSeekChatMode } from './deepseek-chat-mode.types.js'
import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type { DeepSeekChatModeAuditReport } from './deepseek-mode-audit.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type { DeepSeekGenerationSettlementStatus } from './deepseek-stream-control.types.js'

export type DeepSeekModeReleaseRegressionScenario = 'release-mode-controls'

export type DeepSeekModeReleaseRegressionStatus = 'pass' | 'fail'

export type DeepSeekModeReleaseRegressionFailureClass =
  | 'ok'
  | 'mode_surface_drift'
  | 'composer_toggle_drift'
  | 'composer_stop_cycle_drift'
  | 'capability_boundary_drift'

export interface DeepSeekModeReleaseRegressionCheck {
  id: string
  status: DeepSeekModeReleaseRegressionStatus
  failureClass: DeepSeekModeReleaseRegressionFailureClass
  message: string
  evidence?: Record<string, unknown> | undefined
}

export interface DeepSeekModeReleaseRegressionReport {
  scenario: DeepSeekModeReleaseRegressionScenario
  ok: boolean
  checks: DeepSeekModeReleaseRegressionCheck[]
}

export interface DeepSeekModeReleaseRegressionStopCycleObservation {
  chatMode: DeepSeekChatMode
  sessionId: string | null
  finalUrl: string | null
  beforeSendSnapshot: DeepSeekComposerSnapshot
  afterStopSnapshot: DeepSeekComposerSnapshot
  generationResponseObserved: boolean
  stopModeObserved: boolean
  stopClickIssued: boolean
  liveSettlementStatus: DeepSeekGenerationSettlementStatus | null
  liveSettlementSource: string | null
  stopAcknowledged: boolean
  targetStatus: string | null
  continueCommandAvailable: boolean
}

export interface DeepSeekModeReleaseRegressionInput {
  modeAudit: DeepSeekChatModeAuditReport
  instantDefaultControls: DeepSeekComposerSnapshot
  instantTogglesOffControls: DeepSeekComposerSnapshot
  expertDefaultControls: DeepSeekComposerSnapshot
  expertTogglesOffControls: DeepSeekComposerSnapshot
  visionDefaultControls: DeepSeekComposerSnapshot
  instantStopCycle: DeepSeekModeReleaseRegressionStopCycleObservation
  expertStopCycle: DeepSeekModeReleaseRegressionStopCycleObservation
}

export interface DeepSeekModeReleaseRegressionCommandReport {
  scenario: DeepSeekModeReleaseRegressionScenario
  generatedAt: string
  coveredChatModes: DeepSeekChatMode[]
  commands: Record<string, string>
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  runtime: {
    browserId: string | null
    cdpUrl: string
    sessionStoreDir: string
  }
  artifacts: {
    rawEvidenceDir: string
    modeAuditFile: string
    controlSnapshotFiles: Array<{
      id: string
      file: string
    }>
    stopCycleFiles: Array<{
      chatMode: DeepSeekChatMode
      file: string
    }>
  }
  observations: DeepSeekModeReleaseRegressionInput
  report: DeepSeekModeReleaseRegressionReport
}
