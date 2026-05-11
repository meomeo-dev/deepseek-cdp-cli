import { createGenerationRunAccumulator } from './generationRunAccumulator.js'
import {
  buildAnnotationKey,
  buildCitationKey,
  buildDefaultOrder,
  buildMessageItem,
  buildMessageItemId,
  buildOutputTextContent,
  buildReasoningItemFromSnapshot,
  buildReasoningItemId,
  buildResponseObject,
  buildSearchKey,
  buildWebSearchCallItem,
  createSearchEmissionState,
  findOutputItemById,
  mapCitationsToAnnotations,
  mapResponseMessageStatus,
  mapSearchStatus,
  resolveAdapterOptions,
} from './openaiResponsesAdapterShared.js'
import type {
  DeepSeekGenerationCitation,
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationSearchState,
  DeepSeekGenerationStreamEvent,
} from '../../types/deepseek-stream.types.js'
import type {
  OpenAIResponseObject,
  OpenAIResponsesAdapterOptions,
  OpenAIResponsesStreamFailure,
  OpenAIResponsesStreamAdapter,
  OpenAIResponsesStreamEvent,
} from '../../types/openai-responses.types.js'
import type {
  OutputSlotKey,
  ResolvedAdapterOptions,
  SearchEmissionState,
} from './openaiResponsesAdapterShared.js'

interface StreamAdapterState {
  context: DeepSeekGenerationRunContext
  createdAt: string | null
  accumulator: ReturnType<typeof createGenerationRunAccumulator>
  options: ResolvedAdapterOptions
  sequenceNumber: number
  order: OutputSlotKey[]
  messageAdded: boolean
  messageContentAdded: boolean
  messageTextDone: boolean
  messageContentDone: boolean
  messageDone: boolean
  reasoningAdded: boolean
  reasoningContentAdded: boolean
  reasoningTextDone: boolean
  reasoningSummaryAdded: boolean
  reasoningSummaryTextDone: boolean
  reasoningSummaryPartDone: boolean
  reasoningDone: boolean
  emittedInitialLifecycle: boolean
  emittedTerminalLifecycle: boolean
  emittedErrorEvent: boolean
  emittedAnnotationKeys: Set<string>
  searchStates: Map<string, SearchEmissionState>
}

export function adaptDeepSeekCompletedToOpenAIResponse(input: {
  context: DeepSeekGenerationRunContext
  result: DeepSeekGenerationCompletedState
  options?: OpenAIResponsesAdapterOptions
}): OpenAIResponseObject {
  const adapterOptions = resolveAdapterOptions(input.context, input.options)
  return buildResponseObject({
    context: input.context,
    createdAt: input.options?.createdAt ?? input.result.completedAt,
    options: adapterOptions,
    result: input.result,
    order: buildDefaultOrder(input.result),
  })
}

export function adaptDeepSeekGenerationEventsToOpenAIResponsesStream(input: {
  context: DeepSeekGenerationRunContext
  events: Iterable<DeepSeekGenerationStreamEvent>
  options?: OpenAIResponsesAdapterOptions
}): OpenAIResponsesStreamEvent[] {
  return createOpenAIResponsesStreamAdapter({
    context: input.context,
    ...input.options,
  }).pushMany(input.events)
}

export function createOpenAIResponsesStreamAdapter(input: {
  context: DeepSeekGenerationRunContext
} & OpenAIResponsesAdapterOptions): OpenAIResponsesStreamAdapter {
  const options = resolveAdapterOptions(input.context, input)
  const state: StreamAdapterState = {
    context: { ...input.context },
    createdAt: input.createdAt ?? null,
    accumulator: createGenerationRunAccumulator({
      context: input.context,
      ...(input.createdAt ? { occurredAt: input.createdAt } : {}),
    }),
    options,
    sequenceNumber: 0,
    order: [],
    messageAdded: false,
    messageContentAdded: false,
    messageTextDone: false,
    messageContentDone: false,
    messageDone: false,
    reasoningAdded: false,
    reasoningContentAdded: false,
    reasoningTextDone: false,
    reasoningSummaryAdded: false,
    reasoningSummaryTextDone: false,
    reasoningSummaryPartDone: false,
    reasoningDone: false,
    emittedInitialLifecycle: false,
    emittedTerminalLifecycle: false,
    emittedErrorEvent: false,
    emittedAnnotationKeys: new Set(),
    searchStates: new Map(),
  }

  return {
    push(event) {
      return pushCanonicalEvent(state, event)
    },
    pushMany(events) {
      const emitted: OpenAIResponsesStreamEvent[] = []
      for (const event of events) {
        emitted.push(...pushCanonicalEvent(state, event))
      }
      return emitted
    },
    fail(error) {
      return emitSyntheticFailureEvents(state, error)
    },
    snapshot() {
      return buildResponseFromAccumulator(state)
    },
  }
}

