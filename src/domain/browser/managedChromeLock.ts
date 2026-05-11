import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildManagedChromeLockFilePath } from '../../shared/runtime/runtimePaths.js'

interface ManagedChromeExecutionLockState {
  cdpUrl: string
  pid: number
  acquiredAt: string
}

export interface ManagedChromeExecutionLock {
  lockFilePath: string
  cdpUrl: string
  pid: number
  acquiredAt: string
}

export function acquireManagedChromeExecutionLock(input: {
  cdpUrl: string
  cwd?: string | undefined
  runtimeDir?: string | undefined
  pid?: number | undefined
  acquiredAt?: string | undefined
}): ManagedChromeExecutionLock {
  const lockFilePath = buildManagedChromeLockFilePath(input.cdpUrl, input.runtimeDir, input.cwd)
  mkdirSync(dirname(lockFilePath), { recursive: true })

  const lockState = buildManagedChromeExecutionLockState(input)
  tryWriteManagedChromeLock(lockFilePath, lockState)

  return {
    lockFilePath,
    cdpUrl: lockState.cdpUrl,
    pid: lockState.pid,
    acquiredAt: lockState.acquiredAt,
  }
}

export function releaseManagedChromeExecutionLock(lock: ManagedChromeExecutionLock): void {
  try {
    unlinkSync(lock.lockFilePath)
  } catch {
    return
  }
}

export function releaseManagedChromeExecutionLockByCdpUrl(input: {
  cdpUrl: string
  cwd?: string | undefined
  runtimeDir?: string | undefined
}): void {
  releaseManagedChromeExecutionLock({
    lockFilePath: buildManagedChromeLockFilePath(input.cdpUrl, input.runtimeDir, input.cwd),
    cdpUrl: input.cdpUrl,
    pid: 0,
    acquiredAt: '',
  })
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isMissingProcessError(error)
  }
}

function buildManagedChromeExecutionLockState(input: {
  cdpUrl: string
  pid?: number | undefined
  acquiredAt?: string | undefined
}): ManagedChromeExecutionLockState {
  return {
    cdpUrl: input.cdpUrl,
    pid: input.pid ?? process.pid,
    acquiredAt: input.acquiredAt ?? new Date().toISOString(),
  }
}

function tryWriteManagedChromeLock(
  lockFilePath: string,
  lockState: ManagedChromeExecutionLockState,
): void {
  try {
    writeFileSync(lockFilePath, JSON.stringify(lockState, null, 2), {
      flag: 'wx',
    })
    return
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error
    }
  }

  const existingLock = readManagedChromeExecutionLockState(lockFilePath)
  if (!existingLock) {
    releaseManagedChromeExecutionLock({
      lockFilePath,
      cdpUrl: lockState.cdpUrl,
      pid: lockState.pid,
      acquiredAt: lockState.acquiredAt,
    })
  } else if (!isManagedChromeExecutionLockStale(existingLock)) {
    throw new Error(
      `Managed Chrome is already active for ${lockState.cdpUrl} under pid ${existingLock.pid}. ` +
        `This usually means another deepseek-cdp-cli managed runtime already owns the requested fixed CDP endpoint. ` +
        `Run 'deepseek browser list' to inspect active runtimes, or choose another --cdp-url.`,
    )
  } else {
    releaseManagedChromeExecutionLock({
      lockFilePath,
      cdpUrl: existingLock.cdpUrl,
      pid: existingLock.pid,
      acquiredAt: existingLock.acquiredAt,
    })
  }

  writeFileSync(lockFilePath, JSON.stringify(lockState, null, 2), {
    flag: 'wx',
  })
}

function readManagedChromeExecutionLockState(
  lockFilePath: string,
): ManagedChromeExecutionLockState | null {
  try {
    const parsed = JSON.parse(readFileSync(lockFilePath, 'utf8')) as unknown
    return isManagedChromeExecutionLockState(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isManagedChromeExecutionLockStale(lockState: ManagedChromeExecutionLockState): boolean {
  return !isProcessAlive(lockState.pid)
}

function isManagedChromeExecutionLockState(
  value: unknown,
): value is ManagedChromeExecutionLockState {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value['cdpUrl'] === 'string' &&
    typeof value['acquiredAt'] === 'string' &&
    Number.isInteger(value['pid'])
  )
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function isMissingProcessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
