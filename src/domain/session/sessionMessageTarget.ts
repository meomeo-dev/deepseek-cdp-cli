import { buildDeepSeekSessionBranchCatalog, resolveDeepSeekSessionBranchTarget } from './sessionBranchCatalog.js'
import { buildDeepSeekBranchLineage } from './sessionBranchLineage.js'
import type {
  DeepSeekResolvedMessageTarget,
  DeepSeekSessionMessageTargetContext,
} from '../../types/deepseek-message-target.types.js'
import type { DeepSeekMessage, DeepSeekSession } from '../../types/deepseek-session.types.js'

export interface ResolveDeepSeekSessionMessageTargetInput {
  session: DeepSeekSession
  sessionFile: string
  branchId?: string | undefined
  messageId?: string | undefined
  activeBranchId?: string | null | undefined
  activeBranchSource?: DeepSeekSessionMessageTargetContext['activeBranchSource'] | undefined
  allowedRoles?: DeepSeekMessage['role'][] | undefined
}

export function resolveDeepSeekSessionMessageTarget(
  input: ResolveDeepSeekSessionMessageTargetInput,
): DeepSeekResolvedMessageTarget {
  const branchId = normalizeOptionalString(input.branchId)
  const messageId = normalizeOptionalString(input.messageId)
  const catalog = buildDeepSeekSessionBranchCatalog(input.session, {
    activeBranchId: input.activeBranchId,
    activeBranchSource: input.activeBranchSource,
  })
  const context: DeepSeekSessionMessageTargetContext = {
    sessionId: input.session.id,
    defaultBranchId: catalog.defaultBranchId,
    activeBranchId: catalog.activeBranchId,
    activeBranchSource: catalog.activeBranchSource,
    catalog,
    lineage: buildDeepSeekBranchLineage(input.session),
  }

  if (branchId) {
    return resolveWithExplicitBranch({
      session: input.session,
      sessionFile: input.sessionFile,
      branchId,
      messageId,
      allowedRoles: normalizeAllowedRoles(input.allowedRoles),
      context,
    })
  }

  if (messageId) {
    return resolveWithExplicitMessage({
      session: input.session,
      sessionFile: input.sessionFile,
      messageId,
      activeBranchId: context.activeBranchId,
      allowedRoles: normalizeAllowedRoles(input.allowedRoles),
      context,
    })
  }

  const fallbackBranchId = context.activeBranchId ?? context.defaultBranchId
  if (!fallbackBranchId) {
    throw new Error('Could not resolve a branch target: no activeBranchId or defaultBranchId is available.')
  }

  const resolvedBranch = resolveDeepSeekSessionBranchTarget({
    session: input.session,
    branchId: fallbackBranchId,
    sessionFile: input.sessionFile,
  })

  return {
    sessionFile: input.sessionFile,
    session: input.session,
    context,
    resolvedBranchId: resolvedBranch.branch.id,
    resolutionSource: context.activeBranchId ? 'active-branch' : 'default-branch',
    branch: resolvedBranch.branch,
    branchSummary: resolvedBranch.summary,
    branchLineage: selectBranchLineage(context, resolvedBranch.branch.id),
    messageId: null,
    message: null,
    candidateBranchIds: [resolvedBranch.branch.id],
  }
}

function resolveWithExplicitBranch(input: {
  session: DeepSeekSession
  sessionFile: string
  branchId: string
  messageId: string | null
  allowedRoles: Set<DeepSeekMessage['role']> | null
  context: DeepSeekSessionMessageTargetContext
}): DeepSeekResolvedMessageTarget {
  const resolvedBranch = resolveDeepSeekSessionBranchTarget({
    session: input.session,
    branchId: input.branchId,
    sessionFile: input.sessionFile,
  })

  const message = input.messageId
    ? resolvedBranch.branch.messages.find(candidate => candidate.id === input.messageId) ?? null
    : null
  if (input.messageId && !message) {
    const candidateBranchIds = findCandidateBranchIdsByMessageId(input.session, input.messageId)
    throw new Error(
      `Message ${input.messageId} was not found in branch ${input.branchId}. Candidate branches: ${formatBranchIds(candidateBranchIds)}.`,
    )
  }

  assertAllowedRoles(message, input.allowedRoles)

  return {
    sessionFile: input.sessionFile,
    session: input.session,
    context: input.context,
    resolvedBranchId: resolvedBranch.branch.id,
    resolutionSource: 'explicit-branch',
    branch: resolvedBranch.branch,
    branchSummary: resolvedBranch.summary,
    branchLineage: selectBranchLineage(input.context, resolvedBranch.branch.id),
    messageId: message?.id ?? null,
    message,
    candidateBranchIds: [resolvedBranch.branch.id],
  }
}

