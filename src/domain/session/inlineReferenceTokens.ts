import type {
  DeepSeekInlineCitationObservation,
  DeepSeekMessageResponseReference,
} from '../../types/deepseek-session.types.js'

const INLINE_REFERENCE_TOKEN_PATTERN = /\[reference:(\d+)\]/g
const INLINE_DAGGER_LINE_PATTERN = /\[(\d+)†L\d+(?:-L?\d+)?\]/g
const INLINE_CITATION_LIKE_PATTERN = /\[[^\]\n]*†[^\]\n]*\]/g

interface MatchedInlineCitationToken {
  token: string
  kind: DeepSeekInlineCitationObservation['kind']
  ordinal: number | null
  index: number
}

export function extractDeepSeekInlineReferenceTokens(
  text: string | null | undefined,
): string[] {
  return observeDeepSeekInlineCitations({
    text,
  })
    .filter(observation => observation.kind === 'reference-ordinal')
    .map(observation => observation.token)
}

export function observeDeepSeekInlineCitations(input: {
  text: string | null | undefined
  responseReferences?: DeepSeekMessageResponseReference[] | null | undefined
}): DeepSeekInlineCitationObservation[] {
  if (typeof input.text !== 'string' || input.text.trim() === '') {
    return []
  }

  const responseReferences = (input.responseReferences ?? []).map(reference => ({
    referenceId: reference.referenceId,
    referenceType: reference.referenceType,
  }))
  const observations = collectMatchedInlineCitationTokens(input.text).map(match =>
    resolveInlineCitationObservation(match, responseReferences),
  )

  return dedupeInlineCitationObservations(observations)
}

function collectMatchedInlineCitationTokens(text: string): MatchedInlineCitationToken[] {
  const matches = [
    ...collectPatternMatches(text, INLINE_REFERENCE_TOKEN_PATTERN, match => ({
      token: match[0],
      kind: 'reference-ordinal' as const,
      ordinal: Number.parseInt(match[1] ?? '', 10),
    })),
    ...collectPatternMatches(text, INLINE_DAGGER_LINE_PATTERN, match => ({
      token: match[0],
      kind: 'line-range' as const,
      ordinal: null,
    })),
    ...collectPatternMatches(text, INLINE_CITATION_LIKE_PATTERN, match => ({
      token: match[0],
      kind: 'citation-like-unknown' as const,
      ordinal: null,
    })),
  ].sort((left, right) => left.index - right.index)

  const unique = new Set<string>()
  const deduped: MatchedInlineCitationToken[] = []
  for (const match of matches) {
    if (unique.has(match.token)) {
      continue
    }
    unique.add(match.token)
    deduped.push(match)
  }

  return deduped
}

function collectPatternMatches<T extends Omit<MatchedInlineCitationToken, 'index'>>(
  text: string,
  pattern: RegExp,
  mapMatch: (match: RegExpMatchArray) => T,
): MatchedInlineCitationToken[] {
  const matches: MatchedInlineCitationToken[] = []
  const workingPattern = new RegExp(pattern.source, pattern.flags)
  for (const match of text.matchAll(workingPattern)) {
    const mapped = mapMatch(match)
    matches.push({
      ...mapped,
      index: match.index ?? Number.MAX_SAFE_INTEGER,
    })
  }
  return matches
}

function resolveInlineCitationObservation(
  match: MatchedInlineCitationToken,
  responseReferences: DeepSeekMessageResponseReference[],
): DeepSeekInlineCitationObservation {
  if (match.kind === 'reference-ordinal') {
    if (match.ordinal !== null && match.ordinal < responseReferences.length) {
      const responseReference = responseReferences[match.ordinal]
      if (responseReference) {
        return {
          token: match.token,
          kind: match.kind,
          verificationStatus: 'verified',
          resolution: 'response-reference-ordinal',
          ordinal: match.ordinal,
          responseReference: { ...responseReference },
        }
      }
    }

    return {
      token: match.token,
      kind: match.kind,
      verificationStatus:
        responseReferences.length === 0
          ? 'suspected-generated-citation'
          : 'unverified',
      resolution:
        responseReferences.length === 0
          ? 'no-structured-response-references'
          : 'ordinal-out-of-range',
      ...(match.ordinal !== null ? { ordinal: match.ordinal } : {}),
    }
  }

  return {
    token: match.token,
    kind: match.kind,
    verificationStatus:
      responseReferences.length === 0
        ? 'suspected-generated-citation'
        : 'unverified',
    resolution:
      responseReferences.length === 0
        ? 'no-structured-response-references'
        : 'unsupported-citation-format',
  }
}

function dedupeInlineCitationObservations(
  observations: DeepSeekInlineCitationObservation[],
): DeepSeekInlineCitationObservation[] {
  const seen = new Set<string>()
  const deduped: DeepSeekInlineCitationObservation[] = []
  for (const observation of observations) {
    if (seen.has(observation.token)) {
      continue
    }
    seen.add(observation.token)
    deduped.push({
      ...observation,
      ...(observation.responseReference
        ? {
            responseReference: {
              ...observation.responseReference,
            },
          }
        : {}),
    })
  }
  return deduped
}
