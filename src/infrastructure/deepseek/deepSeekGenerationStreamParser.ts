import type {
  DeepSeekGenerationCapturedExchange,
  DeepSeekGenerationParseResult,
  DeepSeekGenerationUnknownObservation,
} from '../../types/deepseek-generation-parser.types.js'
import type {
  DeepSeekGenerationCitation,
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationErrorDetail,
  DeepSeekGenerationEventBase,
  DeepSeekGenerationFinishReason,
  DeepSeekGenerationReasoningKind,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationSearchState,
  DeepSeekGenerationStreamEvent,
  DeepSeekGenerationTerminalStatus,
  DeepSeekGenerationUsageSnapshot,
} from '../../types/deepseek-stream.types.js'
import { matchDeepSeekSessionRoute } from './deepSeekApiCatalog.js'
import {
  buildCombinedFragmentText,
  buildSearchStateFromTrackedFragment,
  cloneCitations,
  collectResponseReferences,
  cloneSearchState,
  collectResolvedCitations,
  createTrackedFragmentState,
  getTrackedFragmentByRelativeIndex,
  parseFragmentPatchPath,
  upsertSearchState,
} from './deepSeekGenerationFragmentState.js'
import type {
  ParsedFragmentPatchPath,
  TrackedFragmentState,
} from './deepSeekGenerationFragmentState.js'
import {
  buildRunId,
  consumeSseMessages,
  isRecord,
  type ParsedSseMessage,
  parseJsonIfPossible,
  readEpochishTimestamp,
  readOptionalNumber,
  readOptionalString,
  readPrimitiveString,
  splitSseMessages,
  stringifyNullableNumber,
} from './deepSeekGenerationParserPrimitives.js'
import { buildDeepSeekChatModeFact } from './deepSeekChatModeSignal.js'

const DEFAULT_OCCURRED_AT = new Date(0).toISOString()

interface ParserState {
  sequence: number
  context: DeepSeekGenerationRunContext
  events: DeepSeekGenerationStreamEvent[]
  unknownObservations: DeepSeekGenerationUnknownObservation[]
  lastPatchPath: string | null
  lastPatchOperation: string | null
  currentOccurredAt: string
  outputText: string
  reasoningText: string
  reasoningKind: DeepSeekGenerationReasoningKind
  trackedFragments: TrackedFragmentState[]
  searches: DeepSeekGenerationSearchState[]
  citations: DeepSeekGenerationCitation[]
  usage: DeepSeekGenerationUsageSnapshot | null
  finishReason: DeepSeekGenerationFinishReason
  terminalStatus: DeepSeekGenerationTerminalStatus | null
  stopReason: 'user' | 'system' | 'unknown'
  error: DeepSeekGenerationErrorDetail | null
}

export interface DeepSeekGenerationIncrementalParserSnapshot {
  transport: DeepSeekGenerationParseResult['transport']
  context: DeepSeekGenerationRunContext
  eventCount: number
  unknownObservationCount: number
  finalized: boolean
}

export interface DeepSeekGenerationIncrementalParserPushResult {
  transport: DeepSeekGenerationParseResult['transport']
  context: DeepSeekGenerationRunContext
  events: DeepSeekGenerationStreamEvent[]
  unknownObservations: DeepSeekGenerationUnknownObservation[]
  snapshot: DeepSeekGenerationIncrementalParserSnapshot
}

export interface DeepSeekGenerationIncrementalParserFinalizeResult
  extends DeepSeekGenerationParseResult {
  newEvents: DeepSeekGenerationStreamEvent[]
  newUnknownObservations: DeepSeekGenerationUnknownObservation[]
  snapshot: DeepSeekGenerationIncrementalParserSnapshot
}

export interface DeepSeekGenerationIncrementalParser {
  snapshot: () => DeepSeekGenerationIncrementalParserSnapshot
  pushBodyChunk: (chunkText: string) => DeepSeekGenerationIncrementalParserPushResult
  finalize: () => DeepSeekGenerationIncrementalParserFinalizeResult
}

