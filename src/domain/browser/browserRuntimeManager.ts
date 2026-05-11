import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import puppeteer from 'puppeteer-core'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  BrowserRuntimeDescriptor,
  BrowserRuntimeLease,
  BrowserRuntimePurpose,
  ChromeProfileCopyScope,
} from '../../types/browser-runtime.types.js'
import type { ManagedChromeExecutionPlan } from '../../types/managed-chrome.types.js'
import {
  buildBrowserRuntimeProfileDirectoryPath,
} from '../../shared/runtime/runtimePaths.js'
import {
  acquireManagedChromeExecutionLock,
  releaseManagedChromeExecutionLock,
} from './managedChromeLock.js'
import { BrowserRuntimeRegistry } from './browserRuntimeRegistry.js'
import { observeLocalBrowserRuntimeEndpoint } from './browserRuntimeEndpointProbe.js'
import {
  BrowserRuntimeJanitor,
  type BrowserRuntimeJanitorOptions,
} from './browserRuntimeJanitor.js'
import { ensureBrowserRuntimeIdleWatchdog } from './browserRuntimeIdleWatchdog.js'
import {
  areManagedLaunchConfigsEquivalent,
  buildManagedLaunchConfig,
  buildManagedLaunchConfigFromPlan,
} from './browserRuntimeManagedConfig.js'
import {
  DEFAULT_CHROME_PROFILE_COPY_SCOPE,
  REDUCED_MANIFEST_EXPERIMENTAL_COPY_SCOPE,
  REDUCED_MANIFEST_EXPERIMENTAL_ENTRIES,
  resolveChromeProfileCopyScope,
} from './chromeProfileCopyScope.js'
import { terminateChildProcess } from '../../shared/runtime/terminateChildProcess.js'

const CHROME_PROFILE_COPY_RETRYABLE_ERROR_CODES = new Set(['ENOENT'])
const CHROME_PROFILE_COPY_MAX_ATTEMPTS = 3
const CHROME_PROFILE_COPY_RETRY_DELAY_MS = 250
const CHROME_PROFILE_LOCAL_STATE_ENTRY = 'Local State'
const CHROME_PROFILE_DEFAULT_DIRECTORY = 'Default'
const CHROME_PROFILE_DIRECTORY_NAME_PATTERN = /^Profile \d+$/u
const CHROME_PROFILE_COOKIES_ENTRY_NAME = 'Cookies'
const CHROME_PROFILE_LOCAL_STORAGE_ENTRY_NAME = 'Local Storage'
const CHROME_PROFILE_COOKIES_ENTRY = `${CHROME_PROFILE_DEFAULT_DIRECTORY}/${CHROME_PROFILE_COOKIES_ENTRY_NAME}`
const CHROME_PROFILE_LOCAL_STORAGE_ENTRY =
  `${CHROME_PROFILE_DEFAULT_DIRECTORY}/${CHROME_PROFILE_LOCAL_STORAGE_ENTRY_NAME}`
const CHROME_PROFILE_COOKIE_AUXILIARY_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const DEEPSEEK_SITE_FILTER_URL = 'https://chat.deepseek.com/'
const DEEPSEEK_COOKIE_SQL =
  "host_key = 'chat.deepseek.com' OR host_key = 'deepseek.com' OR host_key LIKE '%.deepseek.com'"
const HELPER_BROWSER_EXIT_TIMEOUT_MS = 2_000
const HELPER_BROWSER_EXPORT_ROOT_CLEANUP_MAX_ATTEMPTS = 5
const HELPER_BROWSER_EXPORT_ROOT_CLEANUP_RETRY_DELAY_MS = 100
const HELPER_BROWSER_EXPORT_ROOT_CLEANUP_RETRYABLE_ERROR_CODES = new Set([
  'ENOTEMPTY',
  'EBUSY',
  'EPERM',
])

interface ChromeProfileLocalStorageSliceExport {
  finalUrl: string | null
  entries: Array<[string, string]>
  entryCount: number
  keySample: string[]
}

interface ChromeProfileLocalStorageSliceInjection {
  finalUrl: string | null
  entryCount: number
  keySample: string[]
}

type HelperBrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.connect>>['newPage']>>

type HelperBrowserPageRunner = <T>(input: {
  userDataDir: string
  chromeExecutablePath: string
  timeoutMs: number
  run: (page: HelperBrowserPage) => Promise<T>
}) => Promise<T>

type RemovePath = (
  path: string,
  options: {
    recursive: boolean
    force: boolean
  },
) => Promise<void>

export interface BrowserRuntimeManagerOptions extends BrowserRuntimeJanitorOptions {
  registry?: BrowserRuntimeRegistry | undefined
  janitor?: BrowserRuntimeJanitor | undefined
  accessPath?: ((path: string) => Promise<void>) | undefined
  copyChromeProfile?:
    | ((sourcePath: string, targetPath: string) => Promise<void>)
    | undefined
  exportSiteFilteredLocalStorageEntries?:
    | ((input: {
        sourceUserDataDir: string
        sourceProfileDirectory: string
        chromeExecutablePath: string
        timeoutMs: number
        copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
      }) => Promise<ChromeProfileLocalStorageSliceExport>)
    | undefined
  injectSiteFilteredLocalStorageEntries?:
    | ((input: {
        targetUserDataDir: string
        chromeExecutablePath: string
        timeoutMs: number
        entries: Array<[string, string]>
      }) => Promise<ChromeProfileLocalStorageSliceInjection>)
    | undefined
  helperBrowserPageRunner?: HelperBrowserPageRunner | undefined
  removePath?: RemovePath | undefined
  spawnChrome?:
    | ((input: {
        chromeExecutablePath: string
        launchArgs: string[]
      }) => ChildProcess)
    | undefined
  waitForBrowserUrl?: ((browserUrl: string, timeoutMs: number) => Promise<void>) | undefined
  ensureWarmRuntimeIdleWatchdog?:
    | ((input: {
        runtimeId: string
        cwd?: string | undefined
        runtimeDir?: string | undefined
      }) => Promise<void>)
    | undefined
  nowIso?: (() => string) | undefined
  randomId?: (() => string) | undefined
}

export interface BrowserRuntimeLeaseInput {
  operation: string
  pid?: number | undefined
}

export interface BrowserRuntimeAcquireOptions {
  runtimeId?: string | undefined
  idleTtlMs?: number | null | undefined
}

export interface BrowserRuntimeExpectedOptions {
  purpose?: BrowserRuntimePurpose | undefined
}

export interface BrowserRuntimeLeaseResult {
  descriptor: BrowserRuntimeDescriptor
  lease: BrowserRuntimeLease
}

export interface AcquiredBrowserRuntime {
  manager: BrowserRuntimeManager
  descriptor: BrowserRuntimeDescriptor
  lease: BrowserRuntimeLease
  release: () => Promise<void>
}

export interface BrowserRuntimeRecord {
  descriptor: BrowserRuntimeDescriptor
  lease: BrowserRuntimeLease | null
}

export interface BrowserRuntimeStartOptions {
  runtimeId?: string | undefined
  idleTtlMs?: number | null | undefined
}

export interface BrowserRuntimeStartResult {
  descriptor: BrowserRuntimeDescriptor
  reused: boolean
}

export interface BrowserRuntimeStopOptions {
  force?: boolean | undefined
}

