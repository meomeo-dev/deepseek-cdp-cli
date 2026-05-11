import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  BrowserRuntimeDescriptor,
  BrowserRuntimeId,
  BrowserRuntimeLease,
} from '../../types/browser-runtime.types.js'
import {
  buildBrowserRuntimeDescriptorFilePath,
  buildBrowserRuntimeDirectoryPath,
  buildBrowserRuntimeLeaseFilePath,
  buildBrowserRuntimeRegistryFilePath,
  resolveDeepSeekBrowserRuntimeRootDir,
} from '../../shared/runtime/runtimePaths.js'

const RUNTIME_RM_RETRY_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 200,
} as const

interface BrowserRuntimeRegistrySummary {
  runtimeId: BrowserRuntimeId
  mode: BrowserRuntimeDescriptor['mode']
  ownership: BrowserRuntimeDescriptor['ownership']
  purpose: BrowserRuntimeDescriptor['purpose']
  state: BrowserRuntimeDescriptor['state']
  cdpUrl: string
  pid: number | null
  lastSeenAt: string
}

interface BrowserRuntimeRegistryIndex {
  version: 1
  runtimes: BrowserRuntimeRegistrySummary[]
}

export interface BrowserRuntimeRegistryOptions {
  cwd?: string | undefined
  runtimeDir?: string | undefined
}

export class BrowserRuntimeRegistry {
  private readonly cwd: string | undefined
  private readonly runtimeDir: string | undefined

  constructor(options: BrowserRuntimeRegistryOptions = {}) {
    this.cwd = options.cwd
    this.runtimeDir = options.runtimeDir
  }

  async listRuntimeIds(): Promise<BrowserRuntimeId[]> {
    const runtimesDir = this.resolveRuntimesDirectory()
    try {
      const entries = await readdir(runtimesDir, { withFileTypes: true })
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    } catch {
      return []
    }
  }

  async listDescriptors(): Promise<BrowserRuntimeDescriptor[]> {
    const runtimeIds = await this.listRuntimeIds()
    const descriptors = await Promise.all(runtimeIds.map(id => this.readDescriptor(id)))
    return descriptors.filter((descriptor): descriptor is BrowserRuntimeDescriptor => descriptor !== null)
  }

  async readDescriptor(runtimeId: BrowserRuntimeId): Promise<BrowserRuntimeDescriptor | null> {
    return this.readJsonFile(
      buildBrowserRuntimeDescriptorFilePath(runtimeId, this.runtimeDir, this.cwd),
      isBrowserRuntimeDescriptor,
    )
  }

  async writeDescriptor(descriptor: BrowserRuntimeDescriptor): Promise<void> {
    await this.writeJsonFile(
      buildBrowserRuntimeDescriptorFilePath(descriptor.runtimeId, this.runtimeDir, this.cwd),
      descriptor,
    )
    await this.syncIndex()
  }

  async readLease(runtimeId: BrowserRuntimeId): Promise<BrowserRuntimeLease | null> {
    return this.readJsonFile(
      buildBrowserRuntimeLeaseFilePath(runtimeId, this.runtimeDir, this.cwd),
      isBrowserRuntimeLease,
    )
  }

  async writeLease(lease: BrowserRuntimeLease): Promise<void> {
    await this.writeJsonFile(
      buildBrowserRuntimeLeaseFilePath(lease.runtimeId, this.runtimeDir, this.cwd),
      lease,
    )
  }

  async deleteLease(runtimeId: BrowserRuntimeId): Promise<void> {
    await rm(buildBrowserRuntimeLeaseFilePath(runtimeId, this.runtimeDir, this.cwd), {
      force: true,
    })
  }

  async removeRuntime(runtimeId: BrowserRuntimeId): Promise<void> {
    await rm(
      buildBrowserRuntimeDirectoryPath(runtimeId, this.runtimeDir, this.cwd),
      RUNTIME_RM_RETRY_OPTIONS,
    )
    await this.syncIndex()
  }

  private resolveRuntimesDirectory(): string {
    return `${resolveDeepSeekBrowserRuntimeRootDir(this.runtimeDir, this.cwd)}/runtimes`
  }

  private async syncIndex(): Promise<void> {
    const descriptors = await this.listDescriptors()
    const index: BrowserRuntimeRegistryIndex = {
      version: 1,
      runtimes: descriptors.map(descriptor => ({
        runtimeId: descriptor.runtimeId,
        mode: descriptor.mode,
        ownership: descriptor.ownership,
        purpose: descriptor.purpose,
        state: descriptor.state,
        cdpUrl: descriptor.cdpUrl,
        pid: descriptor.pid ?? null,
        lastSeenAt: descriptor.lastSeenAt,
      })),
    }

    await this.writeJsonFile(
      buildBrowserRuntimeRegistryFilePath(this.runtimeDir, this.cwd),
      index,
    )
  }

  private async readJsonFile<T>(
    filePath: string,
    guard: (value: unknown) => value is T,
  ): Promise<T | null> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      return guard(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(value, null, 2))
  }
}

function isBrowserRuntimeDescriptor(value: unknown): value is BrowserRuntimeDescriptor {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value['runtimeId'] === 'string' &&
    typeof value['mode'] === 'string' &&
    typeof value['ownership'] === 'string' &&
    typeof value['purpose'] === 'string' &&
    typeof value['state'] === 'string' &&
    typeof value['cdpUrl'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    typeof value['lastSeenAt'] === 'string' &&
    typeof value['keepTempProfile'] === 'boolean'
  )
}

function isBrowserRuntimeLease(value: unknown): value is BrowserRuntimeLease {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value['runtimeId'] === 'string' &&
    typeof value['leaseId'] === 'string' &&
    typeof value['operation'] === 'string' &&
    Number.isInteger(value['pid']) &&
    typeof value['startedAt'] === 'string' &&
    typeof value['heartbeatAt'] === 'string' &&
    Number.isInteger(value['pageCount'])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
