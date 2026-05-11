import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  applyCommonHttpResponseHeaders,
  resolveBearerToken,
  resolveHttpRequestId,
  resolveRouteSurfaceHint,
} from './httpHeaders.js'
import {
  buildHttpErrorBody,
  createHttpServiceError,
  HttpServiceError,
} from './httpErrors.js'

export type HttpRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type HttpRouteSurface = 'rpc' | 'openai'

export type HttpRoutePathParams = Record<string, string>

export interface MatchedHttpRoute {
  route: HttpRouteDefinition
  pathParams: HttpRoutePathParams
}

export interface HttpRouteContext {
  request: IncomingMessage
  response: ServerResponse<IncomingMessage>
  method: string
  url: URL
  path: string
  pathParams: HttpRoutePathParams
  searchParams: URLSearchParams
  requestId: string
  readBody: () => Promise<string>
}

export interface HttpRouteDefinition {
  id: string
  surface: HttpRouteSurface
  method: HttpRouteMethod
  path: string
  pathParamPatterns?: Record<string, RegExp> | undefined
  handler: (context: HttpRouteContext) => Promise<void>
}

export interface HttpServerOptions {
  host?: string | undefined
  port: number
  routes: HttpRouteDefinition[]
  auth?: {
    apiKey?: string | undefined
  } | undefined
}

export function matchHttpRoute(
  routes: readonly HttpRouteDefinition[],
  method: string,
  path: string,
): MatchedHttpRoute | null {
  const normalizedMethod = method.toUpperCase()
  const candidates = routes
    .filter(route => route.method === normalizedMethod)
    .flatMap(route => {
      const matched = matchHttpRoutePath(route, path)
      return matched ? [matched] : []
    })

  return selectMostSpecificHttpRouteMatch(candidates)
}

export function listAllowedHttpMethods(
  routes: readonly HttpRouteDefinition[],
  path: string,
): string[] {
  const candidates = routes.flatMap(route => {
    const matched = matchHttpRoutePath(route, path)
    return matched ? [matched] : []
  })
  const bestMatch = selectMostSpecificHttpRouteMatch(candidates)
  if (!bestMatch) {
    return []
  }

  const bestSpecificity = calculateHttpRouteSpecificity(bestMatch.route)
  return [
    ...new Set(
      candidates
        .filter(candidate => {
          const specificity = calculateHttpRouteSpecificity(candidate.route)
          return (
            specificity.staticSegmentCount === bestSpecificity.staticSegmentCount &&
            specificity.segmentCount === bestSpecificity.segmentCount
          )
        })
        .map(candidate => candidate.route.method),
    ),
  ].sort()
}

export async function serveHttpServer(options: HttpServerOptions): Promise<void> {
  const server = createServer(async (request, response) => {
    await handleHttpRequest(request, response, options.routes, options.auth)
  })

  await listen(server, options.port, options.host ?? '127.0.0.1')
}

export async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  routes: readonly HttpRouteDefinition[],
  auth: HttpServerOptions['auth'] = {},
): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase()
  const url = extractRequestUrl(request)
  const path = url.pathname
  const requestId = resolveHttpRequestId(request)
  const routeMatch = matchHttpRoute(routes, method, path)
  const route = routeMatch?.route ?? null
  const surface = resolveRouteSurfaceHint(path, route)

  applyCommonHttpResponseHeaders(response, requestId)

  if (!route) {
    const allowedMethods = listAllowedHttpMethods(routes, path)
    if (allowedMethods.length > 0) {
      sendHttpErrorResponse(
        response,
        createHttpServiceError({
          statusCode: 405,
          surface,
          type: 'invalid_request_error',
          code: 'method_not_allowed',
          message: `Method ${method} is not allowed for ${path}.`,
          headers: {
            allow: allowedMethods.join(', '),
          },
        }),
      )
      return
    }

    sendHttpErrorResponse(
      response,
      createHttpServiceError({
        statusCode: 404,
        surface,
        type: 'invalid_request_error',
        code: 'route_not_found',
        message: `No HTTP route is registered for ${method} ${path}.`,
      }),
    )
    return
  }

  if (auth?.apiKey) {
    const token = resolveBearerToken(request)
    if (token !== auth.apiKey) {
      sendHttpErrorResponse(
        response,
        createHttpServiceError({
          statusCode: 401,
          surface: route.surface,
          type: 'authentication_error',
          code: 'invalid_api_key',
          message: 'Missing or invalid Authorization: Bearer token.',
          headers: {
            'www-authenticate': 'Bearer',
          },
        }),
      )
      return
    }
  }

  let bodyPromise: Promise<string> | null = null
  try {
    await route.handler({
      request,
      response,
      method,
      url,
      path,
      pathParams: routeMatch?.pathParams ?? {},
      searchParams: url.searchParams,
      requestId,
      readBody() {
        bodyPromise ??= readHttpBody(request)
        return bodyPromise
      },
    })
  } catch (error) {
    if (!response.writableEnded) {
      sendHttpErrorResponse(
        response,
        error instanceof HttpServiceError
          ? error
          : createHttpServiceError({
              statusCode: 500,
              surface: route.surface,
              type: 'api_error',
              code: 'internal_server_error',
              message: 'Internal Server Error',
            }),
      )
    }
  }
}

