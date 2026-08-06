import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  CLI_PREFERENCE_CATALOG,
  diffCliPreferences,
  formatCliPreferenceValue,
  isCliPreferenceKey,
  parseCliPreferenceValue,
  readCliPreferenceValue,
  resolveCliReplyPreferences,
} from '../../domain/preferences/cliPreferenceCatalog.js'
import {
  FileSystemCliPreferencesStore,
} from '../../infrastructure/preferences/fileSystemCliPreferencesStore.js'
import type {
  CliPreferenceHistorySnapshot,
  CliPreferenceKey,
  CliPreferencesDocument,
  CliPreferenceValue,
} from '../../types/cli-preferences.types.js'

const CLI_PREFERENCES_INTERRUPT = '\u0003'

interface CliPreferencesSessionStore {
  load: () => Promise<CliPreferencesDocument>
  setPreference: (
    key: CliPreferenceKey,
    value: CliPreferenceValue,
    expectedRevision: number,
  ) => Promise<CliPreferencesDocument>
  resetPreference: (
    key: CliPreferenceKey,
    expectedRevision: number,
  ) => Promise<CliPreferencesDocument>
  createSnapshot: (
    document: CliPreferencesDocument,
  ) => Promise<CliPreferenceHistorySnapshot>
  listHistory: () => Promise<CliPreferenceHistorySnapshot[]>
  restore: (
    snapshotId: string,
    expectedRevision: number,
  ) => Promise<CliPreferencesDocument>
}

export interface CliPreferencesSessionOptions {
  store: CliPreferencesSessionStore
  ask: (prompt: string) => Promise<string | null>
  write: (chunk: string) => void
}

export async function runCliPreferencesSession(
  options: CliPreferencesSessionOptions,
): Promise<void> {
  const initial = await options.store.load()
  let current = initial
  options.write('DeepSeek CLI preferences. Type `help` for commands.\n')
  options.write(renderPreferencesTable(current))

  while (true) {
    const answer = await options.ask('preferences> ')
    if (answer === null) {
      const confirmed = await confirmExit(options, initial, current, 'EOF')
      if (confirmed) {
        await snapshotConfirmedExit(options, current)
      } else {
        options.write(
          'Exit was not confirmed; no history snapshot was created.\n',
        )
      }
      return
    }
    if (answer === CLI_PREFERENCES_INTERRUPT) {
      if (await confirmExit(options, initial, current, 'SIGINT')) {
        await snapshotConfirmedExit(options, current)
        return
      }
      options.write('Exit cancelled.\n')
      continue
    }

    const line = answer.trim()
    if (!line) {
      continue
    }
    if (line === 'exit' || line === 'quit') {
      if (await confirmExit(options, initial, current, line)) {
        await snapshotConfirmedExit(options, current)
        return
      }
      options.write('Exit cancelled.\n')
      continue
    }

    try {
      current = await executePreferencesCommand(options, current, line)
    } catch (error) {
      options.write(`Error: ${errorMessage(error)}\n`)
    }
  }
}

export async function runCliPreferencesShell(input: {
  store?: FileSystemCliPreferencesStore | undefined
  input?: NodeJS.ReadableStream | undefined
  output?: NodeJS.WritableStream | undefined
} = {}): Promise<void> {
  const output = input.output ?? stdout
  const shellState: { active: readline.Interface | null } = { active: null }
  let activeQuestionAbort: AbortController | null = null
  const handleInterrupt = () => {
    activeQuestionAbort?.abort()
  }
  process.on('SIGINT', handleInterrupt)
  try {
    await runCliPreferencesSession({
      store: input.store ?? new FileSystemCliPreferencesStore(),
      ask: async prompt => {
        shellState.active ??= readline.createInterface({
          input: input.input ?? stdin,
          output,
        })
        const controller = new AbortController()
        activeQuestionAbort = controller
        try {
          return await askReadline(
            shellState.active,
            prompt,
            controller.signal,
          )
        } finally {
          if (activeQuestionAbort === controller) {
            activeQuestionAbort = null
          }
        }
      },
      write: chunk => {
        output.write(chunk)
      },
    })
  } finally {
    process.off('SIGINT', handleInterrupt)
    shellState.active?.close()
  }
}

function renderPreferencesTable(document: CliPreferencesDocument): string {
  const resolved = resolveCliReplyPreferences({
    saved: document.preferences,
  })
  const lines = CLI_PREFERENCE_CATALOG.map(descriptor => {
    const saved = readCliPreferenceValue(document.preferences, descriptor.key)
    const effective = resolved.options[descriptor.property]
    return `${descriptor.key} | built-in=${formatCliPreferenceValue(
      descriptor.builtInValue,
    )} | saved=${formatCliPreferenceValue(saved)} | effective=${
      formatCliPreferenceValue(effective)
    }`
  })
  return `${lines.join('\n')}\n`
}

