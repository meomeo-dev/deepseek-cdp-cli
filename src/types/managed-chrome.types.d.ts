import type {
  BrowserRuntimeOptionInput,
  BrowserRuntimeResolution,
  ChromeProfileCopyScope,
} from './browser-runtime.types.js'

export interface ManagedChromeOptions extends BrowserRuntimeOptionInput {
  browserRuntime?: BrowserRuntimeResolution | undefined
}

export interface LocalCdpTarget {
  host: string
  port: number
  browserUrl: string
}

export type ManagedChromeExecutionPlan =
  | {
      mode: 'runtime'
      browserRuntime: BrowserRuntimeResolution
      browserId: string
      timeoutMs: number
    }
  | {
      mode: 'existing'
      browserRuntime: BrowserRuntimeResolution
      cdpUrl: string
      timeoutMs: number
      cloneChromeProfile: false
      headless: false
      proxyServer: null
      chromeExecutablePath: null
      chromeUserDataDir: null
      chromeProfileDirectory?: null | undefined
      keepTempChromeProfile: boolean
    }
  | {
      mode: 'managed'
      browserRuntime: BrowserRuntimeResolution
      cdpUrl: string
      timeoutMs: number
      cloneChromeProfile: true
      deepSeekAuthProfile?: true | undefined
      chromeProfileCopyScope?: ChromeProfileCopyScope | undefined
      headless: boolean
      proxyServer: string | null
      chromeExecutablePath: string | null
      chromeUserDataDir: string | null
      chromeProfileDirectory?: string | null | undefined
      keepTempChromeProfile: boolean
      cdpTarget: LocalCdpTarget
    }

export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
