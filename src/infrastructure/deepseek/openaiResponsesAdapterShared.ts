import { createHash } from 'node:crypto'
import type { DeepSeekGenerationAccumulatorSnapshot } from '../../types/deepseek-accumulator.types.js'
import type {
  DeepSeekGenerationCitation,
  DeepSeekGenerationCompletedState,
  DeepSeekGenerationFinishReason,
  DeepSeekGenerationRunContext,
  DeepSeekGenerationSearchState,
} from '../../types/deepseek-stream.types.js'
import type {
  OpenAIResponseObject,
  OpenAIResponsesAdapterOptions,
  OpenAIResponsesAnnotation,
  OpenAIResponsesIncompleteDetails,
  OpenAIResponsesOutputItem,
  OpenAIResponsesOutputTextContent,
  OpenAIResponsesReasoningItem,
  OpenAIResponsesUsage,
  OpenAIResponsesWebSearchCallItem,
} from '../../types/openai-responses.types.js'

export type OutputSlotKey = 'reasoning' | 'message' | `search:${string}`

export interface ResolvedAdapterOptions {
  responseId: string
  model: string
  instructions: string | null
  previousResponseId: string | null
  store: boolean
  metadata: Record<string, string>
}

export interface SearchEmissionState {
  itemId: string
  added: boolean
  inProgress: boolean
  searching: boolean
  completed: boolean
  done: boolean
}

export function resolveAdapterOptions(
  context: DeepSeekGenerationRunContext,
  options: OpenAIResponsesAdapterOptions | undefined,
): ResolvedAdapterOptions {
  return {
    responseId: options?.responseId ?? buildStableOpenAIId('resp', context.runId),
    model: options?.model ?? 'deepseek-chat-browser',
    instructions: options?.instructions ?? null,
    previousResponseId: options?.previousResponseId ?? null,
    store: options?.store ?? true,
    metadata: options?.metadata ? { ...options.metadata } : {},
  }
}

export function buildResponseObject(input: {
  context: DeepSeekGenerationRunContext
  createdAt: string | null
  options: ResolvedAdapterOptions
  order: OutputSlotKey[]
  result?: DeepSeekGenerationCompletedState
  snapshot?: DeepSeekGenerationAccumulatorSnapshot
}): OpenAIResponseObject {
  const result =
    input.result ??
    (input.snapshot && input.snapshot.status !== 'running'
      ? {
          status: mapSnapshotStatusToCompletedStateStatus(input.snapshot),
          finishReason: input.snapshot.finishReason,
          outputText: input.snapshot.outputText,
          reasoningText: input.snapshot.reasoningText,
          reasoningKind: input.snapshot.reasoningKind,
          citations: input.snapshot.citations,
          responseReferences: input.snapshot.responseReferences,
          searches: input.snapshot.searches,
          usage: input.snapshot.usage,
          error: input.snapshot.error,
          completedAt:
            input.snapshot.completedAt ??
            input.snapshot.lastOccurredAt ??
            input.createdAt ??
            new Date(0).toISOString(),
        }
      : null)
  const runningSnapshot = input.snapshot ?? null
  const responseStatus = mapResponseStatus(result, runningSnapshot)
  const output = buildOrderedOutputItems({
    context: input.context,
    order: input.order,
    result,
    snapshot: runningSnapshot,
  })

  return {
    id: input.options.responseId,
    object: 'response',
    created_at: isoToUnixSeconds(input.createdAt),
    completed_at:
      responseStatus === 'in_progress'
        ? null
        : isoToUnixSeconds(result?.completedAt ?? runningSnapshot?.completedAt ?? input.createdAt),
    status: responseStatus,
    error: buildOpenAIError(result ?? runningSnapshot),
    incomplete_details: buildIncompleteDetails(result ?? runningSnapshot),
    instructions: input.options.instructions,
    model: input.options.model,
    output,
    output_text:
      (result?.outputText ?? runningSnapshot?.outputText ?? '') === ''
        ? null
        : result?.outputText ?? runningSnapshot?.outputText ?? null,
    usage:
      responseStatus === 'in_progress'
        ? null
        : buildOpenAIUsage(result?.usage ?? runningSnapshot?.usage ?? null),
    previous_response_id: input.options.previousResponseId,
    store: input.options.store,
    reasoning: null,
    background: null,
    max_output_tokens: null,
    max_tool_calls: null,
    text: {
      format: {
        type: 'text',
      },
    },
    tools: [],
    tool_choice: 'auto',
    truncation: 'disabled',
    parallel_tool_calls: true,
    conversation: null,
    temperature: null,
    top_p: null,
    prompt: null,
    metadata: input.options.metadata,
  }
}