export function parseDeepSeekGenerationCapturedExchange(
  exchange: DeepSeekGenerationCapturedExchange,
): DeepSeekGenerationParseResult {
  const parser = createDeepSeekIncrementalGenerationParser(exchange)
  parser.pushBodyChunk(exchange.response.bodyText)
  const finalized = parser.finalize()

  return {
    transport: finalized.transport,
    context: { ...finalized.context },
    events: finalized.events.map(event => ({ ...event })),
    unknownObservations: finalized.unknownObservations.map(observation => ({
      ...observation,
    })),
  }
}

export function createDeepSeekIncrementalGenerationParser(
  exchange: DeepSeekGenerationCapturedExchange,
): DeepSeekGenerationIncrementalParser {
  const transport = exchange.response.contentType?.includes('text/event-stream') ? 'sse' : 'json'
  const exchangeWithoutBody: DeepSeekGenerationCapturedExchange = {
    endpoint: exchange.endpoint,
    ...(exchange.routeUrl !== undefined ? { routeUrl: exchange.routeUrl } : {}),
    request: {
      ...exchange.request,
    },
    response: {
      status: exchange.response.status,
      contentType: exchange.response.contentType,
      bodyText: '',
    },
  }
  const state = createParserState(exchangeWithoutBody, transport)
  let bufferedBodyText = ''
  let sseRemainder = ''
  let finalized = false
  let drainedEventCount = 0
  let drainedUnknownObservationCount = 0

  return {
    snapshot() {
      return buildIncrementalParserSnapshot(state, transport, finalized)
    },
    pushBodyChunk(chunkText) {
      if (finalized) {
        throw new Error('DeepSeek incremental generation parser is finalized and cannot accept more chunks.')
      }

      if (!chunkText) {
        return collectIncrementalParserDelta({
          state,
          transport,
          finalized,
          drainedEventCount,
          drainedUnknownObservationCount,
        })
      }

      bufferedBodyText += chunkText
      if (transport === 'sse' && exchange.response.status >= 200 && exchange.response.status < 300) {
        sseRemainder += chunkText
        const consumed = consumeSseMessages(sseRemainder)
        sseRemainder = consumed.remainder
        applySseMessages(consumed.messages, state)
      }

      const delta = collectIncrementalParserDelta({
        state,
        transport,
        finalized,
        drainedEventCount,
        drainedUnknownObservationCount,
      })
      drainedEventCount += delta.events.length
      drainedUnknownObservationCount += delta.unknownObservations.length
      return delta
    },
    finalize() {
      if (!finalized) {
        if (transport === 'sse' && exchange.response.status >= 200 && exchange.response.status < 300) {
          if (sseRemainder.trim()) {
            applySseMessages(splitSseMessages(sseRemainder), state)
            sseRemainder = ''
          }
        } else {
          parseNonSseTransport(
            {
              ...exchangeWithoutBody,
              response: {
                ...exchangeWithoutBody.response,
                bodyText: bufferedBodyText,
              },
            },
            state,
          )
        }

        finalizeCompletedEvent(state)
        finalized = true
      }

      const delta = collectIncrementalParserDelta({
        state,
        transport,
        finalized,
        drainedEventCount,
        drainedUnknownObservationCount,
      })
      drainedEventCount += delta.events.length
      drainedUnknownObservationCount += delta.unknownObservations.length

      return {
        transport,
        context: { ...state.context },
        events: state.events.map(event => ({ ...event })),
        unknownObservations: state.unknownObservations.map(observation => ({
          ...observation,
        })),
        newEvents: delta.events,
        newUnknownObservations: delta.unknownObservations,
        snapshot: buildIncrementalParserSnapshot(state, transport, finalized),
      }
    },
  }
}

function buildIncrementalParserSnapshot(
  state: ParserState,
  transport: DeepSeekGenerationParseResult['transport'],
  finalized: boolean,
): DeepSeekGenerationIncrementalParserSnapshot {
  return {
    transport,
    context: { ...state.context },
    eventCount: state.events.length,
    unknownObservationCount: state.unknownObservations.length,
    finalized,
  }
}

function collectIncrementalParserDelta(input: {
  state: ParserState
  transport: DeepSeekGenerationParseResult['transport']
  finalized: boolean
  drainedEventCount: number
  drainedUnknownObservationCount: number
}): DeepSeekGenerationIncrementalParserPushResult {
  return {
    transport: input.transport,
    context: { ...input.state.context },
    events: input.state.events
      .slice(input.drainedEventCount)
      .map(event => ({ ...event })),
    unknownObservations: input.state.unknownObservations
      .slice(input.drainedUnknownObservationCount)
      .map(observation => ({ ...observation })),
    snapshot: buildIncrementalParserSnapshot(input.state, input.transport, input.finalized),
  }
}

