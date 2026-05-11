import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HttpRouteDefinition } from './httpServer.js'

export const HTTP_REQUEST_ID_HEADER = 'x-request-id'
export const HTTP_EVENT_STREAM_CONTENT_TYPE = 'text/event-stream; charset=utf-8'

export function resolveHttpRequestId(request: IncomingMessage): string {
  const headerValue = request.headers[HTTP_REQUEST_ID_HEADER]
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim()
  }

  if (Array.isArray(headerValue)) {
    const candidate = headerValue.find(value => value.trim())
    if (candidate) {
      return candidate.trim()
    }
  }

  return randomUUID()
}

export function applyCommonHttpResponseHeaders(
  response: ServerResponse<IncomingMessage>,
  requestId: string,
): void {
  response.setHeader(HTTP_REQUEST_ID_HEADER, requestId)
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
}

export function applyEventStreamResponseHeaders(
  response: ServerResponse<IncomingMessage>,
): void {
  response.statusCode = 200
  response.setHeader('content-type', HTTP_EVENT_STREAM_CONTENT_TYPE)
  response.setHeader('connection', 'keep-alive')
  response.setHeader('x-accel-buffering', 'no')
}

export function writeSseDataFrame(
  response: ServerResponse<IncomingMessage>,
  payload: string,
): void {
  response.write(`data: ${payload}\n\n`)
}

export function writeSseEventFrame(
  response: ServerResponse<IncomingMessage>,
  event: string,
  payload: string,
): void {
  response.write(`event: ${event}\n`)
  writeSseDataFrame(response, payload)
}

export function resolveRouteSurfaceHint(
  path: string,
  route: HttpRouteDefinition | null,
): 'rpc' | 'openai' {
  if (route) {
    return route.surface
  }

  if (path === '/' || !path.startsWith('/v1/')) {
    return 'rpc'
  }

  return 'openai'
}

export function resolveBearerToken(
  request: IncomingMessage,
): string | null {
  const headerValue = request.headers['authorization']
  const normalized =
    typeof headerValue === 'string'
      ? headerValue
      : Array.isArray(headerValue)
        ? headerValue[0] ?? null
        : null

  if (!normalized) {
    return null
  }

  const match = normalized.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return null
  }

  const token = match[1]?.trim()
  return token ? token : null
}
