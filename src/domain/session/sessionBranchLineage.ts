import type {
  DeepSeekActiveBranchSource,
  DeepSeekBranchLineageFact,
} from '../../types/deepseek-message-target.types.js'
import type { DeepSeekSession } from '../../types/deepseek-session.types.js'

export interface DeepSeekResolvedBranchContext {
  defaultBranchId: string | null
  activeBranchId: string | null
  activeBranchSource: DeepSeekActiveBranchSource
  lineage: DeepSeekBranchLineageFact[]
}

export function resolveDeepSeekBranchContext(
  session: DeepSeekSession,
  input: {
    defaultBranchId: string | null
    activeBranchId?: string | null | undefined
    activeBranchSource?: DeepSeekActiveBranchSource | undefined
  },
): DeepSeekResolvedBranchContext {
  const activeBranchId = normalizeOptionalString(input.activeBranchId)
  if (activeBranchId && !session.branches.some(branch => branch.id === activeBranchId)) {
    throw new Error(
      `Active branch not found in session: ${activeBranchId}. Available branches: ${listAvailableBranchIds(session)}.`,
    )
  }

  return {
    defaultBranchId: input.defaultBranchId,
    activeBranchId,
    activeBranchSource: activeBranchId
      ? input.activeBranchSource ?? 'page'
      : 'unavailable',
    lineage: buildDeepSeekBranchLineage(session),
  }
}

export function buildDeepSeekBranchLineage(
  session: DeepSeekSession,
): DeepSeekBranchLineageFact[] {
  const messageBranchIdsByMessageId = indexMessageBranchMembership(session)
  const provisionalFacts = new Map<string, DeepSeekBranchLineageFact>()

  for (const branch of session.branches) {
    const sourceMessageId = normalizeOptionalString(branch.sourceMessageId)
    const sourceMessageBranchIds =
      sourceMessageId === null
        ? []
        : [...(messageBranchIdsByMessageId.get(sourceMessageId) ?? [])].sort()
    const parentBranchCandidates = sourceMessageBranchIds.filter(candidate => candidate !== branch.id)
    const lineageKind =
      sourceMessageId === null
        ? 'root'
        : parentBranchCandidates.length === 1
          ? 'fork'
          : 'unresolved'

    provisionalFacts.set(branch.id, {
      branchId: branch.id,
      sourceMessageId,
      sourceMessageBranchIds,
      parentBranchId: lineageKind === 'fork' ? parentBranchCandidates[0] ?? null : null,
      lineageKind,
      lineagePath: [branch.id],
    })
  }

  return [...provisionalFacts.values()]
    .map(fact => ({
      ...fact,
      lineagePath: buildLineagePath(fact, provisionalFacts),
    }))
    .sort((left, right) => left.branchId.localeCompare(right.branchId))
}

export function indexMessageBranchMembership(
  session: DeepSeekSession,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()

  for (const branch of session.branches) {
    for (const message of branch.messages) {
      const branchIds = index.get(message.id) ?? new Set<string>()
      branchIds.add(branch.id)
      index.set(message.id, branchIds)
    }
  }

  return index
}

function buildLineagePath(
  fact: DeepSeekBranchLineageFact,
  factsByBranchId: Map<string, DeepSeekBranchLineageFact>,
): string[] {
  if (fact.lineageKind !== 'fork' || fact.parentBranchId === null) {
    return [fact.branchId]
  }

  const path: string[] = [fact.branchId]
  const visited = new Set<string>(path)
  let currentBranchId = fact.parentBranchId

  while (currentBranchId) {
    if (visited.has(currentBranchId)) {
      return [fact.branchId]
    }

    path.unshift(currentBranchId)
    visited.add(currentBranchId)

    const currentFact = factsByBranchId.get(currentBranchId)
    if (!currentFact || currentFact.lineageKind !== 'fork' || currentFact.parentBranchId === null) {
      return path
    }

    currentBranchId = currentFact.parentBranchId
  }

  return path
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function listAvailableBranchIds(session: DeepSeekSession): string {
  return session.branches.length > 0
    ? session.branches.map(branch => branch.id).sort().join(', ')
    : 'none'
}