async function executePreferencesCommand(
  options: CliPreferencesSessionOptions,
  current: CliPreferencesDocument,
  line: string,
): Promise<CliPreferencesDocument> {
  if (line === 'help') {
    options.write(buildPreferencesHelp())
    return current
  }
  if (line === 'show' || line === 'list') {
    options.write(renderPreferencesTable(current))
    return current
  }
  if (line === 'history') {
    options.write(renderHistory(await options.store.listHistory()))
    return current
  }

  const segments = line.split(/\s+/u)
  if (segments[0] === 'set' && segments.length === 3) {
    const key = requirePreferenceKey(segments[1])
    const value = parseCliPreferenceValue(key, segments[2] ?? '')
    const saved = await options.store.setPreference(
      key,
      value,
      current.revision,
    )
    options.write(`Saved ${key}=${formatCliPreferenceValue(value)}.\n`)
    return saved
  }
  if (segments[0] === 'reset' && segments.length === 2) {
    const key = requirePreferenceKey(segments[1])
    const saved = await options.store.resetPreference(key, current.revision)
    options.write(`Reset ${key} to its built-in value.\n`)
    return saved
  }
  if (segments[0] === 'restore' && segments.length === 2) {
    return restoreHistoryVersion(options, current, segments[1] ?? '')
  }

  throw new Error(
    'Unknown command. Use show, set <key> <value>, reset <key>, '
      + 'history, restore <id>, or exit.',
  )
}

async function restoreHistoryVersion(
  options: CliPreferencesSessionOptions,
  current: CliPreferencesDocument,
  snapshotId: string,
): Promise<CliPreferencesDocument> {
  const snapshot = (await options.store.listHistory()).find(
    candidate => candidate.id === snapshotId,
  )
  if (!snapshot) {
    throw new Error(`Unknown preferences history version: ${snapshotId}`)
  }

  options.write(`Restore preview: ${snapshot.id} (${snapshot.exitedAt})\n`)
  options.write(renderDiff(current, snapshot.preferences))
  const confirmation = await options.ask('Restore this version? [y/N] ')
  if (!isConfirmation(confirmation)) {
    options.write('Restore cancelled.\n')
    return current
  }

  const restored = await options.store.restore(snapshot.id, current.revision)
  options.write(`Restored ${snapshot.id} and saved revision ${restored.revision}.\n`)
  return restored
}

async function confirmExit(
  options: CliPreferencesSessionOptions,
  initial: CliPreferencesDocument,
  current: CliPreferencesDocument,
  reason: string,
): Promise<boolean> {
  options.write(`Exit summary (${reason}):\n`)
  options.write(renderDiff(initial, current))
  return isConfirmation(await options.ask('Confirm exit? [y/N] '))
}

async function snapshotConfirmedExit(
  options: CliPreferencesSessionOptions,
  current: CliPreferencesDocument,
): Promise<void> {
  const snapshot = await options.store.createSnapshot(current)
  options.write(`Created history version ${snapshot.id}.\n`)
}

function renderDiff(
  before: CliPreferencesDocument,
  after: CliPreferencesDocument,
): string {
  const entries = diffCliPreferences(before.preferences, after.preferences)
  if (entries.length === 0) {
    return '(no changes)\n'
  }
  return `${entries.map(entry =>
    `${entry.key}: ${formatCliPreferenceValue(entry.before)} -> ${
      formatCliPreferenceValue(entry.after)
    }`).join('\n')}\n`
}

function renderHistory(history: CliPreferenceHistorySnapshot[]): string {
  if (history.length === 0) {
    return 'No preferences history versions.\n'
  }
  return `${history.map(snapshot =>
    `${snapshot.id} | exitedAt=${snapshot.exitedAt} | revision=${
      snapshot.preferences.revision
    }`).join('\n')}\n`
}

function buildPreferencesHelp(): string {
  return [
    'show | list                         Show all effective preferences',
    'set <key> <value>                   Save one value immediately',
    'reset <key>                         Remove one saved value immediately',
    'history                             List recent confirmed exits',
    'restore <id>                        Preview and restore one version',
    'exit | quit                         Confirm exit and create one version',
    '',
  ].join('\n')
}

function requirePreferenceKey(value: string | undefined): CliPreferenceKey {
  if (!value || !isCliPreferenceKey(value)) {
    throw new Error(`Unknown configurable preference: ${value ?? ''}`)
  }
  return value
}

function isConfirmation(value: string | null): boolean {
  return value?.trim().toLowerCase() === 'y' ||
    value?.trim().toLowerCase() === 'yes'
}

async function askReadline(
  shell: readline.Interface,
  prompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    return await shell.question(prompt, { signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return CLI_PREFERENCES_INTERRUPT
    }
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_USE_AFTER_CLOSE'
    ) {
      return null
    }
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
