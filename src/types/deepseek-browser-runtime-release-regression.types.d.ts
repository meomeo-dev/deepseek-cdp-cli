import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'

export type DeepSeekBrowserRuntimeReleaseRegressionScenario =
  'release-browser-runtime-governance'

export type DeepSeekBrowserRuntimeReleaseRegressionStatus = 'pass' | 'fail'

export type DeepSeekBrowserRuntimeReleaseRegressionFailureClass =
  | 'ok'
  | 'runtime_registry_drift'
  | 'browser_id_reuse_drift'
  | 'busy_guard_drift'
  | 'restart_stop_drift'
  | 'idle_watchdog_drift'
  | 'attach_guard_drift'
  | 'cleanup_stale_drift'
  | 'cdp_conflict_drift'
  | 'parallel_runtime_drift'

export interface DeepSeekBrowserRuntimeReleaseRegressionCheck {
  id: string
  status: DeepSeekBrowserRuntimeReleaseRegressionStatus
  failureClass: DeepSeekBrowserRuntimeReleaseRegressionFailureClass
  message: string
  evidence?: unknown
}

export interface DeepSeekBrowserRuntimeReleaseRegressionReport {
  scenario: DeepSeekBrowserRuntimeReleaseRegressionScenario
  ok: boolean
  checks: DeepSeekBrowserRuntimeReleaseRegressionCheck[]
}

export interface DeepSeekBrowserRuntimeReleaseLifecycleObservation {
  action: string | null
  browserId: string | null
  mode: string | null
  owner: string | null
  purpose: string | null
  state: string | null
  busy: boolean | null
  pid: number | null
  availableActions: string[]
  lastUsedAt: string | null
}

export interface DeepSeekBrowserRuntimeReleaseBusyGuardObservation {
  commandExited: boolean
  runtimeObservedBusy: boolean
  observedLeaseOperation: string | null
  stopRejected: boolean
  stopError: string | null
  restartRejected: boolean
  restartError: string | null
  releasedToIdle: boolean
}

export interface DeepSeekBrowserRuntimeReleaseIdleWatchdogObservation {
  browserId: string | null
  startObserved: boolean
  statusObservedBeforeExpiry: boolean
  cleanedByWatchdog: boolean
  elapsedMs: number | null
}

export interface DeepSeekBrowserRuntimeReleaseAttachObservation {
  browserId: string | null
  registered: boolean
  owner: string | null
  stopRejected: boolean
  stopError: string | null
  externalStillReachableAfterStop: boolean
  cleanupForgotten: boolean
  cleanupForgottenRuntimeIds: string[]
  statusMissingAfterCleanup: boolean
}

export interface DeepSeekBrowserRuntimeReleaseConflictObservation {
  rejected: boolean
  error: string | null
  actionable: boolean
  cdpUrl: string
}

export interface DeepSeekBrowserRuntimeReleaseParallelObservation {
  browserIds: string[]
  concurrentBusyCount: number
  distinctRuntimeCount: number
  releasedCleanly: boolean
}

export interface DeepSeekBrowserRuntimeReleaseRegressionInput {
  primaryRuntimeStart: DeepSeekBrowserRuntimeReleaseLifecycleObservation
  primaryRuntimeListed: boolean
  primaryRuntimeStatus: DeepSeekBrowserRuntimeReleaseLifecycleObservation
  browserIdReuse: {
    reusedBrowserId: string | null
    runtimeObservedBusy: boolean
    releasedToIdle: boolean
  }
  busyGuard: DeepSeekBrowserRuntimeReleaseBusyGuardObservation
  primaryRuntimeRestart: DeepSeekBrowserRuntimeReleaseLifecycleObservation
  primaryRuntimeStop: {
    action: string | null
    browserId: string | null
    owner: string | null
    forced: boolean | null
    statusMissingAfterStop: boolean
  }
  idleWatchdog: DeepSeekBrowserRuntimeReleaseIdleWatchdogObservation
  attachRuntime: DeepSeekBrowserRuntimeReleaseAttachObservation
  cdpUrlConflict: DeepSeekBrowserRuntimeReleaseConflictObservation
  parallelRuntimes: DeepSeekBrowserRuntimeReleaseParallelObservation
}

export interface DeepSeekBrowserRuntimeReleaseRegressionCommandReport {
  scenario: DeepSeekBrowserRuntimeReleaseRegressionScenario
  generatedAt: string
  commands: Record<string, string>
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  runtime: {
    primaryBrowserId: string | null
    primaryCdpUrl: string
    watchdogBrowserId: string | null
    watchdogCdpUrl: string
    parallelBrowserIds: string[]
    parallelCdpUrls: string[]
    attachBrowserId: string | null
    attachCdpUrl: string
    localEvidenceBaseUrl: string
  }
  artifacts: {
    rawEvidenceDir: string
    busyHoldLogFile: string
    attachHoldLogFile: string
    parallelHoldLogFiles: string[]
  }
  observations: DeepSeekBrowserRuntimeReleaseRegressionInput
  report: DeepSeekBrowserRuntimeReleaseRegressionReport
}