function pushCanonicalEvent(
  state: StreamAdapterState,
  event: DeepSeekGenerationStreamEvent,
): OpenAIResponsesStreamEvent[] {
  const emitted: OpenAIResponsesStreamEvent[] = []
  if (state.createdAt === null) {
    state.createdAt = event.occurredAt
  }

  emitInitialLifecycleIfNeeded(state, emitted)

  const before = state.accumulator.snapshot()
  state.accumulator.push(event)
  const after = state.accumulator.snapshot()
  state.context = { ...after.context }

  switch (event.kind) {
    case 'text.delta':
      ensureMessageSlot(state)
      ensureMessageStructures(state, emitted, after.outputText)
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_text.delta',
          item_id: buildMessageItemId(state.context),
          output_index: outputIndexOf(state, 'message'),
          content_index: 0,
          delta: event.delta,
          logprobs: [],
        }),
      )
      break
    case 'reasoning.delta':
      ensureReasoningSlot(state)
      emitted.push(...emitReasoningDeltaEvents(state, event))
      break
    case 'search.patch':
      emitted.push(...emitSearchPatchEvents(state, before.searches, after.searches))
      break
    case 'citation.patch':
      emitted.push(...emitCitationPatchEvents(state, before.citations, after.citations, after.outputText))
      break
    case 'error':
      state.emittedErrorEvent = true
      emitted.push(
        emitStreamEvent(state, {
          type: 'error',
          code: event.error.code,
          message: event.error.message,
          param: null,
        }),
      )
      break
    case 'completed':
      emitted.push(...emitTerminalEvents(state, event.result))
      break
    case 'usage.update':
    case 'finish':
    case 'stopped':
      break
  }

  return emitted
}

function emitSyntheticFailureEvents(
  state: StreamAdapterState,
  failure: OpenAIResponsesStreamFailure,
): OpenAIResponsesStreamEvent[] {
  if (state.emittedTerminalLifecycle) {
    return []
  }

  const snapshot = state.accumulator.snapshot()
  const terminalError = snapshot.error ?? {
    code: failure.code,
    message: failure.message,
    retryable: false,
  }
  const emitted: OpenAIResponsesStreamEvent[] = []

  if (!state.emittedErrorEvent) {
    emitted.push(
      emitStreamEvent(state, {
        type: 'error',
        code: terminalError.code,
        message: terminalError.message,
        param: null,
      }),
    )
    state.emittedErrorEvent = true
  }

  emitted.push(
    ...emitTerminalEvents(state, {
      status: 'failed',
      finishReason: 'error',
      outputText: snapshot.outputText,
      reasoningText: snapshot.reasoningText,
      reasoningKind: snapshot.reasoningKind,
      citations: snapshot.citations,
      responseReferences: snapshot.responseReferences,
      searches: snapshot.searches,
      usage: null,
      error: terminalError,
      completedAt: new Date().toISOString(),
    }),
  )

  return emitted
}

function emitInitialLifecycleIfNeeded(
  state: StreamAdapterState,
  emitted: OpenAIResponsesStreamEvent[],
): void {
  if (state.emittedInitialLifecycle) {
    return
  }

  emitted.push(
    emitStreamEvent(state, {
      type: 'response.created',
      response: buildResponseFromAccumulator(state),
    }),
  )
  emitted.push(
    emitStreamEvent(state, {
      type: 'response.in_progress',
      response: buildResponseFromAccumulator(state),
    }),
  )
  state.emittedInitialLifecycle = true
}

