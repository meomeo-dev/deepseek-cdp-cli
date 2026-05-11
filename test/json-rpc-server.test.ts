import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeJsonRpcPayload,
  streamJsonRpcPayload,
} from '../src/interfaces/rpc/jsonRpcServer.js'
import { resolveDeepSeekReplyOutputMode } from '../src/application/services/deepSeekReplyOutputMode.js'
import { createDeepSeekFileUploadError } from '../src/shared/errors/deepSeekFileUploadError.js'
import type {
  ManagedChromeExecutionPlan,
  ManagedChromeOptions,
} from '../src/types/managed-chrome.types.js'
import type {
  BrowserRuntimeCleanupResultView,
  BrowserRuntimeListResult,
  BrowserRuntimeRestartResultView,
  BrowserRuntimeStartResultView,
  BrowserRuntimeStatusResult,
  BrowserRuntimeStopResultView,
} from '../src/types/browser-runtime-management.types.js'
import type { DeepSeekReplyResult } from '../src/types/deepseek-reply.types.js'
import type {
  DeepSeekReplyExecutionInput,
  DeepSeekReplyRetryOptionInput,
} from '../src/types/deepseek-reply-output.types.js'
import type { JsonRpcMessage } from '../src/types/rpc.types.js'

void test('JSON-RPC buffered reply can return an OpenAI responses payload envelope', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'hello',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'json',
          jsonShape: 'openai-responses',
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input => {
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult({
            streamRequested: false,
            output: {
              mode: 'buffered',
              canonicalEvents: [],
              canonicalRuns: [],
              finalizedAssistantText: 'Hello from DeepSeek',
            },
          }),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok('result' in message)
  assert.equal(message.id, 7)
  const result = message.result as {
    outputMode: { stream: boolean; transport: string; format: string }
    output: { format: string; jsonShape: string; data: { object: string; output_text: string } }
  }
  assert.equal(result.outputMode.stream, false)
  assert.equal(result.outputMode.transport, 'buffered')
  assert.equal(result.outputMode.format, 'json')
  assert.equal(result.output.format, 'json')
  assert.equal(result.output.jsonShape, 'openai-responses')
  assert.equal(result.output.data.object, 'response')
  assert.equal(result.output.data.output_text, 'Hello from DeepSeek')
})

void test('JSON-RPC browser.planManagedChrome resolves explicit ephemeral mode through the shared runtime resolver', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'plan-browser-1',
      method: 'browser.planManagedChrome',
      params: {
        ...createManagedChromeParams(),
        browserMode: 'ephemeral',
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    mode: string
    cloneChromeProfile: boolean
    browserRuntime: { mode: string; source: string }
  }
  assert.equal(result.mode, 'managed')
  assert.equal(result.cloneChromeProfile, true)
  assert.equal(result.browserRuntime.mode, 'ephemeral')
  assert.equal(result.browserRuntime.source, 'explicit-browser-mode')
})

void test('JSON-RPC browser.planManagedChrome can prefer browserId runtime reuse over lifecycle flags', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'plan-browser-runtime-id',
      method: 'browser.planManagedChrome',
      params: {
        ...createManagedChromeParams(),
        browserId: 'warm-primary-runtime',
        browserMode: 'attach',
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    mode: string
    browserId: string
    browserRuntime: { source: string; executionDisposition: string }
  }
  assert.equal(result.mode, 'runtime')
  assert.equal(result.browserId, 'warm-primary-runtime')
  assert.equal(result.browserRuntime.source, 'explicit-browser-id')
  assert.equal(result.browserRuntime.executionDisposition, 'reuse-existing-runtime')
})

void test('JSON-RPC browser runtime methods are exposed through system.describe', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'system-describe-browser-runtime',
      method: 'system.describe',
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok(message && 'result' in message)
  const result = message.result as {
    methods: string[]
    capabilities: {
      streamingStatus: {
        cliReplyFamily: {
          status: string
          surfaces: string[]
          notes: string[]
        }
        interactiveReplyFamily: {
          status: string
          currentDelivery: string
          surfaces: string[]
          notes: string[]
        }
        rpcReplyFamily: {
          status: string
          currentDelivery: string
          eventMethod: string
          methods: string[]
          notes: string[]
        }
      }
      composerMode: {
        chatMode: string[]
        notes: string[]
      }
      sessionExport: {
        formats: string[]
        scopes: string[]
        textContract: string
      }
    }
  }

  assert.ok(result.methods.includes('browser.start'))
  assert.ok(result.methods.includes('browser.list'))
  assert.ok(result.methods.includes('browser.status'))
  assert.ok(result.methods.includes('browser.stop'))
  assert.ok(result.methods.includes('browser.restart'))
  assert.ok(result.methods.includes('browser.cleanupStale'))
  assert.equal(result.capabilities.streamingStatus.cliReplyFamily.status, 'live')
  assert.ok(result.capabilities.streamingStatus.cliReplyFamily.surfaces.includes('reply'))
  assert.match(
    result.capabilities.streamingStatus.cliReplyFamily.notes[0] ?? '',
    /current live authority/i,
  )
  assert.equal(result.capabilities.streamingStatus.interactiveReplyFamily.status, 'live')
  assert.equal(
    result.capabilities.streamingStatus.interactiveReplyFamily.currentDelivery,
    'live',
  )
  assert.ok(
    result.capabilities.streamingStatus.interactiveReplyFamily.surfaces.includes('reply-session'),
  )
  assert.match(
    result.capabilities.streamingStatus.interactiveReplyFamily.notes[0] ?? '',
    /shared live reply-family delivery contract/i,
  )
  assert.equal(result.capabilities.streamingStatus.rpcReplyFamily.status, 'live')
  assert.equal(result.capabilities.streamingStatus.rpcReplyFamily.currentDelivery, 'live')
  assert.equal(
    result.capabilities.streamingStatus.rpcReplyFamily.eventMethod,
    'deepseek.stream.event',
  )
  assert.ok(
    result.capabilities.streamingStatus.rpcReplyFamily.methods.includes('deepseek.reply'),
  )
  assert.match(
    result.capabilities.streamingStatus.rpcReplyFamily.notes[0] ?? '',
    /authoritative live/i,
  )
  assert.deepEqual(result.capabilities.composerMode.chatMode, [
    'instant',
    'expert',
    'vision',
    'unchanged',
  ])
  assert.match(
    result.capabilities.composerMode.notes[0] ?? '',
    /attachment uploads fail closed/i,
  )
  assert.match(
    result.capabilities.composerMode.notes[1] ?? '',
    /OpenAI HTTP image input/i,
  )
  assert.deepEqual(result.capabilities.sessionExport.formats, [
    'text',
    'markdown',
    'json',
  ])
  assert.deepEqual(result.capabilities.sessionExport.scopes, ['branch', 'session'])
  assert.match(result.capabilities.sessionExport.textContract, /transcript-first/i)
})

