import {
  adaptDeepSeekCompletedToOpenAIResponse,
  adaptDeepSeekGenerationEventsToOpenAIResponsesStream,
} from '../../infrastructure/deepseek/openaiResponsesAdapter.js'
import {
  adaptDeepSeekCompletedToOpenAIChatCompletion,
  adaptDeepSeekGenerationEventsToOpenAIChatCompletionsStream,
} from '../../infrastructure/deepseek/openaiChatCompletionsAdapter.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type {
  DeepSeekBufferedReplyOutput,
  DeepSeekReplyOutputSummary,
  DeepSeekStreamingReplyOutputChunk,
} from '../../types/deepseek-reply-output.types.js'
import { resolveDeepSeekOutputMode } from '../../infrastructure/deepseek/deepSeekOutputModes.js'
import {
  attachDeepSeekReplyRateLimitMetadata,
  buildDeepSeekRateLimitTextNotice,
  resolveDeepSeekReplyRateLimitMetadata,
} from '../../domain/search/deepSeekSearchRateLimitOutput.js'
import {
  buildDeepSeekReplyArtifactsTextAppendix,
  resolveDeepSeekReplyAssistantArtifacts,
  selectPreferredDeepSeekGenerationRun,
} from './deepSeekReplyArtifacts.js'

interface OpenAIAdapterOptions {
  model?: string
  responseId?: string
  instructions?: string | null
  previousResponseId?: string | null
  store?: boolean
  metadata?: Record<string, string>
  includeUsage?: boolean
}

export function buildDeepSeekBufferedReplyOutput(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  openAIAdapterOptions?: OpenAIAdapterOptions | undefined
  includeCitations?: boolean | undefined
}): DeepSeekBufferedReplyOutput {
  if (input.outputMode.outputFamily === 'text') {
    return {
      format: 'text',
      text: buildBufferedTextOutput(
        input.result,
        undefined,
        input.includeCitations !== false,
      ),
    }
  }

  if (input.outputMode.jsonShape === 'native') {
    return {
      format: 'json',
      jsonShape: 'native',
      data: attachDeepSeekReplyRateLimitMetadata(input.result),
    }
  }

  const run = selectPreferredDeepSeekGenerationRun(input.result)
  if (!run) {
    throw new Error('Reply JSON output requires at least one authoritative DeepSeek generation run.')
  }
  if (input.outputMode.jsonShape === 'openai-responses') {
    return {
      format: 'json',
      jsonShape: 'openai-responses',
      data: adaptDeepSeekCompletedToOpenAIResponse({
        context: run.context,
        result: run.finalized,
        ...(input.openAIAdapterOptions ? { options: input.openAIAdapterOptions } : {}),
      }),
    }
  }

  return {
    format: 'json',
    jsonShape: 'openai-chat-completions',
    data: adaptDeepSeekCompletedToOpenAIChatCompletion({
      context: run.context,
      result: run.finalized,
      ...(input.openAIAdapterOptions ? { options: input.openAIAdapterOptions } : {}),
    }),
  }
}

export function buildDeepSeekStreamingReplyOutputChunks(input: {
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  openAIAdapterOptions?: OpenAIAdapterOptions | undefined
  includeCitations?: boolean | undefined
}): DeepSeekStreamingReplyOutputChunk[] {
  if (input.outputMode.transport !== 'streaming') {
    throw new Error('Streaming reply output chunks require `stream=true`.')
  }

  if (input.outputMode.outputFamily === 'text') {
    return buildTextStreamingReplyOutputChunks(
      input.result,
      input.includeCitations !== false,
    )
  }

  return buildJsonStreamingReplyOutputChunks(
    input.result,
    input.outputMode,
    input.openAIAdapterOptions,
  )
}

