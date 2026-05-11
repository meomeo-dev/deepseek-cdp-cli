import { resolveDeepSeekSessionMessageTarget } from '../../domain/session/sessionMessageTarget.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import type { DeepSeekMessage } from '../../types/deepseek-session.types.js'

export interface ResolveDeepSeekMessageTargetInput {
  sessionFile?: string | undefined
  sessionId?: string | undefined
  sessionStoreDir?: string | undefined
  branchId?: string | undefined
  messageId?: string | undefined
  activeBranchId?: string | undefined
  activeBranchSource?: 'page' | 'unavailable' | undefined
  allowedRoles?: DeepSeekMessage['role'][] | undefined
}

export async function resolveDeepSeekMessageTarget(
  input: ResolveDeepSeekMessageTargetInput,
) {
  const source = await resolveDeepSeekSessionSource({
    sessionFile: input.sessionFile,
    sessionId: input.sessionId,
    sessionStoreDir: input.sessionStoreDir,
  })
  const activeBranchId =
    normalizeOptionalString(input.activeBranchId) ??
    normalizeOptionalString(source.storedSession.metadata?.lastKnownActiveBranchId)
  const activeBranchSource =
    activeBranchId === null
      ? 'unavailable'
      : normalizeOptionalString(input.activeBranchId)
        ? input.activeBranchSource ?? 'page'
        : 'stored-session'

  return resolveDeepSeekSessionMessageTarget({
    session: source.session,
    sessionFile: source.sessionFile,
    branchId: input.branchId,
    messageId: input.messageId,
    activeBranchId,
    activeBranchSource,
    allowedRoles: input.allowedRoles,
  })
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}
