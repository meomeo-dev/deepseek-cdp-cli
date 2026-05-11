import { join, resolve } from 'node:path'
import type { DeepSeekFirstMessageResult } from '../../types/deepseek-first-message.types.js'
import type {
  DeepSeekFirstBatchSummary,
  DeepSeekMessage,
  DeepSeekSession,
  DeepSeekStoredSession,
} from '../../types/deepseek-session.types.js'
import type {
  OpenAIHttpEndpoint,
  OpenAIHttpStagedInputFile,
} from '../../types/openai-http-service.types.js'
import type {
  DeepSeekGenerationObservation,
  DeepSeekObservedGenerationRun,
} from '../../types/deepseek-generation.types.js'
import type { DeepSeekFileUploadBatchResult } from '../../types/deepseek-file.types.js'
import type { DeepSeekTranscriptRecovery } from '../../types/deepseek-transcript-recovery.types.js'
import { mapUploadedFilesToDeepSeekAttachments } from './deepSeekFileUploadSupport.js'
import {
  applyDeepSeekRecoveredExportProvenance,
  applyDeepSeekReplyExportProvenance,
  createDeepSeekExportProvenanceForFirstMessage,
} from '../../domain/session/sessionExportProvenance.js'
import {
  cloneDeepSeekBranch,
  cloneDeepSeekMessage,
  cloneDeepSeekMessageResponseReferences,
  mergeDeepSeekAttachments,
  mergeDeepSeekMessage,
} from '../../domain/session/sessionMessageArtifacts.js'
import { mapGenerationSearchesToDeepSeekMessageSearches } from './deepSeekSessionSearchMapping.js'
import {
  cloneDeepSeekChatModeFact,
  pickLatestDeepSeekChatModeFact,
  rebindDeepSeekChatModeFact,
} from '../../domain/deepseek/deepSeekChatModeFact.js'

const DEFAULT_SESSION_STORE_DIR = '.deepseek-cdp-cli/sessions'
const MAIN_BRANCH_ID = 'branch-main'
const SESSION_FILE_SUFFIX = '.json'

export interface CreateStoredSessionFromFirstMessageInput {
  prompt: string
  result: Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'>
  persistedAt?: string | undefined
}

export function resolveDeepSeekSessionStoreDir(
  sessionStoreDir = DEFAULT_SESSION_STORE_DIR,
  cwd = process.cwd(),
): string {
  return resolve(cwd, sessionStoreDir)
}

export function buildDeepSeekSessionFilePath(
  sessionId: string,
  sessionStoreDir?: string,
  cwd?: string,
): string {
  const normalizedSessionId = sanitizeFileSegment(sessionId)
  return join(
    resolveDeepSeekSessionStoreDir(sessionStoreDir, cwd),
    `${normalizedSessionId}${SESSION_FILE_SUFFIX}`,
  )
}

