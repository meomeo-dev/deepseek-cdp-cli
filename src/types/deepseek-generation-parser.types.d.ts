import type {
  DeepSeekGenerationEndpoint,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationStreamEvent,
  DeepSeekGenerationTransport,
} from './deepseek-stream.types.js'

export interface DeepSeekGenerationExchangeRequest {
  method: string
  url: string
  postData: string | null
}

export interface DeepSeekGenerationExchangeResponse {
  status: number
  contentType: string | null
  bodyText: string
}

export interface DeepSeekGenerationCapturedExchange {
  endpoint: DeepSeekGenerationEndpoint
  routeUrl?: string | null
  request: DeepSeekGenerationExchangeRequest
  response: DeepSeekGenerationExchangeResponse
}

export interface DeepSeekGenerationUnknownObservation {
  sequence: number
  stage: 'sse-event' | 'sse-payload' | 'transport'
  label: string
  raw: unknown
}

export interface DeepSeekGenerationParseResult {
  transport: DeepSeekGenerationTransport
  context: DeepSeekGenerationRunContext
  events: DeepSeekGenerationStreamEvent[]
  unknownObservations: DeepSeekGenerationUnknownObservation[]
}
