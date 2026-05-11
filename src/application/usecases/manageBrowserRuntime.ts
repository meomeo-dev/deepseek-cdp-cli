import { BrowserRuntimeManager } from '../../domain/browser/browserRuntimeManager.js'
import { resolveBrowserRuntimeOptions } from '../../domain/browser/browserRuntimeResolver.js'
import {
  planManagedChromeExecution,
  resolveDefaultWarmRuntimeIdleTtlMs,
} from '../../domain/browser/managedChrome.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  BrowserRuntimeEntrypoint,
  BrowserRuntimeDescriptor,
  BrowserRuntimeLease,
} from '../../types/browser-runtime.types.js'
import type {
  BrowserRuntimeCleanupResultView,
  BrowserRuntimeListResult,
  BrowserRuntimeRestartResultView,
  BrowserRuntimeStartCommandInput,
  BrowserRuntimeStartResultView,
  BrowserRuntimeStatusResult,
  BrowserRuntimeStatusView,
  BrowserRuntimeStopResultView,
} from '../../types/browser-runtime-management.types.js'

export interface BrowserRuntimeCommandEnvironment {
  cwd?: string | undefined
  runtimeDir?: string | undefined
  entrypoint?: BrowserRuntimeEntrypoint | undefined
}

export interface BrowserRuntimeCommandDependencies {
  manager?: BrowserRuntimeManager | undefined
  now?: (() => Date) | undefined
}

export function resolvePersistentBrowserRuntimeStartOptions(
  input: BrowserRuntimeStartCommandInput,
  entrypoint: BrowserRuntimeEntrypoint,
) {
  return resolveBrowserRuntimeOptions(
    {
      cdpUrl: input.cdpUrl,
      timeoutMs: input.timeoutMs,
      cloneChromeProfile: true,
      headless: input.headless,
      proxyServer: input.proxyServer,
      chromeExecutablePath: input.chromeExecutablePath,
      chromeUserDataDir: input.chromeUserDataDir,
      chromeProfileDirectory: input.chromeProfileDirectory,
      keepTempChromeProfile: input.keepTempChromeProfile,
      browserMode: 'warm',
      browserPurpose: input.browserPurpose,
    },
    {
      entrypoint,
      allowWarmPersistentRuntime: true,
    },
  )
}

export async function startBrowserRuntime(
  input: BrowserRuntimeStartCommandInput & BrowserRuntimeCommandEnvironment,
  logger = new RuntimeLogger({ level: 'info', scope: 'browser-start' }),
  dependencies: BrowserRuntimeCommandDependencies = {},
): Promise<BrowserRuntimeStartResultView> {
  const manager = resolveManager(input, logger, dependencies)
  const options = resolvePersistentBrowserRuntimeStartOptions(
    input,
    input.entrypoint ?? 'cli',
  )
  const plan = planManagedChromeExecution(options)

  if (plan.mode !== 'managed' || plan.browserRuntime.mode !== 'warm') {
    throw new Error('Browser runtime start requires a managed warm runtime plan.')
  }

  const started = await manager.startPersistentRuntime(plan, {
    idleTtlMs:
      input.idleTtlMs ?? resolveDefaultWarmRuntimeIdleTtlMs(input.entrypoint ?? 'cli'),
  })
  const record = await manager.getRuntimeRecord(started.descriptor.runtimeId)
  if (!record) {
    throw new Error(`Browser runtime ${started.descriptor.runtimeId} disappeared after start.`)
  }

  return {
    action: started.reused ? 'reused' : 'started',
    runtime: toBrowserRuntimeStatusView(record.descriptor, record.lease, dependencies.now),
  }
}

export async function listBrowserRuntimes(
  input: BrowserRuntimeCommandEnvironment = {},
  logger = new RuntimeLogger({ level: 'info', scope: 'browser-list' }),
  dependencies: BrowserRuntimeCommandDependencies = {},
): Promise<BrowserRuntimeListResult> {
  const manager = resolveManager(input, logger, dependencies)
  const records = await manager.listRuntimeRecords()

  return {
    runtimes: records.map(record =>
      toBrowserRuntimeStatusView(record.descriptor, record.lease, dependencies.now),
    ),
  }
}

export async function getBrowserRuntimeStatus(
  input: BrowserRuntimeCommandEnvironment & { browserId: string },
  logger = new RuntimeLogger({ level: 'info', scope: 'browser-status' }),
  dependencies: BrowserRuntimeCommandDependencies = {},
): Promise<BrowserRuntimeStatusResult> {
  const manager = resolveManager(input, logger, dependencies)
  const record = await manager.getRuntimeRecord(input.browserId)

  return {
    runtime: record
      ? toBrowserRuntimeStatusView(record.descriptor, record.lease, dependencies.now)
      : null,
  }
}

export async function stopBrowserRuntime(
  input: BrowserRuntimeCommandEnvironment & {
    browserId: string
    force?: boolean | undefined
  },
  logger = new RuntimeLogger({ level: 'info', scope: 'browser-stop' }),
  dependencies: BrowserRuntimeCommandDependencies = {},
): Promise<BrowserRuntimeStopResultView> {
  const manager = resolveManager(input, logger, dependencies)
  const record = await manager.getRuntimeRecord(input.browserId)
  if (!record) {
    throw new Error(`Browser runtime not found: ${input.browserId}`)
  }

  if (record.descriptor.ownership !== 'managed') {
    throw new Error(
      `Browser runtime ${input.browserId} is attach/external. Stop only applies to managed runtimes.`,
    )
  }

  await manager.stopRuntime(input.browserId, {
    force: input.force === true,
  })
  return {
    action: 'stopped',
    browserId: input.browserId,
    forced: input.force === true,
    previousState: record.descriptor.state,
    owner: record.descriptor.ownership,
  }
}

