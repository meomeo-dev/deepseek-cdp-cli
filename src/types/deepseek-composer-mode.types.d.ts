import type { DeepSeekComposerSnapshot, ToggleState } from './deepseek-controls.types.js'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeCapabilityMatrix,
  DeepSeekChatModeSurfaceSnapshot,
} from './deepseek-chat-mode.types.js'

export type DeepSeekComposerToggleName = 'deepThink' | 'search'
export type DeepSeekComposerToggleTargetState = 'on' | 'off' | 'unchanged'
export type DeepSeekComposerChatModeTargetState = DeepSeekChatMode | 'unchanged'
export type DeepSeekResolvedComposerChatMode = DeepSeekChatMode | 'unavailable'

export interface DeepSeekComposerModeRequest {
  chatMode?: DeepSeekComposerChatModeTargetState | undefined
  deepThink: DeepSeekComposerToggleTargetState
  search: DeepSeekComposerToggleTargetState
}

export interface DeepSeekComposerModeInput {
  chatMode?: DeepSeekComposerChatModeTargetState | undefined
  deepThink?: DeepSeekComposerToggleTargetState | undefined
  search?: DeepSeekComposerToggleTargetState | undefined
}

export interface DeepSeekResolvedComposerMode {
  chatMode?: DeepSeekResolvedComposerChatMode | undefined
  deepThink: ToggleState
  search: ToggleState
}

export interface DeepSeekComposerToggleTransition {
  toggle: DeepSeekComposerToggleName
  from: ToggleState
  to: ToggleState
}

export interface DeepSeekComposerChatModeTransition {
  from: DeepSeekResolvedComposerChatMode
  to: DeepSeekResolvedComposerChatMode
}

export type DeepSeekComposerIgnoredToggleReason =
  | 'vision_mode_search_unavailable'
  | 'expert_search_temporarily_disabled'

export interface DeepSeekComposerIgnoredToggle {
  toggle: DeepSeekComposerToggleName
  targetState: Exclude<DeepSeekComposerToggleTargetState, 'unchanged'>
  reason: DeepSeekComposerIgnoredToggleReason
  requestedChatMode?: DeepSeekComposerChatModeTargetState | undefined
  resolvedChatMode?: DeepSeekResolvedComposerChatMode | undefined
}

export interface DeepSeekComposerModeActionResult {
  requestedMode: DeepSeekComposerModeRequest
  effectiveMode?: DeepSeekComposerModeRequest | undefined
  beforeSnapshot: DeepSeekComposerSnapshot
  settledSnapshot: DeepSeekComposerSnapshot
  beforeModeSurface: DeepSeekChatModeSurfaceSnapshot
  settledModeSurface: DeepSeekChatModeSurfaceSnapshot
  capabilityMatrix: DeepSeekChatModeCapabilityMatrix
  resolvedMode: DeepSeekResolvedComposerMode
  transitions: DeepSeekComposerToggleTransition[]
  ignoredToggles?: DeepSeekComposerIgnoredToggle[] | undefined
  chatModeTransition?: DeepSeekComposerChatModeTransition | undefined
}