function emitReasoningDeltaEvents(
  state: StreamAdapterState,
  event: Extract<DeepSeekGenerationStreamEvent, { kind: 'reasoning.delta' }>,
): OpenAIResponsesStreamEvent[] {
  const emitted: OpenAIResponsesStreamEvent[] = []
  const reasoningItemId = buildReasoningItemId(state.context)
  const outputIndex = outputIndexOf(state, 'reasoning')

  if (!state.reasoningAdded) {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: buildReasoningItemFromSnapshot(state.accumulator.snapshot(), 'in_progress', state.context),
      }),
    )
    state.reasoningAdded = true
  }

  if (event.reasoningKind === 'summary') {
    if (!state.reasoningSummaryAdded) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.reasoning_summary_part.added',
          item_id: reasoningItemId,
          output_index: outputIndex,
          summary_index: 0,
          part: {
            type: 'summary_text',
            text: '',
          },
        }),
      )
      state.reasoningSummaryAdded = true
    }

    emitted.push(
      emitStreamEvent(state, {
        type: 'response.reasoning_summary_text.delta',
        item_id: reasoningItemId,
        output_index: outputIndex,
        summary_index: 0,
        delta: event.delta,
      }),
    )
    return emitted
  }

  if (!state.reasoningContentAdded) {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.content_part.added',
        item_id: reasoningItemId,
        output_index: outputIndex,
        content_index: 0,
        part: {
          type: 'reasoning_text',
          text: '',
        },
      }),
    )
    state.reasoningContentAdded = true
  }

  emitted.push(
    emitStreamEvent(state, {
      type: 'response.reasoning_text.delta',
      item_id: reasoningItemId,
      output_index: outputIndex,
      content_index: 0,
      delta: event.delta,
    }),
  )
  return emitted
}

function emitSearchPatchEvents(
  state: StreamAdapterState,
  beforeSearches: DeepSeekGenerationSearchState[],
  afterSearches: DeepSeekGenerationSearchState[],
): OpenAIResponsesStreamEvent[] {
  const emitted: OpenAIResponsesStreamEvent[] = []
  const beforeMap = new Map(beforeSearches.map((search, index) => [buildSearchKey(search, index), search]))

  for (const [index, search] of afterSearches.entries()) {
    const key = buildSearchKey(search, index)
    const existing = state.searchStates.get(key) ?? createSearchEmissionState(state.context, search, index)
    if (!state.searchStates.has(key)) {
      state.searchStates.set(key, existing)
    }

    const slotKey = `search:${key}` satisfies OutputSlotKey
    ensureOutputOrder(state, slotKey)
    const outputIndex = outputIndexOf(state, slotKey)
    const currentStatus = mapSearchStatus(search.status, state.accumulator.snapshot().status)

    if (!existing.added) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: buildWebSearchCallItem(search, currentStatus, existing.itemId),
        }),
      )
      existing.added = true
    }

    if (!existing.inProgress) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.web_search_call.in_progress',
          output_index: outputIndex,
          item_id: existing.itemId,
        }),
      )
      existing.inProgress = true
    }

    const previous = beforeMap.get(key)
    const previousStatus = previous ? mapSearchStatus(previous.status, 'running') : null
    if (currentStatus === 'searching' && (!existing.searching || previousStatus !== 'searching')) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.web_search_call.searching',
          output_index: outputIndex,
          item_id: existing.itemId,
        }),
      )
      existing.searching = true
    }

    if (currentStatus === 'completed' && !existing.completed) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.web_search_call.completed',
          output_index: outputIndex,
          item_id: existing.itemId,
        }),
      )
      existing.completed = true
    }

    if (
      currentStatus === 'completed' &&
      !existing.done
    ) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: buildWebSearchCallItem(search, currentStatus, existing.itemId),
        }),
      )
      existing.done = true
    }
  }

  return emitted
}

function emitCitationPatchEvents(
  state: StreamAdapterState,
  beforeCitations: DeepSeekGenerationCitation[],
  afterCitations: DeepSeekGenerationCitation[],
  outputText: string,
): OpenAIResponsesStreamEvent[] {
  const emitted: OpenAIResponsesStreamEvent[] = []
  const beforeKeys = new Set(beforeCitations.map(buildCitationKey))
  const nextAnnotations = mapCitationsToAnnotations(afterCitations, outputText)
  if (nextAnnotations.length === 0) {
    return emitted
  }

  ensureMessageSlot(state)
  ensureMessageStructures(state, emitted, state.accumulator.snapshot().outputText)

  for (const [annotationIndex, annotation] of nextAnnotations.entries()) {
    const rawKey = buildAnnotationKey(annotation)
    if (state.emittedAnnotationKeys.has(rawKey)) {
      continue
    }

    const sourceCitation = afterCitations.find(citation => buildCitationKey(citation) === rawKey)
    if (sourceCitation && beforeKeys.has(buildCitationKey(sourceCitation))) {
      state.emittedAnnotationKeys.add(rawKey)
      continue
    }

    emitted.push(
      emitStreamEvent(state, {
        type: 'response.output_text.annotation.added',
        item_id: buildMessageItemId(state.context),
        output_index: outputIndexOf(state, 'message'),
        content_index: 0,
        annotation_index: annotationIndex,
        annotation,
      }),
    )
    state.emittedAnnotationKeys.add(rawKey)
  }

  return emitted
}

