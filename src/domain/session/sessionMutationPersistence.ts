import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekConversationMutation } from '../../types/deepseek-message-mutation.types.js'
import type { DeepSeekSession, DeepSeekStoredSession } from '../../types/deepseek-session.types.js'
import {
  cloneDeepSeekChatModeFact,
  pickLatestDeepSeekChatModeFact,
  rebindDeepSeekChatModeFact,
} from '../deepseek/deepSeekChatModeFact.js'
import { applyDeepSeekMutationExportProvenance } from './sessionExportProvenance.js'

type MutationActiveBranchSource = 'continue' | 'edit-message' | 'regenerate'

export interface UpdateStoredSessionAfterMutationInput {
  storedSession: DeepSeekStoredSession
  materializedSession: DeepSeekSession
  finalUrl: string
  agentId: string
  sessionId: string
  transcriptRecovery: NonNullable<DeepSeekReplyResult['transcriptRecovery']>
  outputTokensUsed: number
  settledAfterMs: number
  activeBranchId: string
  activeBranchSource: MutationActiveBranchSource
  assistantTextSource: DeepSeekReplyResult['assistantTextSource']
  mutation: DeepSeekConversationMutation
  persistedAt?: string | undefined
}

export function updateStoredSessionAfterMutation(
  input: UpdateStoredSessionAfterMutationInput,
): DeepSeekStoredSession {
  const persistedAt = input.persistedAt ?? new Date().toISOString()
  const storedModeFact = rebindDeepSeekChatModeFact({
    fact: pickLatestDeepSeekChatModeFact(
      input.storedSession.session.modeFact,
      input.storedSession.metadata?.modeFact,
      input.materializedSession.modeFact,
    ),
    sourceLayer: 'stored-session',
  })

  return {
    ...input.storedSession,
    session: storedModeFact
      ? {
          ...input.materializedSession,
          modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined,
        }
      : input.materializedSession,
    metadata: input.storedSession.metadata
      ? {
          ...input.storedSession.metadata,
          finalUrl: input.finalUrl,
          authoritativeAgentId: input.agentId,
          authoritativeSessionId: input.sessionId,
          outputTokensUsed: input.outputTokensUsed,
          settledAfterMs: input.settledAfterMs,
          transcriptRecovery: input.transcriptRecovery,
          lastAssistantTextSource: input.assistantTextSource,
          ...(storedModeFact
            ? { modeFact: cloneDeepSeekChatModeFact(storedModeFact) ?? undefined }
            : {}),
          exportProvenance: applyDeepSeekMutationExportProvenance({
            previous: input.storedSession.metadata.exportProvenance,
            mutation: input.mutation,
            transcriptRecovery: input.transcriptRecovery,
            assistantTextSource: input.assistantTextSource,
            persistedAt,
          }),
          lastKnownActiveBranchId: input.activeBranchId,
          lastKnownActiveBranchSource: input.activeBranchSource,
          persistedAt,
        }
      : null,
  }
}
