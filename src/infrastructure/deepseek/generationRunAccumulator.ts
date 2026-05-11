import type {
  DeepSeekGenerationAccumulatorOptions,
  DeepSeekGenerationAccumulatorSealOptions,
  DeepSeekGenerationAccumulatorSnapshot,
  DeepSeekGenerationRunAccumulator,
  DeepSeekGenerationRunLifecycleStatus,
} from '../../types/deepseek-accumulator.types.js'
import type {
  DeepSeekGenerationCitation,
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationErrorDetail,
  DeepSeekGenerationFinishReason,
  DeepSeekGenerationResponseReference,
  DeepSeekGenerationReasoningKind,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationSearchResult,
  DeepSeekGenerationSearchState,
  DeepSeekGenerationStreamEvent,
  DeepSeekGenerationTerminalStatus,
  DeepSeekGenerationUsageSnapshot,
} from '../../types/deepseek-stream.types.js'

const DEFAULT_OCCURRED_AT = new Date(0).toISOString()

interface MutableAccumulatorState {
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
  stopReason: 'user' | 'system' | 'unknown' | null
  completedAt: string | null
  lastOccurredAt: string | null
  lastSequence: number
  eventCount: number
  sealed: boolean
  sealedResult: DeepSeekGenerationCompletedState | null
}

export function createGenerationRunAccumulator(
  options: DeepSeekGenerationAccumulatorOptions,
): DeepSeekGenerationRunAccumulator {
  const state = createMutableAccumulatorState(options)

  return {
    push(event) {
      assertNotSealed(state)
      applyEvent(state, event)
      return createSnapshot(state)
    },
    pushMany(events) {
      assertNotSealed(state)
      for (const event of events) {
        applyEvent(state, event)
      }
      return createSnapshot(state)
    },
    snapshot() {
      return createSnapshot(state)
    },
    isTerminal() {
      return state.status !== 'running'
    },
    seal(sealOptions) {
      if (state.sealedResult) {
        return cloneCompletedState(state.sealedResult)
      }

      const completedState = buildCompletedState(state, sealOptions)
      state.status = completedState.status
      state.finishReason = completedState.finishReason
      state.completedAt = completedState.completedAt
      state.sealed = true
      state.sealedResult = cloneCompletedState(completedState)
      return completedState
    },
  }
}

function createMutableAccumulatorState(
  options: DeepSeekGenerationAccumulatorOptions,
): MutableAccumulatorState {
  return {
    context: cloneContext(options.context),
    status: 'running',
    finishReason: 'unknown',
    outputText: '',
    reasoningText: '',
    reasoningKind: 'unknown',
    citations: [],
    responseReferences: [],
    searches: [],
    usage: null,
    error: null,
    stopReason: null,
    completedAt: null,
    lastOccurredAt: options.occurredAt ?? null,
    lastSequence: 0,
    eventCount: 0,
    sealed: false,
    sealedResult: null,
  }
}

function assertNotSealed(state: MutableAccumulatorState): void {
  if (state.sealed) {
    throw new Error('Generation run accumulator is sealed and cannot accept more events.')
  }
}

function applyEvent(state: MutableAccumulatorState, event: DeepSeekGenerationStreamEvent): void {
  state.context = cloneContext(event.context)
  state.lastOccurredAt = event.occurredAt
  state.lastSequence = event.sequence
  state.eventCount += 1

  switch (event.kind) {
    case 'text.delta':
      state.outputText = applyAccumulatedText(state.outputText, event.delta, event.accumulatedText)
      return
    case 'reasoning.delta':
      state.reasoningText = applyAccumulatedText(
        state.reasoningText,
        event.delta,
        event.accumulatedText,
      )
      state.reasoningKind = event.reasoningKind
      return
    case 'search.patch':
      state.searches = applySearchPatch(state.searches, event.patchMode, event.search)
      return
    case 'citation.patch':
      state.citations = applyCitationPatch(state.citations, event.patchMode, event.citations)
      return
    case 'usage.update':
      state.usage = cloneUsage(event.usage)
      return
    case 'finish':
      state.finishReason = nextFinishReason(state, event.finishReason)
      return
    case 'stopped':
      state.status = 'stopped'
      state.finishReason = 'stopped'
      state.stopReason = event.stopReason
      return
    case 'error':
      state.status = 'failed'
      state.finishReason = 'error'
      state.error = cloneError(event.error)
      return
    case 'completed':
      applyCompletedState(state, event.result)
      return
  }
}