void test('JSON-RPC browser.start delegates to the shared browser runtime start usecase', async () => {
  let observedPurpose: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'browser-start-1',
      method: 'browser.start',
      params: {
        cdpUrl: 'http://127.0.0.1:9555',
        timeoutMs: 30_000,
        headless: true,
        keepTempChromeProfile: false,
        browserPurpose: 'probe',
      },
    }),
    createDependencies({
      startBrowserRuntime: async input => {
        await Promise.resolve()
        observedPurpose = input.browserPurpose
        return {
          action: 'started',
          runtime: createBrowserRuntimeView({
            browserId: 'warm-probe-runtime',
            purpose: input.browserPurpose ?? 'primary',
            state: 'ready',
          }),
        }
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok(message && 'result' in message)
  const result = message.result as BrowserRuntimeStartResultView

  assert.equal(observedPurpose, 'probe')
  assert.equal(result.action, 'started')
  assert.equal(result.runtime.browserId, 'warm-probe-runtime')
  assert.equal(result.runtime.purpose, 'probe')
})

void test('JSON-RPC browser.list and browser.cleanupStale return structured runtime views', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'browser-list-1',
      method: 'browser.list',
    }),
    createDependencies({
      listBrowserRuntimes: async () => {
        await Promise.resolve()
        return {
          runtimes: [createBrowserRuntimeView()],
        }
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok(message && 'result' in message)
  const result = message.result as BrowserRuntimeListResult

  assert.equal(result.runtimes.length, 1)
  assert.equal(result.runtimes[0]?.browserId, 'warm-primary-runtime')

  const cleanupExecution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'browser-cleanup-1',
      method: 'browser.cleanupStale',
    }),
    createDependencies({
      cleanupStaleBrowserRuntimes: async () => {
        await Promise.resolve()
        return {
          action: 'cleanup-stale',
          scannedRuntimeIds: ['warm-primary-runtime'],
          cleanedRuntimeIds: ['warm-primary-runtime'],
          forgottenRuntimeIds: [],
          keptRuntimeIds: [],
          runtimes: [],
        }
      },
    }),
  )

  assert.ok(cleanupExecution)
  assert.equal(cleanupExecution.kind, 'single')
  const cleanupMessage = cleanupExecution.messages[0]
  assert.ok(cleanupMessage && 'result' in cleanupMessage)
  const cleanupResult = cleanupMessage.result as BrowserRuntimeCleanupResultView

  assert.deepEqual(cleanupResult.cleanedRuntimeIds, ['warm-primary-runtime'])
})

void test('JSON-RPC browser.status/stop/restart share the browser runtime control surface', async () => {
  const statusExecution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'browser-status-1',
      method: 'browser.status',
      params: {
        browserId: 'warm-primary-runtime',
      },
    }),
    createDependencies({
      getBrowserRuntimeStatus: async input => {
        await Promise.resolve()
        return {
          runtime:
            input.browserId === 'warm-primary-runtime'
              ? createBrowserRuntimeView({
                  browserId: input.browserId,
                  state: 'busy',
                })
              : null,
        }
      },
    }),
  )

  assert.ok(statusExecution)
  assert.equal(statusExecution.kind, 'single')
  const statusMessage = statusExecution.messages[0]
  assert.ok(statusMessage && 'result' in statusMessage)
  const statusResult = statusMessage.result as BrowserRuntimeStatusResult
  assert.equal(statusResult.runtime?.state, 'busy')

  const stopExecution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'browser-stop-1',
      method: 'browser.stop',
      params: {
        browserId: 'warm-primary-runtime',
        force: true,
      },
    }),
    createDependencies({
      stopBrowserRuntime: async input => {
        await Promise.resolve()
        return {
          action: 'stopped',
          browserId: input.browserId,
          forced: input.force === true,
          previousState: 'busy',
          owner: 'managed',
        }
      },
    }),
  )

  assert.ok(stopExecution)
  assert.equal(stopExecution.kind, 'single')
  const stopMessage = stopExecution.messages[0]
  assert.ok(stopMessage && 'result' in stopMessage)
  const stopResult = stopMessage.result as BrowserRuntimeStopResultView
  assert.equal(stopResult.forced, true)

  const restartExecution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'browser-restart-1',
      method: 'browser.restart',
      params: {
        browserId: 'warm-primary-runtime',
        force: true,
      },
    }),
    createDependencies({
      restartBrowserRuntime: async input => {
        await Promise.resolve()
        return {
          action: 'restarted',
          forced: input.force === true,
          reused: false,
          runtime: createBrowserRuntimeView({
            browserId: input.browserId,
            state: 'ready',
          }),
        }
      },
    }),
  )

  assert.ok(restartExecution)
  assert.equal(restartExecution.kind, 'single')
  const restartMessage = restartExecution.messages[0]
  assert.ok(restartMessage && 'result' in restartMessage)
  const restartResult = restartMessage.result as BrowserRuntimeRestartResultView
  assert.equal(restartResult.action, 'restarted')
  assert.equal(restartResult.runtime.state, 'ready')
})

