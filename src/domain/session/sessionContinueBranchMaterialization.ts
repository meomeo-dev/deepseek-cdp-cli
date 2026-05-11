import type {
  DeepSeekMaterializedContinueBranchResult,
} from '../../types/deepseek-continue-message.types.js'
import type {
  DeepSeekBranch,
  DeepSeekMessage,
  DeepSeekSession,
  DeepSeekStoredSession,
} from '../../types/deepseek-session.types.js'
import {
  cloneDeepSeekMessage,
  mergeDeepSeekMessage,
} from './sessionMessageArtifacts.js'
import { pickLatestDeepSeekChatModeFact } from '../deepseek/deepSeekChatModeFact.js'

export interface MaterializeDeepSeekContinuedBranchInput {
  storedSession: DeepSeekStoredSession
  sourceBranchId: string
  sourceAssistantMessageId: string
  sourceParentMessageId: string | null
  continuedAssistantMessageId: string | null
  assistantText: string | null
  recoveredSession?: DeepSeekSession | undefined
}

export function materializeDeepSeekContinuedBranch(
  input: MaterializeDeepSeekContinuedBranchInput,
): DeepSeekMaterializedContinueBranchResult {
  const sourceBranch = resolveSourceBranch(input.storedSession.session, input.sourceBranchId)
  const sourceAssistantMessage = resolveSourceAssistantMessage(
    sourceBranch,
    input.sourceAssistantMessageId,
  )
  const sourceParentMessageId =
    normalizeOptionalString(input.sourceParentMessageId) ??
    normalizeOptionalString(sourceAssistantMessage.parentId)
  const continuedAssistantMessageId =
    normalizeOptionalString(input.continuedAssistantMessageId) ?? input.sourceAssistantMessageId

  if (continuedAssistantMessageId !== input.sourceAssistantMessageId) {
    throw new Error(
      `DeepSeek continue attribution drifted: expected assistant message ${input.sourceAssistantMessageId}, got ${continuedAssistantMessageId}. Capture a new real fixture before changing continue semantics.`,
    )
  }

  if (input.recoveredSession) {
    const recoveredBranch = resolveRecoveredContinueBranch({
      session: input.recoveredSession,
      sourceBranchId: input.sourceBranchId,
      continuedAssistantMessageId,
    })
    if (recoveredBranch.id !== input.sourceBranchId) {
      throw new Error(
        `DeepSeek continue attribution drifted: expected branch ${input.sourceBranchId}, got ${recoveredBranch.id}. Capture a new real fixture before changing continue semantics.`,
      )
    }

    const mergedSession = mergeDeepSeekSessions(input.storedSession.session, input.recoveredSession)
    const mergedBranch = resolveSourceBranch(mergedSession, input.sourceBranchId)
    assertBranchContainsAssistantMessage(mergedBranch, continuedAssistantMessageId)

    return {
      session: mergedSession,
      branch: cloneBranch(mergedBranch),
      materialization: {
        kind: 'continue',
        sourceBranchId: input.sourceBranchId,
        sourceAssistantMessageId: input.sourceAssistantMessageId,
        sourceParentMessageId,
        materializedBranchId: input.sourceBranchId,
        materializedBranchCreated: false,
        continuedAssistantMessageId,
        continuationDisposition: 'in-place',
        transcriptShape: 'history-recovered-in-place',
      },
    }
  }

  const syntheticBranch = buildSyntheticContinuedBranch({
    sourceBranch,
    sourceAssistantMessageId: input.sourceAssistantMessageId,
    assistantText: input.assistantText,
  })
  const session = upsertBranchIntoSession(input.storedSession.session, syntheticBranch)

  return {
    session,
    branch: cloneBranch(syntheticBranch),
    materialization: {
      kind: 'continue',
      sourceBranchId: input.sourceBranchId,
      sourceAssistantMessageId: input.sourceAssistantMessageId,
      sourceParentMessageId,
      materializedBranchId: input.sourceBranchId,
      materializedBranchCreated: false,
      continuedAssistantMessageId,
      continuationDisposition: 'in-place',
      transcriptShape: 'synthetic-in-place',
    },
  }
}

function buildSyntheticContinuedBranch(input: {
  sourceBranch: DeepSeekBranch
  sourceAssistantMessageId: string
  assistantText: string | null
}): DeepSeekBranch {
  let updated = false
  const nextMessages = input.sourceBranch.messages.map(message => {
    if (message.id !== input.sourceAssistantMessageId) {
      return cloneMessage(message)
    }

    updated = true
    return {
      ...cloneMessage(message),
      text: input.assistantText ?? message.text,
    }
  })

  if (!updated) {
    throw new Error(
      `Assistant message ${input.sourceAssistantMessageId} was not found while building the synthetic continue overlay.`,
    )
  }

  return {
    ...cloneBranch(input.sourceBranch),
    messages: nextMessages.sort(compareMessagesByCreatedAt),
  }
}

function resolveRecoveredContinueBranch(input: {
  session: DeepSeekSession
  sourceBranchId: string
  continuedAssistantMessageId: string
}): DeepSeekBranch {
  const sourceBranch =
    input.session.branches.find(branch => branch.id === input.sourceBranchId) ?? null
  if (
    sourceBranch &&
    sourceBranch.messages.some(message => message.id === input.continuedAssistantMessageId)
  ) {
    return sourceBranch
  }

  const branchContainingAssistant =
    input.session.branches.find(branch =>
      branch.messages.some(message => message.id === input.continuedAssistantMessageId),
    ) ?? null
  if (branchContainingAssistant) {
    return branchContainingAssistant
  }

  throw new Error(
    `Recovered DeepSeek session did not contain assistant message ${input.continuedAssistantMessageId} after continue.`,
  )
}