export function summarizeDeepSeekReplyOutput(result: DeepSeekReplyResult): DeepSeekReplyOutputSummary {
  const assistantArtifacts = resolveDeepSeekReplyAssistantArtifacts(result)
  return {
    entryMode: result.entryMode,
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    agentId: result.agentId,
    sessionId: result.sessionId,
    sessionFile: result.sessionFile,
    assistantText: result.assistantText,
    assistantTextSource: result.assistantTextSource,
    outputTokensUsed: result.outputTokensUsed,
    settledAfterMs: result.settledAfterMs,
    budget: result.budget,
    requestedComposerMode: result.requestedComposerMode,
    ...(result.effectiveComposerMode ? { effectiveComposerMode: result.effectiveComposerMode } : {}),
    ...(result.ignoredComposerToggles ? { ignoredComposerToggles: result.ignoredComposerToggles } : {}),
    composerMode: result.composerMode,
    fileUpload: result.fileUpload,
    rateLimit: resolveDeepSeekReplyRateLimitMetadata(result),
    retry: result.retry ?? null,
    transcriptRecovery: result.transcriptRecovery,
    assistantArtifacts: {
      source: assistantArtifacts.source,
      branchId: assistantArtifacts.branchId,
      messageId: assistantArtifacts.messageId,
      inlineReferenceTokens: [...assistantArtifacts.inlineReferenceTokens],
      inlineCitationObservations: assistantArtifacts.inlineCitationObservations.map(observation => ({
        token: observation.token,
        kind: observation.kind,
        verificationStatus: observation.verificationStatus,
        resolution: observation.resolution,
        ...(observation.ordinal !== undefined ? { ordinal: observation.ordinal } : {}),
        ...(observation.responseReference
          ? {
              responseReference: {
                referenceId: observation.responseReference.referenceId,
                referenceType: observation.responseReference.referenceType,
              },
            }
          : {}),
      })),
      citationCount: assistantArtifacts.citations.length,
      searchCount: assistantArtifacts.searches.length,
      citations: assistantArtifacts.citations.map(citation => ({ ...citation })),
      responseReferences: assistantArtifacts.responseReferences.map(reference => ({
        referenceId: reference.referenceId,
        referenceType: reference.referenceType,
      })),
      searches: assistantArtifacts.searches.map(search => ({
        query: search.query,
        status: search.status,
        results: search.results.map(result => ({
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
                responseReferences: result.responseReferences.map(reference => ({
                  referenceId: reference.referenceId,
                  referenceType: reference.referenceType,
                  resolution: reference.resolution,
                  ...(reference.toolSearchFragmentId !== undefined
                    ? { toolSearchFragmentId: reference.toolSearchFragmentId }
                    : {}),
                  ...(reference.toolOpenFragmentId !== undefined
                    ? { toolOpenFragmentId: reference.toolOpenFragmentId }
                    : {}),
                })),
              }
            : {}),
        })),
      })),
    },
  }
}

export function toBufferedDeepSeekReplyOutputMode(
  outputMode: DeepSeekResolvedOutputMode,
): DeepSeekResolvedOutputMode {
  if (outputMode.transport === 'buffered') {
    return outputMode
  }

  return resolveDeepSeekOutputMode({
    stream: false,
    format: outputMode.outputFamily === 'text' ? 'text' : 'json',
    ...(outputMode.jsonShape ? { jsonShape: outputMode.jsonShape } : {}),
  })
}