export function buildDefaultOrder(
  source: DeepSeekGenerationCompletedState | DeepSeekGenerationAccumulatorSnapshot,
): OutputSlotKey[] {
  const order: OutputSlotKey[] = []
  if (source.reasoningText) {
    order.push('reasoning')
  }
  for (const [index, search] of source.searches.entries()) {
    order.push(`search:${buildSearchKey(search, index)}`)
  }
  if (source.outputText || source.citations.length > 0) {
    order.push('message')
  }
  return order
}

export function buildMessageItem(
  text: string,
  citations: DeepSeekGenerationCitation[],
  status: 'in_progress' | 'completed' | 'incomplete',
  itemId: string,
): OpenAIResponsesOutputItem {
  return {
    id: itemId,
    type: 'message',
    role: 'assistant',
    content: [buildOutputTextContent(text, citations)],
    status,
  }
}

export function buildReasoningItemFromSnapshot(
  source: DeepSeekGenerationCompletedState | DeepSeekGenerationAccumulatorSnapshot,
  status: 'in_progress' | 'completed' | 'incomplete',
  context: DeepSeekGenerationRunContext,
): OpenAIResponsesReasoningItem {
  const item: OpenAIResponsesReasoningItem = {
    id: buildReasoningItemId(context),
    type: 'reasoning',
    summary:
      source.reasoningKind === 'summary'
        ? [
            {
              type: 'summary_text',
              text: source.reasoningText,
            },
          ]
        : [],
    status,
  }

  if (source.reasoningKind !== 'summary') {
    item.content = [
      {
        type: 'reasoning_text',
        text: source.reasoningText,
      },
    ]
  }

  return item
}

export function buildWebSearchCallItem(
  search: DeepSeekGenerationSearchState,
  status: OpenAIResponsesWebSearchCallItem['status'],
  itemId: string,
): OpenAIResponsesWebSearchCallItem {
  return {
    id: itemId,
    type: 'web_search_call',
    status,
    action: {
      type: 'search',
      query: search.query ?? '',
      ...(search.query ? { queries: [search.query] } : {}),
      ...(search.results.length > 0
        ? {
            sources: search.results
              .filter(result => result.url)
              .map(result => ({
                type: 'url' as const,
                url: result.url,
              })),
          }
        : {}),
    },
  }
}

export function buildOutputTextContent(
  text: string,
  citations: DeepSeekGenerationCitation[],
): OpenAIResponsesOutputTextContent {
  return {
    type: 'output_text',
    text,
    annotations: mapCitationsToAnnotations(citations, text),
  }
}

export function mapCitationsToAnnotations(
  citations: DeepSeekGenerationCitation[],
  outputText: string,
): OpenAIResponsesAnnotation[] {
  return citations.flatMap(citation => {
    const annotation = mapCitationToAnnotation(citation, outputText)
    return annotation ? [annotation] : []
  })
}

export function mapSearchStatus(
  status: DeepSeekGenerationSearchState['status'],
  lifecycle: DeepSeekGenerationCompletedState['status'] | 'running',
): OpenAIResponsesWebSearchCallItem['status'] {
  if (status === 'completed' || status === 'results') {
    return 'completed'
  }

  if (lifecycle === 'failed') {
    return 'failed'
  }

  if (status === 'searching') {
    return 'searching'
  }

  return 'in_progress'
}

