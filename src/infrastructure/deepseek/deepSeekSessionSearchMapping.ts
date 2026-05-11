import {
  cloneDeepSeekMessageSearches,
  cloneDeepSeekSearchResult,
  mergeDeepSeekMessageSearches,
} from '../../domain/session/sessionSearchArtifacts.js'
import type {
  DeepSeekMessageSearch,
  DeepSeekSearchResult,
  DeepSeekSearchResultReference,
  DeepSeekSearchStatus,
} from '../../types/deepseek-session.types.js'
import type { DeepSeekGenerationSearchState } from '../../types/deepseek-stream.types.js'
import {
  isRecord,
  readEpochishTimestamp,
  readOptionalString,
  stringifyNullableNumber,
} from './deepSeekGenerationParserPrimitives.js'

interface SearchFragmentState {
  fragmentId: string | null
  query: string | null
  status: DeepSeekSearchStatus
  results: DeepSeekSearchResult[]
}

interface ToolOpenState {
  fragmentId: string | null
  toolSearchFragmentId: string | null
  result: DeepSeekSearchResult | null
}

interface ResponseReferenceState {
  referenceId: string
  referenceType: string
}

export function mapGenerationSearchesToDeepSeekMessageSearches(
  searches: DeepSeekGenerationSearchState[],
): DeepSeekMessageSearch[] {
  return cloneDeepSeekMessageSearches(
    searches.map(search => ({
      query: search.query,
      status: normalizeSearchStatus(search.status),
      results: search.results
        .map(result =>
          normalizeSearchResult(result, {
            query: search.query,
          }),
        )
        .filter((result): result is DeepSeekSearchResult => result !== null),
    })),
  )
}

export function extractDeepSeekMessageSearchesFromHistoryRecord(
  record: Record<string, unknown>,
): DeepSeekMessageSearch[] {
  const explicitSearches = extractExplicitSearches(record)
  if (explicitSearches.length > 0) {
    return explicitSearches
  }

  return extractFragmentSearches(record['fragments'])
}

function extractExplicitSearches(record: Record<string, unknown>): DeepSeekMessageSearch[] {
  const candidates: unknown[] = [
    record['searches'],
    record['search_states'],
    record['search_state'],
    record['search_results'],
  ]

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue
    }

    const normalized = candidate
      .map(item => normalizeExplicitSearchState(item))
      .filter((item): item is DeepSeekMessageSearch => item !== null)
    if (normalized.length > 0) {
      return mergeDeepSeekMessageSearches([], normalized)
    }
  }

  return []
}

function normalizeExplicitSearchState(
  value: unknown,
): DeepSeekMessageSearch | null {
  if (!isRecord(value)) {
    return null
  }

  const explicitResults = Array.isArray(value['results']) ? value['results'] : null
  const directResult = normalizeSearchResult(value, {
    query: readOptionalString(value, 'query'),
  })
  const results = explicitResults
    ? explicitResults
        .map(item =>
          normalizeSearchResult(item, {
            query: readOptionalString(value, 'query'),
          }),
        )
        .filter((item): item is DeepSeekSearchResult => item !== null)
    : directResult
      ? [directResult]
      : []

  if (results.length === 0) {
    return null
  }

  return {
    query: readOptionalString(value, 'query'),
    status: normalizeSearchStatus(readOptionalString(value, 'status')),
    results,
  }
}

function extractFragmentSearches(value: unknown): DeepSeekMessageSearch[] {
  if (!Array.isArray(value)) {
    return []
  }

  const toolSearches = new Map<string, SearchFragmentState>()
  const toolOpens: ToolOpenState[] = []
  const responseReferences: ResponseReferenceState[] = []

  for (const fragment of value) {
    if (!isRecord(fragment)) {
      continue
    }

    const fragmentType = readOptionalString(fragment, 'type')
    if (fragmentType === 'TOOL_SEARCH') {
      const fragmentId =
        stringifyNullableNumber(fragment['id']) ?? readOptionalString(fragment, 'id')
      const query = extractFragmentSearchQuery(fragment)
      const results = extractSearchResults(fragment['results'], {
        query,
        toolSearchFragmentId: fragmentId,
      })
      const search = {
        fragmentId,
        query,
        status: normalizeSearchStatus(readOptionalString(fragment, 'status'), results.length),
        results,
      } satisfies SearchFragmentState
      toolSearches.set(fragmentId ?? buildSyntheticSearchFragmentId(query, toolSearches.size), search)
      continue
    }

    if (fragmentType === 'TOOL_OPEN') {
      toolOpens.push({
        fragmentId:
          stringifyNullableNumber(fragment['id']) ?? readOptionalString(fragment, 'id'),
        toolSearchFragmentId: extractToolOpenSearchReferenceId(fragment['reference']),
        result: normalizeSearchResult(fragment['result'], {
          query: null,
        }),
      })
      continue
    }

    if (fragmentType === 'RESPONSE') {
      responseReferences.push(...extractResponseReferences(fragment['references']))
    }
  }

  const searches = [...toolSearches.values()].map(search =>
    applyReferenceMappingsToSearch(search, toolOpens, responseReferences),
  )

  return mergeDeepSeekMessageSearches([], searches)
}

