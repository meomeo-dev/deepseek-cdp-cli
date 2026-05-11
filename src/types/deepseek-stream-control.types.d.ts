import type { DeepSeekParsedGenerationRun } from './deepseek-generation.types.js'
import type { DeepSeekHistoryMessagesCapturedExchange } from './deepseek-history-messages.types.js'
import type {
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationErrorDetail,
} from './deepseek-stream.types.js'

export type DeepSeekStreamControlEndpoint =
  | '/api/v0/chat/stop_stream'
  | '/api/v0/chat/resume_stream'

export type DeepSeekStreamControlTransport = 'json' | 'sse'

export interface DeepSeekStreamControlExchangeRequest {
  method: string
  url: string
  postData: string | null
}

export interface DeepSeekStreamControlExchangeResponse {
  status: number
  contentType: string | null
  bodyText: string
}

export interface DeepSeekStreamControlCapturedExchange {
  endpoint: DeepSeekStreamControlEndpoint
  routeUrl?: string | null
  request: DeepSeekStreamControlExchangeRequest
  response: DeepSeekStreamControlExchangeResponse
}

export interface DeepSeekStopStreamObservation {
  endpoint: '/api/v0/chat/stop_stream'
  transport: 'json'
  routeUrl: string | null
  requestUrl: string
  status: number
  sessionId: string | null
  messageId: string | null
  acknowledged: boolean
  error: DeepSeekGenerationErrorDetail | null
}

export interface DeepSeekResumeStreamObservation {
  endpoint: '/api/v0/chat/resume_stream'
  transport: DeepSeekStreamControlTransport
  routeUrl: string | null
  requestUrl: string
  status: number
  sessionId: string | null
  messageId: string | null
  run: DeepSeekParsedGenerationRun | null
  acknowledged: boolean
  error: DeepSeekGenerationErrorDetail | null
}

export type DeepSeekObservedStreamControl =
  | DeepSeekStopStreamObservation
  | DeepSeekResumeStreamObservation

export interface DeepSeekResumableCandidate {
  sessionId: string
  assistantMessageId: string
  status: string
  source: 'history_messages' | 'message_action_control'
}

export type DeepSeekGenerationSettlementStatus =
  | 'completed'
  | 'stopped'
  | 'resumable'
  | 'failed'

export interface DeepSeekGenerationSettlement {
  status: DeepSeekGenerationSettlementStatus
  source:
    | 'generation'
    | 'resume_stream'
    | 'stop_stream'
    | 'history_messages'
    | 'message_action_control'
  sessionId: string | null
  assistantMessageId: string | null
  finalized: DeepSeekGenerationCompletedState | null
  stopAcknowledged: boolean
  resumable: DeepSeekResumableCandidate | null
  error: DeepSeekGenerationErrorDetail | null
}

export interface DeepSeekStreamControlSettlementInput {
  generationRuns?: DeepSeekParsedGenerationRun[] | undefined
  streamControls?: DeepSeekObservedStreamControl[] | undefined
  historyCapture?: DeepSeekHistoryMessagesCapturedExchange | null | undefined
  resumableCandidate?: DeepSeekResumableCandidate | null | undefined
}
