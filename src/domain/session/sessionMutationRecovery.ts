import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekSession } from '../../types/deepseek-session.types.js'
import type { DeepSeekTranscriptRecovery } from '../../types/deepseek-transcript-recovery.types.js'

export function resolveMutationTranscriptRecovery(input: {
  previous: DeepSeekTranscriptRecovery | null
  next: DeepSeekTranscriptRecovery
  recoveredSession?: DeepSeekSession | undefined
}): DeepSeekTranscriptRecovery {
  if (
    input.recoveredSession ||
    input.next.status === 'recovered' ||
    input.previous === null ||
    input.previous.status !== 'recovered'
  ) {
    return input.next
  }

  return input.previous
}

export function resolveMutationAssistantTextSource(input: {
  recoveredSession?: DeepSeekSession | null | undefined
  assistantMessageId?: string | null | undefined
  fallback: DeepSeekReplyResult['assistantTextSource']
}): DeepSeekReplyResult['assistantTextSource'] {
  const assistantMessageId = normalizeOptionalString(input.assistantMessageId)
  if (
    input.recoveredSession &&
    assistantMessageId &&
    sessionContainsMessageId(input.recoveredSession, assistantMessageId)
  ) {
    return 'history_messages'
  }

  return input.fallback
}

function sessionContainsMessageId(session: DeepSeekSession, messageId: string): boolean {
  return session.branches.some(branch =>
    branch.messages.some(message => message.id === messageId),
  )
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}
