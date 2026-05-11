import type { ManagedChromeOptions, WaitUntil } from './managed-chrome.types.js'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeFact,
  DeepSeekChatModeCapabilityMatrix,
  DeepSeekChatModeSignalObservation,
  DeepSeekChatModeSurfaceSnapshot,
} from './deepseek-chat-mode.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'

export interface AuditDeepSeekChatModesInput extends ManagedChromeOptions {
  url: string
  waitUntil: WaitUntil
  instantPrompt?: string | undefined
  expertPrompt?: string | undefined
  visionPrompt?: string | undefined
  visionFile?: string | undefined
  outputFile?: string | undefined
}

export interface DeepSeekChatModeDeliverySurfaceAudit {
  mappedSessionModeFact: DeepSeekChatModeFact | null
  mappedSessionHasModeFact: boolean
  storedSessionModeFact: DeepSeekChatModeFact | null
  storedSessionHasModeFact: boolean
  exportDocumentModeFact: DeepSeekChatModeFact | null
  exportDocumentHasModeFact: boolean
  note: string
}

export interface DeepSeekChatModeFileEvidenceAudit {
  requestedFiles: string[]
  uploadedFileIds: string[]
  mountedFileIds: string[]
  requestRefFileIds: string[]
  note: string
}

export interface DeepSeekChatModeAuditScenarioReport {
  requestedMode: DeepSeekChatMode
  prompt: string
  finalUrl: string
  sessionId: string
  homeSurface: DeepSeekChatModeSurfaceSnapshot
  sessionSurface: DeepSeekChatModeSurfaceSnapshot
  reopenedSessionSurface: DeepSeekChatModeSurfaceSnapshot
  homeCapabilities: DeepSeekChatModeCapabilityMatrix
  sessionCapabilities: DeepSeekChatModeCapabilityMatrix
  reopenedSessionCapabilities: DeepSeekChatModeCapabilityMatrix
  authoritySignals: DeepSeekChatModeSignalObservation[]
  deliverySurfaces: DeepSeekChatModeDeliverySurfaceAudit
  fileEvidence?: DeepSeekChatModeFileEvidenceAudit | undefined
}

export interface DeepSeekChatModeAuditReport {
  scenario: 'mode-audit'
  capturedAt: string
  requestedUrl: string
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  defaultHomeSurface: DeepSeekChatModeSurfaceSnapshot
  scenarios: DeepSeekChatModeAuditScenarioReport[]
}
