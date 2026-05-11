import type {
  DeepSeekResolvedBranchTarget,
  DeepSeekSessionBranchCatalog,
  DeepSeekSessionBranchSummary,
} from '../../types/deepseek-branch-catalog.types.js'
import type { DeepSeekActiveBranchSource } from '../../types/deepseek-message-target.types.js'
import type { DeepSeekBranch, DeepSeekMessage, DeepSeekSession } from '../../types/deepseek-session.types.js'
import { resolveDeepSeekBranchContext } from './sessionBranchLineage.js'

const MAIN_BRANCH_ID = 'branch-main'

export function buildDeepSeekSessionBranchCatalog(
  session: DeepSeekSession,
  input: {
    activeBranchId?: string | null | undefined
    activeBranchSource?: DeepSeekActiveBranchSource | undefined
  } = {},
): DeepSeekSessionBranchCatalog {
  const defaultBranchId = selectDefaultBranchId(session.branches)
  const context = resolveDeepSeekBranchContext(session, {
    defaultBranchId,
    activeBranchId: input.activeBranchId,
    activeBranchSource: input.activeBranchSource,
  })
  const lineageByBranchId = new Map(
    context.lineage.map(lineage => [lineage.branchId, lineage] as const),
  )
  const branches = [...session.branches]
    .sort(compareBranchesForCatalog)
    .map(branch => summarizeSessionBranch(branch, lineageByBranchId.get(branch.id)))

  return {
    sessionId: session.id,
    agentId: session.agentId,
    title: session.title,
    createdAt: session.createdAt,
    branchCount: branches.length,
    defaultBranchId: context.defaultBranchId,
    activeBranchId: context.activeBranchId,
    activeBranchSource: context.activeBranchSource,
    branches,
  }
}

export function resolveDeepSeekSessionBranchTarget(input: {
  session: DeepSeekSession
  branchId: string
  sessionFile: string
}): DeepSeekResolvedBranchTarget {
  const catalog = buildDeepSeekSessionBranchCatalog(input.session)
  const summary = catalog.branches.find(candidate => candidate.branchId === input.branchId)
  const branch = input.session.branches.find(candidate => candidate.id === input.branchId)

  if (!summary || !branch) {
    const availableBranchIds =
      catalog.branches.length > 0
        ? catalog.branches.map(candidate => candidate.branchId).join(', ')
        : 'none'
    throw new Error(
      `Branch not found in session: ${input.branchId}. Available branches: ${availableBranchIds}.`,
    )
  }

  return {
    sessionFile: input.sessionFile,
    session: input.session,
    branch,
    summary,
    catalog,
  }
}

function summarizeSessionBranch(
  branch: DeepSeekBranch,
  lineage?: ReturnType<typeof resolveDeepSeekBranchContext>['lineage'][number],
): DeepSeekSessionBranchSummary {
  const messages = [...branch.messages].sort(compareMessagesByCreatedAt)
  const firstMessage = messages[0] ?? null
  const lastMessage = messages.at(-1) ?? null
  const previewSource =
    messages.find(candidate => candidate.role === 'user' && candidate.text.trim()) ??
    messages.find(candidate => candidate.text.trim()) ??
    null

  return {
    branchId: branch.id,
    sessionId: branch.sessionId,
    title: branch.title,
    createdAt: branch.createdAt,
    sourceMessageId: branch.sourceMessageId,
    sourceMessageBranchIds: lineage?.sourceMessageBranchIds ?? [],
    parentBranchId: lineage?.parentBranchId ?? null,
    lineageKind: lineage?.lineageKind ?? 'root',
    lineagePath: lineage?.lineagePath ?? [branch.id],
    messageCount: messages.length,
    userMessageCount: messages.filter(candidate => candidate.role === 'user').length,
    assistantMessageCount: messages.filter(candidate => candidate.role === 'assistant').length,
    attachmentCount: messages.reduce((total, candidate) => total + candidate.attachments.length, 0),
    citationCount: messages.reduce((total, candidate) => total + candidate.citations.length, 0),
    firstMessageId: firstMessage?.id ?? null,
    lastMessageId: lastMessage?.id ?? null,
    lastMessageRole: lastMessage?.role ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    previewText: createPreview(previewSource?.text ?? ''),
  }
}

function selectDefaultBranchId(branches: DeepSeekBranch[]): string | null {
  const mainBranch = branches.find(candidate => candidate.id === MAIN_BRANCH_ID)
  if (mainBranch) {
    return mainBranch.id
  }

  return branches[0]?.id ?? null
}

function compareBranchesForCatalog(left: DeepSeekBranch, right: DeepSeekBranch): number {
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

  const lastActivityDiff = compareIsoTimestamps(
    getLastMessageCreatedAt(left.messages) ?? left.createdAt,
    getLastMessageCreatedAt(right.messages) ?? right.createdAt,
  )
  if (lastActivityDiff !== 0) {
    return lastActivityDiff
  }

  return left.id.localeCompare(right.id)
}

function compareMessagesByCreatedAt(left: DeepSeekMessage, right: DeepSeekMessage): number {
  const createdAtDiff = compareIsoTimestamps(left.createdAt, right.createdAt)
  if (createdAtDiff !== 0) {
    return createdAtDiff
  }

  return left.id.localeCompare(right.id)
}

function compareIsoTimestamps(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime()
}

function getLastMessageCreatedAt(messages: DeepSeekMessage[]): string | null {
  const sortedMessages = [...messages].sort(compareMessagesByCreatedAt)
  return sortedMessages.at(-1)?.createdAt ?? null
}

function createPreview(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  if (normalized.length <= 96) {
    return normalized
  }

  return `${normalized.slice(0, 95).trimEnd()}…`
}