function createParserState(
  exchange: DeepSeekGenerationCapturedExchange,
  transport: 'sse' | 'json',
): ParserState {
  const requestPayload = parseJsonIfPossible(exchange.request.postData)
  const requestRecord = isRecord(requestPayload) ? requestPayload : null
  const routeMatch = exchange.routeUrl ? matchDeepSeekSessionRoute(exchange.routeUrl) : null

  const sessionId = readOptionalString(requestRecord, 'chat_session_id')
  const requestModelType = readOptionalString(requestRecord, 'model_type')
  const agentId = routeMatch?.agentId ?? null
  const initialContext: DeepSeekGenerationRunContext = {
    runId: buildRunId(exchange.endpoint, sessionId, null, null),
    endpoint: exchange.endpoint,
    transport,
    requestUrl: exchange.request.url,
    routeUrl: exchange.routeUrl ?? null,
    agentId,
    sessionId,
    branchId: null,
    parentMessageId: stringifyNullableNumber(requestRecord?.['parent_message_id']) ?? null,
    assistantMessageId: null,
    modeFact: buildDeepSeekChatModeFact({
      sourceLayer: 'canonical-generation-context',
      rawModelType: requestModelType,
      derivedFromLayer: 'request-payload',
    }),
  }

  return {
    sequence: 0,
    context: initialContext,
    events: [],
    unknownObservations: [],
    lastPatchPath: null,
    lastPatchOperation: null,
    currentOccurredAt: DEFAULT_OCCURRED_AT,
    outputText: '',
    reasoningText: '',
    reasoningKind: 'unknown',
    trackedFragments: [],
    searches: [],
    citations: [],
    usage: null,
    finishReason: 'unknown',
    terminalStatus: null,
    stopReason: 'unknown',
    error: null,
  }
}

function applySseMessages(messages: ParsedSseMessage[], state: ParserState): void {
  for (const message of messages) {
    if (!message.dataText.trim()) {
      continue
    }

    const payload = parseJsonIfPossible(message.dataText)
    if (payload === null) {
      recordUnknown(state, 'sse-payload', 'non_json_data', {
        event: message.event,
        dataText: message.dataText,
      })
      continue
    }

    switch (message.event) {
      case 'ready':
        applyReadyEvent(payload, state)
        continue
      case 'hint':
        applyHintEvent(payload, state)
        continue
      case 'close':
        applyCloseEvent(payload, state)
        continue
      case 'update_session':
      case 'title':
        recordUnknown(state, 'sse-event', `unhandled_event:${message.event}`, payload)
        continue
      case null:
      case '':
        applyDataPayload(payload, state)
        continue
      default:
        recordUnknown(state, 'sse-event', `unhandled_event:${message.event}`, payload)
    }
  }
}

function parseNonSseTransport(
  exchange: DeepSeekGenerationCapturedExchange,
  state: ParserState,
): void {
  const payload = parseJsonIfPossible(exchange.response.bodyText)
  const code = isRecord(payload) ? readPrimitiveString(payload['code']) : null
  const message =
    (isRecord(payload) ? readPrimitiveString(payload['msg']) : null) ??
    `DeepSeek generation request failed with status ${exchange.response.status}.`

  const errorDetail: DeepSeekGenerationErrorDetail = {
    code,
    message,
    retryable: exchange.response.status >= 500 || exchange.response.status === 429,
  }

  state.error = errorDetail
  state.finishReason = 'error'
  state.terminalStatus = 'failed'

  emitEvent(state, 'error', {
    error: errorDetail,
  })
}

