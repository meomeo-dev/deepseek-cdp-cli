import { buildDeepSeekSessionBranchCatalog } from '../../domain/session/sessionBranchCatalog.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import type { DeepSeekSessionBranchCatalog } from '../../types/deepseek-branch-catalog.types.js'

export interface ListDeepSeekSessionBranchesInput {
  sessionFile?: string | undefined
  sessionId?: string | undefined
  sessionStoreDir?: string | undefined
}

export interface ListDeepSeekSessionBranchesResult {
  sessionFile: string
  sessionId: string
  authoritativeSessionId: string
  authoritativeAgentId: string
  finalUrl: string | null
  catalog: DeepSeekSessionBranchCatalog
}

export async function listDeepSeekSessionBranches(
  input: ListDeepSeekSessionBranchesInput,
): Promise<ListDeepSeekSessionBranchesResult> {
  const source = await resolveDeepSeekSessionSource(input)
  const activeBranchId = source.storedSession.metadata?.lastKnownActiveBranchId ?? null
  const activeBranchSource = activeBranchId ? 'stored-session' : 'unavailable'
  return {
    sessionFile: source.sessionFile,
    sessionId: source.session.id,
    authoritativeSessionId: source.authoritativeSessionId,
    authoritativeAgentId: source.authoritativeAgentId,
    finalUrl: source.finalUrl,
    catalog: buildDeepSeekSessionBranchCatalog(source.session, {
      activeBranchId,
      activeBranchSource,
    }),
  }
}
