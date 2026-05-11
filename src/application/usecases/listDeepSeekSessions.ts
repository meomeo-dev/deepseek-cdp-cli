import {
  listDeepSeekStoredSessionCandidateFiles,
  loadDeepSeekSessionCatalogSummaryFromFile,
} from '../../infrastructure/deepseek/deepSeekSessionCatalog.js'
import { resolveDeepSeekSessionStoreDir } from '../../infrastructure/deepseek/deepSeekStoredSession.js'
import {
  createDeepSeekSessionCatalogAllInvalidError,
} from '../../shared/errors/deepSeekSessionCatalogError.js'
import type {
  DeepSeekSessionCatalogResult,
  DeepSeekSessionCatalogSummary,
  DeepSeekSessionCatalogWarning,
  DeepSeekSessionCatalogWarningCode,
} from '../../types/deepseek-session-catalog.types.js'

export interface ListDeepSeekSessionsInput {
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
  query?: string | undefined
  limit?: number | null | undefined
}

export async function listDeepSeekSessions(
  input: ListDeepSeekSessionsInput = {},
): Promise<DeepSeekSessionCatalogResult> {
  const resolvedSessionStoreDir = resolveDeepSeekSessionStoreDir(input.sessionStoreDir, input.cwd)
  const normalizedQuery = normalizeQuery(input.query)
  const normalizedLimit = normalizeLimit(input.limit)
  const candidateFiles = await listDeepSeekStoredSessionCandidateFiles(input)
  const warnings: DeepSeekSessionCatalogWarning[] = []
  const validSessions: DeepSeekSessionCatalogSummary[] = []

  for (const sessionFile of candidateFiles) {
    try {
      const summary = await loadDeepSeekSessionCatalogSummaryFromFile(sessionFile)
      validSessions.push(summary)
    } catch (error) {
      warnings.push(
        createSessionCatalogWarning({
          sessionFile,
          error,
        }),
      )
    }
  }

  const sortedSessions = [...validSessions].sort(compareSessionCatalogSummaries)
  const matchedSessions = normalizedQuery
    ? sortedSessions.filter(session => matchesSessionQuery(session, normalizedQuery))
    : sortedSessions
  const limitedSessions =
    normalizedLimit === null
      ? matchedSessions
      : matchedSessions.slice(0, normalizedLimit)
  const result: DeepSeekSessionCatalogResult = {
    sessionStoreDir: resolvedSessionStoreDir,
    query: normalizedQuery,
    limit: normalizedLimit,
    scannedFileCount: candidateFiles.length,
    validSessionCount: sortedSessions.length,
    matchedSessionCount: matchedSessions.length,
    returnedSessionCount: limitedSessions.length,
    truncated:
      normalizedLimit !== null && normalizedLimit < matchedSessions.length,
    warnings,
    sessions: limitedSessions,
  }

  if (candidateFiles.length > 0 && sortedSessions.length === 0) {
    throw createDeepSeekSessionCatalogAllInvalidError(result)
  }

  return result
}

function normalizeQuery(query: string | undefined): string | null {
  const normalized = query?.trim() ?? ''
  return normalized ? normalized : null
}

function normalizeLimit(limit: number | null | undefined): number | null {
  if (limit === undefined || limit === null) {
    return null
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error('`limit` must be a non-negative integer when provided.')
  }

  return limit
}

function createSessionCatalogWarning(input: {
  sessionFile: string
  error: unknown
}): DeepSeekSessionCatalogWarning {
  return {
    code: resolveSessionCatalogWarningCode(input.error),
    sessionFile: input.sessionFile,
    message: formatErrorMessage(input.error),
  }
}

function resolveSessionCatalogWarningCode(error: unknown): DeepSeekSessionCatalogWarningCode {
  const message = formatErrorMessage(error)
  return /is inconsistent:/i.test(message)
    ? 'session_file_inconsistent'
    : 'session_file_load_failed'
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'DeepSeek session catalog failed with an unknown error.'
}

function matchesSessionQuery(
  session: DeepSeekSessionCatalogSummary,
  query: string,
): boolean {
  const normalizedNeedle = query.toLocaleLowerCase()
  return [
    session.sessionId,
    session.title,
    session.userPromptPreview ?? '',
  ].some(value => value.toLocaleLowerCase().includes(normalizedNeedle))
}

function compareSessionCatalogSummaries(
  left: DeepSeekSessionCatalogSummary,
  right: DeepSeekSessionCatalogSummary,
): number {
  const persistedAtDiff = compareIsoTimestampsDesc(left.persistedAt, right.persistedAt)
  if (persistedAtDiff !== 0) {
    return persistedAtDiff
  }

  return left.sessionId.localeCompare(right.sessionId)
}

function compareIsoTimestampsDesc(left: string, right: string): number {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }

  if (Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return -1
  }

  if (!Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return 1
  }

  return right.localeCompare(left)
}
