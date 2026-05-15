import readline from 'node:readline'
import { z } from 'zod'
import { discoverDeepSeekControls } from '../../application/usecases/discoverDeepSeekControls.js'
import { exportConversation } from '../../application/usecases/exportConversation.js'
import { inspectDeepSeekSession } from '../../application/usecases/inspectDeepSeekSession.js'
import { listDeepSeekSessionBranches } from '../../application/usecases/listDeepSeekSessionBranches.js'
import {
  cleanupStaleBrowserRuntimes,
  getBrowserRuntimeStatus,
  listBrowserRuntimes,
  restartBrowserRuntime,
  startBrowserRuntime,
  stopBrowserRuntime,
} from '../../application/usecases/manageBrowserRuntime.js'
import { planManagedChromeSession } from '../../application/usecases/planManagedChromeSession.js'
import { resolveBrowserRuntimeOptions } from '../../domain/browser/browserRuntimeResolver.js'
import { executeDeepSeekEditMessage } from '../../application/services/executeDeepSeekEditMessage.js'
import { executeDeepSeekContinueMessage } from '../../application/services/executeDeepSeekContinueMessage.js'
import { executeDeepSeekRegenerateMessage } from '../../application/services/executeDeepSeekRegenerateMessage.js'
import { executeDeepSeekReply } from '../../application/services/executeDeepSeekReply.js'
import { describeKnownDeepSeekApiSurface } from '../../infrastructure/deepseek/deepSeekApiCatalog.js'
import {
  buildDeepSeekRpcBufferedResult,
  createDeepSeekRpcRealtimeStreamEventController,
  buildDeepSeekRpcStreamEventFrames,
  buildDeepSeekRpcStreamingResult,
} from './deepSeekRpcOutput.js'
import { resolveDeepSeekReplyOutputMode } from '../../application/services/deepSeekReplyOutputMode.js'
import { extractDeepSeekStructuredError } from '../../shared/errors/deepSeekFileUploadError.js'
import type {
  DeepSeekResolvedOutputMode,
} from '../../types/deepseek-output-modes.types.js'
import type {
  DeepSeekReplyResult,
} from '../../types/deepseek-reply.types.js'
import type {
  DeepSeekReplyExecutionInput,
  DeepSeekReplyLiveEvent,
} from '../../types/deepseek-reply-output.types.js'
import type {
  JsonRpcErrorObject,
  JsonRpcFailure,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
} from '../../types/rpc.types.js'
import type {
  DeepSeekRpcStreamEventFrame,
} from '../../types/rpc-output.types.js'
import { serveHttpService } from '../http/httpService.js'
import type { OpenAIHttpRouteOptions } from '../http/openaiHttpRoutes.js'

const managedChromeSchema = z.object({
  browserId: z.string().min(1).optional(),
  cdpUrl: z.string().url(),
  timeoutMs: z.number().int().positive(),
  browserMode: z.enum(['attach', 'ephemeral', 'warm']).optional(),
  cloneChromeProfile: z.boolean(),
  headless: z.boolean(),
  proxyServer: z.string().optional(),
  chromeExecutablePath: z.string().optional(),
  chromeUserDataDir: z.string().optional(),
  chromeProfileDirectory: z.string().optional(),
  keepTempChromeProfile: z.boolean(),
})

const browserStartSchema = z.object({
  cdpUrl: z.string().url(),
  timeoutMs: z.number().int().positive(),
  headless: z.boolean(),
  proxyServer: z.string().optional(),
  chromeExecutablePath: z.string().optional(),
  chromeUserDataDir: z.string().optional(),
  chromeProfileDirectory: z.string().optional(),
  keepTempChromeProfile: z.boolean(),
  browserPurpose: z.enum(['primary', 'probe', 'regression', 'audit']).optional(),
  idleTtlMs: z.number().int().positive().optional(),
})

const browserIdSchema = z.object({
  browserId: z.string().min(1),
})

