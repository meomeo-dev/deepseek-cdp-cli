import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekChatModeAuditReport } from '../../types/deepseek-mode-audit.types.js'
import type {
  DeepSeekSelectorDriftCleanupEntry,
  DeepSeekSelectorDriftTargetResolution,
} from '../../types/deepseek-selector-drift-audit.types.js'

const PRIMARY_MODE_PRIORITY: DeepSeekChatMode[] = ['expert', 'instant', 'vision']

export interface DeepSeekSelectorAuditSessionTarget {
  requestedMode: DeepSeekChatMode
  sessionId: string
  finalUrl: string
}

export interface DeepSeekSelectorAuditTargetPlan {
  availableTargets: DeepSeekSelectorAuditSessionTarget[]
  unavailableTargets: DeepSeekSelectorAuditSessionTarget[]
  resolution: DeepSeekSelectorDriftTargetResolution
}

export function buildDeepSeekSelectorAuditSessionTargets(
  modeAudit: DeepSeekChatModeAuditReport,
): DeepSeekSelectorAuditSessionTarget[] {
  return PRIMARY_MODE_PRIORITY.map(requestedMode => {
    const scenario = modeAudit.scenarios.find(item => item.requestedMode === requestedMode)
    if (!scenario) {
      throw new Error(`Mode audit did not return the ${requestedMode} scenario.`)
    }

    return {
      requestedMode,
      sessionId: scenario.sessionId,
      finalUrl: scenario.finalUrl,
    }
  })
}

export function planDeepSeekSelectorAuditTargets(input: {
  targets: DeepSeekSelectorAuditSessionTarget[]
  catalogSessionIds: Iterable<string>
  routeConfirmedSessionIds: Iterable<string>
  catalogAttempts: number
  catalogPartial: boolean
}): DeepSeekSelectorAuditTargetPlan {
  const catalogSessionIds = new Set(input.catalogSessionIds)
  const routeConfirmedSessionIds = new Set(input.routeConfirmedSessionIds)
  const availableTargets: DeepSeekSelectorAuditSessionTarget[] = []
  const unavailableTargets: DeepSeekSelectorAuditSessionTarget[] = []

  const targets = input.targets.map(target => {
    const catalogued = catalogSessionIds.has(target.sessionId)
    const routeConfirmed = routeConfirmedSessionIds.has(target.sessionId)
    const status = catalogued
      ? 'catalogued'
      : routeConfirmed
        ? 'route-confirmed'
        : 'unavailable'

    if (status === 'unavailable') {
      unavailableTargets.push(target)
    } else {
      availableTargets.push(target)
    }

    return {
      requestedMode: target.requestedMode,
      sessionId: target.sessionId,
      finalUrl: target.finalUrl,
      status,
    } as const
  })

  if (availableTargets.length === 0) {
    const targetSummary = input.targets
      .map(target => `${target.requestedMode}=${target.sessionId}`)
      .join(', ')
    throw new Error(
      'No selector audit seed session was present in the authenticated online ' +
        `catalog or confirmed session route after probing: ${targetSummary}.`,
    )
  }

  return {
    availableTargets,
    unavailableTargets,
    resolution: {
      source: 'fetch_page-and-session-route',
      catalogAttempts: input.catalogAttempts,
      catalogPartial: input.catalogPartial,
      selectedPrimaryMode: availableTargets[0]?.requestedMode ?? null,
      targets,
    },
  }
}

export function recordUnavailableTargetCleanupEntries(
  targetPlan: DeepSeekSelectorAuditTargetPlan,
  cleanupEntriesBySessionId: Map<string, DeepSeekSelectorDriftCleanupEntry>,
): void {
  for (const target of targetPlan.unavailableTargets) {
    cleanupEntriesBySessionId.set(target.sessionId, {
      requestedMode: target.requestedMode,
      sessionId: target.sessionId,
      finalUrl: target.finalUrl,
      status: 'skipped',
      errorMessage:
        'Session was absent from the observed fetch_page catalog and did not ' +
        'remain on its exact session route.',
    })
  }
}

export function orderSelectorAuditCleanupEntries(
  targets: DeepSeekSelectorAuditSessionTarget[],
  primaryTarget: DeepSeekSelectorAuditSessionTarget,
  cleanupEntriesBySessionId: Map<string, DeepSeekSelectorDriftCleanupEntry>,
): DeepSeekSelectorDriftCleanupEntry[] {
  const orderedTargets = [
    primaryTarget,
    ...targets.filter(target => target.sessionId !== primaryTarget.sessionId),
  ]

  return orderedTargets.map(target =>
    cleanupEntriesBySessionId.get(target.sessionId) ?? {
      requestedMode: target.requestedMode,
      sessionId: target.sessionId,
      finalUrl: target.finalUrl,
      status: 'delete-failed',
      errorMessage: 'Selector audit completed without a cleanup outcome.',
    },
  )
}

export async function cleanupRemainingSelectorAuditTargets(input: {
  targets: DeepSeekSelectorAuditSessionTarget[]
  cleanupEntriesBySessionId: Map<string, DeepSeekSelectorDriftCleanupEntry>
  cleanup: (
    target: DeepSeekSelectorAuditSessionTarget,
  ) => Promise<DeepSeekSelectorDriftCleanupEntry>
}): Promise<void> {
  for (const target of input.targets) {
    const existing = input.cleanupEntriesBySessionId.get(target.sessionId)
    if (existing?.status === 'deleted' || existing?.status === 'skipped') {
      continue
    }

    const cleanupEntry = await input.cleanup(target)
    input.cleanupEntriesBySessionId.set(target.sessionId, cleanupEntry)
  }
}

export async function withDeepSeekSelectorAuditFailureCleanup<T>(input: {
  targets: DeepSeekSelectorAuditSessionTarget[]
  cleanupEntriesBySessionId: Map<string, DeepSeekSelectorDriftCleanupEntry>
  run: () => Promise<T>
  cleanup: (
    target: DeepSeekSelectorAuditSessionTarget,
  ) => Promise<DeepSeekSelectorDriftCleanupEntry>
}): Promise<T> {
  let completed = false

  try {
    const result = await input.run()
    completed = true
    return result
  } finally {
    if (!completed) {
      await cleanupUnsettledSelectorAuditSessions(input)
    }
  }
}

async function cleanupUnsettledSelectorAuditSessions(input: {
  targets: DeepSeekSelectorAuditSessionTarget[]
  cleanupEntriesBySessionId: Map<string, DeepSeekSelectorDriftCleanupEntry>
  cleanup: (
    target: DeepSeekSelectorAuditSessionTarget,
  ) => Promise<DeepSeekSelectorDriftCleanupEntry>
}): Promise<void> {
  for (const target of input.targets) {
    const existing = input.cleanupEntriesBySessionId.get(target.sessionId)
    if (existing?.status === 'deleted' || existing?.status === 'skipped') {
      continue
    }

    try {
      const cleanupEntry = await input.cleanup(target)
      input.cleanupEntriesBySessionId.set(target.sessionId, cleanupEntry)
    } catch (error) {
      input.cleanupEntriesBySessionId.set(
        target.sessionId,
        buildCleanupFailureEntry(target, error),
      )
    }
  }
}

function buildCleanupFailureEntry(
  target: DeepSeekSelectorAuditSessionTarget,
  error: unknown,
): DeepSeekSelectorDriftCleanupEntry {
  return {
    requestedMode: target.requestedMode,
    sessionId: target.sessionId,
    finalUrl: target.finalUrl,
    status: 'delete-failed',
    errorMessage: error instanceof Error ? error.message : String(error),
  }
}
