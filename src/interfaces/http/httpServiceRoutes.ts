import { buildOpenAIHttpRoutes, type OpenAIHttpRouteOptions } from './openaiHttpRoutes.js'
import type { HttpRouteDefinition, HttpRouteSurface } from './httpServer.js'

export interface HttpServiceRouteRegistryOptions {
  surfaces: readonly HttpRouteSurface[]
  rpcRoute: HttpRouteDefinition
  openaiRoutes?: OpenAIHttpRouteOptions | undefined
}

export function buildHttpServiceRoutes(
  input: HttpServiceRouteRegistryOptions,
): HttpRouteDefinition[] {
  const routes: HttpRouteDefinition[] = []
  const requestedSurfaces = new Set(input.surfaces)

  if (requestedSurfaces.has('rpc')) {
    routes.push(input.rpcRoute)
  }

  if (requestedSurfaces.has('openai')) {
    routes.push(...buildOpenAIHttpRoutes(input.openaiRoutes))
  }

  return routes
}