const browserMutationSchema = browserIdSchema.extend({
  force: z.boolean().optional(),
})

const composerModeSchema = z.object({
  chatMode: z.enum(['instant', 'expert', 'vision', 'unchanged']).optional(),
  deepThink: z.enum(['on', 'off', 'unchanged']).optional(),
  search: z.enum(['on', 'off', 'unchanged']).optional(),
})

const outputModeSchema = z.object({
  stream: z.boolean().optional(),
  format: z.enum(['text', 'json', 'stream-json']).optional(),
  jsonShape: z.enum(['native', 'openai-responses', 'openai-chat-completions']).optional(),
})

const retryModeSchema = z.object({
  onRateLimit: z.boolean().optional(),
  maxRetries: z.number().int().min(0).optional(),
  cooldownMs: z.number().int().min(0).optional(),
  countdown: z.boolean().optional(),
})

const inspectComposerSchema = managedChromeSchema.extend({
  url: z.string().url(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
  stabilize: z.boolean(),
  composerMode: composerModeSchema.optional(),
})

const sendFirstMessageSchema = managedChromeSchema.extend({
  url: z.string().url(),
  prompt: z.string().min(1),
  files: z.array(z.string().min(1)).optional(),
  sessionStoreDir: z.string().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
  composerMode: composerModeSchema.optional(),
  output: outputModeSchema.optional(),
  retry: retryModeSchema.optional(),
})

const replySchema = managedChromeSchema.extend({
  prompt: z.string().min(1),
  files: z.array(z.string().min(1)).optional(),
  sessionId: z.string().min(1).optional(),
  sessionFile: z.string().optional(),
  sessionStoreDir: z.string().optional(),
  url: z.string().url().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
  stream: z.boolean().optional(),
  composerMode: composerModeSchema.optional(),
  output: outputModeSchema.optional(),
  retry: retryModeSchema.optional(),
})

const editMessageSchema = managedChromeSchema.extend({
  prompt: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  sessionFile: z.string().optional(),
  sessionStoreDir: z.string().optional(),
  branchId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  activeBranchId: z.string().min(1).optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
  stream: z.boolean().optional(),
  composerMode: composerModeSchema.optional(),
  output: outputModeSchema.optional(),
})

const continueMessageSchema = managedChromeSchema.extend({
  sessionId: z.string().min(1).optional(),
  sessionFile: z.string().optional(),
  sessionStoreDir: z.string().optional(),
  branchId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  activeBranchId: z.string().min(1).optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
  stream: z.boolean().optional(),
  output: outputModeSchema.optional(),
})

const regenerateMessageSchema = managedChromeSchema.extend({
  sessionId: z.string().min(1).optional(),
  sessionFile: z.string().optional(),
  sessionStoreDir: z.string().optional(),
  branchId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  activeBranchId: z.string().min(1).optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
  stream: z.boolean().optional(),
  composerMode: composerModeSchema.optional(),
  output: outputModeSchema.optional(),
})

const inspectSessionSchema = managedChromeSchema.extend({
  sessionId: z.string().min(1),
  sessionFile: z.string().optional(),
  sessionStoreDir: z.string().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']),
})

const exportConversationSchema = z.object({
  sessionFile: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  sessionStoreDir: z.string().optional(),
  branchId: z.string().min(1).optional(),
  format: z.enum(['text', 'markdown', 'json']),
  outputFile: z.string(),
})

const sessionLocatorSchema = z.object({
  sessionFile: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  sessionStoreDir: z.string().optional(),
})

type RpcTransport = 'stdio' | 'http'

type JsonRpcExecution =
  | {
      kind: 'single'
      contentType: 'application/json; charset=utf-8'
      messages: [JsonRpcResponse]
    }
  | {
      kind: 'stream'
      contentType: 'application/x-ndjson; charset=utf-8'
      messages: JsonRpcMessage[]
    }

interface JsonRpcStreamEventNotificationParams {
  requestId: string | number | null
  sequence: number
  event: DeepSeekRpcStreamEventFrame
}

interface JsonRpcMessageStreamSink {
  start?: ((meta: Pick<JsonRpcExecution, 'kind' | 'contentType'>) => void) | undefined
  write?: ((message: JsonRpcMessage) => void) | undefined
}

class JsonRpcMessageCollector {
  private executionKind: JsonRpcExecution['kind'] | null = null
  private executionContentType: JsonRpcExecution['contentType'] | null = null
  private readonly messages: JsonRpcMessage[] = []
  private streamNotificationCount = 0

  constructor(
    private readonly options: JsonRpcMessageStreamSink & {
      collectMessages?: boolean | undefined
    } = {},
  ) {}

  start(kind: JsonRpcExecution['kind'], contentType: JsonRpcExecution['contentType']): void {
    if (this.executionKind === null) {
      this.executionKind = kind
      this.executionContentType = contentType
      this.options.start?.({ kind, contentType })
      return
    }

    if (this.executionKind !== kind || this.executionContentType !== contentType) {
      throw new Error('JSON-RPC collector cannot change execution kind or content type mid-flight.')
    }
  }

  emit(message: JsonRpcMessage): void {
    if (this.executionKind === null || this.executionContentType === null) {
      throw new Error('JSON-RPC collector must be started before emitting messages.')
    }

    if (this.options.collectMessages !== false) {
      this.messages.push(message)
    }
    this.options.write?.(message)
  }

  emitSingleSuccess<TResult>(id: string | number | null, result: TResult): void {
    this.start('single', 'application/json; charset=utf-8')
    this.emit(success(id, result))
  }

  emitSingleFailure(id: string | number | null, error: JsonRpcErrorObject): void {
    this.start('single', 'application/json; charset=utf-8')
    this.emit(failure(id, error))
  }

  emitStreamingNotification(params: JsonRpcStreamEventNotificationParams): void {
    this.start('stream', 'application/x-ndjson; charset=utf-8')
    this.streamNotificationCount += 1
    this.emit(streamEventNotification(params))
  }

  emitStreamingSuccess<TResult>(id: string | number | null, result: TResult): void {
    this.start('stream', 'application/x-ndjson; charset=utf-8')
    this.emit(success(id, result))
  }

  emitFailure(id: string | number | null, error: JsonRpcErrorObject): void {
    if (this.executionKind === 'stream') {
      this.emit(failure(id, error))
      return
    }

    this.emitSingleFailure(id, error)
  }

  buildExecution(): JsonRpcExecution | null {
    if (this.executionKind === null || this.executionContentType === null) {
      return null
    }

    return {
      kind: this.executionKind,
      contentType: this.executionContentType,
      messages: [...this.messages],
    } as JsonRpcExecution
  }

  getStreamNotificationCount(): number {
    return this.streamNotificationCount
  }
}

export interface JsonRpcServiceDependencies {
  cleanupStaleBrowserRuntimes: typeof cleanupStaleBrowserRuntimes
  discoverDeepSeekControls: typeof discoverDeepSeekControls
  exportConversation: typeof exportConversation
  getBrowserRuntimeStatus: typeof getBrowserRuntimeStatus
  inspectDeepSeekSession: typeof inspectDeepSeekSession
  listDeepSeekSessionBranches: typeof listDeepSeekSessionBranches
  listBrowserRuntimes: typeof listBrowserRuntimes
  planManagedChromeSession: typeof planManagedChromeSession
  restartBrowserRuntime: typeof restartBrowserRuntime
  startBrowserRuntime: typeof startBrowserRuntime
  stopBrowserRuntime: typeof stopBrowserRuntime
  executeDeepSeekEditMessage: typeof executeDeepSeekEditMessage
  executeDeepSeekContinueMessage: typeof executeDeepSeekContinueMessage
  executeDeepSeekRegenerateMessage: typeof executeDeepSeekRegenerateMessage
  executeDeepSeekReply: typeof executeDeepSeekReply
  describeKnownDeepSeekApiSurface: typeof describeKnownDeepSeekApiSurface
}

const defaultJsonRpcServiceDependencies: JsonRpcServiceDependencies = {
  cleanupStaleBrowserRuntimes,
  discoverDeepSeekControls,
  exportConversation,
  getBrowserRuntimeStatus,
  inspectDeepSeekSession,
  listDeepSeekSessionBranches,
  listBrowserRuntimes,
  planManagedChromeSession,
  restartBrowserRuntime,
  startBrowserRuntime,
  stopBrowserRuntime,
  executeDeepSeekEditMessage,
  executeDeepSeekContinueMessage,
  executeDeepSeekRegenerateMessage,
  executeDeepSeekReply,
  describeKnownDeepSeekApiSurface,
}

export interface JsonRpcServerOptions {
  transport: RpcTransport
  port: number
  host?: string | undefined
  httpSurfaces?: readonly ('rpc' | 'openai')[] | undefined
  httpApiKey?: string | undefined
  openaiRoutes?: OpenAIHttpRouteOptions | undefined
}

export async function serveJsonRpc(options: JsonRpcServerOptions): Promise<void> {
  if (options.transport === 'stdio') {
    await serveOverStdio()
    return
  }

  await serveOverHttp({
    port: options.port,
    host: options.host,
    httpSurfaces: options.httpSurfaces,
    httpApiKey: options.httpApiKey,
    openaiRoutes: options.openaiRoutes,
  })
}

async function serveOverStdio(): Promise<void> {
  const lineReader = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  for await (const line of lineReader) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    await streamJsonRpcPayload(trimmed, {
      write(message) {
        process.stdout.write(`${JSON.stringify(message)}\n`)
      },
    })
  }
}

