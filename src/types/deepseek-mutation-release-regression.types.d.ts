import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type { DeepSeekChatMode } from './deepseek-chat-mode.types.js'

export type DeepSeekMutationReleaseRegressionScenario = 'release-message-actions'

export type DeepSeekMutationReleaseRegressionStatus = 'pass' | 'fail'

export type DeepSeekMutationReleaseRegressionFailureClass =
  | 'ok'
  | 'browser_runtime_drift'
  | 'mode_contract_drift'
  | 'seeded_session_drift'
  | 'mutation_materialization_drift'
  | 'branch_catalog_drift'
  | 'export_provenance_drift'
  | 'attachment_persistence_drift'
  | 'continue_preflight_drift'
  | 'continue_delivery_drift'
  | 'delete_session_drift'

export interface DeepSeekMutationReleaseRegressionCheck {
  id: string
  status: DeepSeekMutationReleaseRegressionStatus
  failureClass: DeepSeekMutationReleaseRegressionFailureClass
  message: string
  evidence?: Record<string, unknown> | undefined
}

export interface DeepSeekMutationReleaseRegressionReport {
  scenario: DeepSeekMutationReleaseRegressionScenario
  ok: boolean
  checks: DeepSeekMutationReleaseRegressionCheck[]
}

export interface DeepSeekMutationReleaseRuntimeObservation {
  action: 'started' | 'reused' | 'status'
  browserId: string | null
  mode: string | null
  owner: string | null
  purpose: string | null
  state: string | null
  cdpUrl: string | null
  lastUsedAt: string | null
}

export interface DeepSeekMutationReleaseSeededSessionObservation {
  requestedChatMode: DeepSeekChatMode | null
  rawModelType: string | null
  resolvedChatMode: DeepSeekChatMode | null
  sessionId: string | null
  finalUrl: string | null
  sessionFile: string | null
  activeBranchId: string | null
  rootUserMessageId: string | null
  rootAssistantMessageId: string | null
  fileUploadRequestedCount: number
  fileUploadAcceptedCount: number
  fileUploadMountedCount: number
  rootUserAttachmentCount: number
  branchAttachmentCount: number
  assistantTextLength: number
  assistantSearchCount: number
  assistantCitationCount: number
  assistantResponseReferenceCount: number
}

export interface DeepSeekMutationReleaseEditObservation {
  rawModelType: string | null
  resolvedChatMode: DeepSeekChatMode | null
  entryMode: string | null
  mutationKind: string | null
  sourceBranchId: string | null
  sourceMessageId: string | null
  materializedBranchId: string | null
  materializedBranchCreated: boolean | null
  assistantMessageId: string | null
  transcriptShape: string | null
  assistantTextLength: number
}

export interface DeepSeekMutationReleaseRegenerateObservation {
  rawModelType: string | null
  resolvedChatMode: DeepSeekChatMode | null
  entryMode: string | null
  mutationKind: string | null
  sourceBranchId: string | null
  sourceAssistantMessageId: string | null
  sourceParentMessageId: string | null
  materializedBranchId: string | null
  materializedBranchCreated: boolean | null
  regeneratedAssistantMessageId: string | null
  transcriptShape: string | null
  assistantTextLength: number
}

export interface DeepSeekMutationReleaseBranchCatalogObservation {
  branchCount: number
  defaultBranchId: string | null
  activeBranchId: string | null
  branchIds: string[]
}

export interface DeepSeekMutationReleaseBranchExportObservation {
  rawModelType: string | null
  resolvedChatMode: DeepSeekChatMode | null
  branchId: string | null
  transcriptShape: string | null
  provenanceSource: string | null
  citationCount: number
  branchAttachmentCount: number
  branchAttachmentRecordCount: number
  messageAttachmentCount: number
  searchEvidenceAvailable: boolean
  searchEvidenceDerivedFrom: string | null
  searchQueryCount: number
  searchResultCount: number
  messageSearchCount: number
  responseReferenceCount: number
  messageCount: number
}

export interface DeepSeekMutationReleaseSessionExportObservation {
  rawModelType: string | null
  resolvedChatMode: DeepSeekChatMode | null
  branchCount: number
  branchIndexCount: number
  totalAttachmentCount: number
  branchAttachmentRecordCount: number
  messageAttachmentCount: number
  branchesWithAttachments: number
  searchEvidenceBranchCount: number
  nonSummaryOnlyBranchCount: number
  messageSearchCount: number
  responseReferenceCount: number
}

export interface DeepSeekMutationReleaseContinueTargetObservation {
  sessionId: string | null
  sessionFile: string | null
  finalUrl: string | null
  status: string | null
  branchId: string | null
  activeBranchId: string | null
  messageId: string | null
  continueCommandPresent: boolean
}

export interface DeepSeekMutationReleaseContinueObservation {
  rawModelType: string | null
  resolvedChatMode: DeepSeekChatMode | null
  entryMode: string | null
  mutationKind: string | null
  sourceBranchId: string | null
  materializedBranchId: string | null
  materializedBranchCreated: boolean | null
  continuedAssistantMessageId: string | null
  continuationDisposition: string | null
  transcriptShape: string | null
  assistantTextLength: number
}

export interface DeepSeekMutationReleaseDeleteObservation {
  endpoint: string | null
  authoritativeSessionId: string | null
  responseStatus: number | null
  localSessionFileDeleted: boolean
  auditOutputFile: string | null
}

export interface DeepSeekMutationReleaseRegressionInput {
  coveredChatModes: DeepSeekChatMode[]
  warmRuntimeStart: DeepSeekMutationReleaseRuntimeObservation
  warmRuntimeStatus: DeepSeekMutationReleaseRuntimeObservation
  seededSession: DeepSeekMutationReleaseSeededSessionObservation
  edit: DeepSeekMutationReleaseEditObservation
  regenerate: DeepSeekMutationReleaseRegenerateObservation
  branchCatalog: DeepSeekMutationReleaseBranchCatalogObservation
  branchExport: DeepSeekMutationReleaseBranchExportObservation
  sessionExport: DeepSeekMutationReleaseSessionExportObservation
  continueTarget: DeepSeekMutationReleaseContinueTargetObservation
  continueResult: DeepSeekMutationReleaseContinueObservation
  continueExport: DeepSeekMutationReleaseBranchExportObservation
  deleteSession: DeepSeekMutationReleaseDeleteObservation
}

export interface DeepSeekMutationReleaseRegressionCommandReport {
  scenario: DeepSeekMutationReleaseRegressionScenario
  generatedAt: string
  coveredChatModes: DeepSeekChatMode[]
  commands: Record<string, string>
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  runtime: {
    warmBrowserId: string | null
    warmCdpUrl: string
    sessionStoreDir: string
  }
  artifacts: {
    outputFile: string
    expertAttachmentProbeFile: string
    mutationBranchExportFile: string
    mutationSessionExportFile: string
    continueBranchExportFile: string
    deleteAuditFile: string
  }
  observations: DeepSeekMutationReleaseRegressionInput
  report: DeepSeekMutationReleaseRegressionReport
}