function emitTerminalEvents(
  state: StreamAdapterState,
  result: DeepSeekGenerationCompletedState,
): OpenAIResponsesStreamEvent[] {
  if (state.emittedTerminalLifecycle) {
    return []
  }

  const emitted: OpenAIResponsesStreamEvent[] = []
  const response = adaptDeepSeekCompletedToOpenAIResponse({
    context: state.context,
    result,
    options: {
      responseId: state.options.responseId,
      model: state.options.model,
      instructions: state.options.instructions,
      metadata: state.options.metadata,
      createdAt: state.createdAt ?? result.completedAt,
    },
  })

  if (result.reasoningText) {
    ensureReasoningSlot(state)
    const reasoningIndex = outputIndexOf(state, 'reasoning')
    const reasoningItemId = buildReasoningItemId(state.context)
    if (!state.reasoningAdded) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.added',
          output_index: reasoningIndex,
          item: buildReasoningItemFromSnapshot(state.accumulator.snapshot(), 'in_progress', state.context),
        }),
      )
      state.reasoningAdded = true
    }

    if (result.reasoningKind === 'summary') {
      if (!state.reasoningSummaryAdded) {
        emitted.push(
          emitStreamEvent(state, {
            type: 'response.reasoning_summary_part.added',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            summary_index: 0,
            part: {
              type: 'summary_text',
              text: '',
            },
          }),
        )
        state.reasoningSummaryAdded = true
      }
      if (!state.reasoningSummaryTextDone) {
        emitted.push(
          emitStreamEvent(state, {
            type: 'response.reasoning_summary_text.done',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            summary_index: 0,
            text: result.reasoningText,
          }),
        )
        state.reasoningSummaryTextDone = true
      }
      if (!state.reasoningSummaryPartDone) {
        emitted.push(
          emitStreamEvent(state, {
            type: 'response.reasoning_summary_part.done',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            summary_index: 0,
            part: {
              type: 'summary_text',
              text: result.reasoningText,
            },
          }),
        )
        state.reasoningSummaryPartDone = true
      }
    } else {
      if (!state.reasoningContentAdded) {
        emitted.push(
          emitStreamEvent(state, {
            type: 'response.content_part.added',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            content_index: 0,
            part: {
              type: 'reasoning_text',
              text: '',
            },
          }),
        )
        state.reasoningContentAdded = true
      }
      if (!state.reasoningTextDone) {
        emitted.push(
          emitStreamEvent(state, {
            type: 'response.reasoning_text.done',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            content_index: 0,
            text: result.reasoningText,
          }),
        )
        state.reasoningTextDone = true
      }
      if (!state.reasoningDone) {
        emitted.push(
          emitStreamEvent(state, {
            type: 'response.content_part.done',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            content_index: 0,
            part: {
              type: 'reasoning_text',
              text: result.reasoningText,
            },
          }),
        )
      }
    }

    if (!state.reasoningDone) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.done',
          output_index: reasoningIndex,
          item: findOutputItemById(response.output, reasoningItemId) ?? buildReasoningItemFromSnapshot(state.accumulator.snapshot(), 'completed', state.context),
        }),
      )
      state.reasoningDone = true
    }
  }

  if (result.outputText || mapCitationsToAnnotations(result.citations, result.outputText).length > 0) {
    ensureMessageSlot(state)
    ensureMessageStructures(state, emitted, result.outputText)
    const messageIndex = outputIndexOf(state, 'message')
    const messageItemId = buildMessageItemId(state.context)

    if (!state.messageTextDone) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_text.done',
          item_id: messageItemId,
          output_index: messageIndex,
          content_index: 0,
          text: result.outputText,
          logprobs: [],
        }),
      )
      state.messageTextDone = true
    }

    if (!state.messageContentDone) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.content_part.done',
          item_id: messageItemId,
          output_index: messageIndex,
          content_index: 0,
          part: buildOutputTextContent(result.outputText, result.citations),
        }),
      )
      state.messageContentDone = true
    }

    if (!state.messageDone) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.done',
          output_index: messageIndex,
          item: findOutputItemById(response.output, messageItemId) ?? buildMessageItem(result.outputText, result.citations, mapResponseMessageStatus(response.status), messageItemId),
        }),
      )
      state.messageDone = true
    }
  }

  for (const [searchIndex, search] of result.searches.entries()) {
    const searchKey = buildSearchKey(search, searchIndex)
    const searchState = state.searchStates.get(searchKey) ?? createSearchEmissionState(state.context, search, searchIndex)
    if (!state.searchStates.has(searchKey)) {
      state.searchStates.set(searchKey, searchState)
    }
    const slotKey = `search:${searchKey}` satisfies OutputSlotKey
    ensureOutputOrder(state, slotKey)
    const outputIndex = outputIndexOf(state, slotKey)
    const searchStatus = mapSearchStatus(search.status, result.status)
    if (!searchState.added) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: buildWebSearchCallItem(search, searchStatus, searchState.itemId),
        }),
      )
      searchState.added = true
    }
    if (searchStatus === 'completed' && !searchState.completed) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.web_search_call.completed',
          output_index: outputIndex,
          item_id: searchState.itemId,
        }),
      )
      searchState.completed = true
    }
    if ((searchStatus === 'completed' || searchStatus === 'failed') && !searchState.done) {
      emitted.push(
        emitStreamEvent(state, {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: buildWebSearchCallItem(search, searchStatus, searchState.itemId),
        }),
      )
      searchState.done = true
    }
  }

  if (response.status === 'completed') {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.completed',
        response,
      }),
    )
  } else if (response.status === 'failed') {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.failed',
        response,
      }),
    )
  } else {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.incomplete',
        response,
      }),
    )
  }

  state.emittedTerminalLifecycle = true
  return emitted
}