export function createStoredSessionFromFirstMessage(
  input: CreateStoredSessionFromFirstMessageInput,
): DeepSeekStoredSession {
  const persistedAt = input.persistedAt ?? new Date().toISOString()
  const assistantCreatedAt = new Date(new Date(persistedAt).getTime() + 1_000).toISOString()
  const branchId = resolveObservedFirstMessageBranchId(input.result.generationRuns)
  const userMessageId =
    selectLatestObservedGenerationContextValue(input.result.generationRuns, 'parentMessageId') ??
    `${input.result.sessionId}-user-1`
  const assistantMessageId =
    selectLatestObservedGenerationContextValue(input.result.generationRuns, 'assistantMessageId') ??
    `${input.result.sessionId}-assistant-1`
  const assistantText = buildAssistantText(input.result)
  const firstBatchSummary = buildFirstBatchSummary({
    userMessageId,
    assistantMessageId,
    prompt: input.prompt,
    assistantText,
    result: input.result,
  })
  const uploadedAttachments = mapUploadedFilesToDeepSeekAttachments(input.result.fileUpload)
  const observedAssistantArtifacts = buildObservedAssistantArtifacts(input.result.generationRuns)
  const storedModeFact = resolveStoredSessionModeFact(
    selectLatestObservedGenerationModeFact(input.result.generationRuns),
  )

  const userMessage: DeepSeekMessage = {
    id: userMessageId,
    role: 'user',
    text: input.prompt,
    createdAt: persistedAt,
    branchId,
    attachments: uploadedAttachments,
    citations: [],
  }
  const assistantMessage: DeepSeekMessage = {
    id: assistantMessageId,
    role: 'assistant',
    text: assistantText,
    createdAt: assistantCreatedAt,
    parentId: userMessageId,
    branchId,
    attachments: [],
    citations: observedAssistantArtifacts.citations,
    ...(observedAssistantArtifacts.responseReferences.length > 0
      ? { responseReferences: observedAssistantArtifacts.responseReferences }
      : {}),
    ...(observedAssistantArtifacts.searches.length > 0
      ? { searches: observedAssistantArtifacts.searches }
      : {}),
  }

  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: input.result.sessionId,
      agentId: input.result.agentId,
      title: inferSessionTitle(input.prompt),
      createdAt: persistedAt,
      ...(storedModeFact
        ? { modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined }
        : {}),
      branches: [
        {
          id: branchId,
          sessionId: input.result.sessionId,
          title: 'Main Branch',
          createdAt: persistedAt,
          messages: [userMessage, assistantMessage],
        },
      ],
    },
    metadata: {
      source: 'first-message',
      requestedUrl: input.result.requestedUrl,
      finalUrl: input.result.finalUrl,
      authoritativeAgentId: input.result.agentId,
      authoritativeSessionId: input.result.sessionId,
      sessionCreate: input.result.sessionCreate,
      generationObservations: input.result.generationObservations,
      outputTokensUsed: input.result.outputTokensUsed,
      settledAfterMs: input.result.settledAfterMs,
      firstBatchSummary,
      transcriptRecovery: input.result.transcriptRecovery ?? null,
      ...(storedModeFact
        ? { modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined }
        : {}),
      lastAssistantTextSource: input.result.assistantTextSource,
      exportProvenance: createDeepSeekExportProvenanceForFirstMessage({
        branchId,
        captureMode: firstBatchSummary.captureMode,
        assistantTextSource: input.result.assistantTextSource,
        persistedAt,
      }),
      lastKnownActiveBranchId: branchId,
      lastKnownActiveBranchSource: 'first-message',
      persistedAt,
    },
  }
}

export function applyOpenAIHistoryBootstrapMetadataToStoredSession(input: {
  storedSession: DeepSeekStoredSession
  requestId: string | null
  endpoint: OpenAIHttpEndpoint
  historyItemCount: number
  latestActionableUserTurnIndex: number
  latestTurnFileCount: number
  artifact: Pick<
    OpenAIHttpStagedInputFile,
    'source' | 'stageId' | 'stagedFilename' | 'byteSize'
  >
  importedAt?: string | undefined
}): DeepSeekStoredSession {
  if (input.artifact.source !== 'history-bootstrap-artifact') {
    throw new Error(
      'OpenAI history bootstrap provenance requires a staged bootstrap artifact source.',
    )
  }

  if (input.storedSession.metadata === null) {
    return input.storedSession
  }

  const importedAt = input.importedAt ?? new Date().toISOString()
  return {
    ...input.storedSession,
    metadata: {
      ...input.storedSession.metadata,
      openaiHistoryBootstrap: {
        source: 'openai-http',
        endpoint: input.endpoint,
        requestId: input.requestId,
        historyItemCount: input.historyItemCount,
        latestActionableUserTurnIndex: input.latestActionableUserTurnIndex,
        latestTurnFileCount: input.latestTurnFileCount,
        artifactStageId: input.artifact.stageId,
        artifactFilename: input.artifact.stagedFilename,
        artifactByteSize: input.artifact.byteSize,
        importedAt,
      },
      persistedAt: importedAt,
    },
  }
}