async function serveOverHttp(options: {
  port: number
  host?: string | undefined
  httpSurfaces?: readonly ('rpc' | 'openai')[] | undefined
  httpApiKey?: string | undefined
  openaiRoutes?: OpenAIHttpRouteOptions | undefined
}): Promise<void> {
  await serveHttpService({
    port: options.port,
    host: options.host,
    surfaces: options.httpSurfaces ?? ['rpc'],
    apiKey: options.httpApiKey,
    openaiRoutes: options.openaiRoutes,
    streamJsonRpcPayload(payload, sink) {
      return streamJsonRpcPayload(payload, sink, defaultJsonRpcServiceDependencies)
    },
  })
}

export async function executeJsonRpcPayload(
  payload: string,
  dependencies: JsonRpcServiceDependencies = defaultJsonRpcServiceDependencies,
): Promise<JsonRpcExecution | null> {
  const collector = new JsonRpcMessageCollector()
  await streamJsonRpcPayload(payload, undefined, dependencies, collector)
  return collector.buildExecution()
}

export async function streamJsonRpcPayload(
  payload: string,
  sink: JsonRpcMessageStreamSink = {},
  dependencies: JsonRpcServiceDependencies = defaultJsonRpcServiceDependencies,
  collector = new JsonRpcMessageCollector({
    ...sink,
    collectMessages: false,
  }),
): Promise<void> {
  let request: JsonRpcRequest
  try {
    request = JSON.parse(payload) as JsonRpcRequest
  } catch {
    collector.emitSingleFailure(null, {
      code: -32700,
      message: 'Parse error',
    })
    return
  }

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    collector.emitSingleFailure(request.id ?? null, {
      code: -32600,
      message: 'Invalid Request',
    })
    return
  }

  try {
    switch (request.method) {
      case 'system.describe':
        collector.emitSingleSuccess(request.id ?? null, {
          name: 'deepseek-cdp-cli',
          methods: [
            'system.describe',
            'browser.planManagedChrome',
            'browser.start',
            'browser.list',
            'browser.status',
            'browser.stop',
            'browser.restart',
            'browser.cleanupStale',
            'deepseek.endpointCatalog',
            'deepseek.inspectComposer',
            'deepseek.inspectSession',
            'deepseek.reply',
            'deepseek.editMessage',
            'deepseek.continueMessage',
            'deepseek.regenerateMessage',
            'deepseek.sendFirstMessage',
            'session.listBranches',
            'session.export',
          ],
          streaming: {
            stdio: 'jsonrpc-ndjson',
            http: 'application/x-ndjson',
            eventMethod: 'deepseek.stream.event',
          },
          outputModes: {
            buffered: ['text', 'json'],
            streaming: ['text', 'stream-json'],
            jsonShapes: ['native', 'openai-responses', 'openai-chat-completions'],
          },
          capabilities: {
            streamingStatus: {
              cliReplyFamily: {
                status: 'live',
                surfaces: [
                  'reply',
                  'send-first-message',
                  'continue-message',
                  'edit-message',
                  'regenerate-message',
                ],
                notes: [
                  'One-shot CLI reply-family commands are the current live authority for --stream on the public command surface.',
                ],
              },
              interactiveReplyFamily: {
                status: 'live',
                currentDelivery: 'live',
                surfaces: [
                  'reply',
                  'reply-session',
                  'send-first-message',
                  'continue-message',
                  'edit-message',
                  'regenerate-message',
                ],
                notes: [
                  'Interactive shell now consumes the shared live reply-family delivery contract and keeps retry status / prompt boundaries line-safe while streaming.',
                ],
              },
              rpcReplyFamily: {
                status: 'live',
                currentDelivery: 'live',
                eventMethod: 'deepseek.stream.event',
                methods: [
                  'deepseek.reply',
                  'deepseek.sendFirstMessage',
                  'deepseek.continueMessage',
                  'deepseek.editMessage',
                  'deepseek.regenerateMessage',
                ],
                notes: [
                  'RPC stream=true now emits authoritative live deepseek.stream.event notifications over both stdio and HTTP before the final success envelope.',
                ],
              },
            },
            composerMode: {
              chatMode: ['instant', 'expert', 'vision', 'unchanged'],
              deepThink: ['on', 'off', 'unchanged'],
              search: ['on', 'off', 'unchanged'],
              notes: [
                'Attachment uploads fail closed whenever the settled mode surface lacks a real file input.',
                'Vision is exposed as browser composer mode plus files[] upload; OpenAI HTTP image input and reusable file registry are not claimed by this RPC catalog.',
                'Expert + files[] is temporarily disabled while DeepSeek hides Expert attachments.',
              ],
            },
            sessionExport: {
              formats: ['text', 'markdown', 'json'],
              scopes: ['branch', 'session'],
              textContract:
                'Transcript-first human-readable export with the same Citations appendix semantics used by reply --format text.',
              markdownContract:
                'Document-oriented export that retains structured audit sections such as Inline References Observed and Search Results / Reference Mapping.',
            },
          },
        })
        return
      case 'browser.planManagedChrome':
        collector.emitSingleSuccess(
          request.id ?? null,
          dependencies.planManagedChromeSession(
            resolveRpcManagedChromeOptions(managedChromeSchema.parse(request.params)),
          ),
        )
        return
      case 'browser.start':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.startBrowserRuntime({
            ...browserStartSchema.parse(request.params),
            entrypoint: 'rpc',
          }),
        )
        return
      case 'browser.list':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.listBrowserRuntimes(),
        )
        return
      case 'browser.status':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.getBrowserRuntimeStatus(browserIdSchema.parse(request.params)),
        )
        return
      case 'browser.stop':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.stopBrowserRuntime(browserMutationSchema.parse(request.params)),
        )
        return
      case 'browser.restart':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.restartBrowserRuntime(browserMutationSchema.parse(request.params)),
        )
        return
      case 'browser.cleanupStale':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.cleanupStaleBrowserRuntimes(),
        )
        return
      case 'deepseek.endpointCatalog':
        collector.emitSingleSuccess(
          request.id ?? null,
          dependencies.describeKnownDeepSeekApiSurface(),
        )
        return
      case 'deepseek.inspectComposer':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.discoverDeepSeekControls(
            resolveRpcManagedChromeOptions(inspectComposerSchema.parse(request.params)),
          ),
        )
        return
      case 'deepseek.inspectSession':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.inspectDeepSeekSession(
            resolveRpcManagedChromeOptions(inspectSessionSchema.parse(request.params)),
          ),
        )
        return
      case 'session.listBranches':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.listDeepSeekSessionBranches(sessionLocatorSchema.parse(request.params)),
        )
        return
      case 'deepseek.reply':
        await executeReplyMethod({
          id: request.id ?? null,
          params: replySchema.parse(request.params),
          dependencies,
          collector,
        })
        return
      case 'deepseek.editMessage':
        await executeEditMessageMethod({
          id: request.id ?? null,
          params: editMessageSchema.parse(request.params),
          dependencies,
          collector,
        })
        return
      case 'deepseek.continueMessage':
        await executeContinueMessageMethod({
          id: request.id ?? null,
          params: continueMessageSchema.parse(request.params),
          dependencies,
          collector,
        })
        return
      case 'deepseek.regenerateMessage':
        await executeRegenerateMessageMethod({
          id: request.id ?? null,
          params: regenerateMessageSchema.parse(request.params),
          dependencies,
          collector,
        })
        return
      case 'deepseek.sendFirstMessage':
        await executeSendFirstMessageMethod({
          id: request.id ?? null,
          params: sendFirstMessageSchema.parse(request.params),
          dependencies,
          collector,
        })
        return
      case 'session.export':
        collector.emitSingleSuccess(
          request.id ?? null,
          await dependencies.exportConversation(exportConversationSchema.parse(request.params)),
        )
        return
      default:
        collector.emitSingleFailure(request.id ?? null, {
          code: -32601,
          message: `Method not found: ${request.method}`,
        })
        return
    }
  } catch (error) {
    const structuredError = extractDeepSeekStructuredError(error)
    collector.emitFailure(request.id ?? null, {
      code: structuredError ? -32010 : -32000,
      message: structuredError?.message ?? (error instanceof Error ? error.message : 'Unknown server error'),
      ...(structuredError?.data ? { data: structuredError.data } : {}),
    })
    return
  }
}

