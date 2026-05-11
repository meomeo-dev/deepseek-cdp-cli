import type { HttpRouteSurface } from './httpServer.js'

export const DEEPSEEK_HTTP_API_KEY_ENV = 'DEEPSEEK_HTTP_API_KEY'

export type HttpSurfaceSelection = 'rpc' | 'openai' | 'both'
export type HttpTransportSelection = 'stdio' | 'http'

export interface ResolveServeHttpOptionsInput {
  transport: HttpTransportSelection
  port: number
  host?: string | undefined
  httpSurface?: string | undefined
  httpApiKey?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  hostExplicit?: boolean | undefined
  httpSurfaceExplicit?: boolean | undefined
  httpApiKeyExplicit?: boolean | undefined
}

export interface ResolvedServeHttpOptions {
  transport: HttpTransportSelection
  port: number
  host: string
  httpSurface: HttpSurfaceSelection
  surfaces: HttpRouteSurface[]
  httpApiKey?: string | undefined
}

export function resolveServeHttpOptions(
  input: ResolveServeHttpOptionsInput,
): ResolvedServeHttpOptions {
  const httpSurface = resolveHttpSurfaceSelection(input.httpSurface)
  const host = normalizeHost(input.host)
  const httpApiKey = resolveHttpApiKey(input.httpApiKey, input.env)

  if (input.transport === 'stdio') {
    if (input.hostExplicit || input.httpSurfaceExplicit || input.httpApiKeyExplicit) {
      throw new Error(
        '`--host`, `--http-surface`, and `--http-api-key` only apply to `serve --transport http`.',
      )
    }
  }

  if (input.transport === 'http') {
    if ((httpSurface === 'openai' || httpSurface === 'both') && !httpApiKey) {
      throw new Error(
        'HTTP surfaces including `openai` require `--http-api-key` or `DEEPSEEK_HTTP_API_KEY`.',
      )
    }

    if (!isLoopbackHost(host) && !httpApiKey) {
      throw new Error(
        'Non-loopback HTTP bind requires `--http-api-key` or `DEEPSEEK_HTTP_API_KEY`.',
      )
    }
  }

  return {
    transport: input.transport,
    port: input.port,
    host,
    httpSurface,
    surfaces: expandHttpSurfaceSelection(httpSurface),
    ...(httpApiKey ? { httpApiKey } : {}),
  }
}

export function resolveHttpSurfaceSelection(value: string | undefined): HttpSurfaceSelection {
  if (value === undefined || value === 'rpc' || value === 'openai' || value === 'both') {
    return value ?? 'rpc'
  }

  throw new Error(
    `Invalid --http-surface: ${value}. Expected one of rpc, openai, or both.`,
  )
}

export function expandHttpSurfaceSelection(
  selection: HttpSurfaceSelection,
): HttpRouteSurface[] {
  switch (selection) {
    case 'rpc':
      return ['rpc']
    case 'openai':
      return ['openai']
    case 'both':
      return ['rpc', 'openai']
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

function normalizeHost(host: string | undefined): string {
  const normalized = host?.trim()
  return normalized ? normalized : '127.0.0.1'
}

function resolveHttpApiKey(
  httpApiKey: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): string | undefined {
  const cliValue = httpApiKey?.trim()
  if (cliValue) {
    return cliValue
  }

  const envValue = env?.[DEEPSEEK_HTTP_API_KEY_ENV]?.trim()
  return envValue ? envValue : undefined
}
