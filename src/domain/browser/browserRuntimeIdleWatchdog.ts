import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { BrowserRuntimeJanitor } from './browserRuntimeJanitor.js'
import { BrowserRuntimeRegistry } from './browserRuntimeRegistry.js'
import {
  buildBrowserRuntimeIdleWatchFilePath,
} from '../../shared/runtime/runtimePaths.js'
import type {
  BrowserRuntimeDescriptor,
  BrowserRuntimeLease,
} from '../../types/browser-runtime.types.js'

export const DEEPSEEK_IDLE_WATCH_CWD_ENV = 'DEEPSEEK_CDP_BROWSER_IDLE_WATCH_CWD'
export const DEEPSEEK_IDLE_WATCH_RUNTIME_DIR_ENV =
  'DEEPSEEK_CDP_BROWSER_IDLE_WATCH_RUNTIME_DIR'

const WATCHDOG_POLL_INTERVAL_MS = 30_000

interface BrowserRuntimeIdleWatchRecord {
  runtimeId: string
  watcherPid: number
  createdAt: string
}

export interface EnsureBrowserRuntimeIdleWatchdogInput {
  runtimeId: string
  cwd?: string | undefined
  runtimeDir?: string | undefined
  cliEntryPath?: string | undefined
  execPath?: string | undefined
  execArgv?: string[] | undefined
  env?: NodeJS.ProcessEnv | undefined
  isProcessAlive?: ((pid: number) => boolean) | undefined
  spawnProcess?: ((input: {
    command: string
    args: string[]
    cwd?: string | undefined
    env?: NodeJS.ProcessEnv | undefined
  }) => ChildProcess) | undefined
}

export interface RunBrowserRuntimeIdleWatchdogInput {
  runtimeId: string
  cwd?: string | undefined
  runtimeDir?: string | undefined
}

export async function ensureBrowserRuntimeIdleWatchdog(
  input: EnsureBrowserRuntimeIdleWatchdogInput,
): Promise<void> {
  const cliEntryPath = resolveCliEntryPath(input.cliEntryPath)
  if (!cliEntryPath) {
    return
  }

  const watchFilePath = buildBrowserRuntimeIdleWatchFilePath(
    input.runtimeId,
    input.runtimeDir,
    input.cwd,
  )
  const existingRecord = await readBrowserRuntimeIdleWatchRecord(watchFilePath)
  const isProcessAlive = input.isProcessAlive ?? defaultIsProcessAlive
  if (
    existingRecord &&
    existingRecord.runtimeId === input.runtimeId &&
    isProcessAlive(existingRecord.watcherPid)
  ) {
    return
  }

  const execPath = input.execPath ?? process.execPath
  const execArgv = input.execArgv ?? process.execArgv
  const spawnProcess =
    input.spawnProcess ??
    (spawnInput =>
      spawn(spawnInput.command, spawnInput.args, {
        cwd: spawnInput.cwd,
        env: spawnInput.env,
        detached: true,
        stdio: 'ignore',
      }))
  const child = spawnProcess({
    command: execPath,
    args: [
      ...execArgv,
      cliEntryPath,
      'browser',
      'idle-watch',
      '--browser-id',
      input.runtimeId,
    ],
    cwd: input.cwd ?? process.cwd(),
    env: {
      ...(input.env ?? process.env),
      [DEEPSEEK_IDLE_WATCH_CWD_ENV]: input.cwd ?? process.cwd(),
      ...(input.runtimeDir
        ? { [DEEPSEEK_IDLE_WATCH_RUNTIME_DIR_ENV]: input.runtimeDir }
        : {}),
    },
  })
  child.unref()

  if (!child.pid) {
    return
  }

  const record: BrowserRuntimeIdleWatchRecord = {
    runtimeId: input.runtimeId,
    watcherPid: child.pid,
    createdAt: new Date().toISOString(),
  }
  await mkdir(dirname(watchFilePath), { recursive: true })
  await writeFile(watchFilePath, JSON.stringify(record, null, 2))
}

export async function runBrowserRuntimeIdleWatchdog(
  input: RunBrowserRuntimeIdleWatchdogInput,
): Promise<void> {
  const registry = new BrowserRuntimeRegistry({
    cwd: input.cwd,
    runtimeDir: input.runtimeDir,
  })
  const janitor = new BrowserRuntimeJanitor({
    cwd: input.cwd,
    runtimeDir: input.runtimeDir,
  })
  const watchFilePath = buildBrowserRuntimeIdleWatchFilePath(
    input.runtimeId,
    input.runtimeDir,
    input.cwd,
  )

  try {
    while (true) {
      const descriptor = await registry.readDescriptor(input.runtimeId)
      if (!descriptor) {
        return
      }
      if (descriptor.mode !== 'warm' || descriptor.ownership !== 'managed') {
        return
      }

      const reconciled = await janitor.reconcileRuntime(input.runtimeId)
      if (!reconciled) {
        return
      }
      if (reconciled.state === 'stale') {
        await janitor.cleanupManagedRuntime(reconciled)
        return
      }

      const lease = await registry.readLease(input.runtimeId)
      const delayMs = resolveBrowserRuntimeIdleWatchDelay(reconciled, lease, new Date())
      if (delayMs === null) {
        return
      }

      await sleep(delayMs)
    }
  } finally {
    await rm(watchFilePath, { force: true }).catch(() => {})
  }
}

function resolveBrowserRuntimeIdleWatchDelay(
  descriptor: BrowserRuntimeDescriptor,
  lease: BrowserRuntimeLease | null,
  now: Date,
): number | null {
  if (lease) {
    return WATCHDOG_POLL_INTERVAL_MS
  }

  const idleTtlMs = descriptor.idleTtlMs ?? null
  if (idleTtlMs === null || idleTtlMs <= 0) {
    return null
  }

  const releaseAnchor = descriptor.lastLeaseReleasedAt ?? descriptor.createdAt
  const expiresAtMs = Date.parse(releaseAnchor) + idleTtlMs
  if (!Number.isFinite(expiresAtMs)) {
    return WATCHDOG_POLL_INTERVAL_MS
  }

  const remainingMs = expiresAtMs - now.getTime()
  if (remainingMs <= 0) {
    return 0
  }

  return Math.min(remainingMs, WATCHDOG_POLL_INTERVAL_MS)
}

function resolveCliEntryPath(cliEntryPath?: string): string | null {
  const candidate = cliEntryPath ?? process.argv[1]
  if (!candidate) {
    return null
  }

  const candidateBaseName = basename(candidate)
  if (candidateBaseName !== 'cli.ts' && candidateBaseName !== 'cli.js') {
    return null
  }

  return candidate
}

async function readBrowserRuntimeIdleWatchRecord(
  watchFilePath: string,
): Promise<BrowserRuntimeIdleWatchRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(watchFilePath, 'utf8')) as unknown
    return isBrowserRuntimeIdleWatchRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isBrowserRuntimeIdleWatchRecord(
  value: unknown,
): value is BrowserRuntimeIdleWatchRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record['runtimeId'] === 'string' &&
    Number.isInteger(record['watcherPid']) &&
    typeof record['createdAt'] === 'string'
  )
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}
