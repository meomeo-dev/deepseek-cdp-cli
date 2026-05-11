import type {
  DeepSeekGenerationCitation,
  DeepSeekGenerationResponseReference,
  DeepSeekGenerationSearchResult,
  DeepSeekGenerationSearchState,
} from '../../types/deepseek-stream.types.js'
import {
  isRecord,
  readEpochishTimestamp,
  readOptionalString,
  stringifyNullableNumber,
} from './deepSeekGenerationParserPrimitives.js'

export type FragmentKind = 'THINK' | 'RESPONSE' | 'TOOL_SEARCH' | 'TOOL_OPEN' | 'UNKNOWN'

export interface TrackedFragmentReference {
  id: string
  type: string
}

export interface TrackedFragmentState {
  id: string | null
  kind: FragmentKind
  content: string
  status: string | null
  query: string | null
  searchResults: DeepSeekGenerationSearchResult[]
  openCitation: DeepSeekGenerationCitation | null
  responseReferences: TrackedFragmentReference[]
}

export interface ParsedFragmentPatchPath {
  patchPath: string
  relativeIndex: number
  nestedPath: string
}

export function createTrackedFragmentState(
  fragment: Record<string, unknown>,
): TrackedFragmentState {
  const kind = normalizeFragmentKind(readOptionalString(fragment, 'type'))
  return {
    id: stringifyNullableNumber(fragment['id']) ?? readOptionalString(fragment, 'id'),
    kind,
    content: readOptionalString(fragment, 'content') ?? '',
    status: readOptionalString(fragment, 'status'),
    query: extractSearchQuery(fragment),
    searchResults: extractSearchResults(fragment['results']),
    openCitation: kind === 'TOOL_OPEN' ? extractToolOpenCitation(fragment['result']) : null,
    responseReferences:
      kind === 'RESPONSE' ? extractTrackedFragmentReferences(fragment['references']) : [],
  }
}

export function parseFragmentPatchPath(
  patchPath: string,
): ParsedFragmentPatchPath | null {
  const match = /^response\/fragments\/-(\d+)\/(.+)$/.exec(patchPath)
  if (!match) {
    return null
  }

  return {
    patchPath,
    relativeIndex: Number.parseInt(match[1] ?? '', 10),
    nestedPath: match[2] ?? '',
  }
}

export function getTrackedFragmentByRelativeIndex(
  trackedFragments: TrackedFragmentState[],
  relativeIndex: number,
): TrackedFragmentState | null {
  if (!Number.isInteger(relativeIndex) || relativeIndex <= 0) {
    return null
  }

  const index = trackedFragments.length - relativeIndex
  if (index < 0 || index >= trackedFragments.length) {
    return null
  }

  return trackedFragments[index] ?? null
}

export function buildCombinedFragmentText(
  trackedFragments: TrackedFragmentState[],
  kind: Extract<FragmentKind, 'THINK' | 'RESPONSE'>,
): string {
  return trackedFragments
    .filter(fragment => fragment.kind === kind)
    .map(fragment => fragment.content)
    .join('')
}

export function buildSearchStateFromTrackedFragment(
  trackedFragment: TrackedFragmentState,
): DeepSeekGenerationSearchState | null {
  if (trackedFragment.kind !== 'TOOL_SEARCH') {
    return null
  }

  return {
    query: trackedFragment.query,
    status: normalizeSearchStatus(
      trackedFragment.status,
      trackedFragment.searchResults.length,
    ),
    results: trackedFragment.searchResults.map(result => ({ ...result })),
  }
}

export function upsertSearchState(
  currentSearches: DeepSeekGenerationSearchState[],
  nextSearch: DeepSeekGenerationSearchState,
): DeepSeekGenerationSearchState[] {
  const replaceIndex = currentSearches.findIndex(search =>
    search.query && nextSearch.query ? search.query === nextSearch.query : false,
  )

  if (replaceIndex < 0) {
    return [...currentSearches.map(cloneSearchState), cloneSearchState(nextSearch)]
  }

  return currentSearches.map((search, index) =>
    index === replaceIndex ? cloneSearchState(nextSearch) : cloneSearchState(search),
  )
}

