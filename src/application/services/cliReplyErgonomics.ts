import type {
  DeepSeekComposerChatModeTargetState,
} from '../../types/deepseek-composer-mode.types.js'
import type {
  CliPreferenceSource,
} from '../../types/cli-preferences.types.js'

export type CliReplySessionPlan =
  | { source: 'new-session' }
  | {
      source: 'explicit-session'
      sessionId?: string | undefined
      sessionFile?: string | undefined
    }
  | { source: 'last-session'; sessionId: string }

export function resolveCliReplyMessage(input: {
  positionalMessage?: string | undefined
  optionMessage?: string | undefined
}): string {
  const positionalMessage = normalizeOptionalString(input.positionalMessage)
  const optionMessage = normalizeOptionalString(input.optionMessage)
  if (positionalMessage && optionMessage) {
    throw new Error(
      'Choose either a positional message or --message, not both.',
    )
  }
  const message = positionalMessage ?? optionMessage
  if (!message) {
    throw new Error(
      'Reply message is required. Pass it positionally or with --message.',
    )
  }
  return message
}

export function resolveCliReplySessionPlan(input: {
  explicitNew?: boolean | undefined
  preferenceNew?: boolean | undefined
  explicitSessionId?: string | undefined
  explicitSessionFile?: string | undefined
  lastSessionId?: string | undefined
}): CliReplySessionPlan {
  const sessionId = normalizeOptionalString(input.explicitSessionId)
  const sessionFile = normalizeOptionalString(input.explicitSessionFile)
  if (input.explicitNew === true && (sessionId || sessionFile)) {
    throw new Error(
      '--new cannot be combined with --session-id or --session-file.',
    )
  }
  if (sessionId || sessionFile) {
    return {
      source: 'explicit-session',
      ...(sessionId ? { sessionId } : {}),
      ...(sessionFile ? { sessionFile } : {}),
    }
  }
  if (input.explicitNew === true || input.preferenceNew === true) {
    return { source: 'new-session' }
  }
  const lastSessionId = normalizeOptionalString(input.lastSessionId)
  if (lastSessionId) {
    return { source: 'last-session', sessionId: lastSessionId }
  }
  return { source: 'new-session' }
}

export function resolveCliReplyChatModeForSession(input: {
  requestedChatMode: DeepSeekComposerChatModeTargetState
  existingSession: boolean
  source: CliPreferenceSource
}): DeepSeekComposerChatModeTargetState {
  if (!input.existingSession || input.source !== 'built-in') {
    return input.requestedChatMode
  }
  return 'unchanged'
}

export async function runCliReplyAndRememberSession<
  TResult extends { sessionId: string },
>(input: {
  plan: CliReplySessionPlan
  lastSessionStore: { save: (sessionId: string) => Promise<void> }
  validateLastSession?: ((sessionId: string) => Promise<void>) | undefined
  execute: (plan: CliReplySessionPlan) => Promise<TResult>
}): Promise<TResult> {
  if (input.plan.source === 'last-session' && input.validateLastSession) {
    try {
      await input.validateLastSession(input.plan.sessionId)
    } catch (error) {
      throw new Error(
        `Last session pointer "${input.plan.sessionId}" is invalid or unavailable. `
          + `Run "deepseek new" to clear it, or pass an explicit session target. `
          + `Cause: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  const result = await input.execute(input.plan)
  await input.lastSessionStore.save(result.sessionId)
  return result
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