async function executeReplyMethod(input: {
  id: string | number | null
  params: z.infer<typeof replySchema>
  dependencies: JsonRpcServiceDependencies
  collector: JsonRpcMessageCollector
}): Promise<void> {
  const output = {
    stream: input.params.output?.stream,
    legacyStream: input.params.stream,
    format: input.params.output?.format,
    jsonShape: input.params.output?.jsonShape,
  } satisfies DeepSeekReplyExecutionInput['output']
  const outputMode = resolveDeepSeekReplyOutputMode(output)
  const live = createRpcReplyLiveOption({
    id: input.id,
    outputMode,
    collector: input.collector,
  })
  const delivery = await input.dependencies.executeDeepSeekReply({
    reply: stripReplyOutputParams(input.params),
    output,
    retry: input.params.retry,
    ...live,
  })

  emitReplyExecution({
    id: input.id,
    result: delivery.result,
    outputMode: delivery.outputMode,
    collector: input.collector,
    liveController: live.liveController,
  })
}

async function executeSendFirstMessageMethod(input: {
  id: string | number | null
  params: z.infer<typeof sendFirstMessageSchema>
  dependencies: JsonRpcServiceDependencies
  collector: JsonRpcMessageCollector
}): Promise<void> {
  const output = {
    stream: input.params.output?.stream,
    format: input.params.output?.format,
    jsonShape: input.params.output?.jsonShape,
  } satisfies DeepSeekReplyExecutionInput['output']
  const outputMode = resolveDeepSeekReplyOutputMode(output)
  const live = createRpcReplyLiveOption({
    id: input.id,
    outputMode,
    collector: input.collector,
  })
  const delivery = await input.dependencies.executeDeepSeekReply({
    reply: stripSendFirstOutputParams(input.params),
    output,
    retry: input.params.retry,
    ...live,
  })

  emitReplyExecution({
    id: input.id,
    result: delivery.result,
    outputMode: delivery.outputMode,
    collector: input.collector,
    liveController: live.liveController,
  })
}

