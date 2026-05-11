import { allocateLocalPort } from './allocateLocalPort.js'

export async function allocateIsolatedManagedChromeCdpUrl(
  baseCdpUrl: string,
): Promise<string> {
  const parsed = new URL(baseCdpUrl)
  const host = resolveLoopbackHost(parsed.hostname)
  const port = await allocateLocalPort(host)

  parsed.hostname = host
  parsed.port = String(port)
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function resolveLoopbackHost(hostname: string): string {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return hostname === 'localhost' ? '127.0.0.1' : hostname
  }

  throw new Error(
    `Isolated managed browser runtime requires a local CDP url. Received host: ${hostname}`,
  )
}
