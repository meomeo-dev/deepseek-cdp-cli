import { buildHttpServiceRoutes } from './httpServiceRoutes.js'
import { buildJsonRpcHttpRoute } from './jsonRpcHttpRoute.js'
import { serveHttpServer, type HttpRouteSurface } from './httpServer.js'
import type { OpenAIHttpRouteOptions } from './openaiHttpRoutes.js'
import type { JsonRpcMessage } from '../../types/rpc.types.js'

interface JsonRpcHttpExecutionMeta {
  kind: 'single' | 'stream'
  contentType: string
}

interface JsonRpcMessageStreamSink {
  start?: ((meta: JsonRpcHttpExecutionMeta) => void) | undefined
  write?: ((message: JsonRpcMessage) => void) | undefined
}

export interface HttpServiceOptions {
  host?: string | undefined
  port: number
  surfaces: readonly HttpRouteSurface[]
  apiKey?: string | undefined
  openaiRoutes?: OpenAIHttpRouteOptions | undefined
  streamJsonRpcPayload: (
    payload: string,
    sink?: JsonRpcMessageStreamSink,
  ) => Promise<void>
}

export async function serveHttpService(options: HttpServiceOptions): Promise<void> {
  const routes = buildHttpServiceRoutes({
    surfaces: options.surfaces,
    rpcRoute: buildJsonRpcHttpRoute({
      streamPayload: options.streamJsonRpcPayload,
    }),
    openaiRoutes: options.openaiRoutes,
  })

  await serveHttpServer({
    host: options.host,
    port: options.port,
    routes,
    auth: {
      apiKey: options.apiKey,
    },
  })
}
