import type { DeepSeekConversationMutation } from '../../types/deepseek-message-mutation.types.js'
import type { DeepSeekTranscriptRecovery } from '../../types/deepseek-transcript-recovery.types.js'
import type {
  DeepSeekSession,
  DeepSeekStoredBranchExportProvenance,
  DeepSeekStoredExportProvenance,
} from '../../types/deepseek-session.types.js'

export function createDeepSeekExportProvenanceForFirstMessage(input: {
  branchId: string
  captureMode: 'summary-only' | 'generation-stream'
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  persistedAt: string
}): DeepSeekStoredExportProvenance {
  return {
    version: 1,
    updatedAt: input.persistedAt,
    branches: [
      {
        branchId: input.branchId,
        source: 'stored-session',
        transcriptShape:
          input.captureMode === 'summary-only'
            ? 'summary-only'
            : 'generation-stream-fallback',
        transcriptRecoveryStatus: 'unavailable',
        assistantTextSource: input.assistantTextSource,
        lastUpdatedBy: 'first-message',
        updatedAt: input.persistedAt,
      },
    ],
  }
}

export function applyDeepSeekRecoveredExportProvenance(input: {
  previous: DeepSeekStoredExportProvenance | null | undefined
  recoveredSession: DeepSeekSession
  transcriptRecovery: DeepSeekTranscriptRecovery
  persistedAt: string
}): DeepSeekStoredExportProvenance {
  const branches = cloneProvenanceEntries(input.previous)

  for (const branch of input.recoveredSession.branches) {
    upsertBranchProvenance(branches, {
      branchId: branch.id,
      source: 'history_messages',
      transcriptShape: 'history-recovered',
      transcriptRecoveryStatus: input.transcriptRecovery.status,
      assistantTextSource: 'history_messages',
      lastUpdatedBy: 'history_messages',
      updatedAt: input.persistedAt,
      sourceMessageId: branch.sourceMessageId ?? null,
    })
  }

  return {
    version: 1,
    updatedAt: input.persistedAt,
    branches: sortBranchProvenance(branches),
  }
}

export function applyDeepSeekReplyExportProvenance(input: {
  previous: DeepSeekStoredExportProvenance | null | undefined
  branchId: string
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  persistedAt: string
}): DeepSeekStoredExportProvenance {
  const branches = cloneProvenanceEntries(input.previous)
  upsertBranchProvenance(branches, {
    branchId: input.branchId,
    source: 'mixed',
    transcriptShape: 'reply-appended',
    transcriptRecoveryStatus: 'failed',
    assistantTextSource: input.assistantTextSource,
    lastUpdatedBy: 'reply',
    updatedAt: input.persistedAt,
  })

  return {
    version: 1,
    updatedAt: input.persistedAt,
    branches: sortBranchProvenance(branches),
  }
}

export function applyDeepSeekMutationExportProvenance(input: {
  previous: DeepSeekStoredExportProvenance | null | undefined
  mutation: DeepSeekConversationMutation
  transcriptRecovery: DeepSeekTranscriptRecovery
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  persistedAt: string
}): DeepSeekStoredExportProvenance {
  const branches = cloneProvenanceEntries(input.previous)
  upsertBranchProvenance(branches, buildMutationBranchProvenance(input))

  return {
    version: 1,
    updatedAt: input.persistedAt,
    branches: sortBranchProvenance(branches),
  }
}

function buildMutationBranchProvenance(input: {
  mutation: DeepSeekConversationMutation
  transcriptRecovery: DeepSeekTranscriptRecovery
  assistantTextSource: 'history_messages' | 'generation-stream' | 'unavailable'
  persistedAt: string
}): DeepSeekStoredBranchExportProvenance {
  switch (input.mutation.kind) {
    case 'edit-message':
      return {
        branchId: input.mutation.materializedBranchId,
        source:
          input.mutation.transcriptShape === 'history-recovered'
            ? 'history_messages'
            : 'local-materialization',
        transcriptShape: input.mutation.transcriptShape,
        transcriptRecoveryStatus: resolveTranscriptRecoveryStatus(input.transcriptRecovery),
        assistantTextSource: input.assistantTextSource,
        lastUpdatedBy: 'edit-message',
        updatedAt: input.persistedAt,
        sourceBranchId: input.mutation.sourceBranchId,
        sourceMessageId: input.mutation.sourceMessageId,
      }
    case 'regenerate':
      return {
        branchId: input.mutation.materializedBranchId,
        source:
          input.mutation.transcriptShape === 'history-recovered'
            ? 'history_messages'
            : input.mutation.transcriptShape === 'active-view-assistant-only'
              ? 'mixed'
              : 'local-materialization',
        transcriptShape: input.mutation.transcriptShape,
        transcriptRecoveryStatus: resolveTranscriptRecoveryStatus(input.transcriptRecovery),
        assistantTextSource: input.assistantTextSource,
        lastUpdatedBy: 'regenerate',
        updatedAt: input.persistedAt,
        sourceBranchId: input.mutation.sourceBranchId,
        sourceMessageId: input.mutation.sourceAssistantMessageId,
      }
    case 'continue':
      return {
        branchId: input.mutation.materializedBranchId,
        source:
          input.mutation.transcriptShape === 'history-recovered-in-place'
            ? 'history_messages'
            : 'local-materialization',
        transcriptShape: input.mutation.transcriptShape,
        transcriptRecoveryStatus: resolveTranscriptRecoveryStatus(input.transcriptRecovery),
        assistantTextSource: input.assistantTextSource,
        lastUpdatedBy: 'continue',
        updatedAt: input.persistedAt,
        sourceBranchId: input.mutation.sourceBranchId,
        sourceMessageId: input.mutation.sourceAssistantMessageId,
      }
  }
}

function resolveTranscriptRecoveryStatus(
  recovery: DeepSeekTranscriptRecovery,
): DeepSeekStoredBranchExportProvenance['transcriptRecoveryStatus'] {
  return recovery.status
}

function cloneProvenanceEntries(
  provenance: DeepSeekStoredExportProvenance | null | undefined,
): DeepSeekStoredBranchExportProvenance[] {
  return (provenance?.branches ?? []).map(entry => ({ ...entry }))
}

function upsertBranchProvenance(
  collection: DeepSeekStoredBranchExportProvenance[],
  next: DeepSeekStoredBranchExportProvenance,
): void {
  const index = collection.findIndex(entry => entry.branchId === next.branchId)
  if (index >= 0) {
    collection.splice(index, 1, next)
    return
  }

  collection.push(next)
}

function sortBranchProvenance(
  collection: DeepSeekStoredBranchExportProvenance[],
): DeepSeekStoredBranchExportProvenance[] {
  return [...collection].sort((left, right) => left.branchId.localeCompare(right.branchId))
}
