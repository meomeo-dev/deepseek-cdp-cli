import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'

export type DeepSeekCoreRegressionScenario = 'release-core'

export type DeepSeekCoreRegressionStatus = 'pass' | 'fail'

export type DeepSeekCoreRegressionFailureClass =
  | 'ok'
  | 'browser_runtime_drift'
  | 'home_entry_drift'
  | 'session_restore_drift'
  | 'route_authority_drift'
  | 'output_mode_drift'
  | 'openai_shape_drift'
  | 'entrypoint_drift'

export interface DeepSeekCoreRegressionCheck {
  id: string
  status: DeepSeekCoreRegressionStatus
  failureClass: DeepSeekCoreRegressionFailureClass
  message: string
  evidence?: Record<string, unknown> | undefined
}

export interface DeepSeekCoreRegressionReport {
  scenario: DeepSeekCoreRegressionScenario
  ok: boolean
  checks: DeepSeekCoreRegressionCheck[]
}

export interface DeepSeekCorePlanObservation {
  mode: string | null
  cloneChromeProfile: boolean | null
  browserId: string | null
  browserRuntimeMode: string | null
  browserRuntimePurpose: string | null
  executionDisposition: string | null
  source: string | null
}

export interface DeepSeekCoreHomeObservation {
  finalUrl: string | null
  routeKind: string | null
  composerInputFound: boolean
  sendButtonFound: boolean
  sessionId: string | null
}

export interface DeepSeekCoreSessionCreationObservation {
  sessionId: string | null
  finalUrl: string | null
  sessionFile: string | null
  assistantTextLength: number
  assistantTextSource: string | null
  sessionCreateId: string | null
  routeSessionId: string | null
}

export interface DeepSeekCoreSessionRestoreObservation {
  authoritativeSessionId: string | null
  finalUrl: string | null
  routeVerified: boolean
  contextSource: string | null
  branchCount: number
}

export interface DeepSeekCoreOpenAiResponsesStreamObservation {
  chunkCount: number
  typeCount: number
  responseCreated: boolean
  responseCompleted: boolean
  nativeKindCount: number
}

export interface DeepSeekCoreInteractiveObservation {
  sessionId: string | null
  finalUrl: string | null
  assistantTextLength: number
}

export interface DeepSeekCoreRpcObservation {
  jsonrpc: string | null
  outputFormat: string | null
  outputJsonShape: string | null
  objectType: string | null
  sessionId: string | null
  assistantTextLength: number
}

export interface DeepSeekCoreRuntimeObservation {
  action: string | null
  browserId: string | null
  mode: string | null
  owner: string | null
  purpose: string | null
  state: string | null
  cdpUrl: string | null
  lastUsedAt: string | null
}

export interface DeepSeekCoreRegressionInput {
  attachPlan: DeepSeekCorePlanObservation
  ephemeralPlan: DeepSeekCorePlanObservation
  warmPlan: DeepSeekCorePlanObservation
  warmRuntimeStart: DeepSeekCoreRuntimeObservation
  warmRuntimeStatus: DeepSeekCoreRuntimeObservation
  attachHome: DeepSeekCoreHomeObservation
  ephemeralHome: DeepSeekCoreHomeObservation
  sessionCreation: DeepSeekCoreSessionCreationObservation
  sessionRestore: DeepSeekCoreSessionRestoreObservation
  cliOpenAiResponsesStream: DeepSeekCoreOpenAiResponsesStreamObservation
  interactive: DeepSeekCoreInteractiveObservation
  rpc: DeepSeekCoreRpcObservation
}

export interface DeepSeekCoreRegressionCommandReport {
  scenario: DeepSeekCoreRegressionScenario
  generatedAt: string
  commands: Record<string, string>
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  runtime: {
    warmBrowserId: string | null
    warmCdpUrl: string | null
    ephemeralCdpUrl: string | null
    sessionStoreDir: string
  }
  observations: DeepSeekCoreRegressionInput
  report: DeepSeekCoreRegressionReport
}