function sendHttpErrorResponse(
  response: ServerResponse<IncomingMessage>,
  error: HttpServiceError,
): void {
  response.statusCode = error.statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  for (const [name, value] of Object.entries(error.headers)) {
    response.setHeader(name, value)
  }

  response.end(buildHttpErrorBody(error))
}

function extractRequestUrl(request: IncomingMessage): URL {
  const value = request.url ?? '/'
  try {
    return new URL(value, 'http://127.0.0.1')
  } catch {
    return new URL('/', 'http://127.0.0.1')
  }
}

function matchHttpRoutePath(
  route: HttpRouteDefinition,
  path: string,
): MatchedHttpRoute | null {
  const routeSegments = splitHttpRoutePath(route.path)
  const pathSegments = splitHttpRoutePath(path)
  if (routeSegments.length !== pathSegments.length) {
    return null
  }

  const pathParams: HttpRoutePathParams = {}
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index] ?? ''
    const pathSegment = pathSegments[index] ?? ''
    const paramName = extractRouteParamName(routeSegment)
    if (paramName === null) {
      if (routeSegment !== pathSegment) {
        return null
      }
      continue
    }

    if (!pathSegment) {
      return null
    }

    const pattern = route.pathParamPatterns?.[paramName]
    if (pattern && !pattern.test(pathSegment)) {
      return null
    }
    pathParams[paramName] = pathSegment
  }

  return {
    route,
    pathParams,
  }
}

function splitHttpRoutePath(path: string): string[] {
  const trimmed = path.startsWith('/') ? path.slice(1) : path
  return trimmed === '' ? [] : trimmed.split('/')
}

function extractRouteParamName(segment: string): string | null {
  const matched = segment.match(/^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/u)
  return matched?.[1] ?? null
}

function selectMostSpecificHttpRouteMatch(
  matches: readonly MatchedHttpRoute[],
): MatchedHttpRoute | null {
  if (matches.length === 0) {
    return null
  }

  return matches.reduce((best, candidate) => {
    if (best === null) {
      return candidate
    }

    const bestSpecificity = calculateHttpRouteSpecificity(best.route)
    const candidateSpecificity = calculateHttpRouteSpecificity(candidate.route)
    if (
      candidateSpecificity.staticSegmentCount > bestSpecificity.staticSegmentCount ||
      (candidateSpecificity.staticSegmentCount === bestSpecificity.staticSegmentCount &&
        candidateSpecificity.segmentCount > bestSpecificity.segmentCount)
    ) {
      return candidate
    }

    return best
  }, null as MatchedHttpRoute | null)
}

function calculateHttpRouteSpecificity(route: HttpRouteDefinition): {
  staticSegmentCount: number
  segmentCount: number
} {
  const segments = splitHttpRoutePath(route.path)
  return {
    staticSegmentCount: segments.filter(segment => extractRouteParamName(segment) === null).length,
    segmentCount: segments.length,
  }
}

async function readHttpBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
      continue
    }

    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk))
      continue
    }

    throw new Error('Received an unsupported HTTP body chunk.')
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
}