export class BrowserRuntimeManager {
  private readonly registry: BrowserRuntimeRegistry
  private readonly janitor: BrowserRuntimeJanitor
  private readonly cwd: string | undefined
  private readonly runtimeDir: string | undefined
  private readonly logger?:
    | Pick<RuntimeLogger, 'debug' | 'info' | 'error'>
    | undefined
  private readonly accessPath: (path: string) => Promise<void>
  private readonly copyChromeProfile: (
    sourcePath: string,
    targetPath: string,
  ) => Promise<void>
  private readonly exportSiteFilteredLocalStorageEntries: (input: {
    sourceUserDataDir: string
    sourceProfileDirectory: string
    chromeExecutablePath: string
    timeoutMs: number
    copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  }) => Promise<ChromeProfileLocalStorageSliceExport>
  private readonly injectSiteFilteredLocalStorageEntries: (input: {
    targetUserDataDir: string
    chromeExecutablePath: string
    timeoutMs: number
    entries: Array<[string, string]>
  }) => Promise<ChromeProfileLocalStorageSliceInjection>
  private readonly spawnChrome: (input: {
    chromeExecutablePath: string
    launchArgs: string[]
  }) => ChildProcess
  private readonly waitForBrowserUrl: (browserUrl: string, timeoutMs: number) => Promise<void>
  private readonly ensureWarmRuntimeIdleWatchdog: (input: {
    runtimeId: string
    cwd?: string | undefined
    runtimeDir?: string | undefined
  }) => Promise<void>
  private readonly nowIso: () => string
  private readonly randomId: () => string

  constructor(options: BrowserRuntimeManagerOptions = {}) {
    this.registry = options.registry ?? new BrowserRuntimeRegistry(options)
    this.janitor =
      options.janitor instanceof BrowserRuntimeJanitor
        ? options.janitor
        : new BrowserRuntimeJanitor({
            ...options,
            registry: this.registry,
          })
    this.cwd = options.cwd
    this.runtimeDir = options.runtimeDir
    this.logger = options.logger
    this.accessPath = options.accessPath ?? access
    this.copyChromeProfile = options.copyChromeProfile ?? copyChromeProfileToTarget
    const helperBrowserPageRunner = options.helperBrowserPageRunner ?? withHelperBrowserPage
    const removePath = options.removePath ?? rm
    this.exportSiteFilteredLocalStorageEntries =
      options.exportSiteFilteredLocalStorageEntries ??
      (input =>
        exportSiteFilteredLocalStorageEntriesFromProfile({
          ...input,
          helperBrowserPageRunner,
          removePath,
        }))
    this.injectSiteFilteredLocalStorageEntries =
      options.injectSiteFilteredLocalStorageEntries ??
      (input =>
        injectSiteFilteredLocalStorageEntriesIntoProfile({
          ...input,
          helperBrowserPageRunner,
        }))
    this.spawnChrome =
      options.spawnChrome ??
      (input =>
        spawn(input.chromeExecutablePath, input.launchArgs, {
          stdio: 'ignore',
        }))
    this.waitForBrowserUrl = options.waitForBrowserUrl ?? waitForBrowserUrl
    this.ensureWarmRuntimeIdleWatchdog =
      options.ensureWarmRuntimeIdleWatchdog ??
      (input =>
        ensureBrowserRuntimeIdleWatchdog({
          runtimeId: input.runtimeId,
          cwd: input.cwd,
          runtimeDir: input.runtimeDir,
        }))
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.randomId = options.randomId ?? (() => randomUUID().slice(0, 8))
  }

  async acquireCommandRuntime(
    plan: ManagedChromeExecutionPlan,
    input: BrowserRuntimeLeaseInput,
    options: BrowserRuntimeAcquireOptions = {},
  ): Promise<AcquiredBrowserRuntime> {
    await this.cleanupStaleRuntimes()

    if (plan.mode === 'runtime') {
      return this.acquireRegisteredRuntime(plan.browserId, input, {
        purpose: plan.browserRuntime.purpose,
      })
    }

    if (plan.mode === 'existing') {
      return this.acquireAttachedRuntime(plan, input)
    }

    if (plan.browserRuntime.mode === 'ephemeral') {
      return this.acquireEphemeralRuntime(plan, input, options)
    }

    const runtime = await this.ensureManagedRuntime(plan, {
      runtimeId: options.runtimeId,
      idleTtlMs: options.idleTtlMs,
    })
    const { descriptor, lease } = await this.acquireLease(runtime.runtimeId, input)
    return {
      manager: this,
      descriptor,
      lease,
      release: async () => {
        await this.releaseLease(runtime.runtimeId, lease.leaseId)
      },
    }
  }

  async listRuntimeRecords(): Promise<BrowserRuntimeRecord[]> {
    const descriptors = await this.registry.listDescriptors()
    const records: BrowserRuntimeRecord[] = []

    for (const descriptor of descriptors) {
      const reconciled = await this.janitor.reconcileRuntime(descriptor.runtimeId)
      if (!reconciled) {
        continue
      }

      records.push({
        descriptor: reconciled,
        lease: await this.registry.readLease(reconciled.runtimeId),
      })
    }

    return records.sort((left, right) =>
      left.descriptor.createdAt < right.descriptor.createdAt ? 1 : -1,
    )
  }

  async getRuntimeRecord(runtimeId: string): Promise<BrowserRuntimeRecord | null> {
    const descriptor = await this.janitor.reconcileRuntime(runtimeId)
    if (!descriptor) {
      return null
    }

    return {
      descriptor,
      lease: await this.registry.readLease(runtimeId),
    }
  }

  async acquireRegisteredRuntime(
    runtimeId: string,
    input: BrowserRuntimeLeaseInput,
    expected: BrowserRuntimeExpectedOptions = {},
  ): Promise<AcquiredBrowserRuntime> {
    const record = await this.getRuntimeRecord(runtimeId)
    if (!record) {
      throw new Error(`Browser runtime not found: ${runtimeId}`)
    }
    if (record.descriptor.mode !== 'warm' || record.descriptor.ownership !== 'managed') {
      throw new Error(
        `Browser runtime ${runtimeId} is not a reusable managed warm runtime.`,
      )
    }
    if (expected.purpose && record.descriptor.purpose !== expected.purpose) {
      throw new Error(
        `Browser runtime ${runtimeId} has purpose ${record.descriptor.purpose}, ` +
          `expected ${expected.purpose}.`,
      )
    }
    await this.ensureWarmRuntimeIdleWatchdog({
      runtimeId,
      cwd: this.cwd,
      runtimeDir: this.runtimeDir,
    })

    const { descriptor, lease } = await this.acquireLease(runtimeId, input)
    return {
      manager: this,
      descriptor,
      lease,
      release: async () => {
        await this.releaseLease(runtimeId, lease.leaseId)
      },
    }
  }

  async startPersistentRuntime(
    plan: Extract<ManagedChromeExecutionPlan, { mode: 'managed' }>,
    options: BrowserRuntimeStartOptions = {},
  ): Promise<BrowserRuntimeStartResult> {
    await this.cleanupStaleRuntimes()

    if (plan.browserRuntime.mode !== 'warm') {
      throw new Error('Persistent browser runtime start requires browserRuntime.mode=warm.')
    }

    const existing = await this.findReusableWarmRuntime(plan)
    if (existing) {
      return {
        descriptor: existing,
        reused: true,
      }
    }

    return {
      descriptor: await this.ensureManagedRuntime(plan, {
        allowReuse: false,
        runtimeId: options.runtimeId,
        idleTtlMs: options.idleTtlMs,
      }),
      reused: false,
    }
  }