export function applyTranscriptRecoveryToStoredSession(input: {
  storedSession: DeepSeekStoredSession
  transcriptRecovery: DeepSeekTranscriptRecovery
  recoveredSession?: DeepSeekSession | undefined
  persistedAt?: string | undefined
}): DeepSeekStoredSession {
  const persistedAt = input.persistedAt ?? new Date().toISOString()
  const previousTranscriptRecovery = input.storedSession.metadata?.transcriptRecovery ?? null
  const nextSession = input.recoveredSession
    ? mergeDeepSeekSessions(
        stripFirstBatchPlaceholderMessages(input.storedSession),
        input.recoveredSession,
      )
    : input.storedSession.session
  const storedModeFact = resolveStoredSessionModeFact(
    pickLatestDeepSeekChatModeFact(
      input.storedSession.session.modeFact,
      input.storedSession.metadata?.modeFact,
      nextSession.modeFact,
    ),
  )

  return {
    ...input.storedSession,
    session: applyModeFactToSession(nextSession, storedModeFact),
    metadata: input.storedSession.metadata
        ? {
          ...input.storedSession.metadata,
          transcriptRecovery: resolveStoredTranscriptRecovery({
            previous: previousTranscriptRecovery,
            next: input.transcriptRecovery,
            recoveredSessionProvided: Boolean(input.recoveredSession),
          }),
          ...(storedModeFact
            ? { modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined }
            : {}),
          exportProvenance: input.recoveredSession
            ? applyDeepSeekRecoveredExportProvenance({
                previous: input.storedSession.metadata.exportProvenance,
                recoveredSession: input.recoveredSession,
                transcriptRecovery: input.transcriptRecovery,
                persistedAt,
              })
            : input.storedSession.metadata.exportProvenance,
          persistedAt,
        }
      : null,
  }
}

export function overlayLocalAttachmentMetadataOnRecoveredSession(input: {
  localSession: DeepSeekSession
  recoveredSession: DeepSeekSession
}): DeepSeekSession {
  const recovered = {
    ...input.recoveredSession,
    branches: input.recoveredSession.branches.map(branch => cloneDeepSeekBranch(branch)),
  }

  const localAttachmentMessages = input.localSession.branches.flatMap(branch =>
    branch.messages
      .filter(message => message.attachments.length > 0)
      .map(message => cloneDeepSeekMessage(message)),
  )

  for (const localMessage of localAttachmentMessages) {
    const branch = recovered.branches.find(candidate => candidate.id === localMessage.branchId)
    if (!branch) {
      continue
    }

    const sameRoleLocalAttachmentMessages = localAttachmentMessages.filter(message => {
      if (message.role !== localMessage.role) {
        return false
      }
      return message.branchId === localMessage.branchId
    })
    const recoveredMessage = findRecoveredAttachmentTarget(branch.messages, localMessage, {
      allowSingleCandidateFallback: sameRoleLocalAttachmentMessages.length === 1,
    })
    if (!recoveredMessage) {
      continue
    }

    recoveredMessage.attachments = mergeDeepSeekAttachments(
      localMessage.attachments,
      recoveredMessage.attachments,
    )
  }

  return recovered
}

