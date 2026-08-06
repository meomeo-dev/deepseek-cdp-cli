import { randomUUID } from 'node:crypto'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  createEmptyCliPreferencesDocument,
  parseCliPreferencesDocument,
  resetCliPreferenceValue,
  setCliPreferenceValue,
} from '../../domain/preferences/cliPreferenceCatalog.js'
import type {
  CliPreferenceHistorySnapshot,
  CliPreferenceKey,
  CliPreferences,
  CliPreferencesDocument,
  CliPreferenceValue,
} from '../../types/cli-preferences.types.js'
import {
  isNodeError,
  type PrivateAtomicWrite,
  withPrivateFileLock,
  writePrivateFileAtomically,
  writePrivateFileExclusively,
} from './privateAtomicFile.js'

const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const PREFERENCES_FILE_NAME = 'preferences.json'
const HISTORY_DIRECTORY_NAME = 'history'
const LOCK_FILE_NAME = '.preferences.lock'

export interface FileSystemCliPreferencesStoreOptions {
  configDir?: string | undefined
  now?: (() => Date) | undefined
  atomicWrite?: PrivateAtomicWrite | undefined
}

export class FileSystemCliPreferencesStore {
  readonly configDir: string
  private readonly now: () => Date
  private readonly atomicWrite: PrivateAtomicWrite
  private readonly preferencesFile: string
  private readonly historyDirectory: string
  private readonly lockFile: string

  constructor(options: FileSystemCliPreferencesStoreOptions = {}) {
    this.configDir = options.configDir ?? resolveCliPreferencesConfigDir()
    this.now = options.now ?? (() => new Date())
    this.atomicWrite = options.atomicWrite ?? writePrivateFileAtomically
    this.preferencesFile = join(this.configDir, PREFERENCES_FILE_NAME)
    this.historyDirectory = join(this.configDir, HISTORY_DIRECTORY_NAME)
    this.lockFile = join(this.configDir, LOCK_FILE_NAME)
  }

  async load(): Promise<CliPreferencesDocument> {
    let content: string
    try {
      content = await readFile(this.preferencesFile, 'utf8')
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return createEmptyCliPreferencesDocument(this.now())
      }
      throw error
    }

