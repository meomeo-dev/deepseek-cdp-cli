import type { DeepSeekComposerSnapshot, DeepSeekRouteKind } from './deepseek-controls.types.js'
import type { DeepSeekComposerFileInput } from './deepseek-file.types.js'

export type DeepSeekChatMode = 'instant' | 'expert' | 'vision'

export type DeepSeekChatModeSignalLayer =
  | 'request-payload'
  | 'generation-ready-sse'
  | 'canonical-generation-context'
  | 'history-messages-raw'
  | 'history-messages-mapped-session'
  | 'stored-session'
  | 'export-document'

export interface DeepSeekChatModeFact {
  sourceLayer: DeepSeekChatModeSignalLayer
  rawModelType: string
  resolvedMode: DeepSeekChatMode | null
  derivedFromLayer?: DeepSeekChatModeSignalLayer | undefined
}

export interface DeepSeekChatModeSurfaceSnapshot {
  pageUrl: string
  routeKind: DeepSeekRouteKind
  heading: string | null
  modeSelectorVisible: boolean
  availableModes: DeepSeekChatMode[]
  activeMode: DeepSeekChatMode | null
  composerSnapshot: DeepSeekComposerSnapshot
  fileInput: DeepSeekComposerFileInput
}

export interface DeepSeekChatModeCapabilityMatrix {
  composerInput: boolean
  sendOrStop: boolean
  deepThink: boolean
  search: boolean
  fileButton: boolean
  fileInput: boolean
}

export interface DeepSeekChatModeSignalObservation {
  layer: DeepSeekChatModeSignalLayer
  observed: boolean
  rawModelType: string | null
  resolvedMode: DeepSeekChatMode | null
  note: string
}
