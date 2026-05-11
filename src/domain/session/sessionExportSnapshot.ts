import { buildDeepSeekSessionBranchCatalog } from './sessionBranchCatalog.js'
import type { BuildDeepSeekSessionExportSnapshotInput } from '../../types/deepseek-export.types.js'
import type {
  DeepSeekSessionExportBranchSnapshot,
  DeepSeekSessionExportSnapshot,
} from '../../types/deepseek-export.types.js'
import type { DeepSeekStoredBranchExportProvenance } from '../../types/deepseek-session.types.js'

export function buildDeepSeekSessionExportSnapshot(
  input: BuildDeepSeekSessionExportSnapshotInput,
): DeepSeekSessionExportSnapshot {
  const catalog = buildDeepSeekSessionBranchCatalog(input.source.session, {
    activeBranchId: input.source.storedSession.metadata?.lastKnownActiveBranchId,
    activeBranchSource: input.source.storedSession.metadata?.lastKnownActiveBranchId
      ? 'stored-session'
      : 'unavailable',
  })
  const branches = catalog.branches.map(summary => {
    const branch = input.source.session.branches.find(candidate => candidate.id === summary.branchId)
    if (!branch) {
      throw new Error(`Branch ${summary.branchId} was not found while building the export snapshot.`)
    }

    return {
      branchId: branch.id,
      branch,
      summary,
      provenance: resolveBranchExportProvenance({
        branchId: branch.id,
        source: input.source,
      }),
    } satisfies DeepSeekSessionExportBranchSnapshot
  })

  return {
    authority: {
      sessionFile: input.source.sessionFile,
      sessionId: input.source.authoritativeSessionId,
      agentId: input.source.authoritativeAgentId,
      finalUrl: input.source.finalUrl,
    },
    storedSession: input.source.storedSession,
    session: input.source.session,
    catalog,
    transcriptRecovery: input.source.storedSession.metadata?.transcriptRecovery ?? null,
    branches,
  }
}

function resolveBranchExportProvenance(input: {
  branchId: string
  source: BuildDeepSeekSessionExportSnapshotInput['source']
}): DeepSeekStoredBranchExportProvenance {
  const explicit = input.source.storedSession.metadata?.exportProvenance?.branches.find(
    entry => entry.branchId === input.branchId,
  )
  if (explicit) {
    return { ...explicit }
  }

  const metadata = input.source.storedSession.metadata
  if (metadata?.transcriptRecovery?.status === 'recovered' && input.source.session.branches.length === 1) {
    return {
      branchId: input.branchId,
      source: 'history_messages',
      transcriptShape: 'history-recovered',
      transcriptRecoveryStatus: 'recovered',
      assistantTextSource: 'history_messages',
      lastUpdatedBy: 'legacy',
      updatedAt: metadata.persistedAt,
    }
  }

  if (metadata && input.branchId === 'branch-main') {
    return {
      branchId: input.branchId,
      source:
        metadata.lastKnownActiveBranchSource === 'reply' && metadata.transcriptRecovery?.status !== 'recovered'
          ? 'mixed'
          : 'stored-session',
      transcriptShape:
        metadata.lastKnownActiveBranchSource === 'reply' && metadata.transcriptRecovery?.status !== 'recovered'
          ? 'reply-appended'
          : metadata.firstBatchSummary.captureMode === 'summary-only'
            ? 'summary-only'
            : 'generation-stream-fallback',
      transcriptRecoveryStatus: metadata.transcriptRecovery?.status ?? 'unavailable',
      assistantTextSource: metadata.lastAssistantTextSource ?? null,
      lastUpdatedBy: 'legacy',
      updatedAt: metadata.persistedAt,
    }
  }

  return {
    branchId: input.branchId,
    source: 'unknown',
    transcriptShape: 'unknown',
    transcriptRecoveryStatus: metadata?.transcriptRecovery?.status ?? 'unavailable',
    assistantTextSource: metadata?.lastAssistantTextSource ?? null,
    lastUpdatedBy: 'legacy',
    updatedAt: metadata?.persistedAt ?? input.source.session.createdAt,
  }
}
