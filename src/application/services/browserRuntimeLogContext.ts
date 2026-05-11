import type { ManagedChromeRuntimeHandle } from '../../domain/browser/managedChrome.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'

export function buildRequestedBrowserRuntimeLogContext(
  input: ManagedChromeOptions,
): Record<string, unknown> {
  const browserRuntimeMode =
    input.browserRuntime?.mode ?? input.browserMode ?? (input.cloneChromeProfile ? 'ephemeral' : 'attach')

  return {
    ...(input.browserId
      ? {
          browserId: input.browserId,
          requestedCdpUrl: input.cdpUrl,
        }
      : {
          cdpUrl: input.cdpUrl,
        }),
    cloneChromeProfile: input.cloneChromeProfile,
    browserRuntimeMode,
  }
}

export function buildAcquiredBrowserRuntimeLogContext(
  runtime: ManagedChromeRuntimeHandle,
): Record<string, unknown> {
  return {
    browserId: runtime.descriptor.runtimeId,
    cdpUrl: runtime.descriptor.cdpUrl,
    browserRuntimeMode: runtime.descriptor.mode,
    owner: runtime.descriptor.ownership,
    purpose: runtime.descriptor.purpose,
  }
}
