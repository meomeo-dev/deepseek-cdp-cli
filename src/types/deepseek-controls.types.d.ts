export type ToggleState = 'on' | 'off' | 'unavailable'
export type SendButtonMode = 'send' | 'stop' | 'unavailable'
export type DeepSeekRouteKind = 'home' | 'landing' | 'session' | 'unknown'

export interface DeepSeekControlMatch {
  found: boolean
  selector: string | null
  label: string | null
  state?: ToggleState | SendButtonMode | undefined
}

export interface DeepSeekComposerSnapshot {
  pageUrl: string
  routeKind: DeepSeekRouteKind
  agentId: string | null
  sessionId: string | null
  composerInput: DeepSeekControlMatch
  sendOrStopButton: DeepSeekControlMatch
  deepThinkToggle: DeepSeekControlMatch
  searchToggle: DeepSeekControlMatch
  fileButton: DeepSeekControlMatch
}

export interface StableComposerSnapshotOptions {
  timeoutMs: number
  pollIntervalMs: number
  stableWindowMs: number
}
