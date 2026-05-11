import { createConnection } from 'node:net'
import type {
  BrowserRuntimeEndpointObservation,
  BrowserRuntimeObservedEndpointKind,
} from '../../types/browser-runtime-auto-management.types.js'

export async function observeLocalBrowserRuntimeEndpoint(
  cdpUrl: string,
): Promise<BrowserRuntimeEndpointObservation> {
  const target = parseLocalCdpEndpointTarget(cdpUrl)
  const devtoolsProbe = await probeExistingChromeDevtoolsEndpoint(target.browserUrl)

  if (devtoolsProbe.kind === 'chrome-devtools-active') {
    return {
      devtoolsEndpointDetected: true,
      nonCdpPortOccupied: false,
      endpointKind: 'chrome-devtools-active',
    }
  }

  const nonCdpPortOccupied = await isLocalTcpPortOccupied({
    host: target.host,
    port: target.port,
  })

  return {
    devtoolsEndpointDetected: false,
    nonCdpPortOccupied,
    endpointKind: nonCdpPortOccupied ? 'non-cdp-port-occupied' : 'available',
  }
}

export async function probeExistingChromeDevtoolsEndpoint(browserUrl: string): Promise<{
  kind: Extract<BrowserRuntimeObservedEndpointKind, 'available' | 'chrome-devtools-active'>
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 750)

  try {
    const response = await fetch(`${browserUrl}/json/version`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        kind: 'available',
      }
    }

    const payload: unknown = await response.json().catch(() => null)
    if (!isChromeDevtoolsVersionPayload(payload)) {
      return {
        kind: 'available',
      }
    }

    return {
      kind: 'chrome-devtools-active',
    }
  } catch {
    return {
      kind: 'available',
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function isLocalTcpPortOccupied(input: {
  host: string
  port: number
}): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({
      host: input.host,
      port: input.port,
    })

    const finish = (occupied: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(occupied)
    }

    socket.setTimeout(750)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function parseLocalCdpEndpointTarget(cdpUrl: string): {
  browserUrl: string
  host: string
  port: number
} {
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
    browserUrl: `${url.protocol}//${url.host}`,
    host: url.hostname,
    port,
  }
}

function isChromeDevtoolsVersionPayload(
  value: unknown,
): value is {
  Browser?: string
  webSocketDebuggerUrl?: string
} {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  if ('webSocketDebuggerUrl' in value && typeof value.webSocketDebuggerUrl === 'string') {
    return true
  }

  return 'Browser' in value && typeof value.Browser === 'string'
}
