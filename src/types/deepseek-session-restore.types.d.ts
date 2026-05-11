import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'
import type { DeepSeekHistoryMessagesRecoveryResult } from './deepseek-history-messages.types.js'
import type { DeepSeekSession, DeepSeekStoredSession } from './deepseek-session.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'

export interface DeepSeekResolvedSessionTarget {
  requestedSessionId: string
  sessionFile: string
  finalUrl: string
  authoritativeSessionId: string
  authoritativeAgentId: string
  storedSession: DeepSeekStoredSession
}

export interface DeepSeekSessionRestoreResult {
  requestedSessionId: string
  authoritativeSessionId: string
  authoritativeAgentId: string
  finalUrl: string
  sessionFile: string
  routeVerified: true
  composerSnapshot: DeepSeekComposerSnapshot
  historyMessagesRecovery: DeepSeekHistoryMessagesRecoveryResult
  contextSource: 'history_messages' | 'stored-session'
  transcriptRecovery: DeepSeekTranscriptRecovery | null
  session: DeepSeekSession
}
