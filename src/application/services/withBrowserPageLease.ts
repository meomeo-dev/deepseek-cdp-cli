import type { ManagedChromeRuntimeHandle } from '../../domain/browser/managedChrome.js'
import {
  withCdpPage,
  type CdpPageContext,
} from '../../infrastructure/browser/cdpPage.js'

export async function withBrowserPageLease<T>(
  options: {
    runtime: ManagedChromeRuntimeHandle
    timeoutMs: number
  },
  run: (context: CdpPageContext) => Promise<T>,
): Promise<T> {
  return withCdpPage(
    {
      runtime: options.runtime,
      timeoutMs: options.timeoutMs,
    },
    run,
  )
}

export type { CdpPageContext }
