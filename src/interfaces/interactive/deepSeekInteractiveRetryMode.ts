import {
  resolveDeepSeekReplyRetryPolicy,
} from '../../application/services/deepSeekReplyRateLimitRetry.js'
import { buildDeepSeekReplyRetryDeliveryBoundary } from '../../domain/search/deepSeekReplyRetryBoundary.js'
import type {
  DeepSeekReplyRetryDeliveryBoundary,
  DeepSeekReplyRetryOptionInput,
  DeepSeekResolvedReplyRetryPolicy,
} from '../../types/deepseek-reply-output.types.js'

export interface DeepSeekInteractiveRetryModeState {
  requested: Required<Pick<DeepSeekReplyRetryOptionInput, 'onRateLimit'>> &
    Pick<DeepSeekReplyRetryOptionInput, 'maxRetries' | 'cooldownMs' | 'countdown'>
  resolved: DeepSeekResolvedReplyRetryPolicy
  deliveryBoundary: DeepSeekReplyRetryDeliveryBoundary
}

export function createDeepSeekInteractiveRetryModeState(
  input: DeepSeekReplyRetryOptionInput | undefined,
): DeepSeekInteractiveRetryModeState {
  const requested = {
    onRateLimit: input?.onRateLimit === true,
    ...(typeof input?.maxRetries === 'number' ? { maxRetries: input.maxRetries } : {}),
    ...(typeof input?.cooldownMs === 'number' ? { cooldownMs: input.cooldownMs } : {}),
    ...(typeof input?.countdown === 'boolean' ? { countdown: input.countdown } : {}),
  }

  return {
    requested,
    resolved: resolveDeepSeekReplyRetryPolicy(requested),
    deliveryBoundary: buildDeepSeekReplyRetryDeliveryBoundary(),
  }
}

export function serializeDeepSeekInteractiveRetryModeState(
  state: DeepSeekInteractiveRetryModeState,
): string {
  return JSON.stringify(
    {
      requested: {
        onRateLimit: state.requested.onRateLimit,
        maxRetries: state.requested.maxRetries ?? null,
        cooldownMs: state.requested.cooldownMs ?? null,
        countdown: state.requested.countdown ?? null,
      },
      resolved: state.resolved,
      deliveryBoundary: state.deliveryBoundary,
    },
    null,
    2,
  )
}

export function applyDeepSeekInteractiveRetryModeCommand(
  current: DeepSeekInteractiveRetryModeState,
  command: string,
): DeepSeekInteractiveRetryModeState {
  const [target, value] = command.split(/\s+/, 2)
  if (target === 'reset') {
    return createDeepSeekInteractiveRetryModeState(undefined)
  }

  if (target === 'on' || target === 'off') {
    return createDeepSeekInteractiveRetryModeState({
      ...current.requested,
      onRateLimit: target === 'on',
    })
  }

  if (target === 'max') {
    if (!value || !/^\d+$/.test(value)) {
      throw new Error('Usage: retry max <count>')
    }

    return createDeepSeekInteractiveRetryModeState({
      ...current.requested,
      maxRetries: Number.parseInt(value, 10),
    })
  }

  if (target === 'cooldown') {
    if (!value) {
      throw new Error('Usage: retry cooldown <ms|auto>')
    }

    return createDeepSeekInteractiveRetryModeState({
      ...current.requested,
      ...(value === 'auto'
        ? { cooldownMs: undefined }
        : { cooldownMs: parseInteractiveNonNegativeInteger(value, 'retry cooldown') }),
    })
  }

  if (target === 'countdown') {
    if (value !== 'on' && value !== 'off') {
      throw new Error('Usage: retry countdown <on|off>')
    }

    return createDeepSeekInteractiveRetryModeState({
      ...current.requested,
      countdown: value === 'on',
    })
  }

  throw new Error(
    'Usage: retry | retry on|off | retry max <count> | retry cooldown <ms|auto> | retry countdown <on|off> | retry reset',
  )
}

function parseInteractiveNonNegativeInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }

  return Number.parseInt(value, 10)
}
