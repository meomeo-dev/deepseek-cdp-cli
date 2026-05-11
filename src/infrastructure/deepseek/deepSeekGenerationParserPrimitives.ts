export interface ParsedSseMessage {
  event: string | null
  dataText: string
}

export interface ConsumedSseMessages {
  messages: ParsedSseMessage[]
  remainder: string
}

export function splitSseMessages(bodyText: string): ParsedSseMessage[] {
  const messages: ParsedSseMessage[] = []

  for (const chunk of bodyText.split('\n\n')) {
    const trimmedChunk = chunk.trim()
    if (!trimmedChunk) {
      continue
    }

    let eventName: string | null = null
    const dataLines: string[] = []

    for (const line of trimmedChunk.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || null
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim())
      }
    }

    messages.push({
      event: eventName,
      dataText: dataLines.join('\n'),
    })
  }

  return messages
}

export function consumeSseMessages(bodyText: string): ConsumedSseMessages {
  const normalized = bodyText.replace(/\r\n/g, '\n')
  const messages: ParsedSseMessage[] = []
  let offset = 0

  while (offset < normalized.length) {
    const separatorIndex = normalized.indexOf('\n\n', offset)
    if (separatorIndex < 0) {
      break
    }

    const chunk = normalized.slice(offset, separatorIndex)
    offset = separatorIndex + 2
    const trimmedChunk = chunk.trim()
    if (!trimmedChunk) {
      continue
    }

    let eventName: string | null = null
    const dataLines: string[] = []
    for (const line of trimmedChunk.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || null
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim())
      }
    }

    messages.push({
      event: eventName,
      dataText: dataLines.join('\n'),
    })
  }

  return {
    messages,
    remainder: normalized.slice(offset),
  }
}

export function parseJsonIfPossible(value: string | null): unknown {
  if (!value?.trim()) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function buildRunId(
  endpoint: string,
  sessionId: string | null,
  requestMessageId: string | null,
  responseMessageId: string | null,
): string {
  return [
    endpoint.split('/').at(-1) ?? 'generation',
    sessionId ?? 'session-unknown',
    requestMessageId ?? 'request-unknown',
    responseMessageId ?? 'response-unknown',
  ].join(':')
}

export function readOptionalString(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!value) {
    return null
  }
  return readPrimitiveString(value[key])
}

export function readPrimitiveString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function readOptionalNumber(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!value) {
    return null
  }

  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

export function readEpochishTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const milliseconds = value > 1_000_000_000_000 ? value : value * 1_000
  return new Date(milliseconds).toISOString()
}

export function stringifyNullableNumber(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return String(Math.trunc(value))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
