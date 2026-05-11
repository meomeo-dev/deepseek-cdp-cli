import type { ManagedChromeOptions, WaitUntil } from './managed-chrome.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type { DeepSeekChatMode } from './deepseek-chat-mode.types.js'
import type { DeepSeekChatModeAuditReport } from './deepseek-mode-audit.types.js'
import type {
  DeepSeekMessageActionControlKind,
  DeepSeekMessageActionSnapshot,
} from './deepseek-message-actions.types.js'
import type { DeepSeekDeleteSessionAuditFixture } from './deepseek-chat-session-delete.types.js'

export interface AuditDeepSeekSelectorDriftInput extends ManagedChromeOptions {
  url: string
  waitUntil: WaitUntil
  instantPrompt?: string | undefined
  expertPrompt?: string | undefined
  visionPrompt?: string | undefined
  visionFile?: string | undefined
  searchRetryFixtureFile?: string | undefined
  outputFile?: string | undefined
}

export interface DeepSeekSelectorDriftAuditVisibleControl {
  selector: string
  label: string | null
  text: string | null
  role: string | null
  className: string | null
  controlKind: DeepSeekMessageActionControlKind
}

export interface DeepSeekSelectorDriftAuditMenuOption {
  selector: string
  label: string | null
  className: string | null
}

export interface DeepSeekSelectorDriftAuditDialogButton {
  selector: string
  label: string | null
  className: string | null
  intent: 'danger' | 'neutral' | 'unknown'
}

export interface DeepSeekSelectorDriftSidebarSessionAudit {
  pageUrl: string
  sessionId: string
  anchorSelector: string
  hoverControls: DeepSeekSelectorDriftAuditVisibleControl[]
  overflowMenuObserved: boolean
  menuOptions: DeepSeekSelectorDriftAuditMenuOption[]
  deleteDialogObserved: boolean
  deleteDialogTitle: string | null
  deleteDialogButtons: DeepSeekSelectorDriftAuditDialogButton[]
  deleteDialogDismissed: boolean
  triggerPath: string[]
}

export interface DeepSeekSelectorDriftPrimarySessionAudit {
  requestedMode: DeepSeekChatMode
  finalUrl: string
  sessionId: string
  releaseFingerprint: DeepSeekReleaseFingerprint
  messageActions: DeepSeekMessageActionSnapshot
  sidebar: DeepSeekSelectorDriftSidebarSessionAudit
  deleteSession: DeepSeekDeleteSessionAuditFixture | null
}

export interface DeepSeekSelectorDriftCleanupEntry {
  requestedMode: DeepSeekChatMode
  sessionId: string
  finalUrl: string
  status: 'deleted' | 'delete-failed' | 'skipped'
  errorMessage: string | null
}

export interface DeepSeekSelectorDriftSearchRetryBaseline {
  source: 'fixture'
  fixtureFile: string
  generatedAt: string | null
  currentWindowStatus: 'observation-pending'
  searchRateLimitStatus: 'observed' | 'unresolved' | 'not-applicable'
  uiRetryObservedCount: number
  uiRetryClickedCount: number
  observedControlKind: DeepSeekMessageActionControlKind | null
  canonicalMessageIdDeltaObserved: boolean
  notes: string[]
}

export type DeepSeekSelectorDriftAuditArea =
  | 'mode-surface'
  | 'main-path-selector'
  | 'retry-path-selector'

export type DeepSeekSelectorDriftAuditCheckStatus = 'pass' | 'warn' | 'fail'

export interface DeepSeekSelectorDriftAuditCheck {
  id: string
  area: DeepSeekSelectorDriftAuditArea
  status: DeepSeekSelectorDriftAuditCheckStatus
  summary: string
  notes: string[]
}

export interface DeepSeekSelectorDriftAuditReport {
  scenario: 'selector-drift-audit'
  capturedAt: string
  requestedUrl: string
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  modeAudit: DeepSeekChatModeAuditReport
  primarySession: DeepSeekSelectorDriftPrimarySessionAudit
  searchRetryBaseline: DeepSeekSelectorDriftSearchRetryBaseline
  cleanup: DeepSeekSelectorDriftCleanupEntry[]
  checks: DeepSeekSelectorDriftAuditCheck[]
}
