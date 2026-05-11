import type { DeepSeekReplyResult } from './deepseek-reply.types.js'
import type { DeepSeekChatMode, DeepSeekChatModeFact } from './deepseek-chat-mode.types.js'
import type {
  DeepSeekResolvedOutputMode,
} from './deepseek-output-modes.types.js'
import type {
  DeepSeekRpcBufferedResult,
  DeepSeekRpcStreamEventFrame,
  DeepSeekRpcStreamingResult,
} from './rpc-output.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'

export type DeepSeekSearchRegressionScenario =
  | 'search-success'
  | 'search-rate-limit'
  | 'search-ui-retry'

export type DeepSeekSearchRegressionStatus = 'pass' | 'fail' | 'warn'

export type DeepSeekSearchRegressionFailureClass =
  | 'ok'
  | 'search_not_triggered'
  | 'rate_limited'
  | 'citation_export_drift'
  | 'ui_retry_drift'
  | 'ui_retry_unresolved'
  | 'surface_output_drift'

export interface DeepSeekSearchRegressionCheck {
  id: string
  status: DeepSeekSearchRegressionStatus
  failureClass: DeepSeekSearchRegressionFailureClass
  message: string
  evidence?: Record<string, unknown> | undefined
}

export interface DeepSeekSearchRegressionReport {
  scenario: DeepSeekSearchRegressionScenario
  ok: boolean
  checks: DeepSeekSearchRegressionCheck[]
}

export interface DeepSeekSearchSuccessRegressionInput {
  result: DeepSeekReplyResult
  cliTextOutput: string
  cliJsonOutput: unknown
  cliStreamJsonOutput: unknown[]
  interactiveTextOutput: string
  rpcStreamFrames: DeepSeekRpcStreamEventFrame[]
  rpcStreamingResult: DeepSeekRpcStreamingResult
  branchExportDocument: unknown
  sessionExportDocument: unknown
}

export interface DeepSeekSearchRateLimitRegressionInput {
  result: DeepSeekReplyResult
  cliTextOutput: string
  cliJsonOutput: unknown
  cliStreamJsonOutput: unknown[]
  interactiveTextOutput: string
  rpcBufferedResult: DeepSeekRpcBufferedResult
  rpcStreamFrames: DeepSeekRpcStreamEventFrame[]
  rpcStreamingResult: DeepSeekRpcStreamingResult
}

export interface DeepSeekSearchUiRetryProbeMatrixEntry {
  condition: 'search-rate-limit' | 'general-rate-limit' | 'generation-failed' | 'stop-continue'
  status: 'observed' | 'not-observed' | 'unresolved' | 'not-applicable'
  notes: string[]
}

export interface DeepSeekSearchUiRetryProbeAttempt {
  index: number
  releaseFingerprint?: DeepSeekReleaseFingerprint | null | undefined
  targetMessageId: string | null
  resolvedUiTargetMessageId: string | null
  uiRetryAudit: {
    observed: boolean
    messageActionMatches: Array<{
      messageId: string
      control: {
        action: string
        controlKind: string | null
      }
    }>
  } | null
  retryUiAction: {
    clicked: boolean
    targetMessageId: string | null
    targetSource: 'message-action-match' | 'canonical-generation' | 'missing'
    errorCode: string | null
    controlKind: string | null
  } | null
}

export interface DeepSeekSearchUiRetryProbeReport {
  generatedAt: string
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  summary: {
    rateLimitCount: number
    uiRetryObservedCount: number
    uiRetryClickedCount: number
    unresolvedCount: number
    failedCount: number
  }
  matrix: DeepSeekSearchUiRetryProbeMatrixEntry[]
  attempts: DeepSeekSearchUiRetryProbeAttempt[]
}

export interface DeepSeekSearchUiRetryRegressionInput {
  probeReport: DeepSeekSearchUiRetryProbeReport
}

export interface DeepSeekSearchRegressionSuiteReport {
  generatedAt: string
  ok: boolean
  reports: DeepSeekSearchRegressionReport[]
}

export interface DeepSeekSearchRegressionCommandReport {
  scenario: 'search-success'
  generatedAt: string
  coveredChatModes: DeepSeekChatMode[]
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  outputModeMatrix: {
    text: DeepSeekResolvedOutputMode
    json: DeepSeekResolvedOutputMode
    streamJson: DeepSeekResolvedOutputMode
  }
  authority: {
    sessionId: string
    sessionFile: string
    finalUrl: string
    branchId: string | null
    requestedChatMode: DeepSeekChatMode | null
    modeFact: DeepSeekChatModeFact | null
  }
  report: DeepSeekSearchRegressionReport
}
