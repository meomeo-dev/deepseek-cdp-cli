import type {
  DeepSeekMessageSearch,
  DeepSeekSearchResult,
  DeepSeekSearchResultReference,
  DeepSeekSearchStatus,
} from '../../types/deepseek-session.types.js'

const SEARCH_STATUS_PRIORITY: Record<DeepSeekSearchStatus, number> = {
  unknown: 0,
  searching: 1,
  results: 2,
  completed: 3,
}

export function cloneDeepSeekMessageSearches(
  searches: DeepSeekMessageSearch[] | null | undefined,
): DeepSeekMessageSearch[] {
  return (searches ?? []).map(cloneDeepSeekMessageSearch)
}

export function cloneDeepSeekMessageSearch(
  search: DeepSeekMessageSearch,
): DeepSeekMessageSearch {
  return {
    query: search.query,
    status: search.status,
    results: search.results.map(cloneDeepSeekSearchResult),
  }
}

export function cloneDeepSeekSearchResult(
  result: DeepSeekSearchResult,
): DeepSeekSearchResult {
  return {
    id: result.id,
    title: result.title,
    url: result.url,
    ...(result.query !== undefined ? { query: result.query } : {}),
    ...(result.snippet !== undefined ? { snippet: result.snippet } : {}),
    ...(result.source !== undefined ? { source: result.source } : {}),
    ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
    ...(result.toolSearchFragmentId !== undefined
      ? { toolSearchFragmentId: result.toolSearchFragmentId }
      : {}),
    ...(result.toolOpenFragmentIds
      ? { toolOpenFragmentIds: [...result.toolOpenFragmentIds] }
      : {}),
    ...(result.responseReferences
      ? {
          responseReferences: result.responseReferences.map(
            cloneDeepSeekSearchResultReference,
          ),
        }
      : {}),
  }
}

export function cloneDeepSeekSearchResultReference(
  reference: DeepSeekSearchResultReference,
): DeepSeekSearchResultReference {
  return {
    referenceId: reference.referenceId,
    referenceType: reference.referenceType,
    resolution: reference.resolution,
    ...(reference.toolSearchFragmentId !== undefined
      ? { toolSearchFragmentId: reference.toolSearchFragmentId }
      : {}),
    ...(reference.toolOpenFragmentId !== undefined
      ? { toolOpenFragmentId: reference.toolOpenFragmentId }
      : {}),
  }
}

export function mergeDeepSeekMessageSearches(
  current: DeepSeekMessageSearch[] | null | undefined,
  incoming: DeepSeekMessageSearch[] | null | undefined,
): DeepSeekMessageSearch[] {
  const merged: DeepSeekMessageSearch[] = cloneDeepSeekMessageSearches(current)

  for (const next of incoming ?? []) {
    const nextClone = cloneDeepSeekMessageSearch(next)
    const targetIndex = findSearchIndex(merged, nextClone)
    if (targetIndex < 0) {
      merged.push(nextClone)
      continue
    }

    const previous = merged[targetIndex]
    if (!previous) {
      merged.push(nextClone)
      continue
    }

    merged.splice(targetIndex, 1, {
      query: nextClone.query ?? previous.query,
      status: pickMoreInformativeSearchStatus(previous.status, nextClone.status),
      results: mergeDeepSeekSearchResults(previous.results, nextClone.results),
    })
  }

  return merged
}