function applyReadyEvent(payload: unknown, state: ParserState): void {
  if (!isRecord(payload)) {
    recordUnknown(state, 'sse-event', 'ready_payload_not_object', payload)
    return
  }

  const requestMessageId = stringifyNullableNumber(payload['request_message_id'])
  const responseMessageId = stringifyNullableNumber(payload['response_message_id'])
  if (requestMessageId) {
    state.context.parentMessageId = requestMessageId
  }
  if (responseMessageId) {
    state.context.assistantMessageId = responseMessageId
  }
  const readyModelType = readOptionalString(payload, 'model_type')
  if (readyModelType) {
    state.context.modeFact = buildDeepSeekChatModeFact({
      sourceLayer: 'canonical-generation-context',
      rawModelType: readyModelType,
      derivedFromLayer: 'generation-ready-sse',
    })
  }
  state.context.runId = buildRunId(
    state.context.endpoint,
    state.context.sessionId,
    requestMessageId,
    responseMessageId,
  )
}

function applyHintEvent(payload: unknown, state: ParserState): void {
  if (!isRecord(payload)) {
    recordUnknown(state, 'sse-event', 'hint_payload_not_object', payload)
    return
  }

  const finishReason = readOptionalString(payload, 'finish_reason')
  if (finishReason === 'manual_abort') {
    state.finishReason = 'stopped'
    state.terminalStatus = 'stopped'
    state.stopReason = 'user'

    if (payload['clear_response'] === true) {
      state.outputText = ''
      state.reasoningText = ''
      state.usage = null
    }

    emitEvent(state, 'stopped', {
      stopReason: 'user',
    })
    emitEvent(state, 'finish', {
      finishReason: 'stopped',
    })
    return
  }

  if (payload['clear_response'] === true) {
    state.outputText = ''
    state.reasoningText = ''
    state.usage = null
  }

  const normalizedErrorCode = finishReason === 'rate_limit_reached'
    ? 'rate_limit_exceeded'
    : readOptionalString(payload, 'type')
  const errorDetail: DeepSeekGenerationErrorDetail = {
    code: normalizedErrorCode,
    message: readOptionalString(payload, 'content') ?? 'DeepSeek returned a generation hint error.',
    retryable: true,
    ...(finishReason ? { cause: finishReason } : {}),
  }

  state.error = errorDetail
  state.finishReason = 'error'
  state.terminalStatus = 'failed'

  emitEvent(state, 'error', {
    error: errorDetail,
  })
}

function applyCloseEvent(payload: unknown, state: ParserState): void {
  if (!isRecord(payload)) {
    recordUnknown(state, 'sse-event', 'close_payload_not_object', payload)
    return
  }

  const clickBehavior = readOptionalString(payload, 'click_behavior')
  if (clickBehavior === 'retry' && state.error?.code === 'rate_limit_exceeded') {
    recordUnknown(state, 'sse-event', 'rate_limit_retry_close', payload)
    return
  }

  if (state.terminalStatus === null && clickBehavior === 'retry') {
    state.finishReason = 'stopped'
    state.terminalStatus = 'stopped'
    emitEvent(state, 'stopped', {
      stopReason: 'user',
    })
    emitEvent(state, 'finish', {
      finishReason: 'stopped',
    })
  }
}

function applyDataPayload(payload: unknown, state: ParserState): void {
  if (!isRecord(payload)) {
    recordUnknown(state, 'sse-payload', 'payload_not_object', payload)
    return
  }

  if (isRecord(payload['v']) && isRecord(payload['v']['response'])) {
    applyResponseSnapshot(payload['v']['response'], state)
    return
  }

  if ('p' in payload || 'o' in payload || 'v' in payload) {
    applyPatchPayload(payload, state)
    return
  }

  recordUnknown(state, 'sse-payload', 'unhandled_payload', payload)
}

function applyResponseSnapshot(responsePayload: unknown, state: ParserState): void {
  if (!isRecord(responsePayload)) {
    recordUnknown(state, 'sse-payload', 'response_snapshot_not_object', responsePayload)
    return
  }

  const assistantMessageId = stringifyNullableNumber(responsePayload['message_id'])
  const parentMessageId = stringifyNullableNumber(responsePayload['parent_id'])
  if (assistantMessageId) {
    state.context.assistantMessageId = assistantMessageId
  }
  if (parentMessageId) {
    state.context.parentMessageId = parentMessageId
  }
  state.context.runId = buildRunId(
    state.context.endpoint,
    state.context.sessionId,
    state.context.parentMessageId,
    state.context.assistantMessageId,
  )

  const insertedAt = readEpochishTimestamp(responsePayload['inserted_at'])
  if (insertedAt) {
    state.currentOccurredAt = insertedAt
  }

  const usageValue = readOptionalNumber(responsePayload, 'accumulated_token_usage')
  if (usageValue !== null) {
    updateUsage(state, usageValue)
  }

  const fragments = Array.isArray(responsePayload['fragments']) ? responsePayload['fragments'] : []
  if (fragments.length > 0) {
    appendFragments(fragments, state)
  }

  if (readOptionalString(responsePayload, 'status') === 'FINISHED') {
    finalizeSuccessfulStatus(state)
  }
}

