import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CliLastSessionDocument,
} from '../../types/cli-preferences.types.js'
import {
  isNodeError,
  type PrivateAtomicWrite,
  writePrivateFileAtomically,
} from './privateAtomicFile.js'
import { resolveCliPreferencesConfigDir } from './fileSystemCliPreferencesStore.js'

export interface FileSystemLastSessionStoreOptions {
  configDir?: string | undefined
  now?: (() => Date) | undefined
  atomicWrite?: PrivateAtomicWrite | undefined
}

export class FileSystemLastSessionStore {
  readonly configDir: string
  private readonly filePath: string
  private readonly now: () => Date
  private readonly atomicWrite: PrivateAtomicWrite

  constructor(options: FileSystemLastSessionStoreOptions = {}) {
    this.configDir = options.configDir ?? resolveCliPreferencesConfigDir()
    this.filePath = join(this.configDir, 'last-session.json')
    this.now = options.now ?? (() => new Date())
    this.atomicWrite = options.atomicWrite ?? writePrivateFileAtomically
  }

  async load(): Promise<CliLastSessionDocument | null> {
    let content: string
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return null
      }
      throw error
    }

    try {
      return parseLastSessionDocument(JSON.parse(content) as unknown)
    } catch (error) {
      throw new Error(
        `Invalid last-session file ${this.filePath}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  async save(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      throw new Error('Last session id must be a non-empty string.')
    }
    const document: CliLastSessionDocument = {
      schemaVersion: 1,
      sessionId: normalizedSessionId,
      updatedAt: this.now().toISOString(),
    }
    await this.atomicWrite(
      this.filePath,
      `${JSON.stringify(document, null, 2)}\n`,
    )
  }

  async clear(): Promise<boolean> {
    try {
      await unlink(this.filePath)
      return true
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return false
      }
      throw error
    }
  }
}

function parseLastSessionDocument(value: unknown): CliLastSessionDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('last-session document must be an object.')
  }
  const record = value as Record<string, unknown>
  const expectedKeys = ['schemaVersion', 'sessionId', 'updatedAt']
  const actualKeys = Object.keys(record)
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some(key => !actualKeys.includes(key))
  ) {
    throw new Error('last-session document fields are invalid.')
  }
  if (record['schemaVersion'] !== 1) {
    throw new Error('schemaVersion must be 1.')
  }
  if (typeof record['sessionId'] !== 'string' || !record['sessionId'].trim()) {
    throw new Error('sessionId must be a non-empty string.')
  }
  if (
    typeof record['updatedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(record['updatedAt'])) ||
    new Date(record['updatedAt']).toISOString() !== record['updatedAt']
  ) {
    throw new Error('updatedAt must be an ISO timestamp.')
  }
  return {
    schemaVersion: 1,
    sessionId: record['sessionId'],
    updatedAt: record['updatedAt'],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
