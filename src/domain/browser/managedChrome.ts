import {
  decideBrowserRuntimeAction,
} from '../../application/services/browserRuntimeAutoManagement.js'
import {
  createBrowserRuntimeObservationDependencies,
  observeBrowserRuntime,
} from '../../application/services/browserRuntimeObservation.js'
import { allocateIsolatedManagedChromeCdpUrl } from '../../shared/runtime/managedChromeCdpUrl.js'
import {
  resolveDefaultChromeExecutablePath,
  resolveDefaultChromeUserDataDir,
} from '../../shared/runtime/managedChromeDefaults.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  BrowserRuntimeAutoManagementAction,
  BrowserRuntimeAutoManagementAttempt,
  BrowserRuntimeAutoManagementDecision,
  BrowserRuntimeEndpointObservation,
} from '../../types/browser-runtime-auto-management.types.js'
import type {
  LocalCdpTarget,
  ManagedChromeExecutionPlan,
  ManagedChromeOptions,
} from '../../types/managed-chrome.types.js'
import { coerceBrowserRuntimeResolution } from './browserRuntimeResolver.js'
import { DEFAULT_CHROME_PROFILE_COPY_SCOPE } from './chromeProfileCopyScope.js'
import {
  BrowserRuntimeManager,
  type AcquiredBrowserRuntime,
} from './browserRuntimeManager.js'
import { registerBrowserRuntimeProcessCleanup } from './browserRuntimeProcessCleanup.js'
export {
  acquireManagedChromeExecutionLock,
  releaseManagedChromeExecutionLock,
  type ManagedChromeExecutionLock,
} from './managedChromeLock.js'

export interface ManagedChromeRuntimeOptions {
  cwd?: string | undefined
  runtimeDir?: string | undefined
  operation?: string | undefined
  idleTtlMs?: number | null | undefined
  manager?: BrowserRuntimeManager | undefined
  logger?: Pick<RuntimeLogger, 'debug' | 'info' | 'error'> | undefined
  defaultCdpUrl?: string | undefined
  observeEndpoint?: ((cdpUrl: string) => Promise<BrowserRuntimeEndpointObservation>) | undefined
  allocateIsolatedCdpUrl?: ((baseCdpUrl: string) => Promise<string>) | undefined
  onAutoManagementDecision?: ((decision: BrowserRuntimeAutoManagementDecision) => void) | undefined
}

export type ManagedChromeRuntimeHandle = AcquiredBrowserRuntime

const DEFAULT_MANAGED_CHROME_CDP_URL = 'http://127.0.0.1:9222'
const RETRYABLE_AUTO_MANAGEMENT_ACTIONS = new Set<BrowserRuntimeAutoManagementAction>([
  'reuse-registered-runtime',
  'launch-managed-on-requested-endpoint',
])

