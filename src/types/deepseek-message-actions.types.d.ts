export type DeepSeekMessageActionName =
  | 'copy'
  | 'edit'
  | 'retry'
  | 'regenerate'
  | 'continue'
  | 'like'
  | 'dislike'
  | 'share'
  | 'unknown'

export type DeepSeekMessageActionRole = 'user' | 'assistant' | 'unknown'

export type DeepSeekMessageActionControlKind = 'icon-button' | 'inline-button'

export interface DeepSeekMessageActionControlMatch {
  found: boolean
  action: DeepSeekMessageActionName
  controlIndex: number | null
  selector: string | null
  label: string | null
  tooltipLabel: string | null
  controlKind: DeepSeekMessageActionControlKind | null
}

export interface DeepSeekMessageActionItemSnapshot {
  messageId: string
  selector: string
  role: DeepSeekMessageActionRole
  className: string | null
  textPreview: string | null
  actions: DeepSeekMessageActionControlMatch[]
}

export interface DeepSeekMessageActionSnapshot {
  pageUrl: string
  items: DeepSeekMessageActionItemSnapshot[]
}

export interface StableDeepSeekMessageActionSnapshotOptions {
  timeoutMs: number
  pollIntervalMs: number
  stableWindowMs: number
}

export interface DeepSeekMessageActionTarget {
  messageId: string
  action: Exclude<DeepSeekMessageActionName, 'unknown'>
}