export function appendReplyTurnToStoredSession(input: {
  storedSession: DeepSeekStoredSession
  prompt: string
  result: {
    finalUrl: string
    agentId: string
    sessionId: string
    generationObservations: DeepSeekGenerationObservation[]
    generationRuns: DeepSeekObservedGenerationRun[]
    fileUpload: DeepSeekFileUploadBatchResult | null
    assistantText: string | null
    assistantTextSource: 'generation-stream' | 'unavailable'
  }
  persistedAt?: string | undefined
}): DeepSeekStoredSession {
  const persistedAt = input.persistedAt ?? new Date().toISOString()
  const assistantCreatedAt = new Date(new Date(persistedAt).getTime() + 1).toISOString()
  const branchId = resolveReplyBranchId(input.storedSession.session, input.result.generationRuns)
  const existingBranch = input.storedSession.session.branches.find(branch => branch.id === branchId) ?? null
  const attachments = mapUploadedFilesToDeepSeekAttachments(input.result.fileUpload)
  const observedAssistantArtifacts = buildObservedAssistantArtifacts(input.result.generationRuns)
  const storedModeFact = resolveStoredSessionModeFact(
    pickLatestDeepSeekChatModeFact(
      input.storedSession.session.modeFact,
      input.storedSession.metadata?.modeFact,
      selectLatestObservedGenerationModeFact(input.result.generationRuns),
    ),
  )
  const userMessageId =
    selectLatestReplyRunContextValue(input.result.generationRuns, 'parentMessageId') ??
    buildSyntheticReplyMessageId(input.result.sessionId, 'user', persistedAt)
  const assistantMessageId =
    selectLatestReplyRunContextValue(input.result.generationRuns, 'assistantMessageId') ??
    buildSyntheticReplyMessageId(input.result.sessionId, 'assistant', assistantCreatedAt)
  const userParentId =
    existingBranch?.messages
      .slice()
      .sort(compareMessagesForMerge)
      .at(-1)?.id

  const overlaySession: DeepSeekSession = {
    id: input.result.sessionId,
    agentId: input.result.agentId,
    title: input.storedSession.session.title,
    createdAt: input.storedSession.session.createdAt,
    ...(storedModeFact
      ? { modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined }
      : {}),
    branches: [
      {
        id: branchId,
        sessionId: input.result.sessionId,
        title: existingBranch?.title ?? branchId,
        createdAt: existingBranch?.createdAt ?? persistedAt,
        sourceMessageId: existingBranch?.sourceMessageId,
        messages: [
          {
            id: userMessageId,
            role: 'user',
            text: input.prompt,
            createdAt: persistedAt,
            ...(userParentId && userParentId !== userMessageId ? { parentId: userParentId } : {}),
            branchId,
            attachments,
            citations: [],
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            text: buildReplyAssistantText(input.result),
            createdAt: assistantCreatedAt,
            parentId: userMessageId,
            branchId,
            attachments: [],
            citations: observedAssistantArtifacts.citations,
            ...(observedAssistantArtifacts.responseReferences.length > 0
              ? { responseReferences: observedAssistantArtifacts.responseReferences }
              : {}),
            ...(observedAssistantArtifacts.searches.length > 0
              ? { searches: observedAssistantArtifacts.searches }
              : {}),
          },
        ],
      },
    ],
  }

  return {
    ...input.storedSession,
    session: applyModeFactToSession(
      mergeDeepSeekSessions(input.storedSession.session, overlaySession),
      storedModeFact,
    ),
    metadata: input.storedSession.metadata
        ? {
          ...input.storedSession.metadata,
          finalUrl: input.result.finalUrl,
          authoritativeAgentId: input.result.agentId,
          authoritativeSessionId: input.result.sessionId,
          lastAssistantTextSource: input.result.assistantTextSource,
          ...(storedModeFact
            ? { modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined }
            : {}),
          exportProvenance: applyDeepSeekReplyExportProvenance({
            previous: input.storedSession.metadata.exportProvenance,
            branchId,
            assistantTextSource: input.result.assistantTextSource,
            persistedAt,
          }),
          lastKnownActiveBranchId: branchId,
          lastKnownActiveBranchSource: 'reply',
          persistedAt,
        }
      : null,
  }
}

function buildFirstBatchSummary(input: {
  userMessageId: string
  assistantMessageId: string
  prompt: string
  assistantText: string
  result: Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'>
}): DeepSeekFirstBatchSummary {
  const captureMode = input.result.assistantTextSource === 'generation-stream'
    ? 'generation-stream'
    : 'summary-only'
  return {
    captureMode,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    userPrompt: input.prompt,
    userPromptPreview: createPreview(input.prompt, 96),
    assistantSummary: createPreview(input.assistantText, 240),
    generationEndpoints: uniqueSortedEndpoints(input.result.generationObservations.map(
      observation => observation.endpoint,
    )),
    completionRequestObserved: input.result.completionRequestObserved,
  }
}

function buildAssistantText(
  result: Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'>,
): string {
  if (result.assistantText) {
    return result.assistantText
  }

  const endpoints = uniqueSortedEndpoints(
    result.generationObservations.map(observation => observation.endpoint),
  )

  if (endpoints.length === 0) {
    return 'Initial assistant response was submitted, but no generation response metadata was captured. Fetch history_messages for the canonical transcript.'
  }

  const endpointSummary = endpoints.join(', ')
  const outputTokenSummary =
    result.outputTokensUsed > 0
      ? `Observed output tokens: ${result.outputTokensUsed}.`
      : 'Observed output tokens were not reported by the generation responses.'

  return `Initial assistant response summary only. Generated through ${endpointSummary}. ${outputTokenSummary} Fetch history_messages for the canonical transcript.`
}

function inferSessionTitle(prompt: string): string {
  const preview = createPreview(prompt, 48)
  return preview || 'DeepSeek Session'
}

function createPreview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function uniqueSortedEndpoints(endpoints: string[]): string[] {
  return [...new Set(endpoints.filter(Boolean))].sort()
}

function sanitizeFileSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
  return normalized || 'session'
}

