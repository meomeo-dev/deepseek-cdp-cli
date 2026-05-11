import type { DeepSeekOnlineSessionCatalogSummary } from './deepseek-online-session-catalog.types.js'
import type { DeepSeekSessionCatalogWarningCode } from './deepseek-session-catalog.types.js'
import type { DeepSeekSessionRestoreResult } from './deepseek-session-restore.types.js'
import type { DeepSeekStoredSession } from './deepseek-session.types.js'

export interface DeepSeekSessionSyncResult extends DeepSeekSessionRestoreResult {
  storedSession: DeepSeekStoredSession
}

export type DeepSeekSessionCatalogSyncReconciliation =
  | 'discovered_remote_only'
  | 'refreshed_existing'
  | 'already_current'
  | 'skipped'

export type DeepSeekSessionCatalogSyncWarningCode =
  | 'pagination_incomplete'
  | DeepSeekSessionCatalogWarningCode
  | 'session_catalog_persist_failed'

export interface DeepSeekSessionCatalogSyncWarning {
  code: DeepSeekSessionCatalogSyncWarningCode
  message: string
  sessionId?: string | undefined
  sessionFile?: string | undefined
}

export interface DeepSeekSessionCatalogSyncEntry extends DeepSeekOnlineSessionCatalogSummary {
  reconciliation: DeepSeekSessionCatalogSyncReconciliation
  sessionFile: string | null
  finalUrl: string | null
  contextSource: DeepSeekSessionSyncResult['contextSource'] | null
  historyRecoveryOutcome: DeepSeekSessionSyncResult['historyMessagesRecovery']['outcome'] | null
  branchCountBefore: number | null
  branchCountAfter: number | null
  messageCountBefore: number | null
  messageCountAfter: number | null
}

export interface DeepSeekSessionCatalogSyncResult {
  mode: 'catalog'
  sessionStoreDir: string
  requestedUrl: string
  discoverySource: 'fetch_page'
  discoveredCount: number
  importedCount: number
  refreshedCount: number
  unchangedCount: number
  skippedCount: number
  hasMore: boolean
  partial: boolean
  warnings: DeepSeekSessionCatalogSyncWarning[]
  sessions: DeepSeekSessionCatalogSyncEntry[]
}