function resolveWithExplicitMessage(input: {
  session: DeepSeekSession
  sessionFile: string
  messageId: string
  activeBranchId: string | null
  allowedRoles: Set<DeepSeekMessage['role']> | null
  context: DeepSeekSessionMessageTargetContext
}): DeepSeekResolvedMessageTarget {
  const candidateBranchIds = findCandidateBranchIdsByMessageId(input.session, input.messageId)
  if (candidateBranchIds.length === 0) {
    throw new Error(`Message not found in session: ${input.messageId}.`)
  }

  const resolvedBranchId =
    candidateBranchIds.length === 1
      ? candidateBranchIds[0] ?? null
      : input.activeBranchId && candidateBranchIds.includes(input.activeBranchId)
        ? input.activeBranchId
        : null

  if (!resolvedBranchId) {
    throw new Error(
      `Message ${input.messageId} is ambiguous across branches: ${formatBranchIds(candidateBranchIds)}. ` +
      `Provide branchId or an authoritative activeBranchId.`,
    )
  }

  const resolvedBranch = resolveDeepSeekSessionBranchTarget({
    session: input.session,
    branchId: resolvedBranchId,
    sessionFile: input.sessionFile,
  })
  const message = resolvedBranch.branch.messages.find(candidate => candidate.id === input.messageId) ?? null
  if (!message) {
    throw new Error(
      `Message ${input.messageId} could not be resolved inside branch ${resolvedBranchId} after branch selection.`,
    )
  }

  assertAllowedRoles(message, input.allowedRoles)

  return {
    sessionFile: input.sessionFile,
    session: input.session,
    context: input.context,
    resolvedBranchId: resolvedBranch.branch.id,
    resolutionSource: 'explicit-message',
    branch: resolvedBranch.branch,
    branchSummary: resolvedBranch.summary,
    branchLineage: selectBranchLineage(input.context, resolvedBranch.branch.id),
    messageId: message.id,
    message,
    candidateBranchIds,
  }
}

function findCandidateBranchIdsByMessageId(session: DeepSeekSession, messageId: string): string[] {
  return session.branches
    .filter(branch => branch.messages.some(message => message.id === messageId))
    .map(branch => branch.id)
    .sort()
}

function selectBranchLineage(
  context: DeepSeekSessionMessageTargetContext,
  branchId: string,
) {
  const lineage = context.lineage.find(candidate => candidate.branchId === branchId)
  if (!lineage) {
    throw new Error(`Branch lineage fact is missing for branch ${branchId}.`)
  }

  return lineage
}

function assertAllowedRoles(
  message: DeepSeekMessage | null,
  allowedRoles: Set<DeepSeekMessage['role']> | null,
): void {
  if (!message || !allowedRoles || allowedRoles.size === 0) {
    return
  }

  if (!allowedRoles.has(message.role)) {
    throw new Error(
      `Message ${message.id} has role ${message.role}, which is not allowed. Allowed roles: ${[...allowedRoles].join(', ')}.`,
    )
  }
}

function normalizeAllowedRoles(
  value: DeepSeekMessage['role'][] | undefined,
): Set<DeepSeekMessage['role']> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  return new Set(value)
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function formatBranchIds(branchIds: string[]): string {
  return branchIds.length > 0 ? branchIds.join(', ') : 'none'
}
