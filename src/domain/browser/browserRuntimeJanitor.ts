import { access, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { BrowserRuntimeDescriptor } from '../../types/browser-runtime.types.js'
import { buildPreservedBrowserRuntimeProfileDirectoryPath } from '../../shared/runtime/runtimePaths.js'
import { releaseManagedChromeExecutionLockByCdpUrl, isProcessAlive } from './managedChromeLock.js'
import { BrowserRuntimeRegistry } from './browserRuntimeRegistry.js'

const RUNTIME_RM_RETRY_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 200,
} as const

export interface BrowserRuntimeJanitorOptions {
  cwd?: string | undefined
  runtimeDir?: string | undefined
  registry?: BrowserRuntimeRegistry | undefined
  isProcessAlive?: ((pid: number) => boolean) | undefined
  logger?:
    | Pick<RuntimeLogger, 'debug' | 'info' | 'error'>
    | undefined
  now?: (() => Date) | undefined
  terminateProcessByPid?: ((pid: number) => Promise<void>) | undefined
  isBrowserReachable?: ((browserUrl: string, timeoutMs: number) => Promise<boolean>) | undefined
}

export interface BrowserRuntimeCleanupReport {
  scannedRuntimeIds: string[]
  cleanedRuntimeIds: string[]
  forgottenRuntimeIds: string[]
  keptRuntimeIds: string[]
}

export class BrowserRuntimeJanitor {
  private readonly registry: BrowserRuntimeRegistry
  private readonly cwd: string | undefined
  private readonly runtimeDir: string | undefined
  private readonly logger?:
    | Pick<RuntimeLogger, 'debug' | 'info' | 'error'>
    | undefined
  private readonly now: () => Date
  private readonly isProcessAlive: (pid: number) => boolean
  private readonly terminateProcessByPid: (pid: number) => Promise<void>
  private readonly isBrowserReachable: (browserUrl: string, timeoutMs: number) => Promise<boolean>

  constructor(options: BrowserRuntimeJanitorOptions = {}) {
    this.registry = options.registry ?? new BrowserRuntimeRegistry(options)
    this.cwd = options.cwd
    this.runtimeDir = options.runtimeDir
    this.logger = options.logger
    this.now = options.now ?? (() => new Date())
    this.isProcessAlive = options.isProcessAlive ?? isProcessAlive
    this.terminateProcessByPid =
      options.terminateProcessByPid ?? terminateProcessByPid
    this.isBrowserReachable =
      options.isBrowserReachable ?? defaultIsBrowserReachable
  }

  async reconcileRuntime(runtimeId: string): Promise<BrowserRuntimeDescriptor | null> {
    const descriptor = await this.registry.readDescriptor(runtimeId)
    if (!descriptor) {
      return null
    }

    const lease = await this.registry.readLease(runtimeId)
    const nowIso = this.now().toISOString()

    if (descriptor.ownership === 'external') {
      if (!lease) {
        const updated = {
          ...descriptor,
          state: 'ready' as const,
          lastSeenAt: nowIso,
        }
        await this.registry.writeDescriptor(updated)
        return updated
      }

      if (!this.isProcessAlive(lease.pid)) {
        await this.registry.deleteLease(runtimeId)
        await this.registry.removeRuntime(runtimeId)
        return null
      }

      if (descriptor.state !== 'busy') {
        const updated = {
          ...descriptor,
          state: 'busy' as const,
          lastSeenAt: nowIso,
        }
        await this.registry.writeDescriptor(updated)
        return updated
      }

      return descriptor
    }

    const browserAlive =
      descriptor.pid !== null &&
      descriptor.pid !== undefined &&
      this.isProcessAlive(descriptor.pid)
    const browserUrl = resolveBrowserUrl(descriptor)
    const browserReachable =
      browserUrl && browserAlive
        ? await this.isBrowserReachable(browserUrl, 1_500)
        : false

    if (!browserAlive || !browserReachable) {
      const staleDescriptor = {
        ...descriptor,
        state: 'stale' as const,
        lastSeenAt: nowIso,
      }
      await this.registry.writeDescriptor(staleDescriptor)
      return staleDescriptor
    }

    if (lease && !this.isProcessAlive(lease.pid)) {
      if (descriptor.mode === 'warm') {
        await this.registry.deleteLease(runtimeId)
        const recovered = {
          ...descriptor,
          state: 'idle' as const,
          lastSeenAt: nowIso,
          lastLeaseReleasedAt: nowIso,
        }
        await this.registry.writeDescriptor(recovered)
        return recovered
      }

      const staleDescriptor = {
        ...descriptor,
        state: 'stale' as const,
        lastSeenAt: nowIso,
      }
      await this.registry.writeDescriptor(staleDescriptor)
      return staleDescriptor
    }

    if (!lease) {
      if (descriptor.mode === 'warm') {
        if (isIdleRuntimeExpired(descriptor, this.now())) {
          const staleDescriptor = {
            ...descriptor,
            state: 'stale' as const,
            lastSeenAt: nowIso,
          }
          await this.registry.writeDescriptor(staleDescriptor)
          return staleDescriptor
        }

        const idleDescriptor = {
          ...descriptor,
          state: 'idle' as const,
          lastSeenAt: nowIso,
          lastLeaseReleasedAt: descriptor.lastLeaseReleasedAt ?? descriptor.createdAt,
        }
        await this.registry.writeDescriptor(idleDescriptor)
        return idleDescriptor
      }

      const staleDescriptor = {
        ...descriptor,
        state: 'stale' as const,
        lastSeenAt: nowIso,
      }
      await this.registry.writeDescriptor(staleDescriptor)
      return staleDescriptor
    }

    if (descriptor.state !== 'busy') {
      const updated = {
        ...descriptor,
        state: 'busy' as const,
        lastSeenAt: nowIso,
      }
      await this.registry.writeDescriptor(updated)
      return updated
    }

    return descriptor
  }

