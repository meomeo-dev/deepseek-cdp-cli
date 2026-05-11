import puppeteer, {
  type Browser,
  type HTTPResponse,
  type Page,
} from 'puppeteer-core'
import type { AcquiredBrowserRuntime } from '../../domain/browser/browserRuntimeManager.js'
import type { WaitUntil } from '../../types/managed-chrome.types.js'

export interface CdpPageContext {
  page: Page
  goto: (url: string, waitUntil: WaitUntil) => Promise<HTTPResponse | null>
}

export interface CdpPageConnectionOptions {
  cdpUrl: string
  timeoutMs: number
  connect?: ((input: { cdpUrl: string; timeoutMs: number }) => Promise<Browser>) | undefined
}

export interface CdpPageLeaseOptions {
  runtime: AcquiredBrowserRuntime
  timeoutMs: number
  connect?: ((input: { cdpUrl: string; timeoutMs: number }) => Promise<Browser>) | undefined
}

const MIN_PROTOCOL_TIMEOUT_MS = 300_000

export async function withCdpPage<T>(
  options: CdpPageConnectionOptions | CdpPageLeaseOptions,
  run: (context: CdpPageContext) => Promise<T>,
): Promise<T> {
  const cdpUrl = 'runtime' in options ? options.runtime.descriptor.cdpUrl : options.cdpUrl
  const connect =
    options.connect ??
    (input =>
      puppeteer.connect({
        browserURL: input.cdpUrl,
        protocolTimeout: resolveCdpProtocolTimeoutMs(input.timeoutMs),
        defaultViewport: {
          width: 1440,
          height: 1200,
        },
      }))
  const browser = await connect({
    cdpUrl,
    timeoutMs: options.timeoutMs,
  })
  const runtimeLease = 'runtime' in options ? options.runtime : null
  let page: Page | null = null

  try {
    page = await browser.newPage()
    page.setDefaultNavigationTimeout(options.timeoutMs)
    page.setDefaultTimeout(options.timeoutMs)
    page.on('dialog', dialog => {
      void dialog.dismiss().catch(() => {})
    })

    if (runtimeLease) {
      await runtimeLease.manager
        .updateLeasePageCount(
          runtimeLease.descriptor.runtimeId,
          runtimeLease.lease.leaseId,
          1,
        )
        .catch(() => {})
    }

    const activePage = page
    return await run({
      page: activePage,
      goto: async (url: string, waitUntil: WaitUntil) =>
        activePage.goto(url, {
          waitUntil,
        }),
    })
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }

    if (runtimeLease) {
      await runtimeLease.manager
        .updateLeasePageCount(
          runtimeLease.descriptor.runtimeId,
          runtimeLease.lease.leaseId,
          0,
        )
        .catch(() => {})
    }
    await browser.disconnect().catch(() => {})
  }
}

export function resolveCdpProtocolTimeoutMs(timeoutMs: number): number {
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 0

  return Math.max(normalizedTimeoutMs * 2, MIN_PROTOCOL_TIMEOUT_MS)
}