function applyPatchPayload(payload: Record<string, unknown>, state: ParserState): void {
  const patchPath = readPrimitiveString(payload['p']) ?? state.lastPatchPath
  const patchOperation = readPrimitiveString(payload['o']) ?? state.lastPatchOperation
  const patchValue = payload['v']

  if (!patchPath) {
    recordUnknown(state, 'sse-payload', 'patch_without_path', payload)
    return
  }

  if (patchOperation === 'BATCH' && Array.isArray(patchValue)) {
    applyBatchPatch(patchPath, patchValue, state)
    return
  }

  state.lastPatchPath = patchPath
  state.lastPatchOperation = patchOperation

  const fragmentPatch = parseFragmentPatchPath(patchPath)
  if (fragmentPatch) {
    if (fragmentPatch.nestedPath === 'content' && typeof patchValue === 'string') {
      applyFragmentContentPatch(fragmentPatch, patchValue, patchOperation ?? 'APPEND', state)
      return
    }
    if (fragmentPatch.nestedPath === 'status') {
      applyFragmentStatusPatch(fragmentPatch, patchValue, state)
      return
    }
    if (fragmentPatch.nestedPath === 'results') {
      applyFragmentResultsPatch(fragmentPatch, patchValue, state)
      return
    }
    if (fragmentPatch.nestedPath === 'references') {
      applyFragmentReferencesPatch(fragmentPatch, patchValue, state)
      return
    }
  }

  switch (patchPath) {
    case 'response/fragments':
      if (Array.isArray(patchValue)) {
        appendFragments(patchValue, state)
        return
      }
      break
    case 'response/fragments/-1/elapsed_secs':
      recordUnknown(state, 'sse-payload', 'unhandled_elapsed_secs_patch', payload)
      return
    case 'response/accumulated_token_usage':
      if (typeof patchValue === 'number' && Number.isFinite(patchValue)) {
        updateUsage(state, patchValue)
        return
      }
      break
    case 'response/quasi_status':
      if (patchValue === 'FINISHED') {
        return
      }
      break
    case 'response/status':
      if (patchValue === 'FINISHED') {
        finalizeSuccessfulStatus(state)
        return
      }
      if (patchValue === 'FAILED') {
        const errorDetail: DeepSeekGenerationErrorDetail = {
          code: 'response_status_failed',
          message: 'DeepSeek reported a failed generation status.',
          retryable: true,
        }
        state.error = errorDetail
        state.finishReason = 'error'
        state.terminalStatus = 'failed'
        emitEvent(state, 'error', {
          error: errorDetail,
        })
        return
      }
      break
    default:
      break
  }

  recordUnknown(state, 'sse-payload', `unhandled_patch:${patchPath}`, payload)
}

function applyBatchPatch(patchPath: string, batchEntries: unknown[], state: ParserState): void {
  let sawNestedContentPatch = false

  for (const entry of batchEntries) {
    if (!isRecord(entry)) {
      recordUnknown(state, 'sse-payload', 'batch_patch_entry_not_object', entry)
      continue
    }

    const nestedPath = readOptionalString(entry, 'p')
    if (!nestedPath) {
      recordUnknown(state, 'sse-payload', 'batch_patch_missing_path', entry)
      continue
    }

    if (nestedPath === 'content' || nestedPath.endsWith('/content')) {
      sawNestedContentPatch = true
    }

    applyPatchPayload(
      {
        p: `${patchPath}/${nestedPath}`,
        o: readOptionalString(entry, 'o') ?? 'SET',
        v: entry['v'],
      },
      state,
    )
  }

  if (sawNestedContentPatch) {
    state.lastPatchPath = `${patchPath}/content`
    state.lastPatchOperation = 'APPEND'
  }
}