export function parseLocalCdpUrl(cdpUrl: string): LocalCdpTarget {
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

export { resolveDefaultChromeExecutablePath, resolveDefaultChromeUserDataDir }

export function buildManagedChromeLaunchArgs(options: {
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

export function planManagedChromeExecution(
  options: ManagedChromeOptions,
): ManagedChromeExecutionPlan {
  const browserId = normalizeOptionalString(options.browserId)
  const browserRuntime = coerceBrowserRuntimeResolution(options)
  const runtimeMode = browserRuntime.mode
  const proxyServer = normalizeOptionalString(options.proxyServer)
  const chromeExecutablePath = normalizeOptionalString(options.chromeExecutablePath)
  const chromeUserDataDir = normalizeOptionalString(options.chromeUserDataDir)
  const chromeProfileDirectory = normalizeOptionalString(options.chromeProfileDirectory)

  if (browserId) {
    return {
      mode: 'runtime',
      browserRuntime,
      browserId,
      timeoutMs: options.timeoutMs,
    }
  }

  if (options.headless && runtimeMode === 'attach') {
    throw new Error('`--headless` requires a managed browser mode (`ephemeral` or `warm`).')
  }
  if (proxyServer && runtimeMode === 'attach') {
    throw new Error('`--proxy` requires a managed browser mode (`ephemeral` or `warm`).')
  }

  if (runtimeMode === 'attach') {
    return {
      mode: 'existing',
      browserRuntime,
      cdpUrl: options.cdpUrl,
      timeoutMs: options.timeoutMs,
      cloneChromeProfile: false,
      headless: false,
      proxyServer: null,
      chromeExecutablePath: null,
      chromeUserDataDir: null,
      chromeProfileDirectory: null,
      keepTempChromeProfile: options.keepTempChromeProfile,
    }
  }

  return {
    mode: 'managed',
    browserRuntime,
    cdpUrl: options.cdpUrl,
    timeoutMs: options.timeoutMs,
    cloneChromeProfile: true,
    ...(options.deepSeekAuthProfile === true ? { deepSeekAuthProfile: true } : {}),
    chromeProfileCopyScope: DEFAULT_CHROME_PROFILE_COPY_SCOPE,
    headless: options.headless,
    proxyServer: proxyServer ?? null,
    chromeExecutablePath: chromeExecutablePath ?? resolveDefaultChromeExecutablePath() ?? null,
    chromeUserDataDir: chromeUserDataDir ?? resolveDefaultChromeUserDataDir() ?? null,
    chromeProfileDirectory: chromeProfileDirectory ?? null,
    keepTempChromeProfile: options.keepTempChromeProfile,
    cdpTarget: parseLocalCdpUrl(options.cdpUrl),
  }
}

export async function withManagedChromeIfNeeded<T>(
  options: ManagedChromeOptions,
  run: (cdpUrl: string) => Promise<T>,
  runtimeOptions: ManagedChromeRuntimeOptions = {},
): Promise<T> {
  return withManagedChromeRuntimeIfNeeded(
    options,
    runtime => run(runtime.descriptor.cdpUrl),
    runtimeOptions,
  )
}

export async function withManagedChromeRuntimeIfNeeded<T>(
  options: ManagedChromeOptions,
  run: (runtime: ManagedChromeRuntimeHandle) => Promise<T>,
  runtimeOptions: ManagedChromeRuntimeOptions = {},
): Promise<T> {
  const manager =
    runtimeOptions.manager ??
    new BrowserRuntimeManager({
      cwd: runtimeOptions.cwd,
      runtimeDir: runtimeOptions.runtimeDir,
      logger: runtimeOptions.logger,
    })
  const acquired = shouldUseBrowserRuntimeAutoManagement(options, runtimeOptions)
    ? await acquireManagedChromeRuntimeWithAutoManagement(options, manager, runtimeOptions)
    : await acquireManagedChromeRuntimeFromOptions(options, manager, runtimeOptions)
  const releaseAcquired = createOnceAsync(async () => {
    await acquired.release()
  })
  const unregisterProcessCleanup = registerBrowserRuntimeProcessCleanup(releaseAcquired)

  try {
    return await run(acquired)
  } finally {
    unregisterProcessCleanup()
    await releaseAcquired()
  }
}

export function resolveDefaultWarmRuntimeIdleTtlMs(
  entrypoint: ManagedChromeExecutionPlan['browserRuntime']['entrypoint'],
): number | null {
  if (entrypoint === 'interactive') {
    return 15 * 60 * 1_000
  }

  if (entrypoint === 'rpc' || entrypoint === 'cli') {
    return 30 * 60 * 1_000
  }

  return null
}

async function acquireManagedChromeRuntimeWithAutoManagement(
  options: ManagedChromeOptions,
  manager: BrowserRuntimeManager,
  runtimeOptions: ManagedChromeRuntimeOptions,
): Promise<ManagedChromeRuntimeHandle> {
  const attempts: BrowserRuntimeAutoManagementAttempt[] = []
  let lastActionFailure: {
    action: BrowserRuntimeAutoManagementAction
    error: unknown
  } | null = null

  while (true) {
    const observation = await observeBrowserRuntime(
      {
        chrome: options,
        defaultCdpUrl: runtimeOptions.defaultCdpUrl ?? DEFAULT_MANAGED_CHROME_CDP_URL,
      },
      {
        ...createBrowserRuntimeObservationDependencies(manager),
        ...(runtimeOptions.observeEndpoint
          ? {
              observeEndpoint: runtimeOptions.observeEndpoint,
            }
          : {}),
      },
    )
    const decision = decideBrowserRuntimeAction({
      chrome: options,
      observation,
      attempts,
    })
    runtimeOptions.onAutoManagementDecision?.(decision)
    runtimeOptions.logger?.debug?.('Browser runtime auto-management decision settled', {
      requestKind: decision.requestedPolicy.requestKind,
      requestedCdpUrl: decision.requestedCdpUrl,
      stateFingerprint: decision.stateFingerprint,
      chosenAction: decision.chosenAction,
      observedEndpointKind: decision.observedEndpointKind,
      ownershipConfidence: decision.ownershipConfidence,
      observedState: decision.observedState,
      rejectedActions: decision.rejectedActions.map(rejection => ({
        action: rejection.action,
        reason: rejection.reason,
      })),
    })

    if (decision.chosenAction === 'fail-closed') {
      throw buildBrowserRuntimeAutoManagementFailClosedError(decision, lastActionFailure)
    }

    try {
      return await executeBrowserRuntimeAutoManagementAction(
        options,
        decision,
        manager,
        runtimeOptions,
      )
    } catch (error) {
      lastActionFailure = {
        action: decision.chosenAction,
        error,
      }
      runtimeOptions.logger?.debug?.('Browser runtime auto-management action failed', {
        action: decision.chosenAction,
        requestedCdpUrl: decision.requestedCdpUrl,
        stateFingerprint: decision.stateFingerprint,
        error: getErrorMessage(error),
      })

      if (!RETRYABLE_AUTO_MANAGEMENT_ACTIONS.has(decision.chosenAction)) {
        throw buildBrowserRuntimeAutoManagementActionError(decision, error)
      }

      attempts.push({
        action: decision.chosenAction,
        stateFingerprint: decision.stateFingerprint,
      })
    }
  }
}

async function executeBrowserRuntimeAutoManagementAction(
  options: ManagedChromeOptions,
  decision: BrowserRuntimeAutoManagementDecision,
  manager: BrowserRuntimeManager,
  runtimeOptions: ManagedChromeRuntimeOptions,
): Promise<ManagedChromeRuntimeHandle> {
  switch (decision.chosenAction) {
    case 'execute-explicit-intent':
    case 'launch-managed-on-requested-endpoint':
    case 'attach-existing-devtools-endpoint':
      return acquireManagedChromeRuntimeFromOptions(options, manager, runtimeOptions)
    case 'reuse-registered-runtime': {
      const runtimeId = decision.registeredRuntimeMatch?.descriptor.runtimeId
      if (!runtimeId) {
        throw new Error('Auto-management selected runtime reuse without a registered runtime id.')
      }

      return manager.acquireRegisteredRuntime(
        runtimeId,
        {
          operation: resolveManagedChromeRuntimeOperation(runtimeOptions),
        },
        {
          purpose: decision.requestedPolicy.requestedPurpose,
        },
      )
    }
    case 'allocate-isolated-managed-runtime': {
      const isolatedOptions = await buildAutoManagedIsolatedChromeOptions(options, runtimeOptions)
      return acquireManagedChromeRuntimeFromOptions(isolatedOptions, manager, runtimeOptions)
    }
    case 'fail-closed':
      throw buildBrowserRuntimeAutoManagementFailClosedError(decision, null)
  }
}

async function acquireManagedChromeRuntimeFromOptions(
  options: ManagedChromeOptions,
  manager: BrowserRuntimeManager,
  runtimeOptions: ManagedChromeRuntimeOptions,
): Promise<ManagedChromeRuntimeHandle> {
  const plan = planManagedChromeExecution(options)
  return acquireManagedChromeRuntimeFromPlan(plan, manager, runtimeOptions)
}

async function acquireManagedChromeRuntimeFromPlan(
  plan: ManagedChromeExecutionPlan,
  manager: BrowserRuntimeManager,
  runtimeOptions: ManagedChromeRuntimeOptions,
): Promise<ManagedChromeRuntimeHandle> {
  if (plan.mode === 'runtime') {
    return manager.acquireRegisteredRuntime(
      plan.browserId,
      {
        operation: resolveManagedChromeRuntimeOperation(runtimeOptions),
      },
      {
        purpose: plan.browserRuntime.purpose,
      },
    )
  }

  return manager.acquireCommandRuntime(
    plan,
    {
      operation: resolveManagedChromeRuntimeOperation(runtimeOptions),
    },
    {
      idleTtlMs:
        runtimeOptions.idleTtlMs ??
        resolveDefaultWarmRuntimeIdleTtlMs(plan.browserRuntime.entrypoint),
    },
  )
}

async function buildAutoManagedIsolatedChromeOptions(
  options: ManagedChromeOptions,
  runtimeOptions: ManagedChromeRuntimeOptions,
): Promise<ManagedChromeOptions> {
  return {
    ...options,
    browserId: undefined,
    cloneChromeProfile: true,
    cdpUrl: await (runtimeOptions.allocateIsolatedCdpUrl ?? allocateIsolatedManagedChromeCdpUrl)(
      options.cdpUrl,
    ),
    explicitCdpUrl: false,
  }
}

function shouldUseBrowserRuntimeAutoManagement(
  options: ManagedChromeOptions,
  runtimeOptions: ManagedChromeRuntimeOptions,
): boolean {
  const browserRuntime = coerceBrowserRuntimeResolution(options)
  const defaultCdpUrl = runtimeOptions.defaultCdpUrl ?? DEFAULT_MANAGED_CHROME_CDP_URL
  const requestedEndpointPinned =
    options.explicitCdpUrl === true ||
    normalizeUrl(options.cdpUrl) !== normalizeUrl(defaultCdpUrl)

  return (
    browserRuntime.entrypoint === 'cli' &&
    browserRuntime.source === 'legacy-clone-flag' &&
    normalizeOptionalString(options.browserId) === undefined &&
    requestedEndpointPinned === false
  )
}

function resolveManagedChromeRuntimeOperation(
  runtimeOptions: ManagedChromeRuntimeOptions,
): string {
  return runtimeOptions.operation ?? 'managed-chrome-run'
}

function buildBrowserRuntimeAutoManagementFailClosedError(
  decision: BrowserRuntimeAutoManagementDecision,
  lastActionFailure: {
    action: BrowserRuntimeAutoManagementAction
    error: unknown
  } | null,
): Error {
  const rejectedActions =
    decision.rejectedActions.length === 0
      ? ''
      : ` Rejected actions: ${decision.rejectedActions
          .map(rejection => `${rejection.action} (${rejection.reason})`)
          .join('; ')}.`
  const lastFailure = lastActionFailure
    ? ` Last action failure: ${lastActionFailure.action}: ${getErrorMessage(lastActionFailure.error)}.`
    : ''

  return new Error(
    `Browser runtime auto-management failed closed for ${decision.requestedCdpUrl}. ` +
      `${decision.reason}.${rejectedActions}${lastFailure}`,
  )
}

function buildBrowserRuntimeAutoManagementActionError(
  decision: BrowserRuntimeAutoManagementDecision,
  error: unknown,
): Error {
  return new Error(
    `Browser runtime auto-management action ${decision.chosenAction} failed for ` +
      `${decision.requestedCdpUrl}: ${getErrorMessage(error)}`,
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function createOnceAsync<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null

  return async () => {
    if (!pending) {
      pending = run()
    }

    return pending
  }
}
