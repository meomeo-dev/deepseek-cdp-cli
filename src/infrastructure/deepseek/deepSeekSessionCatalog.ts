import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDeepSeekSessionBranchCatalog } from '../../domain/session/sessionBranchCatalog.js'
import type { DeepSeekSessionCatalogSummary } from '../../types/deepseek-session-catalog.types.js'
import type { DeepSeekOnlineSessionCatalogSummary } from '../../types/deepseek-online-session-catalog.types.js'
import type { DeepSeekStoredSession } from '../../types/deepseek-session.types.js'
import { loadStoredSessionFromFile } from './fileSystemSessionStore.js'
import { resolveDeepSeekSessionStoreDir } from './deepSeekStoredSession.js'
import { assertDeepSeekStoredSessionAuthorityConsistency } from './deepSeekStoredSessionAuthority.js'

export interface ListDeepSeekStoredSessionCandidateFilesInput {
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
}

export async function listDeepSeekStoredSessionCandidateFiles(
  input: ListDeepSeekStoredSessionCandidateFilesInput = {},
): Promise<string[]> {
  const directory = resolveDeepSeekSessionStoreDir(input.sessionStoreDir, input.cwd)
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }
}

export async function loadDeepSeekSessionCatalogSummaryFromFile(
  sessionFile: string,
): Promise<DeepSeekSessionCatalogSummary> {
  const storedSession = await loadStoredSessionFromFile(sessionFile)
  return buildDeepSeekSessionCatalogSummary({
    sessionFile,
    storedSession,
  })
}

export function buildDeepSeekSessionCatalogSummary(input: {
  sessionFile: string
  storedSession: DeepSeekStoredSession
}): DeepSeekSessionCatalogSummary {
  const authority = assertDeepSeekStoredSessionAuthorityConsistency({
    sessionFile: input.sessionFile,
    storedSession: input.storedSession,
  })
  const session = input.storedSession.session
  const branchCatalog = buildDeepSeekSessionBranchCatalog(session)
  const defaultBranchSummary =
    branchCatalog.branches.find(branch => branch.branchId === branchCatalog.defaultBranchId) ??
    branchCatalog.branches[0] ??
    null
  const metadata = input.storedSession.metadata
  const messageCount = session.branches.reduce(
    (total, branch) => total + branch.messages.length,
    0,
  )

  return {
    sessionId: authority.authoritativeSessionId,
    title: session.title,
    createdAt: session.createdAt,
    persistedAt: input.storedSession.catalog?.updatedAt ?? metadata?.persistedAt ?? session.createdAt,
    userPromptPreview:
      metadata?.firstBatchSummary.userPromptPreview ?? defaultBranchSummary?.previewText ?? null,
    sessionFile: input.sessionFile,
    finalUrl:
      metadata?.finalUrl ??
      (session.agentId && authority.authoritativeSessionId
        ? buildCanonicalDeepSeekSessionUrl(session.agentId, authority.authoritativeSessionId)
        : null),
    branchCount: session.branches.length,
    messageCount,
    metadataSource: metadata
      ? 'stored-session'
      : input.storedSession.catalog
        ? 'catalog-only-session'
        : 'legacy-session',
    hasOpenAIHistoryBootstrap: Boolean(metadata?.openaiHistoryBootstrap),
  }
}

export function createCatalogOnlyStoredSessionFromOnlineSummary(input: {
  summary: DeepSeekOnlineSessionCatalogSummary
  syncedAt?: string | undefined
}): DeepSeekStoredSession {
  const syncedAt = input.syncedAt ?? new Date().toISOString()

  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session: {
      id: input.summary.sessionId,
      agentId: 'chat',
      title: input.summary.title,
      createdAt: input.summary.updatedAt,
      branches: [],
    },
    metadata: null,
    catalog: {
      version: 1,
      title: input.summary.title,
      updatedAt: input.summary.updatedAt,
      pinned: input.summary.pinned,
      discoverySource: input.summary.discoverySource,
      syncedAt,
    },
  }
}

export function applyOnlineCatalogSummaryToStoredSession(input: {
  storedSession: DeepSeekStoredSession
  summary: DeepSeekOnlineSessionCatalogSummary
  syncedAt?: string | undefined
}): {
  changed: boolean
  storedSession: DeepSeekStoredSession
} {
  const syncedAt = input.syncedAt ?? new Date().toISOString()
  const nextCatalog = {
    version: 1 as const,
    title: input.summary.title,
    updatedAt: input.summary.updatedAt,
    pinned: input.summary.pinned,
    discoverySource: input.summary.discoverySource,
    syncedAt,
  }
  const currentCatalog = input.storedSession.catalog
  const titleChanged = input.storedSession.session.title !== input.summary.title
  const catalogChanged =
    !currentCatalog ||
    currentCatalog.title !== nextCatalog.title ||
    currentCatalog.updatedAt !== nextCatalog.updatedAt ||
    currentCatalog.pinned !== nextCatalog.pinned ||
    currentCatalog.discoverySource !== nextCatalog.discoverySource

  if (!titleChanged && !catalogChanged) {
    return {
      changed: false,
      storedSession: input.storedSession,
    }
  }

  return {
    changed: true,
    storedSession: {
      ...input.storedSession,
      session: {
        ...input.storedSession.session,
        title: input.summary.title,
      },
      catalog: nextCatalog,
    },
  }
}

function buildCanonicalDeepSeekSessionUrl(agentId: string, sessionId: string): string {
  return `https://chat.deepseek.com/a/${encodeURIComponent(agentId)}/s/${encodeURIComponent(sessionId)}`
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error['code'] === code
}
