import type {
  DeepSeekCitationSource,
  DeepSeekGenerationCitation,
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationErrorDetail,
  DeepSeekGenerationFinishReason,
  DeepSeekGenerationResponseReference,
  DeepSeekGenerationReasoningKind,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationSearchState,
  DeepSeekGenerationStreamEvent,
  DeepSeekGenerationTerminalStatus,
  DeepSeekGenerationUsageSnapshot,
  DeepSeekGenerationStoppedEvent,
} from './deepseek-stream.types.js'

export type DeepSeekGenerationRunLifecycleStatus = 'running' | DeepSeekGenerationTerminalStatus

export interface DeepSeekGenerationAccumulatorSnapshot {
  context: DeepSeekGenerationRunContext
  status: DeepSeekGenerationRunLifecycleStatus
  finishReason: DeepSeekGenerationFinishReason
  outputText: string
  reasoningText: string
  reasoningKind: DeepSeekGenerationReasoningKind
  citations: DeepSeekGenerationCitation[]
  responseReferences: DeepSeekGenerationResponseReference[]
  searches: DeepSeekGenerationSearchState[]
  usage: DeepSeekGenerationUsageSnapshot | null
  error: DeepSeekGenerationErrorDetail | null
  stopReason: DeepSeekGenerationStoppedEvent['stopReason'] | null
  completedAt: string | null
  lastOccurredAt: string | null
  lastSequence: number
  eventCount: number
  sealed: boolean
}

export interface DeepSeekGenerationAccumulatorOptions {
  context: DeepSeekGenerationRunContext
  occurredAt?: string
}

export interface DeepSeekGenerationAccumulatorSealOptions {
  completedAt?: string
}

export interface DeepSeekGenerationRunAccumulator {
  push: (event: DeepSeekGenerationStreamEvent) => DeepSeekGenerationAccumulatorSnapshot
  pushMany: (events: Iterable<DeepSeekGenerationStreamEvent>) => DeepSeekGenerationAccumulatorSnapshot
  snapshot: () => DeepSeekGenerationAccumulatorSnapshot
  isTerminal: () => boolean
  seal: (options?: DeepSeekGenerationAccumulatorSealOptions) => DeepSeekGenerationCompletedState
}

export interface DeepSeekGenerationSearchAccumulatorIdentity {
  query: string | null
  resultIds: string[]
}

export interface DeepSeekGenerationCitationAccumulatorIdentity {
  id: string
  url: string
  source: DeepSeekCitationSource
}
