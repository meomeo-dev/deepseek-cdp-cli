export type BrowserRuntimeId = string

export type BrowserRuntimeLeaseId = string

export type BrowserRuntimeMode = 'attach' | 'ephemeral' | 'warm'

export type BrowserRuntimePurpose = 'primary' | 'probe' | 'regression' | 'audit'

export type BrowserRuntimeOwnership = 'external' | 'managed'

export type BrowserRuntimeState =
  | 'starting'
  | 'ready'
  | 'busy'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'stale'
  | 'error'

export type BrowserRuntimeEntrypoint = 'cli' | 'interactive' | 'rpc' | 'unspecified'

export type ChromeProfileCopyScope = 'default' | 'reduced-manifest-experimental'

export type BrowserRuntimeResolutionSource =
  | 'explicit-browser-id'
  | 'explicit-browser-mode'
  | 'legacy-clone-flag'

export type BrowserRuntimeExecutionDisposition =
  | 'reuse-existing-runtime'
  | 'attach-existing-cdp'
  | 'managed-single-run'
  | 'managed-persistent-runtime'

export interface BrowserRuntimeManagedLaunchConfig {
  timeoutMs: number
  headless: boolean
  proxyServer?: string | null | undefined
  chromeExecutablePath: string
  chromeUserDataDir: string
  chromeProfileDirectory?: string | null | undefined
  chromeProfileCopyScope?: ChromeProfileCopyScope | undefined
}

export interface BrowserRuntimeDescriptor {
  runtimeId: BrowserRuntimeId
  mode: BrowserRuntimeMode
  ownership: BrowserRuntimeOwnership
  purpose: BrowserRuntimePurpose
  state: BrowserRuntimeState
  cdpUrl: string
  browserUrl?: string | null | undefined
  browserWSEndpoint?: string | undefined
  pid?: number | null | undefined
  profileDir?: string | null | undefined
  keepTempProfile: boolean
  managedConfig?: BrowserRuntimeManagedLaunchConfig | null | undefined
  createdAt: string
  lastSeenAt: string
  lastLeaseReleasedAt?: string | null | undefined
  idleTtlMs?: number | null | undefined
}

export interface BrowserRuntimeLease {
  runtimeId: BrowserRuntimeId
  leaseId: BrowserRuntimeLeaseId
  operation: string
  pid: number
  startedAt: string
  heartbeatAt: string
  pageCount: number
}

export interface BrowserRuntimeOptionInput {
  cdpUrl: string
  explicitCdpUrl?: boolean | undefined
  timeoutMs: number
  cloneChromeProfile: boolean
  deepSeekAuthProfile?: boolean | undefined
  headless: boolean
  proxyServer?: string | undefined
  chromeExecutablePath?: string | undefined
  chromeUserDataDir?: string | undefined
  chromeProfileDirectory?: string | undefined
  keepTempChromeProfile: boolean
  browserId?: BrowserRuntimeId | undefined
  browserMode?: BrowserRuntimeMode | undefined
  browserPurpose?: BrowserRuntimePurpose | undefined
}

export interface BrowserRuntimeResolverContext {
  entrypoint: BrowserRuntimeEntrypoint
  allowWarmPersistentRuntime?: boolean | undefined
}

export interface BrowserRuntimeResolution {
  entrypoint: BrowserRuntimeEntrypoint
  browserId?: BrowserRuntimeId | undefined
  requestedMode: BrowserRuntimeMode | null
  mode: BrowserRuntimeMode
  ownership: BrowserRuntimeOwnership
  purpose: BrowserRuntimePurpose
  source: BrowserRuntimeResolutionSource
  executionDisposition: BrowserRuntimeExecutionDisposition
  persistentRuntimeReady: boolean
  notes: string[]
}
