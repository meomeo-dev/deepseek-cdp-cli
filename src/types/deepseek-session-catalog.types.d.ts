export type DeepSeekSessionCatalogMetadataSource =
  | 'stored-session'
  | 'legacy-session'
  | 'catalog-only-session'

export type DeepSeekSessionCatalogWarningCode =
  | 'session_file_load_failed'
  | 'session_file_inconsistent'

export interface DeepSeekSessionCatalogWarning {
  code: DeepSeekSessionCatalogWarningCode
  sessionFile?: string | undefined
  message: string
}

export interface DeepSeekSessionCatalogSummary {
  sessionId: string
  title: string
  createdAt: string
  persistedAt: string
  userPromptPreview: string | null
  sessionFile: string
  finalUrl: string | null
  branchCount: number
  messageCount: number
  metadataSource: DeepSeekSessionCatalogMetadataSource
  hasOpenAIHistoryBootstrap: boolean
}

export interface DeepSeekSessionCatalogResult {
  sessionStoreDir: string
  query: string | null
  limit: number | null
  scannedFileCount: number
  validSessionCount: number
  matchedSessionCount: number
  returnedSessionCount: number
  truncated: boolean
  warnings: DeepSeekSessionCatalogWarning[]
  sessions: DeepSeekSessionCatalogSummary[]
}
