import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  DeepSeekSession,
  DeepSeekStoredSession,
} from '../../types/deepseek-session.types.js'
import { isDeepSeekSession, mapHistoryMessagesEnvelopeToSession } from './historyMessagesMapper.js'

export async function loadSessionFromFile(filePath: string): Promise<DeepSeekSession> {
  return (await loadStoredSessionFromFile(filePath)).session
}

export async function loadStoredSessionFromFile(filePath: string): Promise<DeepSeekStoredSession> {
  const content = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(content) as unknown

  if (isDeepSeekStoredSession(parsed)) {
    return parsed
  }

  if (isDeepSeekSession(parsed)) {
    return createLegacyStoredSession(parsed)
  }

  return createLegacyStoredSession(mapHistoryMessagesEnvelopeToSession(parsed))
}

export async function saveSessionToFile(filePath: string, session: DeepSeekSession): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

export async function saveStoredSessionToFile(
  filePath: string,
  storedSession: DeepSeekStoredSession,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(storedSession, null, 2)}\n`, 'utf8')
}

export async function deleteStoredSessionFile(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

function isDeepSeekStoredSession(value: unknown): value is DeepSeekStoredSession {
  if (!isRecord(value)) {
    return false
  }

  return (
    value['kind'] === 'deepseek-stored-session' &&
    value['version'] === 1 &&
    isDeepSeekSession(value['session'])
  )
}

function createLegacyStoredSession(session: DeepSeekSession): DeepSeekStoredSession {
  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session,
    metadata: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error['code'] === code
}