function mergeDeepSeekSessions(
  baseSession: DeepSeekSession,
  recoveredSession: DeepSeekSession,
): DeepSeekSession {
  if (baseSession.id !== recoveredSession.id) {
    throw new Error(
      `Cannot merge DeepSeek sessions with different ids: ${baseSession.id} vs ${recoveredSession.id}.`,
    )
  }

  if (baseSession.agentId !== recoveredSession.agentId) {
    throw new Error(
      `Cannot merge DeepSeek sessions with different agents: ${baseSession.agentId} vs ${recoveredSession.agentId}.`,
    )
  }

  const branchesById = new Map<string, DeepSeekSession['branches'][number]>()
  for (const branch of baseSession.branches) {
    branchesById.set(branch.id, cloneDeepSeekBranch(branch))
  }

  for (const branch of recoveredSession.branches) {
    const existingBranch = branchesById.get(branch.id)
    branchesById.set(
      branch.id,
      existingBranch ? mergeBranch(existingBranch, branch) : cloneDeepSeekBranch(branch),
    )
  }

  return {
    id: baseSession.id,
    agentId: baseSession.agentId,
    title: pickPreferredTitle(baseSession.title, recoveredSession.title, {
      placeholderValue: `DeepSeek Session ${baseSession.id}`,
    }),
    createdAt: pickEarlierTimestamp(baseSession.createdAt, recoveredSession.createdAt),
    ...(pickLatestDeepSeekChatModeFact(baseSession.modeFact, recoveredSession.modeFact)
      ? {
          modeFact:
            pickLatestDeepSeekChatModeFact(baseSession.modeFact, recoveredSession.modeFact) ??
            undefined,
        }
      : {}),
    branches: [...branchesById.values()].sort(compareBranchesForMerge),
  }
}

function stripFirstBatchPlaceholderMessages(storedSession: DeepSeekStoredSession): DeepSeekSession {
  if (storedSession.metadata?.transcriptRecovery?.status === 'recovered') {
    return storedSession.session
  }

  const userMessageId = storedSession.metadata?.firstBatchSummary.userMessageId
  const assistantMessageId = storedSession.metadata?.firstBatchSummary.assistantMessageId
  const placeholderSessionTitle = storedSession.metadata
    ? inferSessionTitle(storedSession.metadata.firstBatchSummary.userPrompt)
    : null
  if (!userMessageId && !assistantMessageId) {
    return storedSession.session
  }

  return {
    ...storedSession.session,
    title:
      placeholderSessionTitle && storedSession.session.title === placeholderSessionTitle
        ? `DeepSeek Session ${storedSession.session.id}`
        : storedSession.session.title,
    branches: storedSession.session.branches.map(branch => ({
      ...branch,
      messages: branch.messages
        .filter(message => message.id !== userMessageId && message.id !== assistantMessageId)
        .map(message => cloneDeepSeekMessage(message)),
    })),
  }
}

function mergeBranch(
  baseBranch: DeepSeekSession['branches'][number],
  recoveredBranch: DeepSeekSession['branches'][number],
): DeepSeekSession['branches'][number] {
  const messagesById = new Map<string, DeepSeekMessage>()
  for (const message of baseBranch.messages) {
    messagesById.set(message.id, cloneDeepSeekMessage(message))
  }

  for (const message of recoveredBranch.messages) {
    const existingMessage = messagesById.get(message.id)
    messagesById.set(
      message.id,
      existingMessage
        ? mergeDeepSeekMessage(existingMessage, message)
        : cloneDeepSeekMessage(message),
    )
  }

  return {
    ...cloneDeepSeekBranch(baseBranch),
    title: pickPreferredTitle(baseBranch.title, recoveredBranch.title, {
      placeholderValue: baseBranch.id,
      genericTitle: 'Main Branch',
    }),
    createdAt: pickEarlierTimestamp(baseBranch.createdAt, recoveredBranch.createdAt),
    sourceMessageId: recoveredBranch.sourceMessageId ?? baseBranch.sourceMessageId,
    messages: [...messagesById.values()].sort(compareMessagesForMerge),
  }
}

function compareBranchesForMerge(
  left: DeepSeekSession['branches'][number],
  right: DeepSeekSession['branches'][number],
): number {
  if (left.id === MAIN_BRANCH_ID && right.id !== MAIN_BRANCH_ID) {
    return -1
  }

  if (right.id === MAIN_BRANCH_ID && left.id !== MAIN_BRANCH_ID) {
    return 1
  }

  const createdAtDiff = compareIsoTimestamps(left.createdAt, right.createdAt)
  if (createdAtDiff !== 0) {
    return createdAtDiff
  }

  return left.id.localeCompare(right.id)
}