  async ensureManagedRuntime(
    plan: Extract<ManagedChromeExecutionPlan, { mode: 'managed' }>,
    options: {
      allowReuse?: boolean | undefined
      runtimeId?: string | undefined
      idleTtlMs?: number | null | undefined
    } = {},
  ): Promise<BrowserRuntimeDescriptor> {
    if (plan.browserRuntime.mode === 'warm' && options.allowReuse !== false) {
      const existing = await this.findReusableWarmRuntime(plan)
      if (existing) {
        return existing
      }
    }

    const chromeUserDataDir = plan.chromeUserDataDir
    if (!chromeUserDataDir) {
      throw new Error('Could not resolve Chrome user-data-dir. Pass --chrome-user-data-dir.')
    }
    const chromeExecutablePath = plan.chromeExecutablePath
    if (!chromeExecutablePath) {
      throw new Error('Could not resolve Chrome executable. Pass --chrome-executable-path.')
    }
    const chromeProfileCopyScope = resolveChromeProfileCopyScope(
      plan.chromeProfileCopyScope,
    )

    const managedMode = plan.browserRuntime.mode === 'warm' ? 'warm' : 'ephemeral'
    const runtimeId =
      options.runtimeId ??
      buildManagedRuntimeId({
        mode: managedMode,
        cdpUrl: plan.cdpUrl,
        purpose: plan.browserRuntime.purpose,
        randomId: this.randomId(),
      })
    const profileDir = buildBrowserRuntimeProfileDirectoryPath(runtimeId, this.runtimeDir, this.cwd)
    const browserUrl = plan.cdpTarget.browserUrl
    const managedConfig = buildManagedLaunchConfig({
      timeoutMs: plan.timeoutMs,
      headless: plan.headless,
      proxyServer: plan.proxyServer,
      chromeExecutablePath,
      chromeUserDataDir,
      chromeProfileDirectory: plan.chromeProfileDirectory ?? null,
      chromeProfileCopyScope,
    })
    const descriptorBase = {
      runtimeId,
      mode: managedMode,
      ownership: plan.browserRuntime.ownership,
      purpose: plan.browserRuntime.purpose,
      cdpUrl: plan.cdpUrl,
      browserUrl,
      keepTempProfile: plan.keepTempChromeProfile,
      profileDir,
      managedConfig,
      pid: null,
      createdAt: this.nowIso(),
      lastSeenAt: this.nowIso(),
      idleTtlMs:
        plan.browserRuntime.mode === 'warm'
          ? (options.idleTtlMs ?? 30 * 60 * 1_000)
          : null,
      lastLeaseReleasedAt: null,
      state: 'starting' as const,
    } satisfies BrowserRuntimeDescriptor

    const executionLock = acquireManagedChromeExecutionLock({
      cdpUrl: plan.cdpUrl,
      cwd: this.cwd,
      runtimeDir: this.runtimeDir,
    })

    await this.registry.writeDescriptor(descriptorBase)

    try {
      await this.accessPath(chromeUserDataDir)
      await this.accessPath(chromeExecutablePath)
      await assertManagedChromeLaunchEndpointAvailable({
        cdpUrl: plan.cdpUrl,
      })
      await mkdir(profileDir, { recursive: true })
      await copyChromeProfileWithRetry({
        copyChromeProfile: this.copyChromeProfile,
        exportSiteFilteredLocalStorageEntries: this.exportSiteFilteredLocalStorageEntries,
        injectSiteFilteredLocalStorageEntries: this.injectSiteFilteredLocalStorageEntries,
        sourceUserDataDir: chromeUserDataDir,
        sourceProfileDirectory: plan.chromeProfileDirectory,
        targetUserDataDir: profileDir,
        copyScope: chromeProfileCopyScope,
        chromeExecutablePath,
        timeoutMs: plan.timeoutMs,
      })

      const child = this.spawnChrome({
        chromeExecutablePath,
        launchArgs: buildManagedChromeLaunchArgs({
          port: plan.cdpTarget.port,
          userDataDir: profileDir,
          headless: plan.headless,
          proxyServer: plan.proxyServer ?? undefined,
        }),
      })
      unrefSpawnedChrome(child)

      const pid = child.pid ?? null
      const readyDescriptor: BrowserRuntimeDescriptor = {
        ...descriptorBase,
        pid,
        state: 'ready',
        lastSeenAt: this.nowIso(),
      }
      await this.registry.writeDescriptor(readyDescriptor)
      await this.waitForBrowserUrl(browserUrl, plan.timeoutMs)
      if (managedMode === 'warm') {
        await this.ensureWarmRuntimeIdleWatchdog({
          runtimeId,
          cwd: this.cwd,
          runtimeDir: this.runtimeDir,
        })
      }
      return readyDescriptor
    } catch (error) {
      await this.registry.removeRuntime(runtimeId).catch(() => {})
      releaseManagedChromeExecutionLock(executionLock)
      throw error
    }
  }

  async acquireLease(
    runtimeId: string,
    input: BrowserRuntimeLeaseInput,
  ): Promise<BrowserRuntimeLeaseResult> {
    const descriptor = await this.janitor.reconcileRuntime(runtimeId)
    if (!descriptor) {
      throw new Error(`Browser runtime not found: ${runtimeId}`)
    }

    const existingLease = await this.registry.readLease(runtimeId)
    if (existingLease) {
      throw new Error(
        `Managed Chrome is already active for ${descriptor.cdpUrl} under pid ${existingLease.pid}. ` +
          `Run 'deepseek browser list' to inspect active runtimes, or choose another --cdp-url.`,
      )
    }

    const nowIso = this.nowIso()
    const lease: BrowserRuntimeLease = {
      runtimeId,
      leaseId: `${runtimeId}-lease-${this.randomId()}`,
      operation: input.operation,
      pid: input.pid ?? process.pid,
      startedAt: nowIso,
      heartbeatAt: nowIso,
      pageCount: 0,
    }
    const busyDescriptor: BrowserRuntimeDescriptor = {
      ...descriptor,
      state: 'busy',
      lastSeenAt: nowIso,
    }

    await this.registry.writeDescriptor(busyDescriptor)
    await this.registry.writeLease(lease)
    return {
      descriptor: busyDescriptor,
      lease,
    }
  }

  async releaseLease(runtimeId: string, leaseId: string): Promise<BrowserRuntimeDescriptor | null> {
    const descriptor = await this.registry.readDescriptor(runtimeId)
    if (!descriptor) {
      return null
    }

    const lease = await this.registry.readLease(runtimeId)
    if (!lease || lease.leaseId !== leaseId) {
      return descriptor
    }

    await this.registry.deleteLease(runtimeId)
    if (descriptor.ownership === 'external') {
      await this.registry.removeRuntime(runtimeId)
      return null
    }

    if (descriptor.mode === 'ephemeral') {
      await this.stopRuntime(runtimeId, { force: true })
      return null
    }

    const releasedDescriptor: BrowserRuntimeDescriptor = {
      ...descriptor,
      state: 'idle',
      lastSeenAt: this.nowIso(),
      lastLeaseReleasedAt: this.nowIso(),
    }
    await this.registry.writeDescriptor(releasedDescriptor)
    return releasedDescriptor
  }

  async updateLeasePageCount(
    runtimeId: string,
    leaseId: string,
    pageCount: number,
  ): Promise<BrowserRuntimeLease | null> {
    const lease = await this.registry.readLease(runtimeId)
    if (!lease || lease.leaseId !== leaseId) {
      return null
    }

    const nowIso = this.nowIso()
    const updatedLease: BrowserRuntimeLease = {
      ...lease,
      heartbeatAt: nowIso,
      pageCount: Math.max(0, pageCount),
    }
    await this.registry.writeLease(updatedLease)

    const descriptor = await this.registry.readDescriptor(runtimeId)
    if (descriptor) {
      await this.registry.writeDescriptor({
        ...descriptor,
        lastSeenAt: nowIso,
        state: 'busy',
      })
    }

    return updatedLease
  }

