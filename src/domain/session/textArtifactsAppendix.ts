import type {
  DeepSeekCitation,
  DeepSeekInlineCitationObservation,
  DeepSeekMessageResponseReference,
  DeepSeekMessageSearch,
} from '../../types/deepseek-session.types.js'
import { observeDeepSeekInlineCitations } from './inlineReferenceTokens.js'

export interface DeepSeekTextArtifactsInput {
  text?: string | null | undefined
  citations: DeepSeekCitation[]
  responseReferences?: DeepSeekMessageResponseReference[] | undefined
  searches?: DeepSeekMessageSearch[] | undefined
  inlineCitationObservations?: DeepSeekInlineCitationObservation[] | undefined
}

interface StructuredTextReferenceCandidate {
  title: string
  url: string
  query: string | null
}

interface StructuredTextReferenceEntry {
  ordinal: number
  referenceType: string
  referenceId: string
  mode: 'exact-page' | 'search-result-set' | 'structured-unresolved'
  candidates: StructuredTextReferenceCandidate[]
  queries: string[]
}

interface AdditionalCitationTextEntry {
  title: string
  url: string
}

export function buildDeepSeekTextArtifactsTextAppendix(
  input: DeepSeekTextArtifactsInput,
): string {
  const responseReferences = input.responseReferences ?? []
  const searches = input.searches ?? []
  const inlineCitationObservations =
    input.inlineCitationObservations ??
    observeDeepSeekInlineCitations({
      text: input.text,
      responseReferences,
    })
  const structuredReferenceEntries = buildStructuredTextReferenceEntries({
    responseReferences,
    searches,
  })
  const additionalCitationEntries = buildAdditionalCitationTextEntries({
    citations: input.citations,
    structuredReferenceEntries,
  })
  const hasCitationNotes = inlineCitationObservations.length > 0
  const lines: string[] = []

  if (
    structuredReferenceEntries.length > 0 ||
    additionalCitationEntries.length > 0 ||
    hasCitationNotes
  ) {
    lines.push('Citations:')
    if (structuredReferenceEntries.length > 0) {
      for (const entry of structuredReferenceEntries) {
        lines.push(...formatStructuredTextReferenceEntryLines(entry))
      }
    }
    if (additionalCitationEntries.length > 0) {
      for (const entry of additionalCitationEntries) {
        lines.push(formatAdditionalCitationTextLine(entry))
      }
    }
    if (
      structuredReferenceEntries.length === 0 &&
      additionalCitationEntries.length === 0
    ) {
      lines.push('- No structured citations were returned by DeepSeek.')
    }
    appendStructuredTextReferenceNotes(lines, structuredReferenceEntries)
    appendReadableCitationNotes(lines, inlineCitationObservations)
    if (
      searches.length > 0 &&
      structuredReferenceEntries.length === 0 &&
      additionalCitationEntries.length === 0
    ) {
      lines.push(
        '- Search results were captured, but no citation entries could be rendered from them.',
      )
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function buildStructuredTextReferenceEntries(input: {
  responseReferences: DeepSeekMessageResponseReference[]
  searches: DeepSeekMessageSearch[]
}): StructuredTextReferenceEntry[] {
  return input.responseReferences.map((reference, ordinal) => {
    const candidates = collectStructuredTextReferenceCandidates({
      reference,
      searches: input.searches,
    })
    if (reference.referenceType === 'TOOL_OPEN' && candidates.length > 0) {
      return {
        ordinal,
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        mode: 'exact-page',
        candidates,
        queries: collectStructuredTextReferenceQueries(candidates),
      }
    }

    if (reference.referenceType === 'TOOL_SEARCH' && candidates.length > 0) {
      return {
        ordinal,
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        mode: 'search-result-set',
        candidates,
        queries: collectStructuredTextReferenceQueries(candidates),
      }
    }

    return {
      ordinal,
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      mode: 'structured-unresolved',
      candidates: [],
      queries: [],
    }
  })
}

function collectStructuredTextReferenceCandidates(input: {
  reference: DeepSeekMessageResponseReference
  searches: DeepSeekMessageSearch[]
}): StructuredTextReferenceCandidate[] {
  const candidates = new Map<string, StructuredTextReferenceCandidate>()

  for (const search of input.searches) {
    for (const result of search.results) {
      const matchesReference = (result.responseReferences ?? []).some(
        candidate =>
          candidate.referenceType === input.reference.referenceType &&
          candidate.referenceId === input.reference.referenceId,
      )
      if (!matchesReference) {
        continue
      }

      const identity = buildCitationIdentity(result.title, result.url)
      candidates.set(identity, {
        title: result.title,
        url: result.url,
        query: search.query,
      })
    }
  }

  return [...candidates.values()].sort((left, right) => left.title.localeCompare(right.title))
}

function collectStructuredTextReferenceQueries(
  candidates: StructuredTextReferenceCandidate[],
): string[] {
  return [
    ...new Set(
      candidates
        .map(candidate => candidate.query)
        .filter(
          (query): query is string => typeof query === 'string' && query.trim().length > 0,
        ),
    ),
  ]
}

function buildAdditionalCitationTextEntries(input: {
  citations: DeepSeekCitation[]
  structuredReferenceEntries: StructuredTextReferenceEntry[]
}): AdditionalCitationTextEntry[] {
  const coveredCitationIdentities = new Set<string>()

  for (const entry of input.structuredReferenceEntries) {
    for (const candidate of entry.candidates) {
      coveredCitationIdentities.add(buildCitationIdentity(candidate.title, candidate.url))
    }
  }

  return input.citations
    .filter(
      citation =>
        !coveredCitationIdentities.has(buildCitationIdentity(citation.title, citation.url)),
    )
    .map(citation => ({
      title: citation.title,
      url: citation.url,
    }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

function formatStructuredTextReferenceEntryLines(
  entry: StructuredTextReferenceEntry,
): string[] {
  const referenceLabel = `[reference:${entry.ordinal}]`
  if (entry.mode === 'exact-page') {
    const exactPage = entry.candidates[0]
    if (!exactPage) {
      return [
        `- ${referenceLabel} Exact page | ${entry.referenceType}#${entry.referenceId} | exact page could not be recovered in text output`,
      ]
    }

    return [`- ${referenceLabel} Exact page | ${exactPage.title} | ${exactPage.url}`]
  }

  if (entry.mode === 'search-result-set') {
    const lines = [
      [
        `- ${referenceLabel} Search result set`,
        entry.queries.length === 1 ? `query=${entry.queries[0]}` : `queries=${entry.queries.length}`,
        `candidates=${entry.candidates.length}`,
      ].join(' | '),
    ]
    const visibleCandidates = entry.candidates.slice(0, 5)
    for (const [index, candidate] of visibleCandidates.entries()) {
      lines.push(`  candidate ${index + 1}: ${candidate.title} | ${candidate.url}`)
    }
    if (entry.candidates.length > visibleCandidates.length) {
      lines.push(
        `  ... ${entry.candidates.length - visibleCandidates.length} more candidate sources omitted from text output; inspect markdown/json for the full set.`,
      )
    }
    return lines
  }

  return [
    `- ${referenceLabel} Structured reference | ${entry.referenceType}#${entry.referenceId} | no precise page mapping recovered in text output`,
  ]
}

function formatAdditionalCitationTextLine(entry: AdditionalCitationTextEntry): string {
  return `- [citation] ${entry.title} | ${entry.url}`
}

function appendStructuredTextReferenceNotes(
  lines: string[],
  entries: StructuredTextReferenceEntry[],
): void {
  if (entries.some(entry => entry.mode === 'search-result-set')) {
    lines.push(
      '- Note: `[reference:n]` backed by `TOOL_SEARCH` denotes a search result set, not a single verified webpage.',
    )
  }
}

function appendReadableCitationNotes(
  lines: string[],
  observations: DeepSeekInlineCitationObservation[],
): void {
  const suspectedGeneratedCitationTokens = observations
    .filter(
      observation => observation.verificationStatus === 'suspected-generated-citation',
    )
    .map(observation => observation.token)
  if (suspectedGeneratedCitationTokens.length > 0) {
    lines.push(
      `- Suspected generated citations without structured DeepSeek backing: ${suspectedGeneratedCitationTokens.join(', ')}`,
    )
  }

  const unresolvedReferenceOrdinals = observations
    .filter(
      observation =>
        observation.kind === 'reference-ordinal' &&
        observation.verificationStatus === 'unverified' &&
        typeof observation.ordinal === 'number',
    )
    .map(observation => observation.ordinal as number)
  if (unresolvedReferenceOrdinals.length > 0) {
    lines.push(
      `- Unresolved inline references: ${formatReferenceOrdinalRanges(unresolvedReferenceOrdinals)}. DeepSeek did not return matching structured RESPONSE.references[] entries for these tokens.`,
    )
  }
}

function formatReferenceOrdinalRanges(ordinals: number[]): string {
  const sortedOrdinals = [...new Set(ordinals)].sort((left, right) => left - right)
  if (sortedOrdinals.length === 0) {
    return ''
  }
  const ranges: string[] = []

  let rangeStart = sortedOrdinals[0]!
  let rangeEnd = sortedOrdinals[0]!

  for (const ordinal of sortedOrdinals.slice(1)) {
    if (ordinal === (rangeEnd ?? ordinal) + 1) {
      rangeEnd = ordinal
      continue
    }

    ranges.push(formatReferenceOrdinalRange(rangeStart, rangeEnd))
    rangeStart = ordinal
    rangeEnd = ordinal
  }

  if (typeof rangeStart === 'number' && typeof rangeEnd === 'number') {
    ranges.push(formatReferenceOrdinalRange(rangeStart, rangeEnd))
  }

  return ranges.join(', ')
}

function formatReferenceOrdinalRange(start: number, end: number): string {
  if (start === end) {
    return `[reference:${start}]`
  }

  return `[reference:${start}]..[reference:${end}]`
}

function buildCitationIdentity(title: string, url: string): string {
  return `${url}::${title}`
}