function compareMessagesForMerge(left: DeepSeekMessage, right: DeepSeekMessage): number {
  const leftOrdinal = parseMessageOrdinal(left.id)
  const rightOrdinal = parseMessageOrdinal(right.id)
  if (leftOrdinal !== null && rightOrdinal !== null && leftOrdinal !== rightOrdinal) {
    return leftOrdinal - rightOrdinal
  }

  const createdAtDiff = compareIsoTimestamps(left.createdAt, right.createdAt)
  if (createdAtDiff !== 0) {
    return createdAtDiff
  }

  return left.id.localeCompare(right.id)
}

function parseMessageOrdinal(value: string): number | null {
  if (/^\d+$/u.test(value)) {
    return Number(value)
  }

  const match = /(?:^|[-_])(?:user|assistant)-(\d+)$/iu.exec(value)
  if (!match?.[1]) {
    return null
  }

  const turn = Number(match[1])
  if (!Number.isFinite(turn)) {
    return null
  }

  return value.toLowerCase().includes('assistant') ? turn * 2 : turn * 2 - 1
}

function compareIsoTimestamps(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime()
}

function pickEarlierTimestamp(left: string, right: string): string {
  if (!left.trim()) {
    return right
  }

  if (!right.trim()) {
    return left
  }

  return compareIsoTimestamps(left, right) <= 0 ? left : right
}

function pickPreferredTitle(
  currentTitle: string,
  incomingTitle: string,
  input: {
    placeholderValue?: string | undefined
    genericTitle?: string | undefined
  } = {},
): string {
  const current = currentTitle.trim()
  const incoming = incomingTitle.trim()

  if (!current) {
    return incoming
  }

  if (!incoming) {
    return current
  }

  const currentIsPlaceholder = isPlaceholderTitle(current, input)
  const incomingIsPlaceholder = isPlaceholderTitle(incoming, input)
  if (currentIsPlaceholder && !incomingIsPlaceholder) {
    return incoming
  }

  if (!currentIsPlaceholder && incomingIsPlaceholder) {
    return current
  }

  return current
}

function isPlaceholderTitle(
  value: string,
  input: {
    placeholderValue?: string | undefined
    genericTitle?: string | undefined
  },
): boolean {
  const normalized = value.trim()
  if (!normalized) {
    return true
  }

  if (input.placeholderValue && normalized === input.placeholderValue) {
    return true
  }

  if (input.genericTitle && normalized === input.genericTitle) {
    return true
  }

  return /^DeepSeek Session\b/i.test(normalized)
}

function findRecoveredAttachmentTarget(
  messages: DeepSeekMessage[],
  localMessage: DeepSeekMessage,
  options: {
    allowSingleCandidateFallback: boolean
  },
): DeepSeekMessage | null {
  const exact = messages.find(message => message.id === localMessage.id) ?? null
  if (exact) {
    return exact
  }

  const localText = normalizeMessageComparisonText(localMessage.text)
  if (localText) {
    const textMatch = messages.find(message => {
      if (message.role !== localMessage.role) {
        return false
      }
      if (message.branchId !== localMessage.branchId) {
        return false
      }
      return normalizeMessageComparisonText(message.text) === localText
    }) ?? null
    if (textMatch) {
      return textMatch
    }
  }

  if (!options.allowSingleCandidateFallback) {
    return null
  }

  const sameRoleCandidates = messages.filter(message => {
    if (message.role !== localMessage.role) {
      return false
    }
    if (message.branchId !== localMessage.branchId) {
      return false
    }
    return message.attachments.length === 0
  })

  return sameRoleCandidates.length === 1 ? sameRoleCandidates[0] ?? null : null
}

function normalizeMessageComparisonText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function resolveStoredTranscriptRecovery(input: {
  previous: DeepSeekTranscriptRecovery | null
  next: DeepSeekTranscriptRecovery
  recoveredSessionProvided: boolean
}): DeepSeekTranscriptRecovery {
  if (
    input.recoveredSessionProvided ||
    input.next.status === 'recovered' ||
    input.previous === null ||
    input.previous.status !== 'recovered'
  ) {
    return input.next
  }

  return input.previous
}

function resolveReplyBranchId(
  session: DeepSeekSession,
  generationRuns: DeepSeekObservedGenerationRun[],
): string {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const branchId = generationRuns[index]?.context.branchId?.trim()
    if (branchId) {
      return branchId
    }
  }

  if (session.branches.some(branch => branch.id === MAIN_BRANCH_ID)) {
    return MAIN_BRANCH_ID
  }

  return session.branches[0]?.id ?? MAIN_BRANCH_ID
}

