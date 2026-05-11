import type { DeepSeekMaterializedRegenerateBranchResult } from '../../types/deepseek-regenerate-message.types.js'
import type {
  DeepSeekBranch,
  DeepSeekMessage,
  DeepSeekSession,
  DeepSeekStoredSession,
} from '../../types/deepseek-session.types.js'
import { cloneDeepSeekMessage } from './sessionMessageArtifacts.js'

export interface MaterializeDeepSeekRegeneratedBranchInput {
  storedSession: DeepSeekStoredSession
  sourceBranchId: string
  sourceAssistantMessageId: string
  sourceParentMessageId: string
  regeneratedAssistantMessageId: string | null
  assistantText: string | null
  recoveredSession?: DeepSeekSession | undefined
  persistedAt?: string | undefined
}

export function materializeDeepSeekRegeneratedBranch(
  input: MaterializeDeepSeekRegeneratedBranchInput,
): DeepSeekMaterializedRegenerateBranchResult {
  const parentBranch = resolveSourceBranch(input.storedSession.session, input.sourceBranchId)
  const sortedParentMessages = [...parentBranch.messages].sort(compareMessagesByCreatedAt)
  const sourceAssistantIndex = sortedParentMessages.findIndex(
    message => message.id === input.sourceAssistantMessageId,
  )
  if (sourceAssistantIndex < 0) {
    throw new Error(
      `Source assistant message ${input.sourceAssistantMessageId} was not found in branch ${input.sourceBranchId}.`,
    )
  }

  const sourceAssistantMessage = sortedParentMessages[sourceAssistantIndex]!
  if (sourceAssistantMessage.role !== 'assistant') {
    throw new Error(
      `Message ${input.sourceAssistantMessageId} is not an assistant message and cannot be regenerated.`,
    )
  }

  const sourceParentMessage =
    sortedParentMessages.find(message => message.id === input.sourceParentMessageId) ?? null
  if (!sourceParentMessage) {
    throw new Error(
      `Source parent message ${input.sourceParentMessageId} was not found in branch ${input.sourceBranchId}.`,
    )
  }

  const prefixMessages = ensureRegenerateParentMessageInPrefix({
    prefixMessages: sortedParentMessages
      .slice(0, sourceAssistantIndex)
      .map(message => cloneMessage(message)),
    sourceParentMessage,
  })
  const subtree = selectRegeneratedSubtreeMessages({
    parentBranch,
    sourceParentMessage,
    regeneratedAssistantMessageId: input.regeneratedAssistantMessageId,
    assistantText: input.assistantText,
    recoveredSession: input.recoveredSession,
    persistedAt: input.persistedAt,
  })
  const branchId = resolveSyntheticRegeneratedBranchId({
    existingSession: input.storedSession.session,
    sourceAssistantMessageId: input.sourceAssistantMessageId,
    subtreeMessages: subtree.messages,
  })
  const branchMessages = reassignBranchId(
    dedupeMessagesById([...prefixMessages, ...subtree.messages]),
    branchId,
  )
  const existingBranch = input.storedSession.session.branches.find(branch => branch.id === branchId) ?? null
  const branch: DeepSeekBranch = {
    id: branchId,
    sessionId: input.storedSession.session.id,
    title: inferBranchTitleFromParent(sourceParentMessage, branchId),
    createdAt: branchMessages[0]?.createdAt ?? input.persistedAt ?? new Date().toISOString(),
    sourceMessageId: input.sourceAssistantMessageId,
    messages: branchMessages,
  }

  return {
    session: upsertBranchIntoSession(input.storedSession.session, branch),
    branch,
    materialization: {
      kind: 'regenerate',
      sourceBranchId: input.sourceBranchId,
      sourceAssistantMessageId: input.sourceAssistantMessageId,
      sourceParentMessageId: input.sourceParentMessageId,
      materializedBranchId: branchId,
      materializedBranchCreated: existingBranch === null,
      regeneratedAssistantMessageId: input.regeneratedAssistantMessageId,
      prefixMessageIds: prefixMessages.map(message => message.id),
      materializedMessageIds: branchMessages.map(message => message.id),
      transcriptShape: subtree.transcriptShape,
    },
  }
}