async function executeEditMessageMethod(input: {
  id: string | number | null
  params: z.infer<typeof editMessageSchema>
  dependencies: JsonRpcServiceDependencies
  collector: JsonRpcMessageCollector
}): Promise<void> {
  const output = {
    stream: input.params.output?.stream,
    legacyStream: input.params.stream,
    format: input.params.output?.format,
    jsonShape: input.params.output?.jsonShape,
  } satisfies DeepSeekReplyExecutionInput['output']
  const outputMode = resolveDeepSeekReplyOutputMode(output)
  const live = createRpcReplyLiveOption({
    id: input.id,
    outputMode,
    collector: input.collector,
  })
  const delivery = await input.dependencies.executeDeepSeekEditMessage({
    edit: stripEditOutputParams(input.params),
    output,
    ...live,
  })

  emitReplyExecution({
    id: input.id,
    result: delivery.result,
    outputMode: delivery.outputMode,
    collector: input.collector,
    liveController: live.liveController,
  })
}

async function executeContinueMessageMethod(input: {
  id: string | number | null
  params: z.infer<typeof continueMessageSchema>
  dependencies: JsonRpcServiceDependencies
  collector: JsonRpcMessageCollector
}): Promise<void> {
  const output = {
    stream: input.params.output?.stream,
    legacyStream: input.params.stream,
    format: input.params.output?.format,
    jsonShape: input.params.output?.jsonShape,
  } satisfies DeepSeekReplyExecutionInput['output']
  const outputMode = resolveDeepSeekReplyOutputMode(output)
  const live = createRpcReplyLiveOption({
    id: input.id,
    outputMode,
    collector: input.collector,
  })
  const delivery = await input.dependencies.executeDeepSeekContinueMessage({
    continue: stripContinueOutputParams(input.params),
    output,
    ...live,
  })

  emitReplyExecution({
    id: input.id,
    result: delivery.result,
    outputMode: delivery.outputMode,
    collector: input.collector,
    liveController: live.liveController,
  })
}