void test('JSON-RPC streaming reply emits NDJSON-compatible stream event notifications and a final result', async () => {
  let observedStream: boolean | undefined
  let observedLiveDelivery = false
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-1',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'hello',
        waitUntil: 'domcontentloaded',
        output: {
          stream: true,
          format: 'stream-json',
          jsonShape: 'openai-chat-completions',
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input => {
        observedStream = input.output?.stream
        observedLiveDelivery = typeof input.live?.onEvent === 'function'
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult(),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'stream')
  assert.equal(execution.contentType, 'application/x-ndjson; charset=utf-8')
  assert.equal(observedStream, true)
  assert.equal(observedLiveDelivery, true)
  const firstMessage = execution.messages[0]
  assert.ok(firstMessage)
  assert.ok('method' in firstMessage)
  assert.equal(firstMessage.method, 'deepseek.stream.event')
  const firstParams = firstMessage.params as {
    requestId: string
    sequence: number
    event: {
      outputMode: { format: string; transport: string }
      output: { format: string; jsonShape: string; data: { object: string } }
    }
  }
  assert.equal(firstParams.requestId, 'reply-1')
  assert.equal(firstParams.sequence, 1)
  assert.equal(firstParams.event.outputMode.format, 'stream-json')
  assert.equal(firstParams.event.output.format, 'stream-json')
  assert.equal(firstParams.event.output.jsonShape, 'openai-chat-completions')
  assert.equal(firstParams.event.output.data.object, 'chat.completion.chunk')

  const lastMessage = execution.messages.at(-1)
  assert.ok(lastMessage && 'result' in lastMessage)
  const finalResult = lastMessage.result as {
    outputMode: { format: string; transport: string }
    finalOutput: { format: string; jsonShape: string; data: { object: string } }
  }
  assert.equal(finalResult.outputMode.transport, 'streaming')
  assert.equal(finalResult.finalOutput.format, 'json')
  assert.equal(finalResult.finalOutput.jsonShape, 'openai-chat-completions')
  assert.equal(finalResult.finalOutput.data.object, 'chat.completion')
})

void test('JSON-RPC streamJsonRpcPayload emits live notifications before the final success resolves', async () => {
  const messages: JsonRpcMessage[] = []
  let finalizeReply!: () => void
  let replyResolved = false
  const canonicalRun = createReplyResult().output.canonicalRuns[0]!
  const pending = streamJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-live-order',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'hello',
        waitUntil: 'domcontentloaded',
        output: {
          stream: true,
          format: 'text',
        },
      },
    }),
    {
      write(message) {
        messages.push(message)
      },
    },
    createDependencies({
      executeDeepSeekReply: input =>
        new Promise(resolve => {
          input.live?.onEvent?.({
            kind: 'generation.event',
            attemptNumber: 1,
            outputMode: resolveDeepSeekReplyOutputMode(input.output),
            source: 'live',
            event: canonicalRun.events[0]!,
          })
          finalizeReply = () => {
            replyResolved = true
            resolve(createReplyExecutionResult({
              result: createReplyResult(),
              output: input.output,
            }))
          }
        }),
    }),
  )

  await Promise.resolve()

  assert.equal(replyResolved, false)
  assert.equal(messages.length, 1)
  const firstMessage = messages[0]
  assert.ok(firstMessage && 'method' in firstMessage)
  assert.equal(firstMessage.method, 'deepseek.stream.event')

  finalizeReply()
  await pending

  const finalMessage = messages.at(-1)
  assert.ok(finalMessage && 'result' in finalMessage)
  const finalResult = finalMessage.result as {
    finalOutput: { format: string; text: string }
  }
  assert.equal(finalResult.finalOutput.format, 'text')
  assert.equal(finalResult.finalOutput.text, 'Hello from DeepSeek')
})

void test('JSON-RPC sendFirstMessage also uses the unified output protocol', async () => {
  let observedUrl: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 9,
      method: 'deepseek.sendFirstMessage',
      params: {
        ...createManagedChromeParams(),
        url: 'https://chat.deepseek.com/',
        prompt: 'hello',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'text',
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input => {
        observedUrl = input.reply.url
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult({
            streamRequested: false,
            output: {
              mode: 'buffered',
              canonicalEvents: [],
              canonicalRuns: [],
              finalizedAssistantText: 'Buffered hello',
            },
            assistantText: 'Buffered hello',
          }),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedUrl, 'https://chat.deepseek.com/')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    output: { format: string; text: string }
  }
  assert.equal(result.output.format, 'text')
  assert.equal(result.output.text, 'Buffered hello')
})

void test('JSON-RPC reply forwards retry options to the unified execution layer', async () => {
  let observedRetry: DeepSeekReplyRetryOptionInput | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-retry-options',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'hello',
        waitUntil: 'domcontentloaded',
        retry: {
          onRateLimit: true,
          maxRetries: 2,
          cooldownMs: 1234,
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input => {
        observedRetry = input.retry
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult(),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedRetry?.onRateLimit, true)
  assert.equal(observedRetry?.maxRetries, 2)
  assert.equal(observedRetry?.cooldownMs, 1234)
})

void test('JSON-RPC reply forwards vision chatMode through the shared composer mode contract', async () => {
  let observedChatMode: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-chat-mode',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'hello',
        waitUntil: 'domcontentloaded',
        composerMode: {
          chatMode: 'vision',
          deepThink: 'on',
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input => {
        observedChatMode = input.reply.composerMode?.chatMode
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult(),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedChatMode, 'vision')
})

void test('JSON-RPC buffered reply summary includes rate-limit metadata for search replies', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-rate-limit',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'search something',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'json',
          jsonShape: 'native',
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input =>
        Promise.resolve(createReplyExecutionResult({
          result: createSearchRateLimitReplyResult(),
          output: input.output,
        })),
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok(message && 'result' in message)
  const result = message.result as {
    summary?: {
      rateLimit?: {
        code: string
        retryable: boolean
        uiObservationStatus: string
        recommendedCooldownMs: number | null
      } | null
    }
  }

  assert.equal(result.summary?.rateLimit?.code, 'rate_limit_exceeded')
  assert.equal(result.summary?.rateLimit?.retryable, true)
  assert.equal(result.summary?.rateLimit?.uiObservationStatus, 'ui-observation-pending')
  assert.equal(result.summary?.rateLimit?.recommendedCooldownMs, 60_000)
})

void test('JSON-RPC buffered reply summary preserves the API retry boundary after a retried run', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-retry-boundary',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'search something',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'json',
          jsonShape: 'native',
        },
      },
    }),
    createDependencies({
      executeDeepSeekReply: input =>
        Promise.resolve(createReplyExecutionResult({
          result: createReplyResult({
            retry: createSuccessfulRetryReport(),
          }),
          output: input.output,
        })),
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok(message && 'result' in message)
  const result = message.result as {
    summary?: {
      retry?: {
        boundary?: {
          strategy: string
          uiRetryControlStatus: string
          note: string
        }
      } | null
    }
  }

  assert.equal(result.summary?.retry?.boundary?.strategy, 'api-cooldown-replay')
  assert.equal(
    result.summary?.retry?.boundary?.uiRetryControlStatus,
    'ui-observation-pending',
  )
  assert.match(
    result.summary?.retry?.boundary?.note ?? '',
    /do not click a confirmed DeepSeek UI retry control/i,
  )
})

