import { resolveBrowserRuntimeOptions } from '../../domain/browser/browserRuntimeResolver.js'
import type { BrowserRuntimePurpose } from '../../types/browser-runtime.types.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'

export interface InteractiveBrowserRuntimeBinding {
  browserId: string
  purpose: BrowserRuntimePurpose
}

export function createInteractiveBrowserRuntimeBinding(
  options: ManagedChromeOptions,
): InteractiveBrowserRuntimeBinding | null {
  const browserId = options.browserRuntime?.browserId ?? options.browserId
  if (!browserId) {
    return null
  }

  return {
    browserId,
    purpose: options.browserRuntime?.purpose ?? options.browserPurpose ?? 'primary',
  }
}

export function deriveInteractiveShellBaseManagedChromeOptions(
  options: ManagedChromeOptions,
): ManagedChromeOptions {
  const requestedMode =
    options.browserRuntime !== undefined
      ? options.browserRuntime.requestedMode
      : options.browserMode
  const purpose = options.browserRuntime?.purpose ?? options.browserPurpose ?? 'primary'

  return resolveBrowserRuntimeOptions(
    {
      cdpUrl: options.cdpUrl,
      timeoutMs: options.timeoutMs,
      cloneChromeProfile: options.cloneChromeProfile,
      headless: options.headless,
      proxyServer: options.proxyServer,
      chromeExecutablePath: options.chromeExecutablePath,
      chromeUserDataDir: options.chromeUserDataDir,
      chromeProfileDirectory: options.chromeProfileDirectory,
      keepTempChromeProfile: options.keepTempChromeProfile,
      browserPurpose: purpose,
      ...(requestedMode ? { browserMode: requestedMode } : {}),
    },
    { entrypoint: 'interactive' },
  )
}

export function resolveInteractiveShellManagedChromeOptions(
  baseOptions: ManagedChromeOptions,
  binding: InteractiveBrowserRuntimeBinding | null,
): ManagedChromeOptions {
  if (!binding) {
    return baseOptions
  }

  const requestedMode =
    baseOptions.browserRuntime !== undefined
      ? baseOptions.browserRuntime.requestedMode
      : baseOptions.browserMode

  return resolveBrowserRuntimeOptions(
    {
      cdpUrl: baseOptions.cdpUrl,
      timeoutMs: baseOptions.timeoutMs,
      cloneChromeProfile: baseOptions.cloneChromeProfile,
      headless: baseOptions.headless,
      proxyServer: baseOptions.proxyServer,
      chromeExecutablePath: baseOptions.chromeExecutablePath,
      chromeUserDataDir: baseOptions.chromeUserDataDir,
      chromeProfileDirectory: baseOptions.chromeProfileDirectory,
      keepTempChromeProfile: baseOptions.keepTempChromeProfile,
      browserId: binding.browserId,
      browserPurpose: binding.purpose,
      ...(requestedMode ? { browserMode: requestedMode } : {}),
    },
    { entrypoint: 'interactive' },
  )
}

export function shouldPinStartedInteractiveBrowserRuntime(
  purpose: BrowserRuntimePurpose,
): boolean {
  return purpose === 'primary'
}

export function bindStartedInteractiveBrowserRuntime(
  current: InteractiveBrowserRuntimeBinding | null,
  runtime: InteractiveBrowserRuntimeBinding,
): InteractiveBrowserRuntimeBinding | null {
  return shouldPinStartedInteractiveBrowserRuntime(runtime.purpose) ? runtime : current
}

export function clearInteractiveBrowserRuntimeBinding(
  current: InteractiveBrowserRuntimeBinding | null,
  browserId: string,
): InteractiveBrowserRuntimeBinding | null {
  return current?.browserId === browserId ? null : current
}
