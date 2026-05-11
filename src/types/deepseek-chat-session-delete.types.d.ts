export interface DeepSeekChatSessionDeleteExchangeRequest {
  method: string
  url: string
  postData: Record<string, unknown> | string | null
}

export interface DeepSeekChatSessionDeleteExchangeResponse {
  status: number
  contentType: string | null
  bodyText: string
}

export interface DeepSeekDeleteSessionAuditFixture {
  endpoint: '/api/v0/chat_session/delete'
  target: {
    requestedSessionId: string
    authoritativeSessionId: string
    finalUrl: string
    sessionFile: string
  }
  page: {
    url: string | null
  }
  interaction: {
    triggerPath: string[]
    destructiveGuard: {
      actionLabel: string
      allowOptionName: string
      confirmationText: string
    }
  }
  request: DeepSeekChatSessionDeleteExchangeRequest
  response: DeepSeekChatSessionDeleteExchangeResponse
}

export interface DeepSeekDeleteSessionResult extends DeepSeekDeleteSessionAuditFixture {
  auditOutputFile: string | null
  localSessionFileDeleted: boolean
}