void test('JSON-RPC attachment failures expose structured error data', async () => {
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'reply-attachment-error',
      method: 'deepseek.reply',
      params: {
        ...createManagedChromeParams(),
        prompt: 'summarize attachment',
        files: ['/tmp/alpha.txt', '/tmp/beta.exe'],
        waitUntil: 'domcontentloaded',
      },
    }),
    createDependencies({
      executeDeepSeekReply: () =>
        Promise.reject(
          createDeepSeekFileUploadError({
            fileInput: {
              found: true,
              selector: 'input[type="file"]',
              accept: '.txt',
              acceptedExtensions: ['.txt'],
              multiple: true,
              hidden: true,
            },
            requestedPaths: ['/tmp/alpha.txt', '/tmp/beta.exe'],
            acceptedPaths: ['/tmp/alpha.txt'],
            problems: [],
            files: [
              {
                path: '/tmp/alpha.txt',
                fileName: 'alpha.txt',
                extension: '.txt',
                sizeBytes: 11,
                acceptedByPreflight: true,
                uploaded: true,
                settled: false,
                mounted: false,
                fileId: 'file-1',
                serverStatus: 'PARSING',
                previewable: false,
                tokenUsage: null,
                previewUrl: null,
                errorCode: null,
                errorMessage: null,
                upload: null,
                fetched: {
                  id: 'file-1',
                  status: 'PARSING',
                  fileName: 'alpha.txt',
                  previewable: false,
                  fileSize: 11,
                  tokenUsage: null,
                  errorCode: null,
                  insertedAt: null,
                  updatedAt: null,
                },
                preview: null,
                problems: [
                  {
                    code: 'fetch_files_processing_timeout',
                    message: 'fetch_files last observed status was PARSING before timeout.',
                    path: '/tmp/alpha.txt',
                    fileName: 'alpha.txt',
                  },
                ],
              },
              {
                path: '/tmp/beta.exe',
                fileName: 'beta.exe',
                extension: '.exe',
                sizeBytes: 22,
                acceptedByPreflight: false,
                uploaded: false,
                settled: false,
                mounted: false,
                fileId: null,
                serverStatus: null,
                previewable: null,
                tokenUsage: null,
                previewUrl: null,
                errorCode: null,
                errorMessage: null,
                upload: null,
                fetched: null,
                preview: null,
                problems: [
                  {
                    code: 'unsupported_file_type',
                    message: 'File extension is not accepted by the DeepSeek composer input: .exe.',
                    path: '/tmp/beta.exe',
                    fileName: 'beta.exe',
                    accept: '.txt',
                  },
                ],
              },
            ],
            fetches: [],
            settled: false,
            blockingIssues: true,
          }),
        ),
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  const message = execution.messages[0]
  assert.ok('error' in message)
  assert.equal(message.error.code, -32010)
  assert.match(message.error.message, /DeepSeek file upload failed/)
  const data = message.error.data as {
    category: string
    report: {
      kind: string
      detailCount: number
    }
    batch: {
      requestedPaths: string[]
    }
  }
  assert.equal(data.category, 'deepseek_file_upload')
  assert.equal(data.report.kind, 'mixed')
  assert.equal(data.report.detailCount, 2)
  assert.deepEqual(data.batch.requestedPaths, ['/tmp/alpha.txt', '/tmp/beta.exe'])
})

void test('JSON-RPC editMessage uses the unified output protocol and forwards target fields', async () => {
  let observedMessageId: string | undefined
  let observedSessionId: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'edit-1',
      method: 'deepseek.editMessage',
      params: {
        ...createManagedChromeParams(),
        sessionId: 'session-001',
        messageId: 'message-user-1',
        prompt: 'replace this prompt',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'json',
          jsonShape: 'native',
        },
      },
    }),
    createDependencies({
      executeDeepSeekEditMessage: input => {
        observedSessionId = input.edit.sessionId
        observedMessageId = input.edit.messageId
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult({
            entryMode: 'message-edit',
            assistantText: 'Edited hello',
            output: {
              mode: 'buffered',
              canonicalEvents: [],
              canonicalRuns: [],
              finalizedAssistantText: 'Edited hello',
            },
            mutation: {
              kind: 'edit-message',
              sourceBranchId: 'branch-main',
              sourceMessageId: 'message-user-1',
              materializedBranchId: 'branch-edit-message-user-1-message-user-2',
              materializedBranchCreated: true,
              replacementMessageId: 'message-user-2',
              assistantMessageId: 'message-assistant-2',
              transcriptShape: 'history-recovered',
            },
          }),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedSessionId, 'session-001')
  assert.equal(observedMessageId, 'message-user-1')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    outputMode: { format: string }
    output: {
      format: string
      jsonShape: string
      data: { entryMode: string; assistantText: string; mutation: { kind: string } }
    }
  }
  assert.equal(result.outputMode.format, 'json')
  assert.equal(result.output.format, 'json')
  assert.equal(result.output.jsonShape, 'native')
  assert.equal(result.output.data.entryMode, 'message-edit')
  assert.equal(result.output.data.assistantText, 'Edited hello')
  assert.equal(result.output.data.mutation.kind, 'edit-message')
})