function appendFragments(fragments: unknown[], state: ParserState): void {
  for (const fragment of fragments) {
    if (!isRecord(fragment)) {
      recordUnknown(state, 'sse-payload', 'fragment_not_object', fragment)
      continue
    }

    const trackedFragment = createTrackedFragmentState(fragment)
    state.trackedFragments.push(trackedFragment)

    if (trackedFragment.kind === 'TOOL_SEARCH') {
      emitSearchPatchForFragment(trackedFragment, state, 'append')
    }

    if (trackedFragment.kind === 'RESPONSE' && trackedFragment.responseReferences.length > 0) {
      state.citations = collectResolvedCitations(state.trackedFragments)
      emitEvent(state, 'citation.patch', {
        patchMode: 'replace',
        citations: cloneCitations(state.citations),
      })
    }

    if (trackedFragment.content) {
      applyTrackedFragmentContent(trackedFragment, trackedFragment.content, 'SET', state)
    }
  }
}

function applyFragmentContentPatch(
  fragmentPatch: ParsedFragmentPatchPath,
  patchValue: string,
  patchOperation: string,
  state: ParserState,
): void {
  const trackedFragment = getTrackedFragmentByRelativeIndex(
    state.trackedFragments,
    fragmentPatch.relativeIndex,
  )
  if (!trackedFragment) {
    recordUnknown(state, 'sse-payload', `missing_fragment_for:${fragmentPatch.patchPath}`, patchValue)
    return
  }

  applyTrackedFragmentContent(trackedFragment, patchValue, patchOperation, state)
}

function applyTrackedFragmentContent(
  trackedFragment: TrackedFragmentState,
  content: string,
  patchOperation: string,
  state: ParserState,
): void {
  if (!content) {
    return
  }

  trackedFragment.content =
    patchOperation === 'SET' ? content : `${trackedFragment.content}${content}`

  if (trackedFragment.kind === 'THINK') {
    state.reasoningKind = 'thinking'
    state.reasoningText = buildCombinedFragmentText(state.trackedFragments, 'THINK')
    emitEvent(state, 'reasoning.delta', {
      reasoningKind: 'thinking',
      delta: content,
      accumulatedText: state.reasoningText,
    })
    return
  }

  if (trackedFragment.kind === 'RESPONSE') {
    state.outputText = buildCombinedFragmentText(state.trackedFragments, 'RESPONSE')
    emitEvent(state, 'text.delta', {
      delta: content,
      accumulatedText: state.outputText,
    })
    return
  }

  recordUnknown(state, 'sse-payload', 'content_without_fragment_kind', {
    kind: trackedFragment.kind,
    content,
  })
}

function applyFragmentStatusPatch(
  fragmentPatch: ParsedFragmentPatchPath,
  patchValue: unknown,
  state: ParserState,
): void {
  if (typeof patchValue !== 'string') {
    recordUnknown(state, 'sse-payload', `non_string_fragment_status:${fragmentPatch.patchPath}`, patchValue)
    return
  }

  const trackedFragment = getTrackedFragmentByRelativeIndex(
    state.trackedFragments,
    fragmentPatch.relativeIndex,
  )
  if (!trackedFragment) {
    recordUnknown(state, 'sse-payload', `missing_fragment_for:${fragmentPatch.patchPath}`, patchValue)
    return
  }

  trackedFragment.status = patchValue
  if (trackedFragment.kind === 'TOOL_SEARCH') {
    emitSearchPatchForFragment(trackedFragment, state, 'append')
  }
}

function applyFragmentResultsPatch(
  fragmentPatch: ParsedFragmentPatchPath,
  patchValue: unknown,
  state: ParserState,
): void {
  const trackedFragment = getTrackedFragmentByRelativeIndex(
    state.trackedFragments,
    fragmentPatch.relativeIndex,
  )
  if (!trackedFragment) {
    recordUnknown(state, 'sse-payload', `missing_fragment_for:${fragmentPatch.patchPath}`, patchValue)
    return
  }

  if (trackedFragment.kind !== 'TOOL_SEARCH') {
    recordUnknown(state, 'sse-payload', `results_patch_on_non_search_fragment:${trackedFragment.kind}`, patchValue)
    return
  }

  const patchedFragment = createTrackedFragmentState({
    ...trackedFragment,
    type: 'TOOL_SEARCH',
    results: patchValue,
  })
  trackedFragment.searchResults = patchedFragment.searchResults
  emitSearchPatchForFragment(trackedFragment, state, 'append')
}

