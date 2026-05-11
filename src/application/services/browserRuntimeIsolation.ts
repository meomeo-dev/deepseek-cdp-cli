import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { allocateIsolatedManagedChromeCdpUrl as allocateManagedChromeCdpUrl } from '../../shared/runtime/managedChromeCdpUrl.js'
import type { BrowserRuntimePurpose } from '../../types/browser-runtime.types.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'
import {
  withManagedChromeRuntimeIfNeeded,
  type ManagedChromeRuntimeHandle,
} from '../../domain/browser/managedChrome.js'
import type { BrowserRuntimeManager } from '../../domain/browser/browserRuntimeManager.js'

export type IsolatedManagedBrowserMode = 'ephemeral' | 'warm'

export interface BrowserRuntimeIsolationOptions {
  chrome: ManagedChromeOptions
  purpose: BrowserRuntimePurpose
  browserMode?: IsolatedManagedBrowserMode | undefined
  allocateCdpUrl?: ((baseCdpUrl: string) => Promise<string>) | undefined
}

export interface WithIsolatedManagedBrowserRuntimeOptions
  extends BrowserRuntimeIsolationOptions {
  operation: string
  cwd?: string | undefined
  runtimeDir?: string | undefined
  idleTtlMs?: number | null | undefined
  manager?: BrowserRuntimeManager | undefined
  logger?: Pick<RuntimeLogger, 'debug' | 'info' | 'error'> | undefined
}

export async function resolveIsolatedManagedChromeOptions(
  input: BrowserRuntimeIsolationOptions,
): Promise<ManagedChromeOptions> {
  const browserId = normalizeOptionalString(input.chrome.browserId)

  if (browserId) {
    return {
      ...input.chrome,
      browserId,
      browserPurpose: input.purpose,
      browserRuntime: undefined,
    }
  }

  const browserMode =
    input.browserMode ?? (input.chrome.browserMode === 'warm' ? 'warm' : 'ephemeral')
  const cdpUrl = await (input.allocateCdpUrl ?? allocateManagedChromeCdpUrl)(
    input.chrome.cdpUrl,
  )

  return {
    ...input.chrome,
    browserId: undefined,
    browserMode,
    browserPurpose: input.purpose,
    browserRuntime: undefined,
    cloneChromeProfile: true,
    cdpUrl,
  }
}

export async function withIsolatedManagedBrowserRuntime<T>(
  input: WithIsolatedManagedBrowserRuntimeOptions,
  run: (context: {
    runtime: ManagedChromeRuntimeHandle
    chrome: ManagedChromeOptions
  }) => Promise<T>,
): Promise<T> {
  const chrome = await resolveIsolatedManagedChromeOptions(input)

  return withManagedChromeRuntimeIfNeeded(
    chrome,
    async runtime => {
      assertRuntimePurpose(runtime, input.purpose)
      return run({
        runtime,
        chrome,
      })
    },
    {
      cwd: input.cwd,
      runtimeDir: input.runtimeDir,
      idleTtlMs: input.idleTtlMs,
      manager: input.manager,
      logger: input.logger,
      operation: input.operation,
    },
  )
}

export async function allocateIsolatedManagedChromeCdpUrl(
  baseCdpUrl: string,
): Promise<string> {
  return allocateManagedChromeCdpUrl(baseCdpUrl)
}

function assertRuntimePurpose(
  runtime: ManagedChromeRuntimeHandle,
  expectedPurpose: BrowserRuntimePurpose,
): void {
  if (runtime.descriptor.purpose === expectedPurpose) {
    return
  }

  throw new Error(
    `Browser runtime ${runtime.descriptor.runtimeId} has purpose ` +
      `${runtime.descriptor.purpose}, expected ${expectedPurpose}.`,
  )
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