void test('JSON-RPC continueMessage uses the unified output protocol and forwards target fields', async () => {
  let observedMessageId: string | undefined
  let observedSessionId: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'continue-1',
      method: 'deepseek.continueMessage',
      params: {
        ...createManagedChromeParams(),
        sessionId: 'session-001',
        messageId: 'message-assistant-1',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'json',
          jsonShape: 'native',
        },
      },
    }),
    createDependencies({
      executeDeepSeekContinueMessage: input => {
        observedSessionId = input.continue.sessionId
        observedMessageId = input.continue.messageId
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult({
            entryMode: 'message-continue',
            assistantText: 'Continued hello',
            output: {
              mode: 'buffered',
              canonicalEvents: [],
              canonicalRuns: [],
              finalizedAssistantText: 'Continued hello',
            },
            mutation: {
              kind: 'continue',
              sourceBranchId: 'branch-main',
              sourceAssistantMessageId: 'message-assistant-1',
              sourceParentMessageId: 'message-user-1',
              materializedBranchId: 'branch-main',
              materializedBranchCreated: false,
              continuedAssistantMessageId: 'message-assistant-1',
              continuationDisposition: 'in-place',
              transcriptShape: 'history-recovered-in-place',
            },
          }),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedSessionId, 'session-001')
  assert.equal(observedMessageId, 'message-assistant-1')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    outputMode: { format: string }
    output: {
      format: string
      jsonShape: string
      data: { entryMode: string; assistantText: string; mutation: { kind: string; continuationDisposition: string } }
    }
  }
  assert.equal(result.outputMode.format, 'json')
  assert.equal(result.output.format, 'json')
  assert.equal(result.output.jsonShape, 'native')
  assert.equal(result.output.data.entryMode, 'message-continue')
  assert.equal(result.output.data.assistantText, 'Continued hello')
  assert.equal(result.output.data.mutation.kind, 'continue')
  assert.equal(result.output.data.mutation.continuationDisposition, 'in-place')
})

void test('JSON-RPC regenerateMessage uses the unified output protocol and forwards target fields', async () => {
  let observedMessageId: string | undefined
  let observedSessionId: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'regen-1',
      method: 'deepseek.regenerateMessage',
      params: {
        ...createManagedChromeParams(),
        sessionId: 'session-001',
        messageId: 'message-assistant-1',
        waitUntil: 'domcontentloaded',
        output: {
          format: 'json',
          jsonShape: 'native',
        },
      },
    }),
    createDependencies({
      executeDeepSeekRegenerateMessage: input => {
        observedSessionId = input.regenerate.sessionId
        observedMessageId = input.regenerate.messageId
        return Promise.resolve(createReplyExecutionResult({
          result: createReplyResult({
            entryMode: 'message-regenerate',
            assistantText: 'Regenerated hello',
            output: {
              mode: 'buffered',
              canonicalEvents: [],
              canonicalRuns: [],
              finalizedAssistantText: 'Regenerated hello',
            },
            mutation: {
              kind: 'regenerate',
              sourceBranchId: 'branch-main',
              sourceAssistantMessageId: 'message-assistant-1',
              sourceParentMessageId: 'message-user-1',
              materializedBranchId: 'branch-regenerate-message-assistant-1-message-assistant-2',
              materializedBranchCreated: true,
              regeneratedAssistantMessageId: 'message-assistant-2',
              transcriptShape: 'history-recovered',
            },
          }),
          output: input.output,
        }))
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedSessionId, 'session-001')
  assert.equal(observedMessageId, 'message-assistant-1')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    outputMode: { format: string }
    output: {
      format: string
      jsonShape: string
      data: { entryMode: string; assistantText: string; mutation: { kind: string } }
    }
  }
  assert.equal(result.outputMode.format, 'json')
  assert.equal(result.output.format, 'json')
  assert.equal(result.output.jsonShape, 'native')
  assert.equal(result.output.data.entryMode, 'message-regenerate')
  assert.equal(result.output.data.assistantText, 'Regenerated hello')
  assert.equal(result.output.data.mutation.kind, 'regenerate')
})

void test('JSON-RPC session.export can export a complete session without branchId', async () => {
  let observedBranchId: string | undefined
  let observedSessionId: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'export-1',
      method: 'session.export',
      params: {
        sessionId: 'session-001',
        format: 'json',
        outputFile: '/tmp/session-export.json',
      },
    }),
    createDependencies({
      exportConversation: input => {
        observedSessionId = input.sessionId
        observedBranchId = input.branchId
        return Promise.resolve({
          sessionId: 'session-001',
          exportScope: 'session',
          branchId: null,
          outputFile: input.outputFile,
          format: input.format,
        })
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedSessionId, 'session-001')
  assert.equal(observedBranchId, undefined)
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    sessionId: string
    exportScope: string
    branchId: string | null
    outputFile: string
    format: string
  }
  assert.equal(result.sessionId, 'session-001')
  assert.equal(result.exportScope, 'session')
  assert.equal(result.branchId, null)
  assert.equal(result.outputFile, '/tmp/session-export.json')
  assert.equal(result.format, 'json')
})

void test('JSON-RPC session.export accepts text format', async () => {
  let observedFormat: string | undefined
  const execution = await executeJsonRpcPayload(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'export-text-1',
      method: 'session.export',
      params: {
        sessionId: 'session-001',
        branchId: 'branch-main',
        format: 'text',
        outputFile: '/tmp/session-export.txt',
      },
    }),
    createDependencies({
      exportConversation: input => {
        observedFormat = input.format
        return Promise.resolve({
          sessionId: 'session-001',
          exportScope: 'branch',
          branchId: 'branch-main',
          outputFile: input.outputFile,
          format: input.format,
        })
      },
    }),
  )

  assert.ok(execution)
  assert.equal(execution.kind, 'single')
  assert.equal(observedFormat, 'text')
  const message = execution.messages[0]
  assert.ok('result' in message)
  const result = message.result as {
    exportScope: string
    branchId: string | null
    outputFile: string
    format: string
  }
  assert.equal(result.exportScope, 'branch')
  assert.equal(result.branchId, 'branch-main')
  assert.equal(result.outputFile, '/tmp/session-export.txt')
  assert.equal(result.format, 'text')
})