function resolveSourceAssistantMessage(
  branch: DeepSeekBranch,
  assistantMessageId: string,
): DeepSeekMessage {
  const candidate = branch.messages.find(message => message.id === assistantMessageId) ?? null
  if (!candidate) {
    throw new Error(
      `Assistant message ${assistantMessageId} was not found in branch ${branch.id}.`,
    )
  }
  if (candidate.role !== 'assistant') {
    throw new Error(
      `Message ${assistantMessageId} in branch ${branch.id} is not an assistant message.`,
    )
  }
  return candidate
}

function assertBranchContainsAssistantMessage(
  branch: DeepSeekBranch,
  assistantMessageId: string,
): void {
  const candidate = branch.messages.find(message => message.id === assistantMessageId) ?? null
  if (!candidate) {
    throw new Error(
      `Branch ${branch.id} does not contain assistant message ${assistantMessageId} after continue recovery.`,
    )
  }
  if (candidate.role !== 'assistant') {
    throw new Error(
      `Recovered message ${assistantMessageId} in branch ${branch.id} is not an assistant message.`,
    )
  }
}

function upsertBranchIntoSession(session: DeepSeekSession, branch: DeepSeekBranch): DeepSeekSession {
  const branches = session.branches.map(candidate =>
    candidate.id === branch.id ? cloneBranch(branch) : cloneBranch(candidate),
  )

  return {
    ...session,
    branches: branches.sort(compareBranchesByCreatedAt),
  }
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

  const branchesById = new Map<string, DeepSeekBranch>()
  for (const branch of baseSession.branches) {
    branchesById.set(branch.id, cloneBranch(branch))
  }
  for (const branch of recoveredSession.branches) {
    const current = branchesById.get(branch.id)
    branchesById.set(branch.id, current ? mergeBranch(current, branch) : cloneBranch(branch))
  }

  return {
    id: baseSession.id,
    agentId: baseSession.agentId,
    title: pickPreferredTitle(baseSession.title, recoveredSession.title),
    createdAt: pickEarlierTimestamp(baseSession.createdAt, recoveredSession.createdAt),
    ...(pickLatestDeepSeekChatModeFact(baseSession.modeFact, recoveredSession.modeFact)
      ? {
          modeFact:
            pickLatestDeepSeekChatModeFact(baseSession.modeFact, recoveredSession.modeFact) ??
            undefined,
        }
      : {}),
    branches: [...branchesById.values()].sort(compareBranchesByCreatedAt),
  }
}

function mergeBranch(current: DeepSeekBranch, incoming: DeepSeekBranch): DeepSeekBranch {
  const messagesById = new Map<string, DeepSeekMessage>()
  for (const message of current.messages) {
    messagesById.set(message.id, cloneMessage(message))
  }
  for (const message of incoming.messages) {
    const previous = messagesById.get(message.id)
    messagesById.set(message.id, previous ? mergeMessage(previous, message) : cloneMessage(message))
  }

  return {
    ...cloneBranch(current),
    title: pickPreferredTitle(current.title, incoming.title),
    createdAt: pickEarlierTimestamp(current.createdAt, incoming.createdAt),
    sourceMessageId: incoming.sourceMessageId ?? current.sourceMessageId,
    messages: [...messagesById.values()].sort(compareMessagesByCreatedAt),
  }
}

function mergeMessage(current: DeepSeekMessage, incoming: DeepSeekMessage): DeepSeekMessage {
  return mergeDeepSeekMessage(current, incoming)
}

function resolveSourceBranch(session: DeepSeekSession, branchId: string): DeepSeekBranch {
  const branch = session.branches.find(candidate => candidate.id === branchId) ?? null
  if (!branch) {
    throw new Error(`Branch not found in session: ${branchId}.`)
  }
  return branch
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

function compareBranchesByCreatedAt(left: DeepSeekBranch, right: DeepSeekBranch): number {
  const timestampDiff = compareTimestamps(left.createdAt, right.createdAt)
  if (timestampDiff !== 0) {
    return timestampDiff
  }
  return left.id.localeCompare(right.id)
}

function compareMessagesByCreatedAt(left: DeepSeekMessage, right: DeepSeekMessage): number {
  const timestampDiff = compareTimestamps(left.createdAt, right.createdAt)
  if (timestampDiff !== 0) {
    return timestampDiff
  }
  return left.id.localeCompare(right.id)
}

function compareTimestamps(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime()
}

function pickEarlierTimestamp(left: string, right: string): string {
  if (!left.trim()) {
    return right
  }
  if (!right.trim()) {
    return left
  }
  return compareTimestamps(left, right) <= 0 ? left : right
}

function pickPreferredTitle(current: string, incoming: string): string {
  const normalizedCurrent = current.trim()
  const normalizedIncoming = incoming.trim()
  if (!normalizedCurrent) {
    return incoming
  }
  if (!normalizedIncoming) {
    return current
  }
  if (/^DeepSeek Session\b/i.test(normalizedCurrent) && !/^DeepSeek Session\b/i.test(normalizedIncoming)) {
    return incoming
  }
  return current
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}