async function executeRegenerateMessageMethod(input: {
  id: string | number | null
  params: z.infer<typeof regenerateMessageSchema>
  dependencies: JsonRpcServiceDependencies
  collector: JsonRpcMessageCollector
}): Promise<void> {
  const output = {
    stream: input.params.output?.stream,
    legacyStream: input.params.stream,
    format: input.params.output?.format,
    jsonShape: input.params.output?.jsonShape,
  } satisfies DeepSeekReplyExecutionInput['output']
  const outputMode = resolveDeepSeekReplyOutputMode(output)
  const live = createRpcReplyLiveOption({
    id: input.id,
    outputMode,
    collector: input.collector,
  })
  const delivery = await input.dependencies.executeDeepSeekRegenerateMessage({
    regenerate: stripRegenerateOutputParams(input.params),
    output,
    ...live,
  })

  emitReplyExecution({
    id: input.id,
    result: delivery.result,
    outputMode: delivery.outputMode,
    collector: input.collector,
    liveController: live.liveController,
  })
}

function createRpcReplyLiveOption(input: {
  id: string | number | null
  outputMode: DeepSeekResolvedOutputMode
  collector: JsonRpcMessageCollector
}): {
  live?: {
    onEvent: (event: DeepSeekReplyLiveEvent) => void
  }
  liveController: ReturnType<typeof createDeepSeekRpcRealtimeStreamEventController>
} {
  if (input.outputMode.transport === 'streaming') {
    input.collector.start('stream', 'application/x-ndjson; charset=utf-8')
  }

  const liveController = createDeepSeekRpcRealtimeStreamEventController({
    outputMode: input.outputMode,
  })
  if (!liveController.enabled) {
    return {
      liveController,
    }
  }

  let sequence = 0
  return {
    live: {
      onEvent: event => {
        for (const frame of liveController.onEvent(event)) {
          input.collector.emitStreamingNotification({
            requestId: input.id,
            sequence: sequence + 1,
            event: frame,
          })
          sequence += 1
        }
      },
    },
    liveController,
  }
}