export function collectResolvedCitations(
  trackedFragments: TrackedFragmentState[],
): DeepSeekGenerationCitation[] {
  const citationsByIdentity = new Map<string, DeepSeekGenerationCitation>()
  const toolOpenCitations = new Map<string, DeepSeekGenerationCitation>()

  for (const fragment of trackedFragments) {
    if (fragment.kind === 'TOOL_OPEN' && fragment.id && fragment.openCitation) {
      toolOpenCitations.set(fragment.id, { ...fragment.openCitation })
    }
  }

  for (const fragment of trackedFragments) {
    if (fragment.kind !== 'RESPONSE') {
      continue
    }

    for (const reference of fragment.responseReferences) {
      if (reference.type !== 'TOOL_OPEN') {
        continue
      }
      const citation = toolOpenCitations.get(reference.id)
      if (!citation) {
        continue
      }
      citationsByIdentity.set(buildCitationIdentity(citation), {
        ...citation,
        annotation: {
          source: 'search',
        },
      })
    }
  }

  return [...citationsByIdentity.values()]
}

export function collectResponseReferences(
  trackedFragments: TrackedFragmentState[],
): DeepSeekGenerationResponseReference[] {
  const references: DeepSeekGenerationResponseReference[] = []

  for (const fragment of trackedFragments) {
    if (fragment.kind !== 'RESPONSE') {
      continue
    }

    for (const reference of fragment.responseReferences) {
      references.push({
        referenceId: reference.id,
        referenceType: reference.type,
      })
    }
  }

  return references
}

export function cloneSearchState(
  search: DeepSeekGenerationSearchState,
): DeepSeekGenerationSearchState {
  return {
    query: search.query,
    status: search.status,
    results: search.results.map(result => ({ ...result })),
  }
}

export function cloneCitations(
  citations: DeepSeekGenerationCitation[],
): DeepSeekGenerationCitation[] {
  return citations.map(citation => ({
    ...citation,
    ...(citation.annotation ? { annotation: { ...citation.annotation } } : {}),
  }))
}

function normalizeFragmentKind(value: string | null): FragmentKind {
  if (value === 'THINK') {
    return 'THINK'
  }
  if (value === 'RESPONSE') {
    return 'RESPONSE'
  }
  if (value === 'TOOL_SEARCH') {
    return 'TOOL_SEARCH'
  }
  if (value === 'TOOL_OPEN') {
    return 'TOOL_OPEN'
  }
  return 'UNKNOWN'
}

function extractSearchQuery(fragment: Record<string, unknown>): string | null {
  const queries = Array.isArray(fragment['queries']) ? fragment['queries'] : []
  const firstQuery = queries.find(isRecord)
  return firstQuery ? readOptionalString(firstQuery, 'query') : null
}

function extractSearchResults(value: unknown): DeepSeekGenerationSearchResult[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => normalizeSearchResult(item, index))
    .filter((item): item is DeepSeekGenerationSearchResult => item !== null)
}

function normalizeSearchResult(
  value: unknown,
  index: number,
): DeepSeekGenerationSearchResult | null {
  if (!isRecord(value)) {
    return null
  }

  const url = readOptionalString(value, 'url')
  const title = readOptionalString(value, 'title')
  const id =
    readOptionalString(value, 'id') ??
    readOptionalString(value, 'url') ??
    readOptionalString(value, 'title') ??
    `search-result-${index + 1}`
  if (!url || !title) {
    return null
  }

  const snippet = readOptionalString(value, 'snippet')
  const source = readOptionalString(value, 'site_name')
  const publishedAt = readEpochishTimestamp(value['published_at'])
  const result: DeepSeekGenerationSearchResult = {
    id,
    title,
    url,
  }

  if (snippet) {
    result.snippet = snippet
  }
  if (source) {
    result.source = source
  }
  if (publishedAt) {
    result.publishedAt = publishedAt
  }

  return result
}

function extractToolOpenCitation(value: unknown): DeepSeekGenerationCitation | null {
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
  const citation: DeepSeekGenerationCitation = {
    id,
    title,
    url,
  }

  if (snippet) {
    citation.snippet = snippet
  }

  return citation
}

function extractTrackedFragmentReferences(value: unknown): TrackedFragmentReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => {
      if (!isRecord(item)) {
        return null
      }
      const id = stringifyNullableNumber(item['id']) ?? readOptionalString(item, 'id')
      const type = readOptionalString(item, 'type')
      if (!id || !type) {
        return null
      }
      return { id, type }
    })
    .filter((item): item is TrackedFragmentReference => item !== null)
}

function normalizeSearchStatus(
  status: string | null,
  resultCount: number,
): DeepSeekGenerationSearchState['status'] {
  if (status === 'FINISHED') {
    return 'completed'
  }
  if (resultCount > 0) {
    return 'results'
  }
  return 'searching'
}

function buildCitationIdentity(citation: DeepSeekGenerationCitation): string {
  return citation.id || citation.url || citation.title
}
