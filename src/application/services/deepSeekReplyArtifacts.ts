import {
  observeDeepSeekInlineCitations,
} from '../../domain/session/inlineReferenceTokens.js'
import { buildDeepSeekTextArtifactsTextAppendix } from '../../domain/session/textArtifactsAppendix.js'
import {
  cloneDeepSeekMessageResponseReferences,
  mergeDeepSeekCitations,
  mergeDeepSeekMessageResponseReferences,
} from '../../domain/session/sessionMessageArtifacts.js'
import {
  cloneDeepSeekMessageSearches,
  mergeDeepSeekMessageSearches,
} from '../../domain/session/sessionSearchArtifacts.js'
import {
  mapGenerationSearchesToDeepSeekMessageSearches,
} from '../../infrastructure/deepseek/deepSeekSessionSearchMapping.js'
import type {
  DeepSeekObservedGenerationRun,
  DeepSeekParsedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type {
  DeepSeekCitation,
  DeepSeekInlineCitationObservation,
  DeepSeekMessage,
  DeepSeekMessageSearch,
  DeepSeekMessageResponseReference,
  DeepSeekSession,
} from '../../types/deepseek-session.types.js'

export type DeepSeekReplyAssistantArtifactSource =
  | 'session-target'
  | 'session-text-match'
  | 'session-latest'
  | 'generation-run'
  | 'unresolved'

export interface DeepSeekReplyAssistantArtifacts {
  source: DeepSeekReplyAssistantArtifactSource
  branchId: string | null
  messageId: string | null
  text: string | null
  citations: DeepSeekCitation[]
  responseReferences: DeepSeekMessageResponseReference[]
  searches: DeepSeekMessageSearch[]
  inlineReferenceTokens: string[]
  inlineCitationObservations: DeepSeekInlineCitationObservation[]
}

export function resolveDeepSeekReplyAssistantArtifacts(
  result: DeepSeekReplyResult,
): DeepSeekReplyAssistantArtifacts {
  const preferredRun = selectPreferredDeepSeekGenerationRun(result)
  const targetHint = resolveAssistantTargetHint(result)
  const resolvedMessage = resolveAssistantMessageFromSession({
    session: result.session,
    branchId: targetHint.branchId,
    messageId: targetHint.messageId,
    assistantText: result.assistantText,
  })
  const runCitations = preferredRun
    ? mapGenerationCitationsToDeepSeekCitations(preferredRun.finalized.citations)
    : []
  const runSearches = preferredRun
    ? mapGenerationSearchesToDeepSeekMessageSearches(preferredRun.finalized.searches)
    : []
  const runResponseReferences = preferredRun
    ? mapGenerationResponseReferencesToMessageResponseReferences(
        preferredRun.finalized.responseReferences,
      )
    : []

  const mergedCitations = resolvedMessage.message
    ? mergeDeepSeekCitations(resolvedMessage.message.citations, runCitations)
    : runCitations
  const mergedResponseReferences = resolvedMessage.message
    ? mergeDeepSeekMessageResponseReferences(
        resolvedMessage.message.responseReferences,
        runResponseReferences,
      )
    : runResponseReferences
  const mergedSearches = resolvedMessage.message
    ? mergeDeepSeekMessageSearches(resolvedMessage.message.searches, runSearches)
    : runSearches
  const text =
    resolvedMessage.message?.text ??
    result.assistantText ??
    preferredRun?.finalized.outputText ??
    null
  const inlineCitationObservations = observeDeepSeekInlineCitations({
    text,
    responseReferences: mergedResponseReferences,
  })

  return {
    source:
      resolvedMessage.source ??
      (preferredRun ? 'generation-run' : 'unresolved'),
    branchId: resolvedMessage.branchId,
    messageId: resolvedMessage.message?.id ?? targetHint.messageId,
    text,
    citations: mergedCitations.map(citation => ({ ...citation })),
    responseReferences: cloneDeepSeekMessageResponseReferences(mergedResponseReferences),
    searches: cloneDeepSeekMessageSearches(mergedSearches),
    inlineCitationObservations,
    inlineReferenceTokens: inlineCitationObservations
      .filter(observation => observation.kind === 'reference-ordinal')
      .map(observation => observation.token),
  }
}

export function buildDeepSeekReplyArtifactsTextAppendix(
  artifacts: DeepSeekReplyAssistantArtifacts,
): string {
  return buildDeepSeekTextArtifactsTextAppendix({
    text: artifacts.text,
    citations: artifacts.citations,
    responseReferences: artifacts.responseReferences,
    searches: artifacts.searches,
    inlineCitationObservations: artifacts.inlineCitationObservations,
  })
}

export function selectPreferredDeepSeekGenerationRun(
  result: DeepSeekReplyResult,
): DeepSeekObservedGenerationRun | DeepSeekParsedGenerationRun | null {
  const preferredParsedRun =
    result.output.mode === 'stream'
      ? result.output.canonicalRuns.findLast(run => run.finalized.status !== 'failed') ??
        result.output.canonicalRuns.at(-1) ??
        null
      : null
  if (preferredParsedRun) {
    return preferredParsedRun
  }

  return (
    result.generationRuns.findLast(run => run.finalized.status !== 'failed') ??
    result.generationRuns.at(-1) ??
    null
  )
}

function resolveAssistantTargetHint(
  result: DeepSeekReplyResult,
): {
  branchId: string | null
  messageId: string | null
} {
  if (result.mutation) {
    switch (result.mutation.kind) {
      case 'edit-message':
        return {
          branchId: result.mutation.materializedBranchId,
          messageId: result.mutation.assistantMessageId,
        }
      case 'continue':
        return {
          branchId: result.mutation.materializedBranchId,
          messageId: result.mutation.continuedAssistantMessageId,
        }
      case 'regenerate':
        return {
          branchId: result.mutation.materializedBranchId,
          messageId: result.mutation.regeneratedAssistantMessageId,
        }
    }
  }

  const preferredRun = selectPreferredDeepSeekGenerationRun(result)
  return {
    branchId: normalizeOptionalString(preferredRun?.context.branchId),
    messageId: normalizeOptionalString(preferredRun?.context.assistantMessageId),
  }
}

function resolveAssistantMessageFromSession(input: {
  session: DeepSeekSession
  branchId: string | null
  messageId: string | null
  assistantText: string | null
}): {
  source: DeepSeekReplyAssistantArtifactSource | null
  branchId: string | null
  message: DeepSeekMessage | null
} {
  const exactMatch = findAssistantMessageById(
    input.session,
    input.branchId,
    input.messageId,
  )
  if (exactMatch) {
    return {
      source: 'session-target',
      branchId: exactMatch.branchId,
      message: exactMatch.message,
    }
  }

  const textMatch = findAssistantMessageByText(input.session, input.assistantText)
  if (textMatch) {
    return {
      source: 'session-text-match',
      branchId: textMatch.branchId,
      message: textMatch.message,
    }
  }

  const latestMatch = findLatestAssistantMessage(input.session)
  if (latestMatch) {
    return {
      source: 'session-latest',
      branchId: latestMatch.branchId,
      message: latestMatch.message,
    }
  }

  return {
    source: null,
    branchId: input.branchId,
    message: null,
  }
}

function findAssistantMessageById(
  session: DeepSeekSession,
  branchId: string | null,
  messageId: string | null,
): {
  branchId: string
  message: DeepSeekMessage
} | null {
  if (branchId && messageId) {
    const branch = session.branches.find(candidate => candidate.id === branchId) ?? null
    const message =
      branch?.messages.find(
        candidate => candidate.role === 'assistant' && candidate.id === messageId,
      ) ?? null
    if (branch && message) {
      return { branchId: branch.id, message }
    }
  }

  if (!messageId) {
    return null
  }

  const matches = session.branches.flatMap(branch =>
    branch.messages
      .filter(message => message.role === 'assistant' && message.id === messageId)
      .map(message => ({
        branchId: branch.id,
        message,
      })),
  )

  if (matches.length === 1) {
    return matches[0] ?? null
  }

  return null
}

function findAssistantMessageByText(
  session: DeepSeekSession,
  assistantText: string | null,
): {
  branchId: string
  message: DeepSeekMessage
} | null {
  const normalizedTarget = normalizeText(assistantText)
  if (!normalizedTarget) {
    return null
  }

  const matches = session.branches.flatMap(branch =>
    branch.messages
      .filter(
        message =>
          message.role === 'assistant' && normalizeText(message.text) === normalizedTarget,
      )
      .map(message => ({
        branchId: branch.id,
        message,
      })),
  )

  return pickLatestAssistantMessage(matches)
}

function findLatestAssistantMessage(
  session: DeepSeekSession,
): {
  branchId: string
  message: DeepSeekMessage
} | null {
  const candidates = session.branches.flatMap(branch =>
    branch.messages
      .filter(message => message.role === 'assistant')
      .map(message => ({
        branchId: branch.id,
        message,
      })),
  )

  return pickLatestAssistantMessage(candidates)
}

function pickLatestAssistantMessage(
  candidates: Array<{
    branchId: string
    message: DeepSeekMessage
  }>,
): {
  branchId: string
  message: DeepSeekMessage
} | null {
  if (candidates.length === 0) {
    return null
  }

  return (
    [...candidates].sort(
      (left, right) =>
        new Date(right.message.createdAt).getTime() -
        new Date(left.message.createdAt).getTime(),
    )[0] ?? null
  )
}

function mapGenerationCitationsToDeepSeekCitations(
  citations: DeepSeekObservedGenerationRun['finalized']['citations'],
): DeepSeekCitation[] {
  return citations.map(citation => ({
    id: citation.id,
    title: citation.title,
    url: citation.url,
    ...(citation.snippet ? { snippet: citation.snippet } : {}),
  }))
}

function mapGenerationResponseReferencesToMessageResponseReferences(
  responseReferences: DeepSeekObservedGenerationRun['finalized']['responseReferences'],
): DeepSeekMessageResponseReference[] {
  return responseReferences.map(reference => ({
    referenceId: reference.referenceId,
    referenceType: reference.referenceType,
  }))
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}
