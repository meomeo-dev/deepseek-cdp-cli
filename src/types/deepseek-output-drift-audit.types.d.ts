import type { ManagedChromeOptions, WaitUntil } from './managed-chrome.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type { DeepSeekChatMode, DeepSeekChatModeFact } from './deepseek-chat-mode.types.js'
import type {
  DeepSeekSessionBranchExportDocument,
  DeepSeekSessionExportDocument,
} from './deepseek-export.types.js'

export interface AuditDeepSeekOutputDriftInput extends ManagedChromeOptions {
  url: string
  waitUntil: WaitUntil
  instantPrompt?: string | undefined
  expertPrompt?: string | undefined
  attachmentFile?: string | undefined
  outputFile?: string | undefined
}

export interface DeepSeekOutputDriftReplyBufferedJsonSurfaces {
  native: unknown
  openaiResponses: unknown
  openaiChatCompletions: unknown
}

export interface DeepSeekOutputDriftReplyStreamingSurfaces {
  textChunks: string[]
  nativeFrames: unknown[]
  openaiResponsesFrames: unknown[]
  openaiChatCompletionsFrames: unknown[]
}

export interface DeepSeekOutputDriftReplySurfaces {
  bufferedText: string
  bufferedJson: DeepSeekOutputDriftReplyBufferedJsonSurfaces
  streaming: DeepSeekOutputDriftReplyStreamingSurfaces
}

export interface DeepSeekOutputDriftExportSurfaces {
  branchId: string
  branchText: string
  branchMarkdown: string
  branchJson: DeepSeekSessionBranchExportDocument
  sessionText: string
  sessionMarkdown: string
  sessionJson: DeepSeekSessionExportDocument
}

export interface DeepSeekOutputDriftLiveScenario {
  requestedMode: DeepSeekChatMode
  prompt: string
  releaseFingerprintComposite: string
  sessionId: string
  finalUrl: string
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  attachmentFile: string | null
  attachmentAttempted: boolean
  acceptedAttachmentPaths: string[]
  attachmentBlockingIssues: boolean
  modeFact: DeepSeekChatModeFact | null
  replySurfaces: DeepSeekOutputDriftReplySurfaces
  exportSurfaces: DeepSeekOutputDriftExportSurfaces
}

export interface DeepSeekOutputDriftCleanupEntry {
  requestedMode: DeepSeekChatMode
  sessionId: string
  finalUrl: string
  status: 'deleted' | 'delete-failed' | 'skipped'
  errorMessage: string | null
}

export interface DeepSeekOutputDriftFixtureReplyBaseline {
  id: string
  source: 'fixture'
  replySurfaces: DeepSeekOutputDriftReplySurfaces
  notes: string[]
}

export interface DeepSeekOutputDriftFixtureExportBaseline {
  id: string
  source: 'fixture'
  exportSurfaces: DeepSeekOutputDriftExportSurfaces
  notes: string[]
}

export interface DeepSeekOutputDriftFixtureBaselines {
  replyBaselines: DeepSeekOutputDriftFixtureReplyBaseline[]
  exportBaselines: DeepSeekOutputDriftFixtureExportBaseline[]
}

export type DeepSeekOutputDriftAuditArea =
  | 'reply-text-contract'
  | 'reply-json-shape'
  | 'export-text-contract'
  | 'citation-rendering'
  | 'mode-fact-delivery'
  | 'attachment-rendering'
  | 'lineage-rendering'
  | 'boundary-split'

export type DeepSeekOutputDriftAuditCheckStatus = 'pass' | 'warn' | 'fail'

export interface DeepSeekOutputDriftAuditCheck {
  id: string
  area: DeepSeekOutputDriftAuditArea
  status: DeepSeekOutputDriftAuditCheckStatus
  summary: string
  notes: string[]
}

export interface DeepSeekOutputDriftAuditReport {
  scenario: 'output-drift-audit'
  capturedAt: string
  requestedUrl: string
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  currentLiveScenarios: DeepSeekOutputDriftLiveScenario[]
  cleanup: DeepSeekOutputDriftCleanupEntry[]
  fixtureBaselines: DeepSeekOutputDriftFixtureBaselines
  checks: DeepSeekOutputDriftAuditCheck[]
  notes: string[]
}