function resolveObservedFirstMessageBranchId(
  generationRuns: DeepSeekObservedGenerationRun[],
): string {
  return selectLatestObservedGenerationContextValue(generationRuns, 'branchId') ?? MAIN_BRANCH_ID
}

function selectLatestReplyRunContextValue(
  generationRuns: DeepSeekObservedGenerationRun[],
  key: 'parentMessageId' | 'assistantMessageId',
): string | null {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const value = generationRuns[index]?.context[key]?.trim()
    if (value) {
      return value
    }
  }

  return null
}

function selectLatestObservedGenerationContextValue(
  generationRuns: DeepSeekObservedGenerationRun[],
  key: 'parentMessageId' | 'assistantMessageId' | 'branchId',
): string | null {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const value = generationRuns[index]?.context[key]?.trim()
    if (value) {
      return value
    }
  }

  return null
}

function buildSyntheticReplyMessageId(
  sessionId: string,
  role: 'user' | 'assistant',
  timestamp: string,
): string {
  return `${sessionId}-${role}-${new Date(timestamp).getTime()}`
}

function buildReplyAssistantText(input: {
  generationObservations: DeepSeekGenerationObservation[]
  outputTokensUsed?: number | undefined
  assistantText: string | null
  assistantTextSource: 'generation-stream' | 'unavailable'
}): string {
  if (input.assistantTextSource === 'generation-stream' && input.assistantText?.trim()) {
    return input.assistantText
  }

  const endpoints = uniqueSortedEndpoints(input.generationObservations.map(
    observation => observation.endpoint,
  ))
  if (endpoints.length === 0) {
    return 'Assistant response was submitted, but no generation response metadata was captured. Fetch history_messages for the canonical transcript.'
  }

  const outputTokenSummary =
    typeof input.outputTokensUsed === 'number' && input.outputTokensUsed > 0
      ? `Observed output tokens: ${input.outputTokensUsed}.`
      : 'Observed output tokens were not reported by the generation responses.'

  return `Assistant response summary only. Generated through ${endpoints.join(', ')}. ${outputTokenSummary} Fetch history_messages for the canonical transcript.`
}

function buildObservedAssistantArtifacts(
  generationRuns: DeepSeekObservedGenerationRun[],
): {
  citations: DeepSeekMessage['citations']
  responseReferences: NonNullable<DeepSeekMessage['responseReferences']>
  searches: NonNullable<DeepSeekMessage['searches']>
} {
  const preferredRun = selectPreferredObservedGenerationRun(generationRuns)
  if (!preferredRun) {
    return {
      citations: [],
      responseReferences: [],
      searches: [],
    }
  }

  return {
    citations: preferredRun.finalized.citations.map(citation => ({
      id: citation.id,
      title: citation.title,
      url: citation.url,
      ...(citation.snippet ? { snippet: citation.snippet } : {}),
    })),
    responseReferences: cloneDeepSeekMessageResponseReferences(
      preferredRun.finalized.responseReferences,
    ),
    searches: mapGenerationSearchesToDeepSeekMessageSearches(preferredRun.finalized.searches),
  }
}

function selectLatestObservedGenerationModeFact(
  generationRuns: DeepSeekObservedGenerationRun[],
) {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const fact = generationRuns[index]?.context.modeFact
    if (fact) {
      return fact
    }
  }

  return null
}

function resolveStoredSessionModeFact(
  fact: DeepSeekSession['modeFact'] | null | undefined,
) {
  return rebindDeepSeekChatModeFact({
    fact,
    sourceLayer: 'stored-session',
  })
}

function applyModeFactToSession(
  session: DeepSeekSession,
  modeFact: DeepSeekSession['modeFact'] | null | undefined,
): DeepSeekSession {
  if (!modeFact) {
    return session
  }

  return {
    ...session,
    modeFact: cloneDeepSeekChatModeFact(modeFact) ?? undefined,
  }
}

function selectPreferredObservedGenerationRun(
  generationRuns: DeepSeekObservedGenerationRun[],
): DeepSeekObservedGenerationRun | null {
  return (
    generationRuns.findLast(run => run.finalized.status !== 'failed') ??
    generationRuns.at(-1) ??
    null
  )
}
