export interface DeepSeekOnlineSessionCatalogExchangeRequest {
  method: string
  url: string
  postData: string | null
}

export interface DeepSeekOnlineSessionCatalogExchangeResponse {
  status: number
  contentType: string | null
  bodyText: string
}

export interface DeepSeekOnlineSessionCatalogCapturedExchange {
  endpoint: '/api/v0/chat_session/fetch_page'
  routeUrl: string | null
  request: DeepSeekOnlineSessionCatalogExchangeRequest
  response: DeepSeekOnlineSessionCatalogExchangeResponse
}

export interface DeepSeekOnlineSessionCatalogSummary {
  sessionId: string
  title: string
  updatedAt: string
  pinned: boolean
  routeUrl: string | null
  discoverySource: 'fetch_page'
}

export type DeepSeekOnlineSessionCatalogWarningCode = 'pagination_incomplete'

export interface DeepSeekOnlineSessionCatalogWarning {
  code: DeepSeekOnlineSessionCatalogWarningCode
  message: string
  requestUrl?: string | undefined
}

export interface DeepSeekOnlineSessionCatalogResult {
  authoritativeCapture: DeepSeekOnlineSessionCatalogCapturedExchange
  captures: DeepSeekOnlineSessionCatalogCapturedExchange[]
  hasMore: boolean
  partial: boolean
  warnings: DeepSeekOnlineSessionCatalogWarning[]
  sessions: DeepSeekOnlineSessionCatalogSummary[]
}