function emitReplyExecution(input: {
  id: string | number | null
  result: DeepSeekReplyResult
  outputMode: DeepSeekResolvedOutputMode
  collector: JsonRpcMessageCollector
  liveController: ReturnType<typeof createDeepSeekRpcRealtimeStreamEventController>
}): void {
  if (input.outputMode.transport === 'buffered') {
    input.collector.emitSingleSuccess(
      input.id,
      buildDeepSeekRpcBufferedResult({
        result: input.result,
        outputMode: input.outputMode,
      }),
    )
    return
  }

  const notificationFrames = input.liveController.enabled
    ? input.liveController.buildTerminalFrames(input.result)
    : buildDeepSeekRpcStreamEventFrames({
        result: input.result,
        outputMode: input.outputMode,
      })
  let terminalSequenceStart = input.collector.getStreamNotificationCount()

  for (const frame of notificationFrames) {
    input.collector.emitStreamingNotification({
      requestId: input.id,
      sequence: terminalSequenceStart + 1,
      event: frame,
    })
    terminalSequenceStart += 1
  }

  input.collector.emitStreamingSuccess(
    input.id,
    buildDeepSeekRpcStreamingResult({
      result: input.result,
      outputMode: input.outputMode,
    }),
  )
}

function stripReplyOutputParams(
  params: z.infer<typeof replySchema>,
): Omit<z.infer<typeof replySchema>, 'output' | 'stream'> {
  const rest = { ...params }
  delete rest.output
  delete rest.stream
  return resolveRpcManagedChromeOptions(rest)
}