function applyFragmentReferencesPatch(
  fragmentPatch: ParsedFragmentPatchPath,
  patchValue: unknown,
  state: ParserState,
): void {
  const trackedFragment = getTrackedFragmentByRelativeIndex(
    state.trackedFragments,
    fragmentPatch.relativeIndex,
  )
  if (!trackedFragment) {
    recordUnknown(state, 'sse-payload', `missing_fragment_for:${fragmentPatch.patchPath}`, patchValue)
    return
  }

  if (trackedFragment.kind !== 'RESPONSE') {
    recordUnknown(state, 'sse-payload', `references_patch_on_non_response_fragment:${trackedFragment.kind}`, patchValue)
    return
  }

  const patchedFragment = createTrackedFragmentState({
    ...trackedFragment,
    type: 'RESPONSE',
    references: patchValue,
  })
  trackedFragment.responseReferences = patchedFragment.responseReferences
  state.citations = collectResolvedCitations(state.trackedFragments)
  emitEvent(state, 'citation.patch', {
    patchMode: 'replace',
    citations: cloneCitations(state.citations),
  })
}

function emitSearchPatchForFragment(
  trackedFragment: TrackedFragmentState,
  state: ParserState,
  patchMode: 'append' | 'replace',
): void {
  const searchState = buildSearchStateFromTrackedFragment(trackedFragment)
  if (!searchState) {
    return
  }

  state.searches = upsertSearchState(state.searches, searchState)
  emitEvent(state, 'search.patch', {
    patchMode,
    search: cloneSearchState(searchState),
  })
}

function updateUsage(state: ParserState, outputTokens: number): void {
  const normalizedValue = Math.max(0, Math.floor(outputTokens))
  const currentValue = state.usage?.outputTokens ?? null
  if (currentValue === normalizedValue) {
    return
  }

  state.usage = {
    inputTokens: null,
    outputTokens: normalizedValue,
    totalTokens: null,
    reasoningTokens: null,
  }

  emitEvent(state, 'usage.update', {
    usage: {
      ...state.usage,
    },
  })
}

function finalizeSuccessfulStatus(state: ParserState): void {
  state.finishReason = 'stop'
  state.terminalStatus = 'completed'
  emitEvent(state, 'finish', {
    finishReason: 'stop',
  })
}

function finalizeCompletedEvent(state: ParserState): void {
  if (state.terminalStatus === null) {
    if (state.error) {
      state.terminalStatus = 'failed'
      state.finishReason = 'error'
    } else if (state.finishReason === 'stopped') {
      state.terminalStatus = 'stopped'
    } else {
      state.terminalStatus = 'completed'
      if (state.finishReason === 'unknown') {
        state.finishReason = 'stop'
      }
    }
  }

  const completedAt = state.currentOccurredAt
  const result: DeepSeekGenerationCompletedState = {
    status: state.terminalStatus,
    finishReason: state.finishReason,
    outputText: state.outputText,
    reasoningText: state.reasoningText,
    reasoningKind: state.reasoningKind,
    citations: cloneCitations(state.citations),
    responseReferences: collectResponseReferences(state.trackedFragments),
    searches: state.searches.map(cloneSearchState),
    usage: state.usage ? { ...state.usage } : null,
    error: state.error ? { ...state.error } : null,
    completedAt,
  }

  emitEvent(state, 'completed', {
    result,
  })
}

function emitEvent(
  state: ParserState,
  kind: DeepSeekGenerationStreamEvent['kind'],
  payload: Omit<DeepSeekGenerationStreamEvent, keyof DeepSeekGenerationEventBase | 'kind'>,
): void {
  state.sequence += 1
  const event: DeepSeekGenerationStreamEvent = {
    kind,
    sequence: state.sequence,
    occurredAt: state.currentOccurredAt,
    context: { ...state.context },
    ...payload,
  } as DeepSeekGenerationStreamEvent

  state.events.push(event)
}

function recordUnknown(
  state: ParserState,
  stage: DeepSeekGenerationUnknownObservation['stage'],
  label: string,
  raw: unknown,
): void {
  state.unknownObservations.push({
    sequence: state.sequence,
    stage,
    label,
    raw,
  })
}