  async stopRuntime(
    runtimeId: string,
    options: BrowserRuntimeStopOptions = {},
  ): Promise<BrowserRuntimeDescriptor | null> {
    const descriptor = await this.registry.readDescriptor(runtimeId)
    if (!descriptor) {
      return null
    }

    if (descriptor.ownership === 'external') {
      await this.registry.removeRuntime(runtimeId)
      return null
    }

    const lease = await this.registry.readLease(runtimeId)
    if (lease) {
      if (options.force !== true) {
        throw new Error(
          `Browser runtime ${runtimeId} is busy under pid ${lease.pid}. Re-run with force=true.`,
        )
      }
      await this.registry.deleteLease(runtimeId)
    }

    const stoppedDescriptor: BrowserRuntimeDescriptor = {
      ...descriptor,
      state: 'stopping',
      lastSeenAt: this.nowIso(),
    }
    await this.registry.writeDescriptor(stoppedDescriptor)
    await this.janitor.cleanupManagedRuntime(stoppedDescriptor)
    return null
  }

  async cleanupStaleRuntimes() {
    return this.janitor.cleanupStaleRuntimes()
  }

  async restartPersistentRuntime(
    runtimeId: string,
    options: BrowserRuntimeStopOptions = {},
  ): Promise<BrowserRuntimeStartResult> {
    const record = await this.getRuntimeRecord(runtimeId)
    if (!record) {
      throw new Error(`Browser runtime not found: ${runtimeId}`)
    }

    if (record.descriptor.ownership !== 'managed') {
      throw new Error(
        `Browser runtime ${runtimeId} is attach/external. Restart is only supported for managed runtimes.`,
      )
    }
    if (record.descriptor.mode !== 'warm') {
      throw new Error(`Browser runtime ${runtimeId} is not a warm runtime and cannot be restarted.`)
    }
    if (!record.descriptor.managedConfig) {
      throw new Error(
        `Browser runtime ${runtimeId} is missing managed launch config and cannot be restarted safely.`,
      )
    }

    const plan = buildManagedExecutionPlanFromRecord(record.descriptor)
    await this.stopRuntime(runtimeId, options)
    return this.startPersistentRuntime(plan, {
      runtimeId,
      idleTtlMs: record.descriptor.idleTtlMs ?? null,
    })
  }

  private async acquireAttachedRuntime(
    plan: Extract<ManagedChromeExecutionPlan, { mode: 'existing' }>,
    input: BrowserRuntimeLeaseInput,
  ): Promise<AcquiredBrowserRuntime> {
    const runtimeId = buildAttachRuntimeId(plan.cdpUrl, plan.browserRuntime.purpose)
    const descriptor: BrowserRuntimeDescriptor = {
      runtimeId,
      mode: 'attach',
      ownership: 'external',
      purpose: plan.browserRuntime.purpose,
      state: 'ready',
      cdpUrl: plan.cdpUrl,
      browserUrl: plan.cdpUrl,
      keepTempProfile: false,
      pid: null,
      profileDir: null,
      createdAt: this.nowIso(),
      lastSeenAt: this.nowIso(),
      lastLeaseReleasedAt: null,
      idleTtlMs: null,
    }
    await this.registry.writeDescriptor(descriptor)
    const { descriptor: busyDescriptor, lease } = await this.acquireLease(runtimeId, input)
    return {
      manager: this,
      descriptor: busyDescriptor,
      lease,
      release: async () => {
        await this.releaseLease(runtimeId, lease.leaseId)
      },
    }
  }

  private async acquireEphemeralRuntime(
    plan: Extract<ManagedChromeExecutionPlan, { mode: 'managed' }>,
    input: BrowserRuntimeLeaseInput,
    options: BrowserRuntimeAcquireOptions = {},
  ): Promise<AcquiredBrowserRuntime> {
    const runtime = await this.ensureManagedRuntime(plan, {
      runtimeId: options.runtimeId,
      idleTtlMs: options.idleTtlMs,
    })
    const { descriptor, lease } = await this.acquireLease(runtime.runtimeId, input)
    return {
      manager: this,
      descriptor,
      lease,
      release: async () => {
        await this.releaseLease(runtime.runtimeId, lease.leaseId)
      },
    }
  }

  private async findReusableWarmRuntime(
    plan: Extract<ManagedChromeExecutionPlan, { mode: 'managed' }>,
  ): Promise<BrowserRuntimeDescriptor | null> {
    const descriptors = await this.registry.listDescriptors()
    const requestedConfig = buildManagedLaunchConfigFromPlan(plan)
    for (const descriptor of descriptors) {
      if (
        descriptor.mode !== 'warm' ||
        descriptor.cdpUrl !== plan.cdpUrl ||
        descriptor.purpose !== plan.browserRuntime.purpose
      ) {
        continue
      }

      const reconciled = await this.janitor.reconcileRuntime(descriptor.runtimeId)
      if (!reconciled || reconciled.state === 'stale') {
        continue
      }

      if (
        reconciled.managedConfig &&
        !areManagedLaunchConfigsEquivalent(reconciled.managedConfig, requestedConfig)
      ) {
        throw new Error(
          `Browser runtime ${reconciled.runtimeId} already owns ${plan.cdpUrl} with a different managed configuration.`,
        )
      }

      await this.ensureWarmRuntimeIdleWatchdog({
        runtimeId: reconciled.runtimeId,
        cwd: this.cwd,
        runtimeDir: this.runtimeDir,
      })

      if (reconciled.state === 'idle' || reconciled.state === 'ready' || reconciled.state === 'busy') {
        return reconciled
      }
    }

    return null
  }
}

function buildManagedRuntimeId(input: {
  mode: 'ephemeral' | 'warm'
  cdpUrl: string
  purpose: BrowserRuntimeDescriptor['purpose']
  randomId: string
}): string {
  const cdpFingerprint = createHash('sha1').update(input.cdpUrl).digest('hex').slice(0, 8)
  return `${input.mode}-${input.purpose}-${cdpFingerprint}-${input.randomId}`
}

function buildAttachRuntimeId(cdpUrl: string, purpose: BrowserRuntimeDescriptor['purpose']): string {
  const cdpFingerprint = createHash('sha1').update(`${purpose}:${cdpUrl}`).digest('hex').slice(0, 12)
  return `attach-${cdpFingerprint}`
}

async function copyChromeProfileToTarget(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await cp(sourcePath, targetPath, { recursive: true })
}