function ensureMessageSlot(state: StreamAdapterState): void {
  ensureOutputOrder(state, 'message')
}

function ensureReasoningSlot(state: StreamAdapterState): void {
  ensureOutputOrder(state, 'reasoning')
}

function ensureMessageStructures(
  state: StreamAdapterState,
  emitted: OpenAIResponsesStreamEvent[],
  text: string,
): void {
  const messageIndex = outputIndexOf(state, 'message')
  const messageItemId = buildMessageItemId(state.context)

  if (!state.messageAdded) {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.output_item.added',
        output_index: messageIndex,
        item: buildMessageItem('', [], 'in_progress', messageItemId),
      }),
    )
    state.messageAdded = true
  }

  if (!state.messageContentAdded) {
    emitted.push(
      emitStreamEvent(state, {
        type: 'response.content_part.added',
        item_id: messageItemId,
        output_index: messageIndex,
        content_index: 0,
        part: buildOutputTextContent(text, []),
      }),
    )
    state.messageContentAdded = true
  }
}

function buildResponseFromAccumulator(state: StreamAdapterState): OpenAIResponseObject {
  const snapshot = state.accumulator.snapshot()
  return buildResponseObject({
    context: state.context,
    createdAt: state.createdAt ?? snapshot.lastOccurredAt ?? null,
    options: state.options,
    snapshot,
    order: state.order.length > 0 ? state.order : buildDefaultOrder(snapshot),
  })
}
function emitStreamEvent<T extends Omit<OpenAIResponsesStreamEvent, 'sequence_number'>>(
  state: StreamAdapterState,
  event: T,
): T & { sequence_number: number } {
  state.sequenceNumber += 1
  return {
    ...event,
    sequence_number: state.sequenceNumber,
  }
}

function ensureOutputOrder(state: StreamAdapterState, key: OutputSlotKey): void {
  if (!state.order.includes(key)) {
    state.order.push(key)
  }
}

function outputIndexOf(state: StreamAdapterState, key: OutputSlotKey): number {
  const index = state.order.indexOf(key)
  if (index >= 0) {
    return index
  }
  state.order.push(key)
  return state.order.length - 1
}