function ensureRegenerateParentMessageInPrefix(input: {
  prefixMessages: DeepSeekMessage[]
  sourceParentMessage: DeepSeekMessage
}): DeepSeekMessage[] {
  if (input.prefixMessages.some(message => message.id === input.sourceParentMessage.id)) {
    return input.prefixMessages
  }

  return [...input.prefixMessages, cloneMessage(input.sourceParentMessage)]
}

function selectRegeneratedSubtreeMessages(input: {
  parentBranch: DeepSeekBranch
  sourceParentMessage: DeepSeekMessage
  regeneratedAssistantMessageId: string | null
  assistantText: string | null
  recoveredSession?: DeepSeekSession | undefined
  persistedAt?: string | undefined
}): {
  transcriptShape: DeepSeekMaterializedRegenerateBranchResult['materialization']['transcriptShape']
  messages: DeepSeekMessage[]
} {
  if (input.recoveredSession) {
    const recoveredBranch = selectRecoveredActiveBranch({
      session: input.recoveredSession,
      regeneratedAssistantMessageId: input.regeneratedAssistantMessageId,
      sourceParentMessageId: input.sourceParentMessage.id,
    })
    const recoveredMessages = [...recoveredBranch.messages].sort(compareMessagesByCreatedAt)
    const parentMessageIds = new Set(input.parentBranch.messages.map(message => message.id))
    const newlyObservedMessages = recoveredMessages.filter(message => !parentMessageIds.has(message.id))
    if (newlyObservedMessages.length > 0) {
      return {
        transcriptShape: 'history-recovered',
        messages: newlyObservedMessages.map(message => cloneMessage(message)),
      }
    }

    if (
      input.regeneratedAssistantMessageId &&
      recoveredMessages.some(message => message.id === input.regeneratedAssistantMessageId)
    ) {
      const regeneratedAssistant = recoveredMessages.find(
        message => message.id === input.regeneratedAssistantMessageId,
      )!
      return {
        transcriptShape: 'active-view-assistant-only',
        messages: [cloneMessage(regeneratedAssistant)],
      }
    }
  }

  return {
    transcriptShape: 'synthetic-fallback',
    messages: buildSyntheticRegeneratedSubtree({
      parentMessageId: input.sourceParentMessage.id,
      sessionId: input.parentBranch.sessionId,
      regeneratedAssistantMessageId: input.regeneratedAssistantMessageId,
      assistantText: input.assistantText,
      persistedAt: input.persistedAt,
    }),
  }
}

function buildSyntheticRegeneratedSubtree(input: {
  parentMessageId: string
  sessionId: string
  regeneratedAssistantMessageId: string | null
  assistantText: string | null
  persistedAt?: string | undefined
}): DeepSeekMessage[] {
  const persistedAt = input.persistedAt ?? new Date().toISOString()
  const regeneratedAssistantMessageId =
    input.regeneratedAssistantMessageId ??
    `${input.sessionId}-regenerate-assistant-${new Date(persistedAt).getTime()}`

  return [
    {
      id: regeneratedAssistantMessageId,
      role: 'assistant',
      text: input.assistantText ?? '',
      createdAt: persistedAt,
      parentId: input.parentMessageId,
      branchId: 'branch-pending-regenerate',
      attachments: [],
      citations: [],
    },
  ]
}

function selectRecoveredActiveBranch(input: {
  session: DeepSeekSession
  regeneratedAssistantMessageId: string | null
  sourceParentMessageId: string
}): DeepSeekBranch {
  const branchContainingAssistant =
    input.regeneratedAssistantMessageId
      ? input.session.branches.find(branch =>
          branch.messages.some(message => message.id === input.regeneratedAssistantMessageId),
        ) ?? null
      : null
  if (branchContainingAssistant) {
    return branchContainingAssistant
  }

  const branchContainingParent =
    input.session.branches.find(branch =>
      branch.messages.some(message => message.id === input.sourceParentMessageId),
    ) ?? null
  if (branchContainingParent) {
    return branchContainingParent
  }

  return [...input.session.branches].sort(compareBranchesByLatestActivity).at(-1) ?? input.session.branches[0]!
}