async function copyChromeProfileWithRetry(input: {
  copyChromeProfile: (
    sourcePath: string,
    targetPath: string,
  ) => Promise<void>
  exportSiteFilteredLocalStorageEntries: (input: {
    sourceUserDataDir: string
    sourceProfileDirectory: string
    chromeExecutablePath: string
    timeoutMs: number
    copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  }) => Promise<ChromeProfileLocalStorageSliceExport>
  injectSiteFilteredLocalStorageEntries: (input: {
    targetUserDataDir: string
    chromeExecutablePath: string
    timeoutMs: number
    entries: Array<[string, string]>
  }) => Promise<ChromeProfileLocalStorageSliceInjection>
  sourceUserDataDir: string
  sourceProfileDirectory?: string | null | undefined
  targetUserDataDir: string
  copyScope?: ChromeProfileCopyScope | undefined
  chromeExecutablePath: string
  timeoutMs: number
}): Promise<void> {
  const copyPlan = await resolveChromeProfileCopyPlan(
    input.sourceUserDataDir,
    input.targetUserDataDir,
    input.copyScope,
    input.sourceProfileDirectory,
  )
  let lastError: unknown

  for (let attempt = 1; attempt <= CHROME_PROFILE_COPY_MAX_ATTEMPTS; attempt += 1) {
    try {
      if (copyPlan.strategy === 'site-filter-default') {
        await materializeDefaultSiteFilteredChromeProfile({
          copyChromeProfile: input.copyChromeProfile,
          exportSiteFilteredLocalStorageEntries: input.exportSiteFilteredLocalStorageEntries,
          injectSiteFilteredLocalStorageEntries: input.injectSiteFilteredLocalStorageEntries,
          sourceUserDataDir: input.sourceUserDataDir,
          sourceProfileDirectory: copyPlan.sourceProfileDirectory,
          targetUserDataDir: input.targetUserDataDir,
          chromeExecutablePath: input.chromeExecutablePath,
          timeoutMs: input.timeoutMs,
        })
      } else {
        for (const entry of copyPlan.entries) {
          await mkdir(dirname(entry.targetPath), { recursive: true })
          await input.copyChromeProfile(entry.sourcePath, entry.targetPath)
        }
      }
      return
    } catch (error) {
      lastError = error
      if (
        !isRetryableChromeProfileCopyError(error) ||
        attempt >= CHROME_PROFILE_COPY_MAX_ATTEMPTS
      ) {
        throw error
      }

      await rm(input.targetUserDataDir, { recursive: true, force: true })
      await mkdir(input.targetUserDataDir, { recursive: true })
      await delay(CHROME_PROFILE_COPY_RETRY_DELAY_MS * attempt)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Chrome profile copy failed after retries.')
}

async function resolveChromeProfileCopyPlan(
  sourceUserDataDir: string,
  targetUserDataDir: string,
  copyScope: ChromeProfileCopyScope | null | undefined,
  requestedProfileDirectory?: string | null,
): Promise<{
  copyScope: ChromeProfileCopyScope
  sourceProfileDirectory: string
  strategy: 'site-filter-default' | 'entry-copy'
  entries: Array<{
    relativePath: string
    sourcePath: string
    targetPath: string
  }>
}> {
  const sourceEntries = await readdir(sourceUserDataDir, { withFileTypes: true })
  const sourceEntryNames = new Set(sourceEntries.map(entry => entry.name))
  const profileDirectoriesObserved = sourceEntries
    .filter(
      entry =>
        entry.isDirectory() &&
        isSupportedChromeProfileDirectoryName(entry.name),
    )
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const hasLocalState = sourceEntryNames.has(CHROME_PROFILE_LOCAL_STATE_ENTRY)
  if (!hasLocalState) {
    throw new ChromeProfileCopyScopeError({
      failureKind: 'missing-local-state',
      copyScope: resolveChromeProfileCopyScope(copyScope),
      message:
        `Chrome user-data-dir ${sourceUserDataDir} is missing '${CHROME_PROFILE_LOCAL_STATE_ENTRY}'. ` +
        `Pass a Chrome user-data-dir root that contains both '${CHROME_PROFILE_LOCAL_STATE_ENTRY}' ` +
        'and at least one Chrome profile directory; --chrome-user-data-dir does not accept a profile subtree directly.',
    })
  }

  const normalizedCopyScope = resolveChromeProfileCopyScope(copyScope)
  if (profileDirectoriesObserved.length === 0) {
    throw new ChromeProfileCopyScopeError({
      failureKind: 'missing-default-profile',
      copyScope: normalizedCopyScope,
      message:
        `Chrome user-data-dir ${sourceUserDataDir} is missing a supported Chrome profile directory. ` +
        `Observed profile directories: none. The default DeepSeek site-filtered clone contract requires '${CHROME_PROFILE_LOCAL_STATE_ENTRY}' ` +
        "and one source profile directory named 'Default' or 'Profile N'.",
    })
  }

  const sourceProfileDirectory = await resolveSourceChromeProfileDirectory({
    sourceUserDataDir,
    profileDirectoriesObserved,
    copyScope: normalizedCopyScope,
    ...(requestedProfileDirectory !== undefined ? { requestedProfileDirectory } : {}),
  })

  const relativeEntries =
    normalizedCopyScope === REDUCED_MANIFEST_EXPERIMENTAL_COPY_SCOPE
      ? [...REDUCED_MANIFEST_EXPERIMENTAL_ENTRIES]
      : [
          CHROME_PROFILE_LOCAL_STATE_ENTRY,
          CHROME_PROFILE_COOKIES_ENTRY,
          CHROME_PROFILE_LOCAL_STORAGE_ENTRY,
        ]

  if (normalizedCopyScope === DEFAULT_CHROME_PROFILE_COPY_SCOPE) {
    const missingEntries: string[] = []
    for (const relativePath of [
      CHROME_PROFILE_LOCAL_STATE_ENTRY,
      CHROME_PROFILE_COOKIES_ENTRY,
      CHROME_PROFILE_LOCAL_STORAGE_ENTRY,
    ]) {
      try {
        await access(join(
          sourceUserDataDir,
          resolveSourceProfileRelativePath(sourceProfileDirectory, relativePath),
        ))
      } catch {
        missingEntries.push(relativePath)
      }
    }

    if (missingEntries.length > 0) {
      const primaryFailureKind =
        missingEntries.includes(CHROME_PROFILE_COOKIES_ENTRY)
          ? 'cookie-domain-slice-missing'
          : 'local-storage-origin-slice-missing'
      throw new ChromeProfileCopyScopeError({
        failureKind: primaryFailureKind,
        copyScope: normalizedCopyScope,
        missingEntries,
        message:
          `Chrome user-data-dir ${sourceUserDataDir} is missing required site-filter entries in source profile ${sourceProfileDirectory}: ${formatSourceProfileMissingEntries(sourceProfileDirectory, missingEntries)}. ` +
          'The default DeepSeek site-filtered clone contract fails closed and will not silently broaden to any wider profile copy or a full-root clone.',
      })
    }
  }

  if (normalizedCopyScope === REDUCED_MANIFEST_EXPERIMENTAL_COPY_SCOPE) {
    const missingEntries: string[] = []
    for (const relativePath of relativeEntries) {
      try {
        await access(join(
          sourceUserDataDir,
          resolveSourceProfileRelativePath(sourceProfileDirectory, relativePath),
        ))
      } catch {
        missingEntries.push(relativePath)
      }
    }

    if (missingEntries.length > 0) {
      throw new ChromeProfileCopyScopeError({
        failureKind: 'reduced-mode-entry-missing',
        copyScope: normalizedCopyScope,
        missingEntries,
        message:
          `Chrome user-data-dir ${sourceUserDataDir} is missing required reduced-manifest entries in source profile ${sourceProfileDirectory}: ${formatSourceProfileMissingEntries(sourceProfileDirectory, missingEntries)}. ` +
          'The legacy reduced-manifest-experimental copy scope fails closed and will not silently broaden to the default site-filtered contract or a full-root clone.',
      })
    }
  }

  return {
    copyScope: normalizedCopyScope,
    sourceProfileDirectory,
    strategy:
      normalizedCopyScope === DEFAULT_CHROME_PROFILE_COPY_SCOPE
        ? 'site-filter-default'
        : 'entry-copy',
    entries: relativeEntries.map(relativePath => ({
      relativePath,
      sourcePath: join(
        sourceUserDataDir,
        resolveSourceProfileRelativePath(sourceProfileDirectory, relativePath),
      ),
      targetPath: join(targetUserDataDir, relativePath),
    })),
  }
}

async function resolveSourceChromeProfileDirectory(input: {
  sourceUserDataDir: string
  requestedProfileDirectory?: string | null
  profileDirectoriesObserved: string[]
  copyScope: ChromeProfileCopyScope
}): Promise<string> {
  const requestedProfileDirectory = normalizeOptionalString(input.requestedProfileDirectory)
  if (requestedProfileDirectory) {
    if (!isSupportedChromeProfileDirectoryName(requestedProfileDirectory)) {
      throw new ChromeProfileCopyScopeError({
        failureKind: 'invalid-profile-directory',
        copyScope: input.copyScope,
        message:
          `Chrome profile directory '${requestedProfileDirectory}' is not supported. ` +
          "Use 'Default' or a Chrome profile directory named 'Profile N'.",
      })
    }

    if (!input.profileDirectoriesObserved.includes(requestedProfileDirectory)) {
      throw new ChromeProfileCopyScopeError({
        failureKind: 'profile-directory-missing',
        copyScope: input.copyScope,
        message:
          `Chrome user-data-dir ${input.sourceUserDataDir} does not contain profile directory '${requestedProfileDirectory}'. ` +
          `Observed profile directories: ${input.profileDirectoriesObserved.join(', ')}.`,
      })
    }

    return requestedProfileDirectory
  }

  if (input.profileDirectoriesObserved.length === 1) {
    return input.profileDirectoriesObserved[0] ?? CHROME_PROFILE_DEFAULT_DIRECTORY
  }

  const candidateProfiles = await findDeepSeekCookieProfileDirectories(
    input.sourceUserDataDir,
    input.profileDirectoriesObserved,
  )
  if (candidateProfiles.length === 1) {
    return candidateProfiles[0] ?? CHROME_PROFILE_DEFAULT_DIRECTORY
  }

  if (candidateProfiles.length > 1) {
    throw new ChromeProfileCopyScopeError({
      failureKind: 'multi-profile-ambiguity',
      copyScope: input.copyScope,
      message:
        `Chrome user-data-dir ${input.sourceUserDataDir} has DeepSeek cookies in multiple profile directories: ${candidateProfiles.join(', ')}. ` +
        "Pass --chrome-profile-directory with one of those profile directory names to select the source profile explicitly.",
    })
  }

  throw new ChromeProfileCopyScopeError({
    failureKind: 'deepseek-profile-not-found',
    copyScope: input.copyScope,
    message:
      `Chrome user-data-dir ${input.sourceUserDataDir} contains multiple profile directories (${input.profileDirectoriesObserved.join(', ')}) ` +
      'but none has readable DeepSeek cookies. Open https://chat.deepseek.com/ in the Chrome profile you want to use, or pass --chrome-profile-directory explicitly.',
  })
}

async function findDeepSeekCookieProfileDirectories(
  sourceUserDataDir: string,
  profileDirectories: string[],
): Promise<string[]> {
  const candidates: string[] = []

  for (const profileDirectory of profileDirectories) {
    const cookieDbPath = join(
      sourceUserDataDir,
      profileDirectory,
      CHROME_PROFILE_COOKIES_ENTRY_NAME,
    )
    const localStoragePath = join(
      sourceUserDataDir,
      profileDirectory,
      CHROME_PROFILE_LOCAL_STORAGE_ENTRY_NAME,
    )
    try {
      await access(cookieDbPath)
      await access(localStoragePath)
      const cookieCount = countDeepSeekCookies(cookieDbPath)
      if (cookieCount > 0) {
        candidates.push(profileDirectory)
      }
    } catch {
      continue
    }
  }

  return candidates
}

function countDeepSeekCookies(dbPath: string): number {
  try {
    const output = runSqlite(
      dbPath,
      `SELECT count(*) FROM cookies WHERE ${DEEPSEEK_COOKIE_SQL};`,
      true,
    )
    return Number.parseInt(output.trim(), 10) || 0
  } catch {
    return 0
  }
}

function resolveSourceProfileRelativePath(
  sourceProfileDirectory: string,
  relativePath: string,
): string {
  if (relativePath === CHROME_PROFILE_LOCAL_STATE_ENTRY) {
    return relativePath
  }

  const defaultPrefix = `${CHROME_PROFILE_DEFAULT_DIRECTORY}/`
  if (relativePath.startsWith(defaultPrefix)) {
    return `${sourceProfileDirectory}/${relativePath.slice(defaultPrefix.length)}`
  }

  return relativePath
}

function formatSourceProfileMissingEntries(
  sourceProfileDirectory: string,
  relativePaths: string[],
): string {
  return relativePaths
    .map(relativePath => resolveSourceProfileRelativePath(sourceProfileDirectory, relativePath))
    .join(', ')
}

function isSupportedChromeProfileDirectoryName(value: string): boolean {
  return (
    value === CHROME_PROFILE_DEFAULT_DIRECTORY ||
    CHROME_PROFILE_DIRECTORY_NAME_PATTERN.test(value)
  )
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

async function materializeDefaultSiteFilteredChromeProfile(input: {
  copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  exportSiteFilteredLocalStorageEntries: (input: {
    sourceUserDataDir: string
    sourceProfileDirectory: string
    chromeExecutablePath: string
    timeoutMs: number
    copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  }) => Promise<ChromeProfileLocalStorageSliceExport>
  injectSiteFilteredLocalStorageEntries: (input: {
    targetUserDataDir: string
    chromeExecutablePath: string
    timeoutMs: number
    entries: Array<[string, string]>
  }) => Promise<ChromeProfileLocalStorageSliceInjection>
  sourceUserDataDir: string
  sourceProfileDirectory: string
  targetUserDataDir: string
  chromeExecutablePath: string
  timeoutMs: number
}): Promise<void> {
  await copyChromeProfileEntry({
    copyChromeProfile: input.copyChromeProfile,
    sourceRoot: input.sourceUserDataDir,
    targetRoot: input.targetUserDataDir,
    relativePath: CHROME_PROFILE_LOCAL_STATE_ENTRY,
  })

  await applyDeepSeekCookieDomainSlice({
    copyChromeProfile: input.copyChromeProfile,
    sourceUserDataDir: input.sourceUserDataDir,
    sourceProfileDirectory: input.sourceProfileDirectory,
    targetUserDataDir: input.targetUserDataDir,
  })

  let localStorageEntries: ChromeProfileLocalStorageSliceExport
  try {
    localStorageEntries = await input.exportSiteFilteredLocalStorageEntries({
      sourceUserDataDir: input.sourceUserDataDir,
      sourceProfileDirectory: input.sourceProfileDirectory,
      chromeExecutablePath: input.chromeExecutablePath,
      timeoutMs: input.timeoutMs,
      copyChromeProfile: input.copyChromeProfile,
    })
  } catch (error) {
    if (error instanceof ChromeProfileCopyScopeError) {
      throw error
    }
    throw new ChromeProfileCopyScopeError({
      failureKind: 'local-storage-origin-slice-unclassified',
      copyScope: DEFAULT_CHROME_PROFILE_COPY_SCOPE,
      message:
        `Could not export the DeepSeek localStorage origin slice from ${input.sourceUserDataDir}. ` +
        'The default DeepSeek site-filtered clone contract fails closed and will not silently broaden to any wider profile copy or a full-root clone.',
      cause: error,
    })
  }

  if (localStorageEntries.entries.length === 0) {
    throw new ChromeProfileCopyScopeError({
      failureKind: 'local-storage-origin-slice-unclassified',
      copyScope: DEFAULT_CHROME_PROFILE_COPY_SCOPE,
      message:
        `Chrome user-data-dir ${input.sourceUserDataDir} did not yield any DeepSeek localStorage entries for ${DEEPSEEK_SITE_FILTER_URL}. ` +
        'The default DeepSeek site-filtered clone contract fails closed and will not silently broaden to any wider profile copy or a full-root clone.',
    })
  }

  try {
    await input.injectSiteFilteredLocalStorageEntries({
      targetUserDataDir: input.targetUserDataDir,
      chromeExecutablePath: input.chromeExecutablePath,
      timeoutMs: input.timeoutMs,
      entries: localStorageEntries.entries,
    })
  } catch (error) {
    if (error instanceof ChromeProfileCopyScopeError) {
      throw error
    }
    throw new ChromeProfileCopyScopeError({
      failureKind: 'local-storage-origin-slice-unclassified',
      copyScope: DEFAULT_CHROME_PROFILE_COPY_SCOPE,
      message:
        `Could not inject the DeepSeek localStorage origin slice into ${input.targetUserDataDir}. ` +
        'The default DeepSeek site-filtered clone contract fails closed and will not silently broaden to any wider profile copy or a full-root clone.',
      cause: error,
    })
  }
}

async function copyChromeProfileEntry(input: {
  copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  sourceRoot: string
  targetRoot: string
  relativePath: string
  sourceRelativePath?: string | undefined
}): Promise<void> {
  const sourcePath = join(input.sourceRoot, input.sourceRelativePath ?? input.relativePath)
  const targetPath = join(input.targetRoot, input.relativePath)
  await mkdir(dirname(targetPath), { recursive: true })
  await input.copyChromeProfile(sourcePath, targetPath)
}

async function applyDeepSeekCookieDomainSlice(input: {
  copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  sourceUserDataDir: string
  sourceProfileDirectory: string
  targetUserDataDir: string
}): Promise<void> {
  const sourceDbPath = join(
    input.sourceUserDataDir,
    input.sourceProfileDirectory,
    CHROME_PROFILE_COOKIES_ENTRY_NAME,
  )
  const targetDbPath = join(input.targetUserDataDir, CHROME_PROFILE_COOKIES_ENTRY)

  await copyChromeProfileEntry({
    copyChromeProfile: input.copyChromeProfile,
    sourceRoot: input.sourceUserDataDir,
    targetRoot: input.targetUserDataDir,
    sourceRelativePath: `${input.sourceProfileDirectory}/${CHROME_PROFILE_COOKIES_ENTRY_NAME}`,
    relativePath: CHROME_PROFILE_COOKIES_ENTRY,
  })

  for (const suffix of CHROME_PROFILE_COOKIE_AUXILIARY_SUFFIXES) {
    const sourceAuxiliaryPath = `${sourceDbPath}${suffix}`
    try {
      await access(sourceAuxiliaryPath)
    } catch {
      continue
    }
    await mkdir(dirname(`${targetDbPath}${suffix}`), { recursive: true })
    await input.copyChromeProfile(sourceAuxiliaryPath, `${targetDbPath}${suffix}`)
  }

  try {
    runSqlite(
      targetDbPath,
      ['PRAGMA journal_mode=DELETE;', `DELETE FROM cookies WHERE NOT (${DEEPSEEK_COOKIE_SQL});`, 'VACUUM;'].join(
        ' ',
      ),
    )
  } catch (error) {
    throw new ChromeProfileCopyScopeError({
      failureKind: 'cookie-domain-slice-unclassified',
      copyScope: DEFAULT_CHROME_PROFILE_COPY_SCOPE,
      message:
        `Could not materialize the DeepSeek cookie domain slice from ${sourceDbPath}. ` +
        'The default DeepSeek site-filtered clone contract fails closed and will not silently broaden to any wider profile copy or a full-root clone.',
      cause: error,
    })
  }
}

class ChromeProfileCopyScopeError extends Error {
  public readonly failureKind:
    | 'missing-local-state'
    | 'missing-default-profile'
    | 'invalid-profile-directory'
    | 'profile-directory-missing'
    | 'multi-profile-ambiguity'
    | 'deepseek-profile-not-found'
    | 'reduced-mode-entry-missing'
    | 'cookie-domain-slice-missing'
    | 'local-storage-origin-slice-missing'
    | 'cookie-domain-slice-unclassified'
    | 'local-storage-origin-slice-unclassified'
  public readonly copyScope: ChromeProfileCopyScope
  public readonly missingEntries: string[]

  public constructor(input: {
    failureKind:
      | 'missing-local-state'
      | 'missing-default-profile'
      | 'invalid-profile-directory'
      | 'profile-directory-missing'
      | 'multi-profile-ambiguity'
      | 'deepseek-profile-not-found'
      | 'reduced-mode-entry-missing'
      | 'cookie-domain-slice-missing'
      | 'local-storage-origin-slice-missing'
      | 'cookie-domain-slice-unclassified'
      | 'local-storage-origin-slice-unclassified'
    copyScope: ChromeProfileCopyScope
    message: string
    missingEntries?: string[] | undefined
    cause?: unknown
  }) {
    super(input.message)
    this.name = 'ChromeProfileCopyScopeError'
    this.failureKind = input.failureKind
    this.copyScope = input.copyScope
    this.missingEntries = [...(input.missingEntries ?? [])]
    if (input.cause !== undefined) {
      this.cause = input.cause
    }
  }
}

function isRetryableChromeProfileCopyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? error.code : null
  return typeof code === 'string' && CHROME_PROFILE_COPY_RETRYABLE_ERROR_CODES.has(code)
}

function unrefSpawnedChrome(child: ChildProcess): void {
  if (typeof child.unref === 'function') {
    child.unref()
  }
}

async function exportSiteFilteredLocalStorageEntriesFromProfile(input: {
  sourceUserDataDir: string
  sourceProfileDirectory: string
  chromeExecutablePath: string
  timeoutMs: number
  copyChromeProfile: (sourcePath: string, targetPath: string) => Promise<void>
  helperBrowserPageRunner?: HelperBrowserPageRunner | undefined
  removePath?: RemovePath | undefined
}): Promise<ChromeProfileLocalStorageSliceExport> {
  const exportRoot = await mkdtemp(join(tmpdir(), 'deepseek-clone-profile-site-filter-export-'))
  const exportUserDataDir = join(exportRoot, 'profile')
  await mkdir(exportUserDataDir, { recursive: true })

  try {
    await copyChromeProfileEntry({
      copyChromeProfile: input.copyChromeProfile,
      sourceRoot: input.sourceUserDataDir,
      targetRoot: exportUserDataDir,
      relativePath: CHROME_PROFILE_LOCAL_STATE_ENTRY,
    })
    await copyChromeProfileEntry({
      copyChromeProfile: input.copyChromeProfile,
      sourceRoot: input.sourceUserDataDir,
      targetRoot: exportUserDataDir,
      sourceRelativePath:
        `${input.sourceProfileDirectory}/${CHROME_PROFILE_LOCAL_STORAGE_ENTRY_NAME}`,
      relativePath: CHROME_PROFILE_LOCAL_STORAGE_ENTRY,
    })

    return await (input.helperBrowserPageRunner ?? withHelperBrowserPage)({
      userDataDir: exportUserDataDir,
      chromeExecutablePath: input.chromeExecutablePath,
      timeoutMs: input.timeoutMs,
      run: async page => {
        await page.goto(DEEPSEEK_SITE_FILTER_URL, {
          waitUntil: 'domcontentloaded',
          timeout: input.timeoutMs,
        })
        const payload = await page.evaluate(() => ({
          finalUrl: location.href,
          entries: Object.entries(window.localStorage),
        }))
        return {
          finalUrl: payload.finalUrl,
          entries: payload.entries,
          entryCount: payload.entries.length,
          keySample: payload.entries.slice(0, 10).map(([key]) => key),
        }
      },
    })
  } finally {
    await cleanupHelperBrowserExportRoot(exportRoot, input.removePath)
  }
}

async function injectSiteFilteredLocalStorageEntriesIntoProfile(input: {
  targetUserDataDir: string
  chromeExecutablePath: string
  timeoutMs: number
  entries: Array<[string, string]>
  helperBrowserPageRunner?: HelperBrowserPageRunner | undefined
}): Promise<ChromeProfileLocalStorageSliceInjection> {
  return (input.helperBrowserPageRunner ?? withHelperBrowserPage)({
    userDataDir: input.targetUserDataDir,
    chromeExecutablePath: input.chromeExecutablePath,
    timeoutMs: input.timeoutMs,
    run: async page => {
      await page.goto(DEEPSEEK_SITE_FILTER_URL, {
        waitUntil: 'domcontentloaded',
        timeout: input.timeoutMs,
      })
      const payload = await page.evaluate((entries: Array<[string, string]>) => {
        window.localStorage.clear()
        for (const [key, value] of entries) {
          window.localStorage.setItem(key, value)
        }
        return {
          finalUrl: location.href,
          localStorageEntries: Object.entries(window.localStorage),
        }
      }, input.entries)
      return {
        finalUrl: payload.finalUrl,
        entryCount: payload.localStorageEntries.length,
        keySample: payload.localStorageEntries.slice(0, 10).map(([key]) => key),
      }
    },
  })
}

async function withHelperBrowserPage<T>(
  input: {
    userDataDir: string
    chromeExecutablePath: string
    timeoutMs: number
    run: (page: HelperBrowserPage) => Promise<T>
  },
): Promise<T> {
  const port = await allocateHelperBrowserPort()
  const browserUrl = `http://127.0.0.1:${port}`
  const child = spawn(input.chromeExecutablePath, buildManagedChromeLaunchArgs({
    port,
    userDataDir: input.userDataDir,
    headless: true,
  }), {
    stdio: 'ignore',
  })
  unrefSpawnedChrome(child)

  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | null = null
  try {
    await waitForBrowserUrl(browserUrl, input.timeoutMs)
    browser = await puppeteer.connect({
      browserURL: browserUrl,
      defaultViewport: null,
      protocolTimeout: input.timeoutMs,
    })
    const page = await browser.newPage()
    try {
      return await input.run(page)
    } finally {
      await page.close().catch(() => {})
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    await terminateHelperChromeProcess(child)
  }
}

async function cleanupHelperBrowserExportRoot(
  exportRoot: string,
  removePath: RemovePath = rm,
): Promise<void> {
  // Helper Chrome can still be finishing session-file writes after the export
  // already succeeded. Cleanup must stay best-effort so teardown noise does not
  // get misclassified as a localStorage export failure.
  for (let attempt = 1; attempt <= HELPER_BROWSER_EXPORT_ROOT_CLEANUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      await removePath(exportRoot, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        !isRetryableHelperBrowserCleanupError(error) ||
        attempt === HELPER_BROWSER_EXPORT_ROOT_CLEANUP_MAX_ATTEMPTS
      ) {
        return
      }
      await delay(HELPER_BROWSER_EXPORT_ROOT_CLEANUP_RETRY_DELAY_MS * attempt)
    }
  }
}

function isRetryableHelperBrowserCleanupError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? error.code : null
  return (
    typeof code === 'string' &&
    HELPER_BROWSER_EXPORT_ROOT_CLEANUP_RETRYABLE_ERROR_CODES.has(code)
  )
}

async function terminateHelperChromeProcess(child: ChildProcess): Promise<void> {
  await terminateChildProcess(child, {
    sigtermTimeoutMs: HELPER_BROWSER_EXIT_TIMEOUT_MS,
  })
}

async function allocateHelperBrowserPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a helper Chrome port.')))
        return
      }
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