function applyReferenceMappingsToSearch(
  search: SearchFragmentState,
  toolOpens: ToolOpenState[],
  responseReferences: ResponseReferenceState[],
): DeepSeekMessageSearch {
  return {
    query: search.query,
    status: search.status,
    results: search.results.map(result => {
      const responseReferenceMappings = new Map<string, DeepSeekSearchResultReference>()
      const matchedToolOpenIds = new Set<string>()

      if (search.fragmentId) {
        for (const reference of responseReferences) {
          if (reference.referenceType !== 'TOOL_SEARCH' || reference.referenceId !== search.fragmentId) {
            continue
          }

          responseReferenceMappings.set(
            buildReferenceIdentity(reference.referenceType, reference.referenceId, 'direct-tool-search'),
            {
              referenceId: reference.referenceId,
              referenceType: reference.referenceType,
              resolution: 'direct-tool-search',
              toolSearchFragmentId: search.fragmentId,
            },
          )
        }
      }

      for (const toolOpen of toolOpens) {
        if (!toolOpen.fragmentId || !toolOpen.toolSearchFragmentId || !toolOpen.result) {
          continue
        }
        if (toolOpen.toolSearchFragmentId !== search.fragmentId) {
          continue
        }
        if (!searchResultMatches(result, toolOpen.result)) {
          continue
        }

        matchedToolOpenIds.add(toolOpen.fragmentId)
        for (const reference of responseReferences) {
          if (reference.referenceType !== 'TOOL_OPEN' || reference.referenceId !== toolOpen.fragmentId) {
            continue
          }

          responseReferenceMappings.set(
            buildReferenceIdentity(reference.referenceType, reference.referenceId, 'via-tool-open'),
            {
              referenceId: reference.referenceId,
              referenceType: reference.referenceType,
              resolution: 'via-tool-open',
              toolSearchFragmentId: search.fragmentId ?? undefined,
              toolOpenFragmentId: toolOpen.fragmentId,
            },
          )
        }
      }

      return {
        ...cloneDeepSeekSearchResult(result),
        ...(matchedToolOpenIds.size > 0
          ? { toolOpenFragmentIds: [...matchedToolOpenIds] }
          : {}),
        ...(responseReferenceMappings.size > 0
          ? { responseReferences: [...responseReferenceMappings.values()] }
          : {}),
      }
    }),
  }
}

function extractSearchResults(
  value: unknown,
  input: {
    query: string | null
    toolSearchFragmentId: string | null
  },
): DeepSeekSearchResult[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item =>
      normalizeSearchResult(item, {
        query: input.query,
        toolSearchFragmentId: input.toolSearchFragmentId,
      }),
    )
    .filter((item): item is DeepSeekSearchResult => item !== null)
}

function normalizeSearchResult(
  value: unknown,
  input: {
    query: string | null
    toolSearchFragmentId?: string | null | undefined
  },
): DeepSeekSearchResult | null {
  if (!isRecord(value)) {
    return null
  }

  const url = readOptionalString(value, 'url')
  const title = readOptionalString(value, 'title')
  const id =
    readOptionalString(value, 'id') ??
    readOptionalString(value, 'url') ??
    readOptionalString(value, 'title')
  if (!id || !url || !title) {
    return null
  }

  const snippet = readOptionalString(value, 'snippet')
  const source = readOptionalString(value, 'site_name')
  const publishedAt = readEpochishTimestamp(value['published_at'])

  return {
    id,
    title,
    url,
    ...(input.query ? { query: input.query } : {}),
    ...(snippet ? { snippet } : {}),
    ...(source ? { source } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(input.toolSearchFragmentId ? { toolSearchFragmentId: input.toolSearchFragmentId } : {}),
  }
}

function extractFragmentSearchQuery(
  fragment: Record<string, unknown>,
): string | null {
  const queries = Array.isArray(fragment['queries']) ? fragment['queries'] : []
  for (const query of queries) {
    if (!isRecord(query)) {
      continue
    }

    const value = readOptionalString(query, 'query')
    if (value) {
      return value
    }
  }

  return readOptionalString(fragment, 'query')
}

function extractToolOpenSearchReferenceId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (readOptionalString(value, 'type') !== 'TOOL_SEARCH') {
    return null
  }

  return stringifyNullableNumber(value['id']) ?? readOptionalString(value, 'id')
}

function extractResponseReferences(value: unknown): ResponseReferenceState[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => {
      if (!isRecord(item)) {
        return null
      }

      const referenceId =
        stringifyNullableNumber(item['id']) ?? readOptionalString(item, 'id')
      const referenceType = readOptionalString(item, 'type')
      if (!referenceId || !referenceType) {
        return null
      }

      return {
        referenceId,
        referenceType,
      } satisfies ResponseReferenceState
    })
    .filter((item): item is ResponseReferenceState => item !== null)
}

function normalizeSearchStatus(
  value: string | null | undefined,
  resultCount = 0,
): DeepSeekSearchStatus {
  if (value === 'completed' || value === 'results' || value === 'searching' || value === 'unknown') {
    return value
  }

  if (value === 'FINISHED') {
    return 'completed'
  }

  if (resultCount > 0) {
    return 'results'
  }

  if (typeof value === 'string' && value.trim()) {
    return 'searching'
  }

  return 'unknown'
}

function searchResultMatches(
  left: DeepSeekSearchResult,
  right: DeepSeekSearchResult,
): boolean {
  return (
    buildSearchResultIdentity(left) === buildSearchResultIdentity(right) ||
    (left.url === right.url && left.title === right.title)
  )
}

function buildSearchResultIdentity(result: DeepSeekSearchResult): string {
  return result.id || result.url || result.title
}

function buildReferenceIdentity(
  referenceType: string,
  referenceId: string,
  resolution: DeepSeekSearchResultReference['resolution'],
): string {
  return `${referenceType}::${referenceId}::${resolution}`
}

function buildSyntheticSearchFragmentId(query: string | null, index: number): string {
  return query?.trim() || `tool-search-${index + 1}`
}