function stripSendFirstOutputParams(
  params: z.infer<typeof sendFirstMessageSchema>,
): Omit<z.infer<typeof sendFirstMessageSchema>, 'output'> {
  const rest = { ...params }
  delete rest.output
  return resolveRpcManagedChromeOptions(rest)
}

function stripEditOutputParams(
  params: z.infer<typeof editMessageSchema>,
): Omit<z.infer<typeof editMessageSchema>, 'output' | 'stream'> {
  const rest = { ...params }
  delete rest.output
  delete rest.stream
  return resolveRpcManagedChromeOptions(rest)
}

function stripContinueOutputParams(
  params: z.infer<typeof continueMessageSchema>,
): Omit<z.infer<typeof continueMessageSchema>, 'output' | 'stream'> {
  const rest = { ...params }
  delete rest.output
  delete rest.stream
  return resolveRpcManagedChromeOptions(rest)
}

function stripRegenerateOutputParams(
  params: z.infer<typeof regenerateMessageSchema>,
): Omit<z.infer<typeof regenerateMessageSchema>, 'output' | 'stream'> {
  const rest = { ...params }
  delete rest.output
  delete rest.stream
  return resolveRpcManagedChromeOptions(rest)
}

function resolveRpcManagedChromeOptions<T extends z.infer<typeof managedChromeSchema>>(
  params: T,
): T & ReturnType<typeof resolveBrowserRuntimeOptions> {
  return {
    ...params,
    ...resolveBrowserRuntimeOptions(params, { entrypoint: 'rpc' }),
  }
}

function success<TResult>(id: string | number | null, result: TResult): JsonRpcSuccess<TResult> {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

function failure(id: string | number | null, error: JsonRpcErrorObject): JsonRpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error,
  }
}

function streamEventNotification(
  params: JsonRpcStreamEventNotificationParams,
): JsonRpcNotification<JsonRpcStreamEventNotificationParams> {
  return {
    jsonrpc: '2.0',
    method: 'deepseek.stream.event',
    params,
  }
}
