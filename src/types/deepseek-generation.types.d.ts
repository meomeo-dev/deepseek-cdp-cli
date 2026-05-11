import type {
  DeepSeekGenerationCapturedExchange,
  DeepSeekGenerationUnknownObservation,
} from './deepseek-generation-parser.types.js'
import type {
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationEndpoint,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationStreamEvent,
  DeepSeekGenerationTransport,
} from './deepseek-stream.types.js'

export interface DeepSeekGenerationObservation {
  endpoint: string
  url: string
  status: number
  contentType: string | null
  outputTokens: number | null
  requestModelType?: string | undefined
  requestRefFileIds?: string[] | undefined
}

export interface DeepSeekCapturedGenerationResponse {
  observation: DeepSeekGenerationObservation
  exchange: DeepSeekGenerationCapturedExchange
}

export interface DeepSeekObservedGenerationRun {
  endpoint: DeepSeekGenerationEndpoint
  transport: DeepSeekGenerationTransport
  routeUrl: string | null
  context: DeepSeekGenerationRunContext
  finalized: DeepSeekGenerationCompletedState
  eventCount: number
  unknownObservationCount: number
  unknownObservationLabels: string[]
}

export interface DeepSeekParsedGenerationRun {
  endpoint: DeepSeekGenerationEndpoint
  transport: DeepSeekGenerationTransport
  routeUrl: string | null
  context: DeepSeekGenerationRunContext
  events: DeepSeekGenerationStreamEvent[]
  finalized: DeepSeekGenerationCompletedState
  unknownObservations: DeepSeekGenerationUnknownObservation[]
  unknownObservationCount: number
  unknownObservationLabels: string[]
}
