import type { HttpRouteDefinition } from './httpServer.js'
import type { JsonRpcMessage } from '../../types/rpc.types.js'

interface JsonRpcHttpExecutionMeta {
  kind: 'single' | 'stream'
  contentType: string
}

interface JsonRpcMessageStreamSink {
  start?: ((meta: JsonRpcHttpExecutionMeta) => void) | undefined
  write?: ((message: JsonRpcMessage) => void) | undefined
}

export function buildJsonRpcHttpRoute(input: {
  streamPayload: (payload: string, sink?: JsonRpcMessageStreamSink) => Promise<void>
}): HttpRouteDefinition {
  return {
    id: 'rpc.jsonrpc-root',
    surface: 'rpc',
    method: 'POST',
    path: '/',
    async handler(context) {
      const body = await context.readBody()
      let singleMessage: JsonRpcMessage | null = null

      await input.streamPayload(body, {
        start(meta) {
          context.response.setHeader('content-type', meta.contentType)
          if (meta.kind === 'stream') {
            context.response.flushHeaders()
          }
        },
        write(message) {
          if (message && 'method' in message) {
            context.response.write(`${JSON.stringify(message)}\n`)
            return
          }

          if (
            message &&
            'result' in message &&
            context.response.getHeader('content-type') === 'application/x-ndjson; charset=utf-8'
          ) {
            context.response.write(`${JSON.stringify(message)}\n`)
            return
          }

          if (
            message &&
            'error' in message &&
            context.response.getHeader('content-type') === 'application/x-ndjson; charset=utf-8'
          ) {
            context.response.write(`${JSON.stringify(message)}\n`)
            return
          }

          singleMessage = message
        },
      })

      const contentType = context.response.getHeader('content-type')
      if (contentType === 'application/x-ndjson; charset=utf-8') {
        context.response.end()
        return
      }

      if (!singleMessage) {
        context.response.statusCode = 204
        context.response.end()
        return
      }

      context.response.end(JSON.stringify(singleMessage))
    },
  }
}
