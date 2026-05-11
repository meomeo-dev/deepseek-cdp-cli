import type { RuntimeLogger } from '../logging/runtimeLogger.js'
import { extractDeepSeekStructuredError } from './deepSeekFileUploadError.js'

export type DeepSeekRuntimeFailureKind =
  | 'budget-exceeded'
  | 'attachment-upload'
  | 'managed-chrome-busy'
  | 'managed-chrome-port-conflict'
  | 'browser-frame-detached'
  | 'browser-page-closed'
  | 'cancelled'
  | 'timeout'
  | 'validation'
  | 'unknown'

export interface DeepSeekRuntimeFailureClassification {
  kind: DeepSeekRuntimeFailureKind
  retryable: boolean
  message: string
}

export function classifyDeepSeekRuntimeFailure(
  error: unknown,
): DeepSeekRuntimeFailureClassification {
  const structuredError = extractDeepSeekStructuredError(error)
  if (structuredError?.data && isStructuredFileUploadErrorData(structuredError.data)) {
    return {
      kind: 'attachment-upload',
      retryable: structuredError.data.report.retryable,
      message: structuredError.message,
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (
    normalized.includes('qpm budget exceeded') ||
    normalized.includes('tpm budget exceeded')
  ) {
    return {
      kind: 'budget-exceeded',
      retryable: false,
      message,
    }
  }

  if (normalized.includes('managed chrome is already active')) {
    return {
      kind: 'managed-chrome-busy',
      retryable: true,
      message,
    }
  }

  if (
    normalized.includes('requested managed chrome cdp endpoint') ||
    normalized.includes('requested managed chrome cdp port')
  ) {
    return {
      kind: 'managed-chrome-port-conflict',
      retryable: false,
      message,
    }
  }

  if (
    normalized.includes('navigating frame was detached') ||
    normalized.includes('attempted to use detached frame')
  ) {
    return {
      kind: 'browser-frame-detached',
      retryable: true,
      message,
    }
  }

  if (
    normalized.includes('page closed') ||
    normalized.includes('target closed') ||
    normalized.includes('browser disconnected')
  ) {
    return {
      kind: 'browser-page-closed',
      retryable: true,
      message,
    }
  }

  if (
    normalized.includes('destructive action cancelled') ||
    normalized.includes('cancelled by user') ||
    normalized.includes('confirmation text mismatch')
  ) {
    return {
      kind: 'cancelled',
      retryable: false,
      message,
    }
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return {
      kind: 'timeout',
      retryable: true,
      message,
    }
  }

  if (normalized.includes('missing ') || normalized.includes('invalid ')) {
    return {
      kind: 'validation',
      retryable: false,
      message,
    }
  }

  return {
    kind: 'unknown',
    retryable: false,
    message,
  }
}

export function logDeepSeekRuntimeFailure(input: {
  logger: RuntimeLogger
  message: string
  error: unknown
  context?: Record<string, unknown> | undefined
}): void {
  const failure = classifyDeepSeekRuntimeFailure(input.error)
  const structuredError = extractDeepSeekStructuredError(input.error)
  input.logger.error(input.message, {
    failureKind: failure.kind,
    retryable: failure.retryable,
    errorMessage: failure.message,
    ...(structuredError?.data ? { structuredError: structuredError.data } : {}),
    ...(input.context ? { context: input.context } : {}),
  })
}

function isStructuredFileUploadErrorData(
  value: unknown,
): value is {
  category: 'deepseek_file_upload'
  report: {
    retryable: boolean
  }
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'category' in value &&
    value.category === 'deepseek_file_upload' &&
    'report' in value &&
    typeof value.report === 'object' &&
    value.report !== null &&
    'retryable' in value.report &&
    typeof value.report.retryable === 'boolean'
  )
}