export function mapResponseMessageStatus(
  responseStatus: OpenAIResponseObject['status'],
): 'in_progress' | 'completed' | 'incomplete' {
  if (responseStatus === 'in_progress') {
    return 'in_progress'
  }
  if (responseStatus === 'completed') {
    return 'completed'
  }
  return 'incomplete'
}

export function buildMessageItemId(context: DeepSeekGenerationRunContext): string {
  return buildStableOpenAIId('msg', context.assistantMessageId ?? `${context.runId}:assistant`)
}

export function buildReasoningItemId(context: DeepSeekGenerationRunContext): string {
  return buildStableOpenAIId('rs', `${context.runId}:reasoning`)
}

export function buildSearchItemId(context: DeepSeekGenerationRunContext, searchKey: string): string {
  return buildStableOpenAIId('ws', `${context.runId}:${searchKey}`)
}

export function buildSearchKey(search: DeepSeekGenerationSearchState, index: number): string {
  const seed = JSON.stringify({
    query: search.query,
    urls: search.results.map(result => result.url),
    ids: search.results.map(result => result.id),
    index,
  })
  return createHash('sha1').update(seed).digest('hex').slice(0, 12)
}

export function buildCitationKey(citation: DeepSeekGenerationCitation): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        id: citation.id,
        url: citation.url,
        title: citation.title,
        start: citation.annotation?.startIndex ?? null,
        end: citation.annotation?.endIndex ?? null,
        source: citation.annotation?.source ?? null,
      }),
    )
    .digest('hex')
    .slice(0, 12)
}

export function buildAnnotationKey(annotation: OpenAIResponsesAnnotation): string {
  return createHash('sha1').update(JSON.stringify(annotation)).digest('hex').slice(0, 12)
}

export function createSearchEmissionState(
  context: DeepSeekGenerationRunContext,
  search: DeepSeekGenerationSearchState,
  index: number,
): SearchEmissionState {
  const key = buildSearchKey(search, index)
  return {
    itemId: buildSearchItemId(context, key),
    added: false,
    inProgress: false,
    searching: false,
    completed: false,
    done: false,
  }
}

export function findOutputItemById(
  output: OpenAIResponsesOutputItem[],
  itemId: string,
): OpenAIResponsesOutputItem | null {
  return output.find(item => item.id === itemId) ?? null
}

function buildOrderedOutputItems(input: {
  context: DeepSeekGenerationRunContext
  order: OutputSlotKey[]
  result: DeepSeekGenerationCompletedState | null
  snapshot: DeepSeekGenerationAccumulatorSnapshot | null
}): OpenAIResponsesOutputItem[] {
  const output: OpenAIResponsesOutputItem[] = []
  const source = input.result ?? input.snapshot
  if (!source) {
    return output
  }

  for (const slot of input.order) {
    if (slot === 'reasoning') {
      if (!source.reasoningText) {
        continue
      }
      output.push(
        buildReasoningItemFromSnapshot(
          source,
          mapResponseMessageStatus(mapResponseStatus(input.result, input.snapshot)),
          input.context,
        ),
      )
      continue
    }

    if (slot === 'message') {
      const annotations = mapCitationsToAnnotations(source.citations, source.outputText)
      if (!source.outputText && annotations.length === 0) {
        continue
      }
      output.push(
        buildMessageItem(
          source.outputText,
          source.citations,
          mapResponseMessageStatus(mapResponseStatus(input.result, input.snapshot)),
          buildMessageItemId(input.context),
        ),
      )
      continue
    }

    const searchKey = slot.slice('search:'.length)
    const search = source.searches.find((candidate, index) => buildSearchKey(candidate, index) === searchKey)
    if (!search) {
      continue
    }
    output.push(
      buildWebSearchCallItem(
        search,
        mapSearchStatus(search.status, source.status),
        buildSearchItemId(input.context, searchKey),
      ),
    )
  }

  return output
}

