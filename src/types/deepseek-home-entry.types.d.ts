import type { DeepSeekComposerSnapshot } from './deepseek-controls.types.js'

export interface DeepSeekHomeEntryWaitOptions {
  requestedUrl: string
  timeoutMs: number
  pollIntervalMs: number
  stableWindowMs: number
}

export interface DeepSeekHomeEntryResult {
  requestedUrl: string
  finalUrl: string
  routeKind: DeepSeekComposerSnapshot['routeKind']
  agentId: string | null
  sessionId: string | null
  settledAfterMs: number
  snapshot: DeepSeekComposerSnapshot
}