function createDependencies(
  overrides: Partial<{
    cleanupStaleBrowserRuntimes: () => Promise<BrowserRuntimeCleanupResultView>
    exportConversation: (input: {
      sessionFile?: string | undefined
      sessionId?: string | undefined
      sessionStoreDir?: string | undefined
      branchId?: string | undefined
      format: 'text' | 'markdown' | 'json'
      outputFile: string
    }) => Promise<{
      sessionId: string
      exportScope: 'branch' | 'session'
      branchId: string | null
      outputFile: string
      format: 'text' | 'markdown' | 'json'
    }>
    executeDeepSeekEditMessage: (input: {
      edit: {
        sessionId?: string | undefined
        messageId: string
      }
      output?: DeepSeekReplyExecutionInput['output']
    }) => Promise<{
      result: DeepSeekReplyResult
      outputMode: ReturnType<typeof resolveDeepSeekReplyOutputMode>
    }>
    executeDeepSeekContinueMessage: (input: {
      continue: {
        sessionId?: string | undefined
        messageId: string
      }
      output?: DeepSeekReplyExecutionInput['output']
    }) => Promise<{
      result: DeepSeekReplyResult
      outputMode: ReturnType<typeof resolveDeepSeekReplyOutputMode>
    }>
    executeDeepSeekRegenerateMessage: (input: {
      regenerate: {
        sessionId?: string | undefined
        messageId: string
      }
      output?: DeepSeekReplyExecutionInput['output']
    }) => Promise<{
      result: DeepSeekReplyResult
      outputMode: ReturnType<typeof resolveDeepSeekReplyOutputMode>
    }>
    executeDeepSeekReply: (input: DeepSeekReplyExecutionInput) => Promise<{
      result: DeepSeekReplyResult
      outputMode: ReturnType<typeof resolveDeepSeekReplyOutputMode>
    }>
    getBrowserRuntimeStatus: (input: {
      browserId: string
    }) => Promise<BrowserRuntimeStatusResult>
    listBrowserRuntimes: () => Promise<BrowserRuntimeListResult>
    restartBrowserRuntime: (input: {
      browserId: string
      force?: boolean | undefined
    }) => Promise<BrowserRuntimeRestartResultView>
    startBrowserRuntime: (input: {
      cdpUrl: string
      timeoutMs: number
      headless: boolean
      proxyServer?: string | undefined
      chromeExecutablePath?: string | undefined
      chromeUserDataDir?: string | undefined
      keepTempChromeProfile: boolean
      browserPurpose?: 'primary' | 'probe' | 'regression' | 'audit' | undefined
      idleTtlMs?: number | undefined
      entrypoint?: 'cli' | 'interactive' | 'rpc' | 'unspecified' | undefined
    }) => Promise<BrowserRuntimeStartResultView>
    stopBrowserRuntime: (input: {
      browserId: string
      force?: boolean | undefined
    }) => Promise<BrowserRuntimeStopResultView>
  }> = {},
) {
  return {
    cleanupStaleBrowserRuntimes:
      overrides.cleanupStaleBrowserRuntimes ??
      (() => Promise.reject(new Error('Unexpected cleanupStaleBrowserRuntimes call in test.'))),
    discoverDeepSeekControls: () =>
      Promise.reject(new Error('Unexpected discoverDeepSeekControls call in test.')),
    exportConversation:
      overrides.exportConversation ??
      (() => Promise.reject(new Error('Unexpected exportConversation call in test.'))),
    getBrowserRuntimeStatus:
      overrides.getBrowserRuntimeStatus ??
      (() => Promise.reject(new Error('Unexpected getBrowserRuntimeStatus call in test.'))),
    inspectDeepSeekSession: () =>
      Promise.reject(new Error('Unexpected inspectDeepSeekSession call in test.')),
    listDeepSeekSessionBranches: () =>
      Promise.reject(new Error('Unexpected listDeepSeekSessionBranches call in test.')),
    listBrowserRuntimes:
      overrides.listBrowserRuntimes ??
      (() => Promise.reject(new Error('Unexpected listBrowserRuntimes call in test.'))),
    planManagedChromeSession: (input: ManagedChromeOptions): ManagedChromeExecutionPlan => ({
      mode: 'existing',
      browserRuntime: input.browserRuntime ?? {
        entrypoint: 'unspecified',
        requestedMode: null,
        mode: 'attach',
        ownership: 'external',
        purpose: 'primary',
        source: 'legacy-clone-flag',
        executionDisposition: 'attach-existing-cdp',
        persistentRuntimeReady: false,
        notes: [],
      },
      cdpUrl: input.cdpUrl,
      timeoutMs: input.timeoutMs,
      cloneChromeProfile: false,
      headless: false,
      proxyServer: null,
      chromeExecutablePath: null,
      chromeUserDataDir: null,
      keepTempChromeProfile: input.keepTempChromeProfile,
    }),
    restartBrowserRuntime:
      overrides.restartBrowserRuntime ??
      (() => Promise.reject(new Error('Unexpected restartBrowserRuntime call in test.'))),
    startBrowserRuntime:
      overrides.startBrowserRuntime ??
      (() => Promise.reject(new Error('Unexpected startBrowserRuntime call in test.'))),
    stopBrowserRuntime:
      overrides.stopBrowserRuntime ??
      (() => Promise.reject(new Error('Unexpected stopBrowserRuntime call in test.'))),
    executeDeepSeekEditMessage:
      overrides.executeDeepSeekEditMessage ??
      (() => Promise.reject(new Error('Unexpected executeDeepSeekEditMessage call in test.'))),
    executeDeepSeekContinueMessage:
      overrides.executeDeepSeekContinueMessage ??
      (() => Promise.reject(new Error('Unexpected executeDeepSeekContinueMessage call in test.'))),
    executeDeepSeekRegenerateMessage:
      overrides.executeDeepSeekRegenerateMessage ??
      (() => Promise.reject(new Error('Unexpected executeDeepSeekRegenerateMessage call in test.'))),
    executeDeepSeekReply:
      overrides.executeDeepSeekReply ??
      (() => Promise.reject(new Error('Unexpected executeDeepSeekReply call in test.'))),
    describeKnownDeepSeekApiSurface: () => ({
      routes: ['/', '/a/chat', '/a/chat/s/:sessionId'],
      generationEndpoints: ['/api/v0/chat/completion'],
      sessionEndpoints: ['/api/v0/chat/history_messages'],
      fileEndpoints: ['/api/v0/file/upload_file'],
    }),
  }
}

