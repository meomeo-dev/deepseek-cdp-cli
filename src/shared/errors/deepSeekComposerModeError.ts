import type {
  DeepSeekChatMode,
  DeepSeekChatModeCapabilityMatrix,
} from '../../types/deepseek-chat-mode.types.js'
import type {
  DeepSeekComposerChatModeTargetState,
  DeepSeekComposerToggleName,
  DeepSeekComposerToggleTargetState,
  DeepSeekResolvedComposerChatMode,
} from '../../types/deepseek-composer-mode.types.js'
import type { ToggleState } from '../../types/deepseek-controls.types.js'

export type DeepSeekComposerModeErrorCode =
  | 'unsupported_requested_deep_think_toggle'
  | 'unsupported_requested_search_toggle'
  | 'deepseek_deep_think_toggle_settle_failed'
  | 'deepseek_search_toggle_settle_failed'
  | 'deepseek_chat_mode_settle_failed'
  | 'unsupported_requested_file_input'
  | 'unsupported_expert_file_input_temporarily_disabled'

export interface DeepSeekComposerModeErrorDetails {
  requestedChatMode?: DeepSeekComposerChatModeTargetState | undefined
  resolvedChatMode?: DeepSeekResolvedComposerChatMode | undefined
  toggle?: DeepSeekComposerToggleName | undefined
  targetState?: Exclude<DeepSeekComposerToggleTargetState, 'unchanged'> | undefined
  currentState?: ToggleState | undefined
  availableModes?: DeepSeekChatMode[] | undefined
  fileInputAvailable?: boolean | undefined
  requestedFileCount?: number | undefined
  pageUrl?: string | undefined
  capabilityMatrix?: DeepSeekChatModeCapabilityMatrix | undefined
  temporaryDisabled?: boolean | undefined
}

export class DeepSeekComposerModeError extends Error {
  readonly code: DeepSeekComposerModeErrorCode
  readonly details: DeepSeekComposerModeErrorDetails

  constructor(
    code: DeepSeekComposerModeErrorCode,
    message: string,
    details: DeepSeekComposerModeErrorDetails = {},
  ) {
    super(message)
    this.name = 'DeepSeekComposerModeError'
    this.code = code
    this.details = { ...details }
  }
}

export function isDeepSeekComposerModeError(
  error: unknown,
): error is DeepSeekComposerModeError {
  return error instanceof DeepSeekComposerModeError
}

export function createDeepSeekComposerToggleUnavailableError(input: {
  toggle: DeepSeekComposerToggleName
  targetState: Exclude<DeepSeekComposerToggleTargetState, 'unchanged'>
  requestedChatMode?: DeepSeekComposerChatModeTargetState | undefined
  resolvedChatMode?: DeepSeekResolvedComposerChatMode | undefined
  pageUrl?: string | undefined
  capabilityMatrix?: DeepSeekChatModeCapabilityMatrix | undefined
}): DeepSeekComposerModeError {
  const label = input.toggle === 'deepThink' ? 'DeepThink' : 'Search'

  return new DeepSeekComposerModeError(
    input.toggle === 'deepThink'
      ? 'unsupported_requested_deep_think_toggle'
      : 'unsupported_requested_search_toggle',
    `The DeepSeek ${label} toggle is unavailable, but ${input.targetState} was requested.`,
    {
      toggle: input.toggle,
      targetState: input.targetState,
      ...(input.requestedChatMode ? { requestedChatMode: input.requestedChatMode } : {}),
      ...(input.resolvedChatMode ? { resolvedChatMode: input.resolvedChatMode } : {}),
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      ...(input.capabilityMatrix ? { capabilityMatrix: input.capabilityMatrix } : {}),
    },
  )
}