function applyCompletedState(
  state: MutableAccumulatorState,
  result: DeepSeekGenerationCompletedState,
): void {
  state.status = result.status
  state.finishReason = result.finishReason
  state.outputText = result.outputText
  state.reasoningText = result.reasoningText
  state.reasoningKind = result.reasoningKind
  state.citations = cloneCitations(result.citations)
  state.responseReferences = cloneResponseReferences(result.responseReferences)
  state.searches = cloneSearches(result.searches)
  state.usage = cloneUsage(result.usage)
  state.error = cloneError(result.error)
  state.completedAt = result.completedAt

  if (result.status !== 'stopped') {
    state.stopReason = null
  }
}

function buildCompletedState(
  state: MutableAccumulatorState,
  options: DeepSeekGenerationAccumulatorSealOptions | undefined,
): DeepSeekGenerationCompletedState {
  const status = resolveTerminalStatus(state)
  const finishReason = resolveTerminalFinishReason(state, status)

  return {
    status,
    finishReason,
    outputText: state.outputText,
    reasoningText: state.reasoningText,
    reasoningKind: state.reasoningKind,
    citations: cloneCitations(state.citations),
    responseReferences: cloneResponseReferences(state.responseReferences),
    searches: cloneSearches(state.searches),
    usage: cloneUsage(state.usage),
    error: cloneError(state.error),
    completedAt: options?.completedAt ?? state.completedAt ?? state.lastOccurredAt ?? DEFAULT_OCCURRED_AT,
  }
}

function resolveTerminalStatus(state: MutableAccumulatorState): DeepSeekGenerationTerminalStatus {
  if (state.status === 'failed' || state.error || state.finishReason === 'error') {
    return 'failed'
  }

  if (state.status === 'stopped' || state.finishReason === 'stopped') {
    return 'stopped'
  }

  return 'completed'
}

function resolveTerminalFinishReason(
  state: MutableAccumulatorState,
  status: DeepSeekGenerationTerminalStatus,
): DeepSeekGenerationFinishReason {
  if (status === 'failed') {
    return 'error'
  }

  if (status === 'stopped') {
    return 'stopped'
  }

  return state.finishReason === 'unknown' ? 'stop' : state.finishReason
}

function nextFinishReason(
  state: MutableAccumulatorState,
  nextReason: DeepSeekGenerationFinishReason,
): DeepSeekGenerationFinishReason {
  if (state.status === 'failed') {
    return 'error'
  }

  if (state.status === 'stopped') {
    return nextReason === 'stopped' ? 'stopped' : state.finishReason
  }

  return nextReason
}

function applyAccumulatedText(
  currentValue: string,
  delta: string,
  accumulatedText: string | undefined,
): string {
  if (typeof accumulatedText === 'string') {
    return accumulatedText
  }

  return currentValue + delta
}

function applySearchPatch(
  searches: DeepSeekGenerationSearchState[],
  patchMode: 'append' | 'replace',
  search: DeepSeekGenerationSearchState,
): DeepSeekGenerationSearchState[] {
  const nextSearch = cloneSearch(search)
  if (patchMode === 'replace') {
    if (searches.length === 0) {
      return [nextSearch]
    }

    const replaceIndex = findSearchIndex(searches, nextSearch)
    const targetIndex = replaceIndex >= 0 ? replaceIndex : searches.length - 1
    return searches.map((item, index) => (index === targetIndex ? nextSearch : cloneSearch(item)))
  }

  const appendIndex = findSearchIndex(searches, nextSearch)
  if (appendIndex < 0) {
    return [...cloneSearches(searches), nextSearch]
  }

  return searches.map((item, index) => {
    if (index !== appendIndex) {
      return cloneSearch(item)
    }

    return {
      query: nextSearch.query ?? item.query,
      status: nextSearch.status,
      results: mergeSearchResults(item.results, nextSearch.results),
    }
  })
}

function findSearchIndex(
  searches: DeepSeekGenerationSearchState[],
  target: DeepSeekGenerationSearchState,
): number {
  if (target.query) {
    const queryIndex = searches.findIndex(search => search.query === target.query)
    if (queryIndex >= 0) {
      return queryIndex
    }
  }

  const targetResultIds = new Set(target.results.map(result => result.id).filter(Boolean))
  if (targetResultIds.size === 0) {
    return -1
  }

  return searches.findIndex(search =>
    search.results.some(result => targetResultIds.has(result.id)),
  )
}