function createReplyExecutionResult(input: {
  result: DeepSeekReplyResult
  output: DeepSeekReplyExecutionInput['output']
}) {
  return {
    result: input.result,
    outputMode: resolveDeepSeekReplyOutputMode(input.output),
  }
}

function createManagedChromeParams() {
  return {
    cdpUrl: 'http://127.0.0.1:9222',
    timeoutMs: 30_000,
    cloneChromeProfile: false,
    headless: false,
    keepTempChromeProfile: false,
  }
}

function createBrowserRuntimeView(
  overrides: Partial<BrowserRuntimeStartResultView['runtime']> = {},
): BrowserRuntimeStartResultView['runtime'] {
  return {
    browserId: overrides.browserId ?? 'warm-primary-runtime',
    runtimeId: overrides.runtimeId ?? overrides.browserId ?? 'warm-primary-runtime',
    mode: overrides.mode ?? 'warm',
    owner: overrides.owner ?? 'managed',
    purpose: overrides.purpose ?? 'primary',
    state: overrides.state ?? 'ready',
    busy: overrides.busy ?? false,
    cdpUrl: overrides.cdpUrl ?? 'http://127.0.0.1:9555',
    browserUrl: overrides.browserUrl ?? 'http://127.0.0.1:9555',
    pid: overrides.pid ?? 12345,
    profileDir:
      overrides.profileDir ??
      '/tmp/deepseek-cdp-cli/browser-runtimes/runtimes/warm-primary-runtime/profile',
    keepTempProfile: overrides.keepTempProfile ?? false,
    ageMs: overrides.ageMs ?? 5000,
    lastUsedAt: overrides.lastUsedAt ?? '2026-04-06T00:00:05.000Z',
    idleTtlMs: overrides.idleTtlMs ?? 1_800_000,
    idleExpiresAt: overrides.idleExpiresAt ?? '2026-04-06T00:30:05.000Z',
    idleRemainingMs: overrides.idleRemainingMs ?? 1_795_000,
    lease: overrides.lease ?? null,
    managedConfig: overrides.managedConfig ?? {
      timeoutMs: 30_000,
      headless: false,
      proxyServer: null,
      chromeExecutablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      chromeUserDataDir: '/Users/jin/Library/Application Support/Google/Chrome',
    },
    availableActions: overrides.availableActions ?? ['stop', 'restart'],
  }
}

function createReplyResult(overrides: Partial<DeepSeekReplyResult> = {}): DeepSeekReplyResult {
  const context = {
    runId: 'run-001',
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    branchId: 'branch-main',
    parentMessageId: 'message-user-1',
    assistantMessageId: 'message-assistant-1',
  }
  const finalized = {
    status: 'completed' as const,
    finishReason: 'stop' as const,
    outputText: 'Hello from DeepSeek',
    reasoningText: '',
    reasoningKind: 'unknown' as const,
    citations: [],
    responseReferences: [],
    searches: [],
    usage: {
      inputTokens: 1,
      outputTokens: 3,
      totalTokens: 4,
      reasoningTokens: null,
    },
    error: null,
    completedAt: '2026-04-05T00:00:02.000Z',
  }
  const canonicalRun = {
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    context,
    events: [
      {
        kind: 'text.delta' as const,
        sequence: 1,
        occurredAt: '2026-04-05T00:00:01.000Z',
        context,
        delta: 'Hello from DeepSeek',
        accumulatedText: 'Hello from DeepSeek',
      },
      {
        kind: 'completed' as const,
        sequence: 2,
        occurredAt: '2026-04-05T00:00:02.000Z',
        context,
        result: finalized,
      },
    ],
    finalized,
    unknownObservations: [],
    unknownObservationCount: 0,
    unknownObservationLabels: [],
  }
  const observedRun = {
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    context,
    finalized,
    eventCount: 2,
    unknownObservationCount: 0,
    unknownObservationLabels: [],
  }

  return {
    entryMode: 'new-session',
    streamRequested: true,
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    sessionFile: '/tmp/session-001.json',
    sessionCreate: {
      sessionId: 'session-001',
      agentId: 'chat',
      url: 'https://chat.deepseek.com/api/v0/chat_session/create',
      status: 200,
    },
    completionRequestObserved: true,
    generationObservations: [
      {
        endpoint: '/api/v0/chat/completion',
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        status: 200,
        contentType: 'text/event-stream',
        outputTokens: 3,
      },
    ],
    generationRuns: [observedRun],
    outputTokensUsed: 3,
    settledAfterMs: 500,
    budget: {
      queriesRemaining: 10,
      tokensRemaining: 1000,
      resetsAt: '2026-04-05T01:00:00.000Z',
    },
    requestedComposerMode: {
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
      deepThink: 'off',
      search: 'off',
    },
    beforeSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/',
      routeKind: 'home',
      agentId: null,
      sessionId: null,
      composerInput: { found: true, selector: 'textarea', label: 'Message DeepSeek' },
      sendOrStopButton: { found: true, selector: '#send', label: 'Send', state: 'send' },
      deepThinkToggle: { found: true, selector: '#deepthink', label: 'DeepThink', state: 'off' },
      searchToggle: { found: true, selector: '#search', label: 'Search', state: 'off' },
      fileButton: { found: true, selector: '#file', label: 'File' },
    },
    afterSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-001',
      composerInput: { found: true, selector: 'textarea', label: 'Message DeepSeek' },
      sendOrStopButton: { found: true, selector: '#send', label: 'Send', state: 'send' },
      deepThinkToggle: { found: true, selector: '#deepthink', label: 'DeepThink', state: 'off' },
      searchToggle: { found: true, selector: '#search', label: 'Search', state: 'off' },
      fileButton: { found: true, selector: '#file', label: 'File' },
    },
    assistantText: 'Hello from DeepSeek',
    assistantTextSource: 'history_messages',
    transcriptRecovery: null,
    session: {
      id: 'session-001',
      agentId: 'chat',
      title: 'Session 001',
      createdAt: '2026-04-05T00:00:00.000Z',
      branches: [
        {
          id: 'branch-main',
          sessionId: 'session-001',
          title: 'Main Branch',
          createdAt: '2026-04-05T00:00:00.000Z',
          messages: [
            {
              id: 'message-user-1',
              role: 'user',
              text: 'hello',
              createdAt: '2026-04-05T00:00:00.000Z',
              branchId: 'branch-main',
              citations: [],
              attachments: [],
            },
            {
              id: 'message-assistant-1',
              role: 'assistant',
              text: 'Hello from DeepSeek',
              createdAt: '2026-04-05T00:00:02.000Z',
              branchId: 'branch-main',
              parentId: 'message-user-1',
              citations: [],
              attachments: [],
            },
          ],
        },
      ],
    },
    output: {
      mode: 'stream',
      canonicalEvents: canonicalRun.events,
      canonicalRuns: [canonicalRun],
      finalizedAssistantText: 'Hello from DeepSeek',
    },
    ...overrides,
  }
}