  async cleanupStaleRuntimes(): Promise<BrowserRuntimeCleanupReport> {
    const runtimeIds = await this.registry.listRuntimeIds()
    const report: BrowserRuntimeCleanupReport = {
      scannedRuntimeIds: runtimeIds,
      cleanedRuntimeIds: [],
      forgottenRuntimeIds: [],
      keptRuntimeIds: [],
    }

    for (const runtimeId of runtimeIds) {
      const descriptor = await this.registry.readDescriptor(runtimeId)
      if (!descriptor) {
        await this.registry.removeRuntime(runtimeId)
        report.cleanedRuntimeIds.push(runtimeId)
        continue
      }

      const reconciled = await this.reconcileRuntime(runtimeId)
      if (!reconciled) {
        report.forgottenRuntimeIds.push(runtimeId)
        continue
      }

      if (reconciled.state !== 'stale') {
        if (reconciled.ownership === 'external') {
          const lease = await this.registry.readLease(reconciled.runtimeId)
          if (!lease) {
            await this.registry.removeRuntime(reconciled.runtimeId)
            report.forgottenRuntimeIds.push(reconciled.runtimeId)
            continue
          }
        }

        report.keptRuntimeIds.push(reconciled.runtimeId)
        continue
      }

      if (reconciled.ownership === 'external') {
        await this.registry.removeRuntime(reconciled.runtimeId)
        report.forgottenRuntimeIds.push(reconciled.runtimeId)
        continue
      }

      await this.cleanupManagedRuntime(reconciled)
      report.cleanedRuntimeIds.push(reconciled.runtimeId)
    }

    return report
  }

  async cleanupManagedRuntime(descriptor: BrowserRuntimeDescriptor): Promise<void> {
    if (descriptor.pid) {
      await this.terminateProcessByPid(descriptor.pid).catch(() => {})
    }

    if (descriptor.keepTempProfile) {
      await preserveRuntimeProfile(descriptor, this.runtimeDir, this.cwd).catch(() => {})
    }

    releaseManagedChromeExecutionLockByCdpUrl({
      cdpUrl: descriptor.cdpUrl,
      cwd: this.cwd,
      runtimeDir: this.runtimeDir,
    })
    await this.registry.removeRuntime(descriptor.runtimeId)
  }
}

function isIdleRuntimeExpired(
  descriptor: BrowserRuntimeDescriptor,
  now: Date,
): boolean {
  if (!descriptor.idleTtlMs || descriptor.idleTtlMs <= 0) {
    return false
  }

  const lastReleasedAt = descriptor.lastLeaseReleasedAt ?? descriptor.createdAt
  if (!lastReleasedAt) {
    return false
  }

  return Date.parse(lastReleasedAt) + descriptor.idleTtlMs <= now.getTime()
}

function resolveBrowserUrl(descriptor: BrowserRuntimeDescriptor): string | null {
  if (descriptor.browserUrl?.trim()) {
    return descriptor.browserUrl
  }

  try {
    return new URL(descriptor.cdpUrl).origin
  } catch {
    return null
  }
}

async function preserveRuntimeProfile(
  descriptor: BrowserRuntimeDescriptor,
  runtimeDir?: string,
  cwd?: string,
): Promise<void> {
  if (!descriptor.profileDir) {
    return
  }

  await access(descriptor.profileDir)
  const preservedProfileDir = buildPreservedBrowserRuntimeProfileDirectoryPath(
    descriptor.runtimeId,
    runtimeDir,
    cwd,
  )
  await rm(preservedProfileDir, {
    ...RUNTIME_RM_RETRY_OPTIONS,
  })
  await mkdir(dirname(preservedProfileDir), { recursive: true })
  await rename(descriptor.profileDir, preservedProfileDir)
}

async function defaultIsBrowserReachable(
  browserUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${browserUrl}/json/version`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function terminateProcessByPid(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  if (!isProcessAlive(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }
}