function runSqlite(dbPath: string, sql: string, readonly = false): string {
  return execFileSync('sqlite3', [...(readonly ? ['-readonly'] : []), dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 8,
  })
}

function buildManagedExecutionPlanFromRecord(
  descriptor: BrowserRuntimeDescriptor,
): Extract<ManagedChromeExecutionPlan, { mode: 'managed' }> {
  if (descriptor.mode !== 'warm') {
    throw new Error(`Browser runtime ${descriptor.runtimeId} is not a managed warm runtime.`)
  }
  if (!descriptor.managedConfig) {
    throw new Error(
      `Browser runtime ${descriptor.runtimeId} is missing managed launch config and cannot be restarted safely.`,
    )
  }

  const cdpTarget = parseLocalCdpTarget(descriptor.cdpUrl)

  return {
    mode: 'managed',
    browserRuntime: {
      entrypoint: 'unspecified',
      requestedMode: 'warm',
      mode: 'warm',
      ownership: 'managed',
      purpose: descriptor.purpose,
      source: 'explicit-browser-mode',
      executionDisposition: 'managed-persistent-runtime',
      persistentRuntimeReady: true,
      notes: [],
    },
    cdpUrl: descriptor.cdpUrl,
    timeoutMs: descriptor.managedConfig.timeoutMs,
    cloneChromeProfile: true,
    chromeProfileCopyScope:
      descriptor.managedConfig.chromeProfileCopyScope ?? DEFAULT_CHROME_PROFILE_COPY_SCOPE,
    headless: descriptor.managedConfig.headless,
    proxyServer: descriptor.managedConfig.proxyServer ?? null,
    chromeExecutablePath: descriptor.managedConfig.chromeExecutablePath,
    chromeUserDataDir: descriptor.managedConfig.chromeUserDataDir,
    chromeProfileDirectory: descriptor.managedConfig.chromeProfileDirectory ?? null,
    keepTempChromeProfile: descriptor.keepTempProfile,
    cdpTarget,
  }
}

