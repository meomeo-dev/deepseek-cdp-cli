import type {
  DeepSeekMaterializedEditBranchResult,
} from '../../types/deepseek-edit-message.types.js'
import type {
  DeepSeekBranch,
  DeepSeekMessage,
  DeepSeekSession,
  DeepSeekStoredSession,
} from '../../types/deepseek-session.types.js'
import {
  cloneDeepSeekMessage,
  mergeDeepSeekAttachments,
} from './sessionMessageArtifacts.js'

export interface MaterializeDeepSeekEditedBranchInput {
  storedSession: DeepSeekStoredSession
  sourceBranchId: string
  sourceMessageId: string
  replacementMessageId: string | null
  assistantMessageId: string | null
  replacementPrompt: string
  assistantText: string | null
  recoveredSession?: DeepSeekSession | undefined
  persistedAt?: string | undefined
}

export function materializeDeepSeekEditedBranch(
  input: MaterializeDeepSeekEditedBranchInput,
): DeepSeekMaterializedEditBranchResult {
  const parentBranch = resolveSourceBranch(input.storedSession.session, input.sourceBranchId)
  const sortedParentMessages = [...parentBranch.messages].sort(compareMessagesByCreatedAt)
  const sourceMessageIndex = sortedParentMessages.findIndex(message => message.id === input.sourceMessageId)
  if (sourceMessageIndex < 0) {
    throw new Error(
      `Source message ${input.sourceMessageId} was not found in branch ${input.sourceBranchId}.`,
    )
  }

  const sourceMessage = sortedParentMessages[sourceMessageIndex]!
  const prefixMessages = sortedParentMessages
    .slice(0, sourceMessageIndex)
    .map(message => cloneMessage(message))
  const subtreeMessages = preserveEditedSourceAttachments({
    sourceMessage,
    replacementMessageId: input.replacementMessageId,
    messages: selectEditedSubtreeMessages({
      parentBranch,
      replacementMessageId: input.replacementMessageId,
      assistantMessageId: input.assistantMessageId,
      replacementPrompt: input.replacementPrompt,
      assistantText: input.assistantText,
      recoveredSession: input.recoveredSession,
      persistedAt: input.persistedAt,
    }),
  })
  const branchId = resolveSyntheticEditedBranchId({
    existingSession: input.storedSession.session,
    sourceMessageId: input.sourceMessageId,
    subtreeMessages,
  })
  const branchMessages = reassignBranchId(
    dedupeMessagesById([...prefixMessages, ...subtreeMessages]),
    branchId,
  )
  const existingBranch = input.storedSession.session.branches.find(branch => branch.id === branchId) ?? null
  const branch: DeepSeekBranch = {
    id: branchId,
    sessionId: input.storedSession.session.id,
    title: inferBranchTitle(branchMessages, branchId),
    createdAt: branchMessages[0]?.createdAt ?? input.persistedAt ?? new Date().toISOString(),
    sourceMessageId: input.sourceMessageId,
    messages: branchMessages,
  }

  return {
    session: upsertBranchIntoSession(input.storedSession.session, branch),
    branch,
    materialization: {
      kind: 'edit-message',
      sourceBranchId: input.sourceBranchId,
      sourceMessageId: input.sourceMessageId,
      materializedBranchId: branchId,
      materializedBranchCreated: existingBranch === null,
      replacementMessageId: input.replacementMessageId,
      assistantMessageId: input.assistantMessageId,
      prefixMessageIds: prefixMessages.map(message => message.id),
      materializedMessageIds: branchMessages.map(message => message.id),
      transcriptShape: input.recoveredSession ? 'history-recovered' : 'synthetic-fallback',
    },
  }
}

function preserveEditedSourceAttachments(input: {
  sourceMessage: DeepSeekMessage
  replacementMessageId: string | null
  messages: DeepSeekMessage[]
}): DeepSeekMessage[] {
  if (input.sourceMessage.role !== 'user' || input.sourceMessage.attachments.length === 0) {
    return input.messages
  }

  const replacementIndex = input.messages.findIndex(message =>
    input.replacementMessageId
      ? message.id === input.replacementMessageId
      : message.role === 'user',
  )
  if (replacementIndex < 0) {
    return input.messages
  }

  return input.messages.map((message, index) =>
    index === replacementIndex
      ? {
          ...message,
          attachments: mergeDeepSeekAttachments(
            input.sourceMessage.attachments,
            message.attachments,
          ),
        }
      : message,
  )
}