export function createDeepSeekComposerToggleSettleError(input: {
  toggle: DeepSeekComposerToggleName
  targetState: Exclude<DeepSeekComposerToggleTargetState, 'unchanged'>
  currentState: ToggleState
  requestedChatMode?: DeepSeekComposerChatModeTargetState | undefined
  resolvedChatMode?: DeepSeekResolvedComposerChatMode | undefined
  pageUrl?: string | undefined
  capabilityMatrix?: DeepSeekChatModeCapabilityMatrix | undefined
}): DeepSeekComposerModeError {
  const label = input.toggle === 'deepThink' ? 'DeepThink' : 'Search'

  return new DeepSeekComposerModeError(
    input.toggle === 'deepThink'
      ? 'deepseek_deep_think_toggle_settle_failed'
      : 'deepseek_search_toggle_settle_failed',
    `The DeepSeek ${label} toggle did not reach ${input.targetState}; current state is ${input.currentState}.`,
    {
      toggle: input.toggle,
      targetState: input.targetState,
      currentState: input.currentState,
      ...(input.requestedChatMode ? { requestedChatMode: input.requestedChatMode } : {}),
      ...(input.resolvedChatMode ? { resolvedChatMode: input.resolvedChatMode } : {}),
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      ...(input.capabilityMatrix ? { capabilityMatrix: input.capabilityMatrix } : {}),
    },
  )
}

export function createDeepSeekChatModeSettleError(input: {
  requestedChatMode: Exclude<DeepSeekComposerChatModeTargetState, 'unchanged'>
  resolvedChatMode: DeepSeekResolvedComposerChatMode
  pageUrl?: string | undefined
  availableModes?: DeepSeekChatMode[] | undefined
  capabilityMatrix?: DeepSeekChatModeCapabilityMatrix | undefined
}): DeepSeekComposerModeError {
  return new DeepSeekComposerModeError(
    'deepseek_chat_mode_settle_failed',
    `The DeepSeek chat mode did not reach ${input.requestedChatMode}; current mode is ${input.resolvedChatMode}.`,
    {
      requestedChatMode: input.requestedChatMode,
      resolvedChatMode: input.resolvedChatMode,
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      ...(input.availableModes ? { availableModes: input.availableModes } : {}),
      ...(input.capabilityMatrix ? { capabilityMatrix: input.capabilityMatrix } : {}),
    },
  )
}

export function createDeepSeekComposerFileInputUnavailableError(input: {
  requestedChatMode?: DeepSeekComposerChatModeTargetState | undefined
  resolvedChatMode?: DeepSeekResolvedComposerChatMode | undefined
  requestedFileCount: number
  pageUrl?: string | undefined
  capabilityMatrix?: DeepSeekChatModeCapabilityMatrix | undefined
}): DeepSeekComposerModeError {
  return new DeepSeekComposerModeError(
    'unsupported_requested_file_input',
    [
      'DeepSeek file upload was blocked before send because the current chat mode does not expose a real file input.',
      `requestedChatMode=${input.requestedChatMode ?? 'unchanged'}`,
      `resolvedChatMode=${input.resolvedChatMode ?? 'unavailable'}`,
      `requestedFileCount=${input.requestedFileCount}`,
      ...(input.pageUrl ? [`pageUrl=${input.pageUrl}`] : []),
      'This command fails closed instead of pretending attachments were accepted in the current mode.',
    ].join(' '),
    {
      ...(input.requestedChatMode ? { requestedChatMode: input.requestedChatMode } : {}),
      ...(input.resolvedChatMode ? { resolvedChatMode: input.resolvedChatMode } : {}),
      requestedFileCount: input.requestedFileCount,
      fileInputAvailable: false,
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      ...(input.capabilityMatrix ? { capabilityMatrix: input.capabilityMatrix } : {}),
    },
  )
}

export function createDeepSeekExpertFileInputTemporarilyDisabledError(input: {
  requestedFileCount: number
}): DeepSeekComposerModeError {
  return new DeepSeekComposerModeError(
    'unsupported_expert_file_input_temporarily_disabled',
    [
      'DeepSeek Expert file upload is temporarily disabled because the current DeepSeek Expert page no longer exposes attachment upload.',
      'requestedChatMode=expert',
      `requestedFileCount=${input.requestedFileCount}`,
      'Retry without --file, or use --chat-mode vision for image uploads while DeepSeek restores Expert attachments.',
    ].join(' '),
    {
      requestedChatMode: 'expert',
      resolvedChatMode: 'unavailable',
      requestedFileCount: input.requestedFileCount,
      fileInputAvailable: false,
      temporaryDisabled: true,
    },
  )
}
