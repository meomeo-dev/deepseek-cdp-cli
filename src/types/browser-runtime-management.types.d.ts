import type {
  BrowserRuntimeLease,
  BrowserRuntimeManagedLaunchConfig,
  BrowserRuntimeMode,
  BrowserRuntimeOwnership,
  BrowserRuntimePurpose,
  BrowserRuntimeState,
} from './browser-runtime.types.js'

export interface BrowserRuntimeStartCommandInput {
  cdpUrl: string
  timeoutMs: number
  headless: boolean
  proxyServer?: string | undefined
  chromeExecutablePath?: string | undefined
  chromeUserDataDir?: string | undefined
  chromeProfileDirectory?: string | undefined
  keepTempChromeProfile: boolean
  browserPurpose?: BrowserRuntimePurpose | undefined
  idleTtlMs?: number | undefined
}

export interface BrowserRuntimeLeaseView extends BrowserRuntimeLease {
  ageMs: number
}

export interface BrowserRuntimeStatusView {
  browserId: string
  runtimeId: string
  mode: BrowserRuntimeMode
  owner: BrowserRuntimeOwnership
  purpose: BrowserRuntimePurpose
  state: BrowserRuntimeState
  busy: boolean
  cdpUrl: string
  browserUrl: string | null
  pid: number | null
  profileDir: string | null
  keepTempProfile: boolean
  ageMs: number
  lastUsedAt: string | null
  idleTtlMs: number | null
  idleExpiresAt: string | null
  idleRemainingMs: number | null
  lease: BrowserRuntimeLeaseView | null
  managedConfig: BrowserRuntimeManagedLaunchConfig | null
  availableActions: string[]
}

export interface BrowserRuntimeListResult {
  runtimes: BrowserRuntimeStatusView[]
}

export interface BrowserRuntimeStatusResult {
  runtime: BrowserRuntimeStatusView | null
}

export interface BrowserRuntimeStartResultView {
  action: 'started' | 'reused'
  runtime: BrowserRuntimeStatusView
}

export interface BrowserRuntimeStopResultView {
  action: 'stopped'
  browserId: string
  forced: boolean
  previousState: BrowserRuntimeState
  owner: BrowserRuntimeOwnership
}

export interface BrowserRuntimeRestartResultView {
  action: 'restarted'
  forced: boolean
  reused: boolean
  runtime: BrowserRuntimeStatusView
}

export interface BrowserRuntimeCleanupResultView {
  action: 'cleanup-stale'
  scannedRuntimeIds: string[]
  cleanedRuntimeIds: string[]
  forgottenRuntimeIds: string[]
  keptRuntimeIds: string[]
  runtimes: BrowserRuntimeStatusView[]
}