function selectEditedSubtreeMessages(input: {
  parentBranch: DeepSeekBranch
  replacementMessageId: string | null
  assistantMessageId: string | null
  replacementPrompt: string
  assistantText: string | null
  recoveredSession?: DeepSeekSession | undefined
  persistedAt?: string | undefined
}): DeepSeekMessage[] {
  if (input.recoveredSession) {
    const recoveredBranch = selectRecoveredActiveBranch({
      session: input.recoveredSession,
      replacementMessageId: input.replacementMessageId,
      assistantMessageId: input.assistantMessageId,
    })
    const recoveredMessages = [...recoveredBranch.messages].sort(compareMessagesByCreatedAt)
    const replacementSubtree = collectReplacementSubtreeMessages(
      recoveredMessages,
      input.replacementMessageId,
      input.assistantMessageId,
    )
    if (replacementSubtree.length > 0) {
      return replacementSubtree.map(message => cloneMessage(message))
    }

    const parentMessageIds = new Set(input.parentBranch.messages.map(message => message.id))
    const newlyObservedMessages = recoveredMessages.filter(message => !parentMessageIds.has(message.id))
    if (newlyObservedMessages.length > 0) {
      return newlyObservedMessages.map(message => cloneMessage(message))
    }
  }

  return buildSyntheticEditedSubtree({
    sessionId: input.parentBranch.sessionId,
    replacementMessageId: input.replacementMessageId,
    assistantMessageId: input.assistantMessageId,
    replacementPrompt: input.replacementPrompt,
    assistantText: input.assistantText,
    persistedAt: input.persistedAt,
  })
}

function collectReplacementSubtreeMessages(
  recoveredMessages: DeepSeekMessage[],
  replacementMessageId: string | null,
  assistantMessageId: string | null,
): DeepSeekMessage[] {
  const messageIds = new Set(recoveredMessages.map(message => message.id))
  const rootMessageId =
    replacementMessageId && messageIds.has(replacementMessageId)
      ? replacementMessageId
      : assistantMessageId
        ? recoveredMessages.find(message => message.id === assistantMessageId)?.parentId ?? null
        : null

  if (!rootMessageId || !messageIds.has(rootMessageId)) {
    return []
  }

  const messagesByParentId = new Map<string | null, DeepSeekMessage[]>()
  for (const message of recoveredMessages) {
    const key = message.parentId ?? null
    const collection = messagesByParentId.get(key) ?? []
    collection.push(message)
    messagesByParentId.set(key, collection)
  }

  const collected = new Map<string, DeepSeekMessage>()
  const queue = [rootMessageId]
  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId || collected.has(currentId)) {
      continue
    }

    const currentMessage = recoveredMessages.find(message => message.id === currentId) ?? null
    if (!currentMessage) {
      continue
    }
    collected.set(currentId, currentMessage)

    for (const child of messagesByParentId.get(currentId) ?? []) {
      queue.push(child.id)
    }
  }

  return [...collected.values()].sort(compareMessagesByCreatedAt)
}

function buildSyntheticEditedSubtree(input: {
  sessionId: string
  replacementMessageId: string | null
  assistantMessageId: string | null
  replacementPrompt: string
  assistantText: string | null
  persistedAt?: string | undefined
}): DeepSeekMessage[] {
  const persistedAt = input.persistedAt ?? new Date().toISOString()
  const assistantCreatedAt = new Date(new Date(persistedAt).getTime() + 1).toISOString()
  const replacementMessageId =
    input.replacementMessageId ?? `${input.sessionId}-edit-user-${new Date(persistedAt).getTime()}`
  const assistantMessageId =
    input.assistantMessageId ??
    `${input.sessionId}-edit-assistant-${new Date(assistantCreatedAt).getTime()}`

  return [
    {
      id: replacementMessageId,
      role: 'user',
      text: input.replacementPrompt,
      createdAt: persistedAt,
      branchId: 'branch-pending-edit',
      attachments: [],
      citations: [],
    },
    {
      id: assistantMessageId,
      role: 'assistant',
      text: input.assistantText ?? '',
      createdAt: assistantCreatedAt,
      parentId: replacementMessageId,
      branchId: 'branch-pending-edit',
      attachments: [],
      citations: [],
    },
  ]
}

function selectRecoveredActiveBranch(input: {
  session: DeepSeekSession
  replacementMessageId: string | null
  assistantMessageId: string | null
}): DeepSeekBranch {
  const branchContainingAssistant =
    input.assistantMessageId
      ? input.session.branches.find(branch =>
          branch.messages.some(message => message.id === input.assistantMessageId),
        ) ?? null
      : null
  if (branchContainingAssistant) {
    return branchContainingAssistant
  }

  const branchContainingReplacement =
    input.replacementMessageId
      ? input.session.branches.find(branch =>
          branch.messages.some(message => message.id === input.replacementMessageId),
        ) ?? null
      : null
  if (branchContainingReplacement) {
    return branchContainingReplacement
  }

  return [...input.session.branches].sort(compareBranchesByLatestActivity).at(-1) ?? input.session.branches[0]!
}

function resolveSyntheticEditedBranchId(input: {
  existingSession: DeepSeekSession
  sourceMessageId: string
  subtreeMessages: DeepSeekMessage[]
}): string {
  const branchLeadMessageId = input.subtreeMessages[0]?.id ?? 'unknown'
  const baseId = sanitizeBranchId(`branch-edit-${input.sourceMessageId}-${branchLeadMessageId}`)
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
    createdAt: compareMessagesTimestamp(current.createdAt, incoming.createdAt) <= 0
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

function inferBranchTitle(messages: DeepSeekMessage[], fallbackBranchId: string): string {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.text.trim())
  const normalized = firstUserMessage?.text.replace(/\s+/g, ' ').trim() ?? ''
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