function mapCitationToAnnotation(
  citation: DeepSeekGenerationCitation,
  outputText: string,
): OpenAIResponsesAnnotation | null {
  const startIndex = citation.annotation?.startIndex
  const endIndex = citation.annotation?.endIndex
  if (
    citation.url &&
    typeof startIndex === 'number' &&
    typeof endIndex === 'number' &&
    startIndex >= 0 &&
    endIndex <= outputText.length
  ) {
    return {
      type: 'url_citation',
      url: citation.url,
      start_index: startIndex,
      end_index: endIndex,
      title: citation.title,
    }
  }

  if (citation.annotation?.source === 'document' && citation.snippet) {
    return {
      type: 'file_citation',
      file_id: buildStableOpenAIId('file', citation.id || citation.url || citation.title),
      index: 0,
      filename: citation.title,
    }
  }

  return null
}

function buildOpenAIUsage(usage: DeepSeekGenerationCompletedState['usage']): OpenAIResponsesUsage | null {
  if (!usage) {
    return null
  }

  const inputTokens = Math.max(0, usage.inputTokens ?? 0)
  const outputTokens = Math.max(0, usage.outputTokens ?? 0)
  const reasoningTokens = Math.max(0, usage.reasoningTokens ?? 0)
  const totalTokens =
    usage.totalTokens !== null && usage.totalTokens !== undefined
      ? Math.max(0, usage.totalTokens)
      : inputTokens + outputTokens

  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cached_tokens: 0,
    },
    output_tokens: outputTokens,
    output_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
    total_tokens: totalTokens,
  }
}

function buildOpenAIError(
  source: DeepSeekGenerationCompletedState | DeepSeekGenerationAccumulatorSnapshot | null,
): OpenAIResponseObject['error'] {
  if (!source || source.status !== 'failed') {
    return null
  }

  if ('error' in source && source.error) {
    return {
      code: normalizeErrorCode(source.error.code),
      message: source.error.message,
    }
  }

  return {
    code: 'server_error',
    message: 'DeepSeek generation failed.',
  }
}

function buildIncompleteDetails(
  source: DeepSeekGenerationCompletedState | DeepSeekGenerationAccumulatorSnapshot | null,
): OpenAIResponsesIncompleteDetails | null {
  if (!source) {
    return null
  }

  if (source.finishReason === 'length') {
    return {
      reason: 'max_output_tokens',
    }
  }

  if (source.finishReason === 'content_filter') {
    return {
      reason: 'content_filter',
    }
  }

  return null
}

function mapResponseStatus(
  result: DeepSeekGenerationCompletedState | null,
  snapshot: DeepSeekGenerationAccumulatorSnapshot | null,
): OpenAIResponseObject['status'] {
  if (result) {
    return mapTerminalStatus(result.status, result.finishReason)
  }

  if (snapshot && snapshot.status !== 'running') {
    return mapTerminalStatus(mapSnapshotStatusToCompletedStateStatus(snapshot), snapshot.finishReason)
  }

  return 'in_progress'
}

function mapTerminalStatus(
  status: DeepSeekGenerationCompletedState['status'],
  finishReason: DeepSeekGenerationFinishReason,
): OpenAIResponseObject['status'] {
  if (status === 'failed') {
    return 'failed'
  }

  if (status === 'stopped' || finishReason === 'length' || finishReason === 'content_filter') {
    return 'incomplete'
  }

  return 'completed'
}

function mapSnapshotStatusToCompletedStateStatus(
  snapshot: DeepSeekGenerationAccumulatorSnapshot,
): DeepSeekGenerationCompletedState['status'] {
  if (snapshot.status === 'running') {
    return 'completed'
  }
  return snapshot.status
}

function buildStableOpenAIId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha1').update(seed).digest('hex').slice(0, 24)}`
}

function isoToUnixSeconds(value: string | null): number {
  if (!value) {
    return 0
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return 0
  }
  return Math.max(0, Math.floor(timestamp / 1000))
}

function normalizeErrorCode(code: string | null): string {
  if (!code) {
    return 'server_error'
  }
  return code
}