function parseLocalCdpTarget(cdpUrl: string): NonNullable<Extract<ManagedChromeExecutionPlan, { mode: 'managed' }>['cdpTarget']> {
  const url = new URL(cdpUrl)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Managed Chrome requires an http(s) CDP url. Received: ${cdpUrl}`)
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`Managed Chrome only supports a local CDP url. Received: ${cdpUrl}`)
  }

  const port = Number(url.port)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Managed Chrome requires an explicit local CDP port. Received: ${cdpUrl}`)
  }

  return {
    host: url.hostname,
    port,
    browserUrl: `${url.protocol}//${url.host}`,
  }
}

async function waitForBrowserUrl(browserUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${browserUrl}/json/version`)
      if (response.ok) {
        return
      }
      lastError = new Error(`Chrome CDP responded with ${response.status}.`)
    } catch (error) {
      lastError = error
    }

    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(
    `Timed out waiting for managed Chrome CDP at ${browserUrl}. ${
      lastError instanceof Error ? lastError.message : ''
    }`.trim(),
  )
}

async function assertManagedChromeLaunchEndpointAvailable(input: {
  cdpUrl: string
}): Promise<void> {
  const endpointObservation = await observeLocalBrowserRuntimeEndpoint(input.cdpUrl)
  if (endpointObservation.devtoolsEndpointDetected) {
    throw new Error(
      `Requested managed Chrome CDP endpoint ${input.cdpUrl} is already serving a Chrome DevTools endpoint before launch. ` +
        `If you want to reuse that browser, use --browser-mode attach; otherwise choose another --cdp-url.`,
    )
  }

  if (endpointObservation.nonCdpPortOccupied) {
    const port = new URL(input.cdpUrl).port
    throw new Error(
      `Requested managed Chrome CDP port ${port} is already in use before launch, but ${new URL(input.cdpUrl).origin}/json/version did not behave like Chrome DevTools. ` +
        `Another local process is likely bound to ${input.cdpUrl}. Choose another --cdp-url or inspect the owner (for example: lsof -i tcp:${port}).`,
    )
  }
}

function buildManagedChromeLaunchArgs(options: {
  port: number
  userDataDir: string
  headless: boolean
  proxyServer?: string | undefined
}): string[] {
  const args = [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]

  if (options.headless) {
    args.push('--headless=new')
  }

  if (options.proxyServer) {
    args.push(`--proxy-server=${options.proxyServer}`)
  }

  args.push('about:blank')
  return args
}