export async function restartBrowserRuntime(
  input: BrowserRuntimeCommandEnvironment & {
    browserId: string
    force?: boolean | undefined
  },
  logger = new RuntimeLogger({ level: 'info', scope: 'browser-restart' }),
  dependencies: BrowserRuntimeCommandDependencies = {},
): Promise<BrowserRuntimeRestartResultView> {
  const manager = resolveManager(input, logger, dependencies)
  const restarted = await manager.restartPersistentRuntime(input.browserId, {
    force: input.force === true,
  })
  const record = await manager.getRuntimeRecord(
    restarted.descriptor.runtimeId,
  )
  if (!record) {
    throw new Error(
      `Browser runtime ${restarted.descriptor.runtimeId} disappeared after restart.`,
    )
  }

  return {
    action: 'restarted',
    forced: input.force === true,
    reused: restarted.reused,
    runtime: toBrowserRuntimeStatusView(record.descriptor, record.lease, dependencies.now),
  }
}

export async function cleanupStaleBrowserRuntimes(
  input: BrowserRuntimeCommandEnvironment = {},
  logger = new RuntimeLogger({ level: 'info', scope: 'browser-cleanup-stale' }),
  dependencies: BrowserRuntimeCommandDependencies = {},
): Promise<BrowserRuntimeCleanupResultView> {
  const manager = resolveManager(input, logger, dependencies)
  const report = await manager.cleanupStaleRuntimes()
  const remaining = await manager.listRuntimeRecords()

  return {
    action: 'cleanup-stale',
    scannedRuntimeIds: report.scannedRuntimeIds,
    cleanedRuntimeIds: report.cleanedRuntimeIds,
    forgottenRuntimeIds: report.forgottenRuntimeIds,
    keptRuntimeIds: report.keptRuntimeIds,
    runtimes: remaining.map(record =>
      toBrowserRuntimeStatusView(record.descriptor, record.lease, dependencies.now),
    ),
  }
}

function resolveManager(
  input: BrowserRuntimeCommandEnvironment,
  logger: RuntimeLogger,
  dependencies: BrowserRuntimeCommandDependencies,
): BrowserRuntimeManager {
  return (
    dependencies.manager ??
    new BrowserRuntimeManager({
      cwd: input.cwd,
      runtimeDir: input.runtimeDir,
      logger,
    })
  )
}

function toBrowserRuntimeStatusView(
  descriptor: BrowserRuntimeDescriptor,
  lease: BrowserRuntimeLease | null,
  nowFactory?: () => Date,
): BrowserRuntimeStatusView {
  const now = nowFactory?.() ?? new Date()
  const createdAtMs = Date.parse(descriptor.createdAt)
  const lastUsedAt = lease?.startedAt ?? descriptor.lastLeaseReleasedAt ?? null
  const idleExpiresAt =
    descriptor.idleTtlMs && descriptor.lastLeaseReleasedAt
      ? new Date(Date.parse(descriptor.lastLeaseReleasedAt) + descriptor.idleTtlMs).toISOString()
      : null
  const idleRemainingMs =
    idleExpiresAt && descriptor.state === 'idle'
      ? Math.max(Date.parse(idleExpiresAt) - now.getTime(), 0)
      : null

  return {
    browserId: descriptor.runtimeId,
    runtimeId: descriptor.runtimeId,
    mode: descriptor.mode,
    owner: descriptor.ownership,
    purpose: descriptor.purpose,
    state: descriptor.state,
    busy: lease !== null,
    cdpUrl: descriptor.cdpUrl,
    browserUrl: descriptor.browserUrl ?? null,
    pid: descriptor.pid ?? null,
    profileDir: descriptor.profileDir ?? null,
    keepTempProfile: descriptor.keepTempProfile,
    ageMs: Number.isFinite(createdAtMs) ? Math.max(now.getTime() - createdAtMs, 0) : 0,
    lastUsedAt,
    idleTtlMs: descriptor.idleTtlMs ?? null,
    idleExpiresAt,
    idleRemainingMs,
    lease: lease ? toBrowserRuntimeLeaseView(lease, now) : null,
    managedConfig: sanitizeManagedConfigForStatus(descriptor.managedConfig ?? null),
    availableActions: buildAvailableBrowserRuntimeActions(descriptor, lease),
  }
}

function sanitizeManagedConfigForStatus(
  managedConfig: BrowserRuntimeDescriptor['managedConfig'],
): BrowserRuntimeStatusView['managedConfig'] {
  if (!managedConfig) {
    return null
  }

  const visibleManagedConfig = { ...managedConfig }
  delete visibleManagedConfig.chromeProfileCopyScope
  return visibleManagedConfig
}

function toBrowserRuntimeLeaseView(
  lease: BrowserRuntimeLease,
  now: Date,
) {
  const startedAtMs = Date.parse(lease.startedAt)
  return {
    ...lease,
    ageMs: Number.isFinite(startedAtMs) ? Math.max(now.getTime() - startedAtMs, 0) : 0,
  }
}

function buildAvailableBrowserRuntimeActions(
  descriptor: BrowserRuntimeDescriptor,
  lease: BrowserRuntimeLease | null,
): string[] {
  if (descriptor.ownership !== 'managed') {
    return []
  }

  const actions = ['stop']
  if (descriptor.mode === 'warm' && descriptor.managedConfig) {
    actions.push('restart')
  }
  if (lease) {
    actions.push('force-stop')
    if (descriptor.mode === 'warm' && descriptor.managedConfig) {
      actions.push('force-restart')
    }
  }
  return actions
}
