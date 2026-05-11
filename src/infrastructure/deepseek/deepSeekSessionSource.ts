import type { DeepSeekResolvedSessionSource } from '../../types/deepseek-branch-catalog.types.js'
import { buildDeepSeekSessionFilePath } from './deepSeekStoredSession.js'
import { loadStoredSessionFromFile } from './fileSystemSessionStore.js'
import { assertDeepSeekStoredSessionAuthorityConsistency } from './deepSeekStoredSessionAuthority.js'

export interface ResolveDeepSeekSessionSourceInput {
  sessionFile?: string | undefined
  sessionId?: string | undefined
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
}

export async function resolveDeepSeekSessionSource(
  input: ResolveDeepSeekSessionSourceInput,
): Promise<DeepSeekResolvedSessionSource> {
  if (!input.sessionFile && !input.sessionId) {
    throw new Error('Either sessionFile or sessionId is required.')
  }

  const sessionFile =
    input.sessionFile ??
    buildDeepSeekSessionFilePath(input.sessionId as string, input.sessionStoreDir, input.cwd)
  const storedSession = await loadStoredSessionFromFile(sessionFile)
  const authority = assertDeepSeekStoredSessionAuthorityConsistency({
    sessionFile,
    storedSession,
  })
  const { authoritativeSessionId, authoritativeAgentId } = authority

  if (input.sessionId && authoritativeSessionId !== input.sessionId) {
    throw new Error(
      `Stored session authority mismatch: requested ${input.sessionId}, but resolved ${authoritativeSessionId} from ${sessionFile}.`,
    )
  }

  return {
    sessionFile,
    storedSession,
    session: storedSession.session,
    authoritativeSessionId,
    authoritativeAgentId,
    finalUrl: storedSession.metadata?.finalUrl ?? null,
  }
}
