import type { DeepSeekSession } from './deepseek-session.types.js'
import type { DeepSeekTranscriptRecovery } from './deepseek-transcript-recovery.types.js'

export interface DeepSeekHistoryMessagesExchangeRequest {
  method: string
  url: string
  postData: string | null
}

export interface DeepSeekHistoryMessagesExchangeResponse {
  status: number
  contentType: string | null
  bodyText: string
}

export interface DeepSeekHistoryMessagesCapturedExchange {
  endpoint: '/api/v0/chat/history_messages'
  routeUrl: string | null
  sessionId: string
  request: DeepSeekHistoryMessagesExchangeRequest
  response: DeepSeekHistoryMessagesExchangeResponse
}

export interface DeepSeekHistoryMessagesRecoverySuccess {
  outcome: 'recovered'
  capture: DeepSeekHistoryMessagesCapturedExchange
  session: DeepSeekSession
  recovery: DeepSeekTranscriptRecovery
}

export interface DeepSeekHistoryMessagesRecoveryFailure {
  outcome: 'failed'
  capture: DeepSeekHistoryMessagesCapturedExchange | null
  session: DeepSeekSession | null
  recovery: DeepSeekTranscriptRecovery
}

export type DeepSeekHistoryMessagesRecoveryResult =
  | DeepSeekHistoryMessagesRecoverySuccess
  | DeepSeekHistoryMessagesRecoveryFailure