export function collectUniqueDeepSeekSearchResults(
  searches: DeepSeekMessageSearch[] | null | undefined,
): DeepSeekSearchResult[] {
  const merged = new Map<string, DeepSeekSearchResult>()

  for (const search of searches ?? []) {
    for (const result of search.results) {
      const identity = buildSearchResultIdentity(result)
      const previous = merged.get(identity)
      merged.set(
        identity,
        previous ? mergeDeepSeekSearchResult(previous, result) : cloneDeepSeekSearchResult(result),
      )
    }
  }

  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function mergeDeepSeekSearchResults(
  current: DeepSeekSearchResult[],
  incoming: DeepSeekSearchResult[],
): DeepSeekSearchResult[] {
  const merged = new Map<string, DeepSeekSearchResult>()

  for (const result of current) {
    merged.set(buildSearchResultIdentity(result), cloneDeepSeekSearchResult(result))
  }

  for (const result of incoming) {
    const identity = buildSearchResultIdentity(result)
    const previous = merged.get(identity)
    merged.set(
      identity,
      previous ? mergeDeepSeekSearchResult(previous, result) : cloneDeepSeekSearchResult(result),
    )
  }

  return [...merged.values()]
}

function mergeDeepSeekSearchResult(
  current: DeepSeekSearchResult,
  incoming: DeepSeekSearchResult,
): DeepSeekSearchResult {
  const toolOpenFragmentIds = mergeStringLists(
    current.toolOpenFragmentIds,
    incoming.toolOpenFragmentIds,
  )
  const responseReferences = mergeSearchResultReferences(
    current.responseReferences,
    incoming.responseReferences,
  )

  return {
    id: incoming.id || current.id,
    title: incoming.title || current.title,
    url: incoming.url || current.url,
    ...(pickPreferredOptionalString(current.query, incoming.query) !== undefined
      ? { query: pickPreferredOptionalString(current.query, incoming.query) }
      : {}),
    ...(pickPreferredOptionalString(current.snippet, incoming.snippet) !== undefined
      ? { snippet: pickPreferredOptionalString(current.snippet, incoming.snippet) }
      : {}),
    ...(pickPreferredOptionalString(current.source, incoming.source) !== undefined
      ? { source: pickPreferredOptionalString(current.source, incoming.source) }
      : {}),
    ...(pickPreferredOptionalString(current.publishedAt, incoming.publishedAt) !== undefined
      ? { publishedAt: pickPreferredOptionalString(current.publishedAt, incoming.publishedAt) }
      : {}),
    ...(pickPreferredOptionalString(
      current.toolSearchFragmentId,
      incoming.toolSearchFragmentId,
    ) !== undefined
      ? {
          toolSearchFragmentId: pickPreferredOptionalString(
            current.toolSearchFragmentId,
            incoming.toolSearchFragmentId,
          ),
        }
      : {}),
    ...(toolOpenFragmentIds.length > 0 ? { toolOpenFragmentIds } : {}),
    ...(responseReferences.length > 0 ? { responseReferences } : {}),
  }
}

function mergeSearchResultReferences(
  current: DeepSeekSearchResultReference[] | undefined,
  incoming: DeepSeekSearchResultReference[] | undefined,
): DeepSeekSearchResultReference[] {
  const merged = new Map<string, DeepSeekSearchResultReference>()

  for (const reference of current ?? []) {
    merged.set(
      buildSearchReferenceIdentity(reference),
      cloneDeepSeekSearchResultReference(reference),
    )
  }

  for (const reference of incoming ?? []) {
    merged.set(
      buildSearchReferenceIdentity(reference),
      cloneDeepSeekSearchResultReference(reference),
    )
  }

  return [...merged.values()]
}

function findSearchIndex(
  searches: DeepSeekMessageSearch[],
  target: DeepSeekMessageSearch,
): number {
  if (target.query) {
    const index = searches.findIndex(search => search.query === target.query)
    if (index >= 0) {
      return index
    }
  }

  const targetResultIds = new Set(target.results.map(result => buildSearchResultIdentity(result)))
  if (targetResultIds.size === 0) {
    return -1
  }

  return searches.findIndex(search =>
    search.results.some(result => targetResultIds.has(buildSearchResultIdentity(result))),
  )
}

function pickMoreInformativeSearchStatus(
  current: DeepSeekSearchStatus,
  incoming: DeepSeekSearchStatus,
): DeepSeekSearchStatus {
  return SEARCH_STATUS_PRIORITY[incoming] >= SEARCH_STATUS_PRIORITY[current]
    ? incoming
    : current
}

function mergeStringLists(
  current: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  return [...new Set([...(current ?? []), ...(incoming ?? [])])]
}

function pickPreferredOptionalString(
  current: string | undefined,
  incoming: string | undefined,
): string | undefined {
  const normalizedIncoming = incoming?.trim()
  if (normalizedIncoming) {
    return normalizedIncoming
  }

  const normalizedCurrent = current?.trim()
  return normalizedCurrent || undefined
}

function buildSearchResultIdentity(result: DeepSeekSearchResult): string {
  return result.id || result.url || result.title
}

function buildSearchReferenceIdentity(reference: DeepSeekSearchResultReference): string {
  return [
    reference.referenceType,
    reference.referenceId,
    reference.resolution,
    reference.toolSearchFragmentId ?? '',
    reference.toolOpenFragmentId ?? '',
  ].join('::')
}
