import type {
  DeepSeekSearchRegressionCommandReport,
  DeepSeekSearchRegressionReport,
  DeepSeekSearchUiRetryProbeReport,
} from './deepseek-search-regression.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type { DeepSeekChatMode } from './deepseek-chat-mode.types.js'

export type DeepSeekSearchReleaseRegressionScenario = 'release-search-and-fact-check'

export type DeepSeekSearchReleaseRegressionStatus = 'pass' | 'fail' | 'warn'

export type DeepSeekSearchReleaseRegressionFailureClass =
  | 'ok'
  | 'search_success_drift'
  | 'fact_check_template_drift'
  | 'fact_check_output_drift'
  | 'rate_limit_retry_drift'
  | 'rate_limit_observation_pending'
  | 'ui_retry_boundary_drift'
  | 'ui_retry_boundary_unresolved'
  | 'reference_rendering_drift'

export interface DeepSeekSearchReleaseRegressionCheck {
  id: string
  status: DeepSeekSearchReleaseRegressionStatus
  failureClass: DeepSeekSearchReleaseRegressionFailureClass
  message: string
  evidence?: Record<string, unknown> | undefined
}

export interface DeepSeekSearchReleaseRegressionReport {
  scenario: DeepSeekSearchReleaseRegressionScenario
  ok: boolean
  checks: DeepSeekSearchReleaseRegressionCheck[]
}

export interface DeepSeekFactCheckTemplateObservation {
  sampleId: string | null
  title: string | null
  expectedOpeningPrefix: string
  requiredDeepThink: string | null
  requiredSearch: string | null
  promptHasClaimSection: boolean
  promptHasTaskSection: boolean
  promptHasOutputStructureSection: boolean
  promptHasProbabilityBuckets: boolean
  verificationScriptMentionsOpeningPrefix: boolean
}

export interface DeepSeekFactCheckExecutionObservation {
  sessionId: string | null
  finalUrl: string | null
  assistantTextLength: number
  assistantStartsWithExpectedOpeningPrefix: boolean
  probabilityBucketLabelCount: number
  probabilityPercentMentionCount: number
  assistantSearchCount: number
  assistantCitationCount: number
  cliTextHasCitations: boolean
  cliTextHasSearchResultSet: boolean
  cliJsonSearchCount: number
  cliJsonCitationCount: number
  cliStreamHasSearchPatch: boolean
  rpcSearchCount: number
  rpcCitationCount: number
  branchExportHasSearchEvidence: boolean
  branchExportCitationCount: number
  sessionExportSearchBranchCount: number
}

export interface DeepSeekRateLimitSurfaceObservation {
  inducedByParallelSearchProbe: boolean
  rateLimitObserved: boolean
  rateLimitCode: string | null
  scope: string | null
  retryable: boolean | null
  uiObservationStatus: string | null
  cliTextHasRateLimitNotice: boolean
  cliJsonRateLimitCode: string | null
  cliStreamHasRateLimitFrame: boolean
}

export interface DeepSeekAutoRetryObservation {
  inducedByParallelSearchProbe: boolean
  retryObserved: boolean
  totalAttempts: number
  retriedAttempts: number
  exhausted: boolean
  boundaryStrategy: string | null
  boundaryUiRetryControlStatus: string | null
  firstAttemptRateLimitCode: string | null
  finalAttemptRateLimitCode: string | null
  scheduledEventCount: number
  tickEventCount: number
  startingEventCount: number
}

export interface DeepSeekReferenceRenderingObservation {
  liveTextHasCitations: boolean
  liveTextHasExactPage: boolean
  liveTextHasSearchResultSet: boolean
  repeatedTopLevelReferenceOrdinals: string[]
  suspectedGeneratedCitationSummaryRendered: boolean
  suspectedGeneratedCitationAvoidedStructuredPromotion: boolean
}

export interface DeepSeekSearchReleaseSearchSuccessObservation {
  generatedAt: string
  coveredChatModes: DeepSeekChatMode[]
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  report: DeepSeekSearchRegressionReport
}

export interface DeepSeekSearchReleaseModeCoverage {
  searchSuccessGate: DeepSeekChatMode[]
  factCheckExecution: DeepSeekChatMode[]
  rateLimitSurface: DeepSeekChatMode[]
  autoRetry: DeepSeekChatMode[]
  uiRetryProbe: DeepSeekChatMode[]
  referenceRendering: DeepSeekChatMode[]
}

export interface DeepSeekSearchReleaseModeScopedSearchSuccessObservation {
  chatMode: DeepSeekChatMode
  commandReport: DeepSeekSearchRegressionCommandReport
}

export interface DeepSeekSearchReleaseModeScopedFactCheckObservation {
  chatMode: DeepSeekChatMode
  observation: DeepSeekFactCheckExecutionObservation
}

export interface DeepSeekSearchReleaseModeScopedReferenceRenderingObservation {
  chatMode: DeepSeekChatMode
  observation: DeepSeekReferenceRenderingObservation
}

export interface DeepSeekSearchReleaseRegressionInput {
  searchSuccessGate: DeepSeekSearchRegressionCommandReport['report']
  factCheckTemplate: DeepSeekFactCheckTemplateObservation
  factCheckExecution: DeepSeekFactCheckExecutionObservation
  rateLimitSurface: DeepSeekRateLimitSurfaceObservation
  autoRetry: DeepSeekAutoRetryObservation
  uiRetryRegression: DeepSeekSearchRegressionReport
  uiRetryProbeSummary: DeepSeekSearchUiRetryProbeReport['summary']
  referenceRendering: DeepSeekReferenceRenderingObservation
}

export interface DeepSeekSearchReleaseRegressionCommandReport {
  scenario: DeepSeekSearchReleaseRegressionScenario
  generatedAt: string
  coveredChatModes: DeepSeekChatMode[]
  modeCoverage?: DeepSeekSearchReleaseModeCoverage | undefined
  commands: Record<string, string>
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  artifacts: {
    searchSuccessGateFile: string
    uiRetryProbeFile: string
    searchSuccessGateFilesByMode?: Array<{
      chatMode: DeepSeekChatMode
      file: string
    }> | undefined
  }
  observations: {
    searchSuccessGate: DeepSeekSearchReleaseSearchSuccessObservation
    factCheckTemplate: DeepSeekFactCheckTemplateObservation
    factCheckExecution: DeepSeekFactCheckExecutionObservation
    rateLimitSurface: DeepSeekRateLimitSurfaceObservation
    autoRetry: DeepSeekAutoRetryObservation
    uiRetryProbe: DeepSeekSearchUiRetryProbeReport
    uiRetryRegression: DeepSeekSearchRegressionReport
    referenceRendering: DeepSeekReferenceRenderingObservation
    perMode?: {
      searchSuccessGates: DeepSeekSearchReleaseModeScopedSearchSuccessObservation[]
      factCheckExecutions: DeepSeekSearchReleaseModeScopedFactCheckObservation[]
      referenceRendering: DeepSeekSearchReleaseModeScopedReferenceRenderingObservation[]
    } | undefined
  }
  report: DeepSeekSearchReleaseRegressionReport
}