function buildTextStreamingReplyOutputChunks(
  result: DeepSeekReplyResult,
  includeCitations: boolean,
): DeepSeekStreamingReplyOutputChunk[] {
  const canonicalRuns = getCanonicalRuns(result)
  const deltas = canonicalRuns.flatMap(run =>
    run.events
      .filter(event => event.kind === 'text.delta')
      .map(event => event.delta),
  )

  if (deltas.length > 0) {
    const textChunks: DeepSeekStreamingReplyOutputChunk[] = deltas.map(delta => ({
      format: 'text',
      delta,
    }))
    const appendix = includeCitations
      ? buildDeepSeekReplyArtifactsTextAppendix(
          resolveDeepSeekReplyAssistantArtifacts(result),
        )
      : ''
    if (appendix) {
      textChunks.push({
        format: 'text',
        delta: `\n\n${appendix}`,
      })
    }
    const rateLimit = resolveDeepSeekReplyRateLimitMetadata(result)
    if (rateLimit) {
      textChunks.push({
        format: 'text',
        delta: `\n\n${buildDeepSeekRateLimitTextNotice(rateLimit)}`,
      })
    }
    return textChunks
  }

  const finalizedText =
    canonicalRuns.at(-1)?.finalized.outputText ?? result.output.finalizedAssistantText
  return [
    {
      format: 'text',
      delta: buildBufferedTextOutput(
        result,
        finalizedText,
        includeCitations,
      ),
    },
  ]
}

function buildJsonStreamingReplyOutputChunks(
  result: DeepSeekReplyResult,
  outputMode: DeepSeekResolvedOutputMode,
  openAIAdapterOptions?: OpenAIAdapterOptions,
): DeepSeekStreamingReplyOutputChunk[] {
  const canonicalRuns = getCanonicalRuns(result)
  const events = canonicalRuns.flatMap(run => run.events)
  const context = canonicalRuns.at(-1)?.context ?? null
  if (!context) {
    throw new Error('Canonical generation stream did not expose a final run context.')
  }

  if (outputMode.jsonShape === 'native') {
    const chunks: DeepSeekStreamingReplyOutputChunk[] = events.map(event => ({
      format: 'stream-json',
      jsonShape: 'native',
      data: event,
    }))
    const rateLimit = resolveDeepSeekReplyRateLimitMetadata(result)
    if (rateLimit) {
      chunks.push({
        format: 'stream-json',
        jsonShape: 'native',
        data: {
          kind: 'reply.rate_limit',
          rateLimit,
        },
      })
    }
    return chunks
  }

  if (outputMode.jsonShape === 'openai-responses') {
    return adaptDeepSeekGenerationEventsToOpenAIResponsesStream({
      context,
      events,
      ...(openAIAdapterOptions ? { options: openAIAdapterOptions } : {}),
    }).map(event => ({
      format: 'stream-json',
      jsonShape: 'openai-responses',
      data: event,
    }))
  }

  return adaptDeepSeekGenerationEventsToOpenAIChatCompletionsStream({
    context,
    events,
    ...(openAIAdapterOptions ? { options: openAIAdapterOptions } : {}),
  }).map(chunk => ({
    format: 'stream-json',
    jsonShape: 'openai-chat-completions',
    data: chunk,
  }))
}

function getCanonicalRuns(result: DeepSeekReplyResult) {
  if (result.output.mode !== 'stream' || result.output.canonicalRuns.length === 0) {
    throw new Error('Streaming reply output requires canonical generation runs, but none were captured.')
  }

  return result.output.canonicalRuns
}

function buildBufferedTextOutput(
  result: DeepSeekReplyResult,
  fallbackText?: string | null,
  includeCitations = true,
): string {
  const baseText = (result.assistantText ?? fallbackText ?? '').trim()
  const artifactsAppendix = includeCitations
    ? buildDeepSeekReplyArtifactsTextAppendix(
        resolveDeepSeekReplyAssistantArtifacts(result),
      )
    : ''
  const rateLimit = resolveDeepSeekReplyRateLimitMetadata(result)
  const sections = [baseText, artifactsAppendix].filter(section => section.trim())

  if (rateLimit) {
    const notice = buildDeepSeekRateLimitTextNotice(rateLimit)
    const retryNote =
      result.retry && result.retry.policy.onRateLimit
        ? `Automatic retries: ${result.retry.retriedAttempts}/${result.retry.policy.maxRetries} used`
        : null
    sections.push(retryNote ? `${notice}\n${retryNote}` : notice)
  }

  return sections.join('\n\n').trim()
}
