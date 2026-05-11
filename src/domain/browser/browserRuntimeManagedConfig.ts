import type {
  BrowserRuntimeManagedLaunchConfig,
  ChromeProfileCopyScope,
} from '../../types/browser-runtime.types.js'
import type { ManagedChromeExecutionPlan } from '../../types/managed-chrome.types.js'
import {
  resolveDefaultChromeExecutablePath,
  resolveDefaultChromeUserDataDir,
} from '../../shared/runtime/managedChromeDefaults.js'
import { resolveChromeProfileCopyScope } from './chromeProfileCopyScope.js'

export function buildManagedLaunchConfigFromPlan(
  plan: Extract<ManagedChromeExecutionPlan, { mode: 'managed' }>,
): BrowserRuntimeManagedLaunchConfig {
  const managedConfig = resolveManagedLaunchConfigFromChromeOptions(plan)
  if (!managedConfig) {
    if (!normalizeOptionalString(plan.chromeExecutablePath)) {
      throw new Error('Could not resolve Chrome executable. Pass --chrome-executable-path.')
    }
    throw new Error('Could not resolve Chrome user-data-dir. Pass --chrome-user-data-dir.')
  }

  return managedConfig
}

export function resolveManagedLaunchConfigFromChromeOptions(
  chrome: {
    timeoutMs: number
    headless: boolean
    proxyServer?: string | null | undefined
    chromeExecutablePath?: string | null | undefined
    chromeUserDataDir?: string | null | undefined
    chromeProfileDirectory?: string | null | undefined
    chromeProfileCopyScope?: ChromeProfileCopyScope | null | undefined
  },
): BrowserRuntimeManagedLaunchConfig | null {
  const chromeExecutablePath =
    normalizeOptionalString(chrome.chromeExecutablePath) ?? resolveDefaultChromeExecutablePath()
  if (!chromeExecutablePath) {
    return null
  }

  const chromeUserDataDir =
    normalizeOptionalString(chrome.chromeUserDataDir) ?? resolveDefaultChromeUserDataDir()
  if (!chromeUserDataDir) {
    return null
  }

  return buildManagedLaunchConfig({
    timeoutMs: chrome.timeoutMs,
    headless: chrome.headless,
    proxyServer: normalizeOptionalString(chrome.proxyServer) ?? null,
    chromeExecutablePath,
    chromeUserDataDir,
    chromeProfileDirectory: normalizeOptionalString(chrome.chromeProfileDirectory) ?? null,
    chromeProfileCopyScope: resolveChromeProfileCopyScope(chrome.chromeProfileCopyScope),
  })
}

export function buildManagedLaunchConfig(input: {
  timeoutMs: number
  headless: boolean
  proxyServer: string | null
  chromeExecutablePath: string
  chromeUserDataDir: string
  chromeProfileDirectory: string | null
  chromeProfileCopyScope: ChromeProfileCopyScope
}): BrowserRuntimeManagedLaunchConfig {
  return {
    timeoutMs: input.timeoutMs,
    headless: input.headless,
    proxyServer: input.proxyServer,
    chromeExecutablePath: input.chromeExecutablePath,
    chromeUserDataDir: input.chromeUserDataDir,
    chromeProfileDirectory: input.chromeProfileDirectory,
    chromeProfileCopyScope: input.chromeProfileCopyScope,
  }
}

export function areManagedLaunchConfigsEquivalent(
  left: BrowserRuntimeManagedLaunchConfig,
  right: BrowserRuntimeManagedLaunchConfig,
): boolean {
  return (
    left.timeoutMs === right.timeoutMs &&
    left.headless === right.headless &&
    (left.proxyServer ?? null) === (right.proxyServer ?? null) &&
    left.chromeExecutablePath === right.chromeExecutablePath &&
    left.chromeUserDataDir === right.chromeUserDataDir &&
    normalizeChromeProfileDirectory(left.chromeProfileDirectory) ===
      normalizeChromeProfileDirectory(right.chromeProfileDirectory) &&
    resolveChromeProfileCopyScope(left.chromeProfileCopyScope) ===
      resolveChromeProfileCopyScope(right.chromeProfileCopyScope)
  )
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeChromeProfileDirectory(value: string | undefined | null): string {
  return normalizeOptionalString(value) ?? ''
}
