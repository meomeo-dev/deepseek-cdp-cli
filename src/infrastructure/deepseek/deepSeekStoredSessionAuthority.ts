import type { DeepSeekStoredSession } from '../../types/deepseek-session.types.js'

export interface DeepSeekStoredSessionAuthority {
  authoritativeSessionId: string
  authoritativeAgentId: string
}

export function resolveDeepSeekStoredSessionAuthority(
  storedSession: DeepSeekStoredSession,
): DeepSeekStoredSessionAuthority {
  return {
    authoritativeSessionId: storedSession.metadata?.authoritativeSessionId ?? storedSession.session.id,
    authoritativeAgentId: storedSession.metadata?.authoritativeAgentId ?? storedSession.session.agentId,
  }
}

export function assertDeepSeekStoredSessionAuthorityConsistency(input: {
  sessionFile: string
  storedSession: DeepSeekStoredSession
}): DeepSeekStoredSessionAuthority {
  const authority = resolveDeepSeekStoredSessionAuthority(input.storedSession)

  if (input.storedSession.session.id !== authority.authoritativeSessionId) {
    throw new Error(
      `Stored session ${input.sessionFile} is inconsistent: session.id does not match metadata.authoritativeSessionId.`,
    )
  }

  if (input.storedSession.session.agentId !== authority.authoritativeAgentId) {
    throw new Error(
      `Stored session ${input.sessionFile} is inconsistent: session.agentId does not match metadata.authoritativeAgentId.`,
    )
  }

  return authority
}
