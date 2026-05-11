import type { WaitUntil } from './managed-chrome.types.js'
import type { DeepSeekMessageActionControlKind } from './deepseek-message-actions.types.js'
import type { DeepSeekHistoryMessagesCapturedExchange } from './deepseek-history-messages.types.js'
import type {
  DeepSeekResolvedSessionTarget,
  DeepSeekSessionRestoreResult,
} from './deepseek-session-restore.types.js'
import type {
  DeepSeekGenerationSettlement,
  DeepSeekObservedStreamControl,
  DeepSeekStreamControlCapturedExchange,
} from './deepseek-stream-control.types.js'

export type DeepSeekContinuePreflightStatus =
  | 'resumable'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'auto-resumed'

export type DeepSeekContinuePreflightDisposition =
  | 'allow-explicit-continue'
  | 'blocked-auto-resume'
  | 'blocked-completed'
  | 'blocked-stopped'
  | 'blocked-failed'

export interface InspectDeepSeekContinuePreflightOnPageInput {
  target: DeepSeekResolvedSessionTarget
  timeoutMs: number
  waitUntil: WaitUntil
  streamControlTimeoutMs?: number | undefined
  preferredAssistantMessageId?: string | undefined
}

export interface DeepSeekContinuePreflightContinueControlSummary {
  observed: boolean
  assistantMessageId: string | null
  controlKind: DeepSeekMessageActionControlKind | null
  label: string | null
  selector: string | null
  matchedBy: 'preferred-message' | 'snapshot-last-assistant' | 'unavailable'
}

export interface DeepSeekContinuePreflightAutoResumeSummary {
  observed: boolean
  acknowledged: boolean
  sessionId: string | null
  assistantMessageId: string | null
  runStatus: 'completed' | 'stopped' | 'failed' | null
}

export interface ResolveDeepSeekContinuePreflightInput {
  restore: DeepSeekSessionRestoreResult
  streamControls: DeepSeekObservedStreamControl[]
  streamControlCaptures?: DeepSeekStreamControlCapturedExchange[] | undefined
  continueControl?: DeepSeekContinuePreflightContinueControlSummary | undefined
}

export interface DeepSeekContinuePreflightResult {
  status: DeepSeekContinuePreflightStatus
  disposition: DeepSeekContinuePreflightDisposition
  explicitContinueAllowed: boolean
  restore: DeepSeekSessionRestoreResult
  controlSettlement: DeepSeekGenerationSettlement
  historyCapture: DeepSeekHistoryMessagesCapturedExchange | null
  streamControls: DeepSeekObservedStreamControl[]
  streamControlCaptures: DeepSeekStreamControlCapturedExchange[]
  continueControl: DeepSeekContinuePreflightContinueControlSummary
  autoResume: DeepSeekContinuePreflightAutoResumeSummary
}