function resolveSyntheticRegeneratedBranchId(input: {
  existingSession: DeepSeekSession
  sourceAssistantMessageId: string
  subtreeMessages: DeepSeekMessage[]
}): string {
  const branchLeadMessageId = input.subtreeMessages[0]?.id ?? 'unknown'
  const baseId = sanitizeBranchId(
    `branch-regenerate-${input.sourceAssistantMessageId}-${branchLeadMessageId}`,
  )
  if (!input.existingSession.branches.some(branch => branch.id === baseId)) {
    return baseId
  }

  let suffix = 2
  while (input.existingSession.branches.some(branch => branch.id === `${baseId}-${suffix}`)) {
    suffix += 1
  }

  return `${baseId}-${suffix}`
}

function upsertBranchIntoSession(session: DeepSeekSession, branch: DeepSeekBranch): DeepSeekSession {
  const branches = [...session.branches]
  const existingIndex = branches.findIndex(candidate => candidate.id === branch.id)
  if (existingIndex >= 0) {
    branches.splice(existingIndex, 1, mergeBranch(branches[existingIndex]!, branch))
  } else {
    branches.push(cloneBranch(branch))
  }

  return {
    ...session,
    branches: branches.sort(compareBranchesByLatestActivity),
  }
}

function mergeBranch(current: DeepSeekBranch, incoming: DeepSeekBranch): DeepSeekBranch {
  const messagesById = new Map<string, DeepSeekMessage>()
  for (const message of current.messages) {
    messagesById.set(message.id, cloneMessage(message))
  }
  for (const message of incoming.messages) {
    messagesById.set(message.id, cloneMessage(message))
  }

  return {
    ...cloneBranch(current),
    title: incoming.title,
    createdAt:
      compareMessagesTimestamp(current.createdAt, incoming.createdAt) <= 0
        ? current.createdAt
        : incoming.createdAt,
    sourceMessageId: incoming.sourceMessageId ?? current.sourceMessageId,
    messages: [...messagesById.values()].sort(compareMessagesByCreatedAt),
  }
}

function reassignBranchId(messages: DeepSeekMessage[], branchId: string): DeepSeekMessage[] {
  return messages.map(message => ({
    ...cloneMessage(message),
    branchId,
  }))
}

function dedupeMessagesById(messages: DeepSeekMessage[]): DeepSeekMessage[] {
  const messagesById = new Map<string, DeepSeekMessage>()
  for (const message of messages) {
    messagesById.set(message.id, cloneMessage(message))
  }
  return [...messagesById.values()].sort(compareMessagesByCreatedAt)
}

function resolveSourceBranch(session: DeepSeekSession, branchId: string): DeepSeekBranch {
  const branch = session.branches.find(candidate => candidate.id === branchId) ?? null
  if (!branch) {
    throw new Error(`Branch not found in session: ${branchId}.`)
  }

  return branch
}

function inferBranchTitleFromParent(sourceParentMessage: DeepSeekMessage, fallbackBranchId: string): string {
  const normalized = sourceParentMessage.text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return fallbackBranchId
  }

  return normalized.length <= 40 ? normalized : `${normalized.slice(0, 39).trimEnd()}…`
}

function compareBranchesByLatestActivity(left: DeepSeekBranch, right: DeepSeekBranch): number {
  const leftLatest = [...left.messages].sort(compareMessagesByCreatedAt).at(-1)?.createdAt ?? left.createdAt
  const rightLatest = [...right.messages].sort(compareMessagesByCreatedAt).at(-1)?.createdAt ?? right.createdAt
  return compareMessagesTimestamp(leftLatest, rightLatest)
}

function compareMessagesByCreatedAt(left: DeepSeekMessage, right: DeepSeekMessage): number {
  const timestampDiff = compareMessagesTimestamp(left.createdAt, right.createdAt)
  if (timestampDiff !== 0) {
    return timestampDiff
  }

  return left.id.localeCompare(right.id)
}

function compareMessagesTimestamp(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime()
}

function sanitizeBranchId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function cloneBranch(branch: DeepSeekBranch): DeepSeekBranch {
  return {
    ...branch,
    messages: branch.messages.map(message => cloneMessage(message)),
  }
}

function cloneMessage(message: DeepSeekMessage): DeepSeekMessage {
  return cloneDeepSeekMessage(message)
}