function mergeSearchResults(
  current: DeepSeekGenerationSearchResult[],
  incoming: DeepSeekGenerationSearchResult[],
): DeepSeekGenerationSearchResult[] {
  const merged = new Map<string, DeepSeekGenerationSearchResult>()

  for (const result of current) {
    merged.set(buildSearchResultIdentity(result), cloneSearchResult(result))
  }

  for (const result of incoming) {
    merged.set(buildSearchResultIdentity(result), cloneSearchResult(result))
  }

  return [...merged.values()]
}

function buildSearchResultIdentity(result: DeepSeekGenerationSearchResult): string {
  return result.id || result.url || result.title
}

function applyCitationPatch(
  citations: DeepSeekGenerationCitation[],
  patchMode: 'append' | 'replace',
  nextCitations: DeepSeekGenerationCitation[],
): DeepSeekGenerationCitation[] {
  if (patchMode === 'replace') {
    return cloneCitations(nextCitations)
  }

  const merged = new Map<string, DeepSeekGenerationCitation>()
  for (const citation of citations) {
    merged.set(buildCitationIdentity(citation), cloneCitation(citation))
  }
  for (const citation of nextCitations) {
    merged.set(buildCitationIdentity(citation), cloneCitation(citation))
  }
  return [...merged.values()]
}

function buildCitationIdentity(citation: DeepSeekGenerationCitation): string {
  return citation.id || citation.url || citation.title
}

function createSnapshot(state: MutableAccumulatorState): DeepSeekGenerationAccumulatorSnapshot {
  return {
    context: cloneContext(state.context),
    status: state.status,
    finishReason: state.finishReason,
    outputText: state.outputText,
    reasoningText: state.reasoningText,
    reasoningKind: state.reasoningKind,
    citations: cloneCitations(state.citations),
    responseReferences: cloneResponseReferences(state.responseReferences),
    searches: cloneSearches(state.searches),
    usage: cloneUsage(state.usage),
    error: cloneError(state.error),
    stopReason: state.stopReason,
    completedAt: state.completedAt,
    lastOccurredAt: state.lastOccurredAt,
    lastSequence: state.lastSequence,
    eventCount: state.eventCount,
    sealed: state.sealed,
  }
}

function cloneCompletedState(result: DeepSeekGenerationCompletedState): DeepSeekGenerationCompletedState {
  return {
    status: result.status,
    finishReason: result.finishReason,
    outputText: result.outputText,
    reasoningText: result.reasoningText,
    reasoningKind: result.reasoningKind,
    citations: cloneCitations(result.citations),
    responseReferences: cloneResponseReferences(result.responseReferences),
    searches: cloneSearches(result.searches),
    usage: cloneUsage(result.usage),
    error: cloneError(result.error),
    completedAt: result.completedAt,
  }
}

function cloneContext(context: DeepSeekGenerationRunContext): DeepSeekGenerationRunContext {
  return { ...context }
}

function cloneUsage(
  usage: DeepSeekGenerationUsageSnapshot | null,
): DeepSeekGenerationUsageSnapshot | null {
  return usage ? { ...usage } : null
}

function cloneError(error: DeepSeekGenerationErrorDetail | null): DeepSeekGenerationErrorDetail | null {
  return error ? { ...error } : null
}

function cloneSearches(searches: DeepSeekGenerationSearchState[]): DeepSeekGenerationSearchState[] {
  return searches.map(cloneSearch)
}

function cloneSearch(search: DeepSeekGenerationSearchState): DeepSeekGenerationSearchState {
  return {
    query: search.query,
    status: search.status,
    results: search.results.map(cloneSearchResult),
  }
}

function cloneSearchResult(
  result: DeepSeekGenerationSearchResult,
): DeepSeekGenerationSearchResult {
  return {
    id: result.id,
    title: result.title,
    url: result.url,
    ...(result.snippet !== undefined ? { snippet: result.snippet } : {}),
    ...(result.source !== undefined ? { source: result.source } : {}),
    ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
  }
}

function cloneCitations(citations: DeepSeekGenerationCitation[]): DeepSeekGenerationCitation[] {
  return citations.map(cloneCitation)
}

function cloneResponseReferences(
  responseReferences: DeepSeekGenerationResponseReference[],
): DeepSeekGenerationResponseReference[] {
  return responseReferences.map(reference => ({
    referenceId: reference.referenceId,
    referenceType: reference.referenceType,
  }))
}

function cloneCitation(citation: DeepSeekGenerationCitation): DeepSeekGenerationCitation {
  return {
    id: citation.id,
    title: citation.title,
    url: citation.url,
    ...(citation.snippet !== undefined ? { snippet: citation.snippet } : {}),
    ...(citation.annotation ? { annotation: { ...citation.annotation } } : {}),
  }
}