function createSearchRateLimitReplyResult(): DeepSeekReplyResult {
  const base = createReplyResult({
    assistantText: null,
    outputTokensUsed: 0,
    requestedComposerMode: {
      deepThink: 'on',
      search: 'on',
    },
    composerMode: {
      deepThink: 'on',
      search: 'on',
    },
  })
  const context = base.generationRuns[0]?.context
  assert.ok(context)
  const finalized = {
    ...base.generationRuns[0]!.finalized,
    status: 'failed' as const,
    finishReason: 'error' as const,
    outputText: '',
    searches: [],
    citations: [],
    usage: null,
    error: {
      code: 'rate_limit_exceeded',
      message: 'Messages too frequent. Try again later.',
      retryable: true,
      cause: 'rate_limit_reached',
    },
  }
  const canonicalRun = {
    endpoint: '/api/v0/chat/completion' as const,
    transport: 'sse' as const,
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    context,
    events: [
      {
        kind: 'error' as const,
        sequence: 1,
        occurredAt: '2026-04-05T00:00:01.000Z',
        context,
        error: {
          code: 'rate_limit_exceeded',
          message: 'Messages too frequent. Try again later.',
          retryable: true,
          cause: 'rate_limit_reached',
        },
      },
      {
        kind: 'completed' as const,
        sequence: 2,
        occurredAt: '2026-04-05T00:00:02.000Z',
        context,
        result: finalized,
      },
    ],
    finalized,
    unknownObservations: [],
    unknownObservationCount: 1,
    unknownObservationLabels: ['rate_limit_retry_close'],
  }
  const observedRun = {
    ...base.generationRuns[0]!,
    finalized,
    eventCount: 2,
    unknownObservationCount: 1,
    unknownObservationLabels: ['rate_limit_retry_close'],
  }

  return {
    ...base,
    generationRuns: [observedRun],
    output: {
      mode: 'stream',
      canonicalEvents: canonicalRun.events,
      canonicalRuns: [canonicalRun],
      finalizedAssistantText: null,
    },
  }
}

function createSuccessfulRetryReport() {
  return {
    policy: {
      onRateLimit: true,
      maxRetries: 2,
      cooldownMs: null,
      countdown: true,
    },
    attempts: [
      {
        attemptNumber: 1,
        startedAt: '2026-04-05T00:00:01.000Z',
        finishedAt: '2026-04-05T00:00:02.000Z',
        finalStatus: 'failed' as const,
        finishReason: 'error',
        errorCode: 'rate_limit_exceeded',
        errorMessage: 'Messages too frequent. Try again later.',
        rateLimit: {
          code: 'rate_limit_exceeded' as const,
          message: 'Messages too frequent. Try again later.',
          retryable: true,
          scope: 'search' as const,
          apiSignalStatus: 'confirmed' as const,
          uiRetryControlStatus: 'ui-observation-pending' as const,
          uiObservationStatus: 'ui-observation-pending' as const,
          recommendedCooldownMs: 60_000,
          rawFinishReason: 'rate_limit_reached',
          clickBehavior: 'retry' as const,
          note:
            'This is an API-level retry signal, not a confirmed clickable UI retry button.',
        },
        retryScheduled: true,
        cooldownMs: 60_000,
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
        sessionId: 'session-001',
      },
      {
        attemptNumber: 2,
        startedAt: '2026-04-05T00:01:02.000Z',
        finishedAt: '2026-04-05T00:01:03.000Z',
        finalStatus: 'completed' as const,
        finishReason: 'stop',
        errorCode: null,
        errorMessage: null,
        rateLimit: null,
        retryScheduled: false,
        cooldownMs: null,
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
        sessionId: 'session-001',
      },
    ],
    totalAttempts: 2,
    retriedAttempts: 1,
    exhausted: false,
    boundary: {
      strategy: 'api-cooldown-replay' as const,
      uiRetryControlStatus: 'ui-observation-pending' as const,
      note:
        'Automatic retries replay the controlled browser send flow after cooldown. They do not click a confirmed DeepSeek UI retry control.',
    },
  }
}