    try {
      return parseCliPreferencesDocument(JSON.parse(content) as unknown)
    } catch (error) {
      throw new Error(
        `Invalid preferences file ${this.preferencesFile}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  async setPreference(
    key: CliPreferenceKey,
    value: CliPreferenceValue,
    expectedRevision: number,
  ): Promise<CliPreferencesDocument> {
    return this.updatePreferences(expectedRevision, preferences =>
      setCliPreferenceValue(preferences, key, value))
  }

  async resetPreference(
    key: CliPreferenceKey,
    expectedRevision: number,
  ): Promise<CliPreferencesDocument> {
    return this.updatePreferences(expectedRevision, preferences =>
      resetCliPreferenceValue(preferences, key))
  }

  async createSnapshot(
    expectedDocument: CliPreferencesDocument,
  ): Promise<CliPreferenceHistorySnapshot> {
    return withPrivateFileLock(this.lockFile, async () => {
      const current = await this.load()
      assertExpectedRevision(current, expectedDocument.revision)
      const exitedAt = this.now().toISOString()
      const snapshot: CliPreferenceHistorySnapshot = {
        schemaVersion: 1,
        id: buildSnapshotId(exitedAt, current.revision),
        exitedAt,
        preferences: current,
      }
      await writePrivateFileExclusively(
        join(this.historyDirectory, `${snapshot.id}.json`),
        serializeJson(snapshot),
      )
      await this.pruneExpiredHistoryAt(this.now())
      return snapshot
    })
  }

  async listHistory(): Promise<CliPreferenceHistorySnapshot[]> {
    let names: string[]
    try {
      names = await readdir(this.historyDirectory)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return []
      }
      throw error
    }

    const snapshots = await Promise.all(
      names
        .filter(name => name.endsWith('.json'))
        .map(name => this.loadHistorySnapshot(name)),
    )
    return snapshots.sort((left, right) => {
      const timeDifference = Date.parse(right.exitedAt) - Date.parse(left.exitedAt)
      return timeDifference === 0
        ? right.id.localeCompare(left.id)
        : timeDifference
    })
  }

  async restore(
    snapshotId: string,
    expectedRevision: number,
  ): Promise<CliPreferencesDocument> {
    const snapshot = (await this.listHistory()).find(
      candidate => candidate.id === snapshotId,
    )
    if (!snapshot) {
      throw new Error(`Unknown preferences history version: ${snapshotId}`)
    }

    const restored = await this.updatePreferences(
      expectedRevision,
      () => clonePreferences(snapshot.preferences.preferences),
    )
    await this.pruneExpiredHistoryAt(this.now())
    return restored
  }

  private async updatePreferences(
    expectedRevision: number,
    update: (preferences: CliPreferences) => CliPreferences,
  ): Promise<CliPreferencesDocument> {
    return withPrivateFileLock(this.lockFile, async () => {
      const current = await this.load()
      assertExpectedRevision(current, expectedRevision)
      const next: CliPreferencesDocument = {
        schemaVersion: 1,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
        preferences: update(current.preferences),
      }
      await this.atomicWrite(this.preferencesFile, serializeJson(next))
      return next
    })
  }

  private async loadHistorySnapshot(
    fileName: string,
  ): Promise<CliPreferenceHistorySnapshot> {
    const filePath = join(this.historyDirectory, fileName)
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      const snapshot = parseHistorySnapshot(parsed)
      if (basename(fileName) !== `${snapshot.id}.json`) {
        throw new Error('snapshot id does not match its file name.')
      }
      return snapshot
    } catch (error) {
      throw new Error(
        `Invalid preferences history file ${filePath}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  private async pruneExpiredHistoryAt(now: Date): Promise<void> {
    const cutoff = now.getTime() - HISTORY_RETENTION_MS
    for (const snapshot of await this.listHistory()) {
      if (Date.parse(snapshot.exitedAt) >= cutoff) {
        continue
      }
      const filePath = join(this.historyDirectory, `${snapshot.id}.json`)
      await unlink(filePath)
    }
  }
}

export function resolveCliPreferencesConfigDir(input: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined
  homeDir?: string | undefined
} = {}): string {
  const env = input.env ?? process.env
  const xdgConfigHome = env['XDG_CONFIG_HOME']?.trim()
  if (xdgConfigHome) {
    return join(xdgConfigHome, 'deepseek-cdp-cli')
  }
  return join(input.homeDir ?? homedir(), '.config', 'deepseek-cdp-cli')
}

function parseHistorySnapshot(value: unknown): CliPreferenceHistorySnapshot {
  assertRecord(value, 'history snapshot')
  assertExactKeys(
    value,
    ['schemaVersion', 'id', 'exitedAt', 'preferences'],
    'history snapshot',
  )
  if (value['schemaVersion'] !== 1) {
    throw new Error('schemaVersion must be 1.')
  }
  if (typeof value['id'] !== 'string' || !value['id'].trim()) {
    throw new Error('id must be a non-empty string.')
  }
  assertIsoTimestamp(value['exitedAt'], 'exitedAt')
  return {
    schemaVersion: 1,
    id: value['id'],
    exitedAt: value['exitedAt'],
    preferences: parseCliPreferencesDocument(value['preferences']),
  }
}

function buildSnapshotId(exitedAt: string, revision: number): string {
  const timestamp = exitedAt.replaceAll(':', '').replaceAll('.', '')
  return `${timestamp}-r${revision}-${randomUUID().slice(0, 8)}`
}

function assertExpectedRevision(
  current: CliPreferencesDocument,
  expectedRevision: number,
): void {
  if (current.revision === expectedRevision) {
    return
  }
  throw new Error(
    'Concurrent preferences update detected: '
      + `expected revision ${expectedRevision}, found ${current.revision}.`,
  )
}

function clonePreferences(preferences: CliPreferences): CliPreferences {
  return { reply: { ...preferences.reply } }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value)
  const missing = expected.filter(key => !actual.includes(key))
  const unknown = actual.filter(key => !expected.includes(key))
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `${label} fields are invalid; missing=[${missing.join(', ')}], `
        + `unknown=[${unknown.join(', ')}].`,
    )
  }
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be an ISO timestamp.`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
