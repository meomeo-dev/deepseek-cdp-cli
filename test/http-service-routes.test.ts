import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildHttpServiceRoutes } from '../src/interfaces/http/httpServiceRoutes.js'
import { buildJsonRpcHttpRoute } from '../src/interfaces/http/jsonRpcHttpRoute.js'
import { handleHttpRequest, matchHttpRoute } from '../src/interfaces/http/httpServer.js'
import type { executeDeepSeekReply } from '../src/application/services/executeDeepSeekReply.js'
import {
  createOpenAIHttpResponseHandleRecordFromReply,
  loadOpenAIHttpResponseHandleRecord,
  saveOpenAIHttpResponseHandleRecord,
} from '../src/infrastructure/openai/openaiHttpResponseHandleRegistry.js'
import {
  createOpenAIHttpChatCompletionRecordFromReply,
  loadOpenAIHttpChatCompletionRecord,
  saveOpenAIHttpChatCompletionRecord,
} from '../src/infrastructure/openai/openaiHttpChatCompletionRegistry.js'
import { createStoredSessionFromFirstMessage } from '../src/infrastructure/deepseek/deepSeekStoredSession.js'
import {
  loadStoredSessionFromFile,
  saveStoredSessionToFile,
} from '../src/infrastructure/deepseek/fileSystemSessionStore.js'
import {
  createDeepSeekComposerFileInputUnavailableError,
  createDeepSeekComposerToggleSettleError,
  createDeepSeekComposerToggleUnavailableError,
} from '../src/shared/errors/deepSeekComposerModeError.js'
import { createDeepSeekFileUploadError } from '../src/shared/errors/deepSeekFileUploadError.js'
import type { HttpRouteDefinition } from '../src/interfaces/http/httpServer.js'
import type { OpenAIHttpExecutionEnvironment } from '../src/types/openai-http-service.types.js'
import type {
  DeepSeekReplyLiveEvent,
} from '../src/types/deepseek-reply-output.types.js'
import type { DeepSeekReplyResult } from '../src/types/deepseek-reply.types.js'

void test('HTTP service route registry keeps rpc and openai surfaces explicitly separated', () => {
  const rpcRoute = createRpcRoute()
  const routes = buildHttpServiceRoutes({
    surfaces: ['rpc', 'openai'],
    rpcRoute,
  })

  assert.deepEqual(
    routes.map(route => ({
      id: route.id,
      surface: route.surface,
      method: route.method,
      path: route.path,
    })),
    [
      {
        id: 'rpc.jsonrpc-root',
        surface: 'rpc',
        method: 'POST',
        path: '/',
      },
      {
        id: 'openai.chat-completions',
        surface: 'openai',
        method: 'POST',
        path: '/v1/chat/completions',
      },
      {
        id: 'openai.chat-completions.list',
        surface: 'openai',
        method: 'GET',
        path: '/v1/chat/completions',
      },
      {
        id: 'openai.chat-completions.retrieve',
        surface: 'openai',
        method: 'GET',
        path: '/v1/chat/completions/{completion_id}',
      },
      {
        id: 'openai.chat-completions.update',
        surface: 'openai',
        method: 'POST',
        path: '/v1/chat/completions/{completion_id}',
      },
      {
        id: 'openai.chat-completions.delete',
        surface: 'openai',
        method: 'DELETE',
        path: '/v1/chat/completions/{completion_id}',
      },
      {
        id: 'openai.chat-completions.messages',
        surface: 'openai',
        method: 'GET',
        path: '/v1/chat/completions/{completion_id}/messages',
      },
      {
        id: 'openai.conversations.create',
        surface: 'openai',
        method: 'POST',
        path: '/v1/conversations',
      },
      {
        id: 'openai.conversations.retrieve',
        surface: 'openai',
        method: 'GET',
        path: '/v1/conversations/{conversation_id}',
      },
      {
        id: 'openai.conversations.delete',
        surface: 'openai',
        method: 'DELETE',
        path: '/v1/conversations/{conversation_id}',
      },
      {
        id: 'openai.conversations.update',
        surface: 'openai',
        method: 'POST',
        path: '/v1/conversations/{conversation_id}',
      },
      {
        id: 'openai.conversations.items.create',
        surface: 'openai',
        method: 'POST',
        path: '/v1/conversations/{conversation_id}/items',
      },
      {
        id: 'openai.conversations.items.list',
        surface: 'openai',
        method: 'GET',
        path: '/v1/conversations/{conversation_id}/items',
      },
      {
        id: 'openai.conversations.items.retrieve',
        surface: 'openai',
        method: 'GET',
        path: '/v1/conversations/{conversation_id}/items/{item_id}',
      },
      {
        id: 'openai.conversations.items.delete',
        surface: 'openai',
        method: 'DELETE',
        path: '/v1/conversations/{conversation_id}/items/{item_id}',
      },
      {
        id: 'openai.responses',
        surface: 'openai',
        method: 'POST',
        path: '/v1/responses',
      },
      {
        id: 'openai.responses.retrieve',
        surface: 'openai',
        method: 'GET',
        path: '/v1/responses/{response_id}',
      },
      {
        id: 'openai.responses.delete',
        surface: 'openai',
        method: 'DELETE',
        path: '/v1/responses/{response_id}',
      },
      {
        id: 'openai.responses.cancel',
        surface: 'openai',
        method: 'POST',
        path: '/v1/responses/{response_id}/cancel',
      },
      {
        id: 'openai.responses.input-items',
        surface: 'openai',
        method: 'GET',
        path: '/v1/responses/{response_id}/input_items',
      },
      {
        id: 'openai.responses.input-tokens',
        surface: 'openai',
        method: 'POST',
        path: '/v1/responses/input_tokens',
      },
      {
        id: 'openai.responses.compact',
        surface: 'openai',
        method: 'POST',
        path: '/v1/responses/compact',
      },
    ],
  )
})

void test('HTTP service route registry can stay rpc-only without registering OpenAI paths', () => {
  const rpcRoute = createRpcRoute()
  const routes = buildHttpServiceRoutes({
    surfaces: ['rpc'],
    rpcRoute,
  })

  assert.equal(routes.length, 1)
  assert.equal(routes[0]?.id, 'rpc.jsonrpc-root')
  assert.equal(matchHttpRoute(routes, 'POST', '/v1/chat/completions'), null)
})

void test('JSON-RPC HTTP route writes single-response payloads without owning the shared HTTP container', async () => {
  const response = createMockResponse()
  const route = buildJsonRpcHttpRoute({
    async streamPayload(payload, sink) {
      await Promise.resolve()
      assert.equal(payload, '{"jsonrpc":"2.0"}')
      sink?.start?.({
        kind: 'single',
        contentType: 'application/json; charset=utf-8',
      })
      sink?.write?.({
        jsonrpc: '2.0',
        id: 1,
        result: {
          ok: true,
        },
      })
    },
  })

  await route.handler({
    request: {} as never,
    response: response as never,
    method: 'POST',
    url: new URL('http://127.0.0.1/'),
    path: '/',
    pathParams: {},
    searchParams: new URLSearchParams(),
    requestId: 'req-rpc-single',
    readBody: () => Promise.resolve('{"jsonrpc":"2.0"}'),
  })

  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.flushCount, 0)
  assert.equal(response.body, '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
})

void test('JSON-RPC HTTP route writes streaming payloads as NDJSON and flushes headers early', async () => {
  const response = createMockResponse()
  const route = buildJsonRpcHttpRoute({
    async streamPayload(_payload, sink) {
      await Promise.resolve()
      sink?.start?.({
        kind: 'stream',
        contentType: 'application/x-ndjson; charset=utf-8',
      })
      sink?.write?.({
        jsonrpc: '2.0',
        method: 'deepseek.stream.event',
        params: {
          requestId: 'reply-1',
          sequence: 1,
          event: {
            type: 'probe',
          },
        },
      })
      sink?.write?.({
        jsonrpc: '2.0',
        id: 'reply-1',
        result: {
          done: true,
        },
      })
    },
  })

  await route.handler({
    request: {} as never,
    response: response as never,
    method: 'POST',
    url: new URL('http://127.0.0.1/'),
    path: '/',
    pathParams: {},
    searchParams: new URLSearchParams(),
    requestId: 'req-rpc-stream',
    readBody: () => Promise.resolve('{"jsonrpc":"2.0"}'),
  })

  assert.equal(response.headers['content-type'], 'application/x-ndjson; charset=utf-8')
  assert.equal(response.flushCount, 1)
  assert.equal(
    response.body,
    '{"jsonrpc":"2.0","method":"deepseek.stream.event","params":{"requestId":"reply-1","sequence":1,"event":{"type":"probe"}}}\n' +
      '{"jsonrpc":"2.0","id":"reply-1","result":{"done":true}}\n',
  )
})

void test('HTTP container enforces bearer auth and emits an OpenAI-compatible error envelope', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 401)
  assert.equal(response.headers['www-authenticate'], 'Bearer')
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.ok(response.headers['x-request-id'])
  assert.match(response.body, /"type":"authentication_error"/)
  assert.match(response.body, /"code":"invalid_api_key"/)
})

void test('HTTP container emits 404 JSON errors with request ids for unregistered OpenAI paths', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['rpc'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 404)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.ok(response.headers['x-request-id'])
  assert.match(response.body, /"code":"route_not_found"/)
})

void test('OpenAI chat completions buffered route executes through the shared bridge and returns a chat.completion payload', async () => {
  const response = createMockResponse()
  let seenExecution: unknown = null

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        messages: [
          {
            role: 'user',
            content: 'Summarize this page.',
          },
        ],
        deepseek_options: {
          search: 'on',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
        'x-request-id': 'req-openai-chat',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          seenExecution = input
          return Promise.resolve({
            result: createBufferedReplyResult(),
            outputMode: {
              stream: false,
              format: 'json',
              jsonShape: 'openai-chat-completions',
              transport: 'buffered',
              outputFamily: 'json',
            },
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['x-request-id'], 'req-openai-chat')
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')

  const payload = JSON.parse(response.body) as {
    object: string
    model: string
    choices: Array<{
      finish_reason: string
      message: {
        content: string | null
      }
    }>
    usage?: {
      completion_tokens: number
    }
  }
  assert.equal(payload.object, 'chat.completion')
  assert.equal(payload.model, 'deepseek-expert-browser')
  assert.equal(payload.choices[0]?.message.content, 'Hello from DeepSeek')
  assert.equal(payload.choices[0]?.finish_reason, 'stop')
  assert.equal(payload.usage?.completion_tokens, 3)

  const execution = seenExecution as {
    reply: {
      prompt: string
      waitUntil: string
      url?: string
      sessionStoreDir?: string
      composerMode?: {
        chatMode: string
        deepThink: string
        search: string
      }
      cdpUrl: string
      timeoutMs: number
      cloneChromeProfile: boolean
      headless: boolean
      keepTempChromeProfile: boolean
    }
    output: {
      stream: boolean
      format: string
      jsonShape: string
    }
  }
  assert.equal(execution.reply.prompt, 'Summarize this page.')
  assert.equal(execution.reply.waitUntil, 'domcontentloaded')
  assert.equal(execution.reply.url, 'https://chat.deepseek.com/')
  assert.equal(execution.reply.sessionStoreDir, '.deepseek-cdp-cli/sessions')
  assert.equal(execution.reply.composerMode?.chatMode, 'expert')
  assert.equal(execution.reply.composerMode?.deepThink, 'off')
  assert.equal(execution.reply.composerMode?.search, 'on')
  assert.equal(execution.reply.cdpUrl, 'http://127.0.0.1:9222')
  assert.equal(execution.reply.timeoutMs, 30_000)
  assert.equal(execution.reply.cloneChromeProfile, false)
  assert.equal(execution.reply.headless, false)
  assert.equal(execution.reply.keepTempChromeProfile, false)
  assert.equal(execution.output.stream, false)
  assert.equal(execution.output.format, 'json')
  assert.equal(execution.output.jsonShape, 'openai-chat-completions')
})

void test('OpenAI chat completions stages history bootstrap context as an artifact and only prompts with the latest official text-content user turn', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-chat-history-bootstrap-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()
    let seenExecution: unknown = null
    let seenBootstrapArtifactPath: string | null = null
    let seenBootstrapArtifactContent: string | null = null
    const baseResult = createBufferedReplyResult()
    const result = createBufferedReplyResult({
      sessionId: 'session-chat-history-bootstrap',
      sessionFile: join(sessionStoreDir, 'session-chat-history-bootstrap.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-history-bootstrap',
      generationRuns: [
        {
          ...baseResult.generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-history-bootstrap',
          context: {
            ...baseResult.generationRuns[0]!.context,
            runId: 'run-chat-history-bootstrap',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-history-bootstrap',
            sessionId: 'session-chat-history-bootstrap',
          },
        },
      ],
    })

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/chat/completions',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          messages: [
            {
              role: 'developer',
              content: [
                {
                  type: 'text',
                  text: 'Answer tersely.',
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Summarize ',
                },
                {
                  type: 'text',
                  text: 'this page.',
                },
              ],
            },
          ],
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          async executeReply(input) {
            seenExecution = input
            seenBootstrapArtifactPath = input.reply.files?.[0] ?? null
            seenBootstrapArtifactContent =
              seenBootstrapArtifactPath === null
                ? null
                : await readFile(seenBootstrapArtifactPath, 'utf8')
            await saveStoredSessionFixture({
              prompt: input.reply.prompt,
              result,
            })
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-chat-completions',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 200)

    const execution = seenExecution as {
      reply: {
        prompt: string
        files?: string[]
      }
    }
    assert.equal(execution.reply.prompt, 'Summarize this page.')
    assert.equal(execution.reply.files?.length, 1)
    assert.match(seenBootstrapArtifactContent ?? '', /Developer:\nAnswer tersely\./u)
    assert.match(seenBootstrapArtifactContent ?? '', /newest actionable user turn is sent separately/u)

    const storedSession = await loadStoredSessionFromFile(result.sessionFile)
    assert.equal(storedSession.metadata?.openaiHistoryBootstrap?.endpoint, '/v1/chat/completions')
    assert.equal(storedSession.metadata?.openaiHistoryBootstrap?.historyItemCount, 1)
    assert.equal(storedSession.metadata?.openaiHistoryBootstrap?.latestTurnFileCount, 0)

    if (seenBootstrapArtifactPath !== null) {
      const fileStats = await stat(seenBootstrapArtifactPath).catch(() => null)
      assert.equal(fileStats, null)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI chat completions persists store=true records and backfills metadata into the response object', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-chat-store-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const baseResult = createBufferedReplyResult()
    const result = createBufferedReplyResult({
      sessionId: 'session-chat-store',
      sessionFile: join(sessionStoreDir, 'session-chat-store.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-store',
      generationRuns: [
        {
          ...baseResult.generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-store',
          context: {
            ...baseResult.generationRuns[0]!.context,
            runId: 'run-chat-store',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-store',
            sessionId: 'session-chat-store',
          },
        },
      ],
    })
    await saveStoredSessionFixture({
      prompt: 'hello',
      result,
    })

    const response = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/chat/completions',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          messages: [
            {
              role: 'developer',
              content: 'Answer tersely.',
            },
            {
              role: 'user',
              content: 'Write a haiku.',
            },
          ],
          store: true,
          metadata: {
            topic: 'demo',
            ticket: '42',
          },
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-chat-completions',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const payload = JSON.parse(response.body) as {
      id: string
      object: string
      metadata: Record<string, string>
      choices: Array<{
        message: {
          content: string | null
        }
      }>
    }
    const storedRecord = await loadOpenAIHttpChatCompletionRecord(payload.id, {
      sessionStoreDir,
    })

    assert.equal(response.statusCode, 200)
    assert.equal(payload.object, 'chat.completion')
    assert.deepEqual(payload.metadata, {
      topic: 'demo',
      ticket: '42',
    })
    assert.equal(payload.choices[0]?.message.content, 'Hello from DeepSeek')
    assert.equal(storedRecord?.store, true)
    assert.deepEqual(storedRecord?.metadata, {
      topic: 'demo',
      ticket: '42',
    })
    assert.deepEqual(storedRecord?.completion.metadata, {
      topic: 'demo',
      ticket: '42',
    })
    assert.deepEqual(storedRecord?.messages, [
      {
        role: 'developer',
        content: 'Answer tersely.',
      },
      {
        role: 'user',
        content: 'Write a haiku.',
      },
    ])
    assert.equal(storedRecord?.sessionId, 'session-chat-store')
    assert.equal(storedRecord?.sessionFile, result.sessionFile)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI chat completions streaming route emits SSE chunks before completion and closes with [DONE]', async () => {
  const response = createMockResponse()
  const streamResult = createStreamingReplyResult()
  const deferred = createDeferred<Awaited<ReturnType<typeof executeDeepSeekReply>>>()
  const executeReplyStarted = createDeferred<void>()
  let liveHandler: ((event: DeepSeekReplyLiveEvent) => void) | null = null

  const requestPromise = handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'stream this please',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
        'x-request-id': 'req-openai-chat-stream',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          liveHandler =
            input.live?.onEvent
              ? event => {
                  input.live?.onEvent?.(event)
                }
              : null
          executeReplyStarted.resolve()
          return deferred.promise
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  await executeReplyStarted.promise
  const emitLive = liveHandler as ((event: DeepSeekReplyLiveEvent) => void) | null
  assert.ok(emitLive)

  emitLive(createAttemptStartedEvent(1))
  emitLive(createStreamingTextDeltaEvent({
    attemptNumber: 1,
    delta: 'Hello',
  }))

  await Promise.resolve()

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(response.headers['connection'], 'keep-alive')
  assert.equal(response.headers['x-accel-buffering'], 'no')
  assert.equal(response.flushCount, 1)
  assert.equal(response.headers['x-request-id'], 'req-openai-chat-stream')
  assert.equal(response.ended, false)
  assert.match(response.body, /data: \{"id":".+","object":"chat\.completion\.chunk","created":\d+,"model":"deepseek-expert-browser","choices":\[\{"index":0,"delta":\{"role":"assistant","content":""\},"logprobs":null,"finish_reason":null\}\]\}/)
  assert.match(response.body, /data: \{"id":".+","object":"chat\.completion\.chunk","created":\d+,"model":"deepseek-expert-browser","choices":\[\{"index":0,"delta":\{"content":"Hello"\},"logprobs":null,"finish_reason":null\}\]\}/)

  emitLive(createStreamingCompletedEvent({
    attemptNumber: 1,
    result: streamResult,
  }))
  deferred.resolve({
    result: streamResult,
    outputMode: createStreamingExecutionOutputMode(),
  })

  await requestPromise

  assert.equal(response.ended, true)
  assert.match(response.body, /"finish_reason":"stop"/)
  assert.doesNotMatch(response.body, /"usage":/u)
  assert.match(response.body, /data: \[DONE\]\n\n$/)
})

void test('OpenAI chat completions streaming route emits official usage chunks only when stream_options.include_usage is requested', async () => {
  const response = createMockResponse()
  const streamResult = createStreamingReplyResult()
  const deferred = createDeferred<Awaited<ReturnType<typeof executeDeepSeekReply>>>()
  const executeReplyStarted = createDeferred<void>()
  let liveHandler: ((event: DeepSeekReplyLiveEvent) => void) | null = null

  const requestPromise = handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        stream: true,
        stream_options: {
          include_usage: true,
        },
        messages: [
          {
            role: 'user',
            content: 'stream this please',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          liveHandler =
            input.live?.onEvent
              ? event => {
                  input.live?.onEvent?.(event)
                }
              : null
          executeReplyStarted.resolve()
          return deferred.promise
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  await executeReplyStarted.promise
  const emitLive = liveHandler as ((event: DeepSeekReplyLiveEvent) => void) | null
  assert.ok(emitLive)

  emitLive(createAttemptStartedEvent(1))
  emitLive(createStreamingTextDeltaEvent({
    attemptNumber: 1,
    delta: 'Hello',
  }))
  emitLive(createStreamingCompletedEvent({
    attemptNumber: 1,
    result: streamResult,
  }))
  deferred.resolve({
    result: streamResult,
    outputMode: createStreamingExecutionOutputMode(),
  })

  await requestPromise

  assert.match(response.body, /"usage":null/u)
  assert.match(
    response.body,
    /"choices":\[\],"usage":\{"prompt_tokens":1,"completion_tokens":3,"total_tokens":4/u,
  )
  assert.match(response.body, /data: \[DONE\]\n\n$/)
})

void test('OpenAI chat completions streaming persists stored completion records after a successful stream', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-chat-stream-store-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const baseResult = createStreamingReplyResult()
    const result = createStreamingReplyResult({
      sessionId: 'session-chat-stream-store',
      sessionFile: join(sessionStoreDir, 'session-chat-stream-store.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
      generationRuns: [
        {
          ...baseResult.generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
          context: {
            ...baseResult.generationRuns[0]!.context,
            runId: 'run-chat-stream-store',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
            sessionId: 'session-chat-stream-store',
          },
        },
      ],
      output: {
        mode: 'stream',
        canonicalEvents: baseResult.output.mode === 'stream'
          ? baseResult.output.canonicalEvents.map(event => ({
              ...event,
              context: {
                ...event.context,
                runId: 'run-chat-stream-store',
                routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
                sessionId: 'session-chat-stream-store',
              },
            }))
          : [],
        canonicalRuns: baseResult.output.mode === 'stream'
          ? baseResult.output.canonicalRuns.map(run => ({
          ...run,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
          context: {
            ...run.context,
            runId: 'run-chat-stream-store',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
            sessionId: 'session-chat-stream-store',
          },
          events: run.events.map(event => ({
            ...event,
            context: {
              ...event.context,
              runId: 'run-chat-stream-store',
              routeUrl: 'https://chat.deepseek.com/a/chat/s/session-chat-stream-store',
              sessionId: 'session-chat-stream-store',
            },
          })),
        }))
          : [],
        finalizedAssistantText: baseResult.output.finalizedAssistantText,
      },
    })
    await saveStoredSessionFixture({
      prompt: 'stream please',
      result,
    })

    const response = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/chat/completions',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          stream: true,
          store: true,
          metadata: {
            source: 'stream-test',
          },
          messages: [
            {
              role: 'user',
              content: 'stream please',
            },
          ],
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result,
              outputMode: createStreamingExecutionOutputMode(),
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const completionId =
      response.body.match(/"id":"(chatcmpl_[^"]+)"/u)?.[1] ?? null
    assert.equal(response.statusCode, 200)
    assert.match(response.body, /data: \[DONE\]\n\n$/)
    assert.ok(completionId)

    const storedRecord = await loadOpenAIHttpChatCompletionRecord(completionId, {
      sessionStoreDir,
    })
    assert.equal(storedRecord?.store, true)
    assert.deepEqual(storedRecord?.metadata, {
      source: 'stream-test',
    })
    assert.equal(storedRecord?.completion.id, completionId)
    assert.equal(storedRecord?.completion.metadata.source, 'stream-test')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI chat completions streaming route can fall back to canonical stream chunks when no live chunk was emitted', async () => {
  const response = createMockResponse()
  const streamResult = createStreamingReplyResult()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'fallback stream',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.resolve({
            result: streamResult,
            outputMode: createStreamingExecutionOutputMode(),
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(response.flushCount, 1)
  assert.match(response.body, /"object":"chat\.completion\.chunk"/)
  assert.match(response.body, /"model":"deepseek-chat-browser"/)
  assert.match(response.body, /"content":"Hello from DeepSeek"/)
  assert.doesNotMatch(response.body, /"usage":/u)
  assert.match(response.body, /data: \[DONE\]\n\n$/)
})

void test('OpenAI chat completions fallback streaming path respects stream_options.include_usage', async () => {
  const response = createMockResponse()
  const streamResult = createStreamingReplyResult()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        stream_options: {
          include_usage: true,
        },
        messages: [
          {
            role: 'user',
            content: 'fallback stream',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.resolve({
            result: streamResult,
            outputMode: createStreamingExecutionOutputMode(),
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /"usage":null/u)
  assert.match(
    response.body,
    /"choices":\[\],"usage":\{"prompt_tokens":1,"completion_tokens":3,"total_tokens":4/u,
  )
  assert.match(response.body, /data: \[DONE\]\n\n$/)
})

void test('OpenAI chat completions stream preserves the JSON error envelope when execution fails before the first chunk', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'hit rate limit before streaming',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.reject(new Error('DeepSeek upstream rate limit cooldown in progress'))
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 429)
  assert.equal(response.flushCount, 0)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.match(response.body, /"type":"rate_limit_error"/)
  assert.match(response.body, /"code":"upstream_rate_limit"/)
})

void test('OpenAI chat completions stream keeps fail-closed JSON errors for unavailable toggle combinations before the first chunk', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'enable search',
          },
        ],
        deepseek_options: {
          search: 'on',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.reject(
            createDeepSeekComposerToggleUnavailableError({
              toggle: 'search',
              targetState: 'on',
              requestedChatMode: 'instant',
              resolvedChatMode: 'instant',
              pageUrl: 'https://chat.deepseek.com/',
            }),
          )
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.equal(response.flushCount, 0)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.match(response.body, /"type":"invalid_request_error"/)
  assert.match(response.body, /"code":"unsupported_requested_search_toggle"/)
})

void test('OpenAI chat completions translates upstream rate limits onto the shared HTTP error envelope', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hit rate limit',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.reject(new Error('DeepSeek upstream rate limit cooldown in progress'))
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 429)
  assert.match(response.body, /"type":"rate_limit_error"/)
  assert.match(response.body, /"code":"upstream_rate_limit"/)
})

void test('OpenAI chat completions maps unexpected execution failures onto a stable 500 contract', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'boom',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.reject(new Error('boom'))
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 500)
  assert.match(response.body, /"type":"api_error"/)
  assert.match(response.body, /"code":"upstream_execution_failed"/)
})

void test('OpenAI responses rejects invalid input_file base64 data with a stable 400 contract before execute', async () => {
  const response = createMockResponse()
  let executeCalled = false

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: [
          {
            role: 'user',
            content: 'stage this file',
          },
          {
            type: 'input_file',
            filename: 'broken.txt',
            file_data: '***not-base64***',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          executeCalled = true
          return Promise.resolve({
            result: createBufferedReplyResult(),
            outputMode: {
              stream: false,
              format: 'json',
              jsonShape: 'openai-responses',
              transport: 'buffered',
              outputFamily: 'json',
            },
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(executeCalled, false)
  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"type":"invalid_request_error"/)
  assert.match(response.body, /"code":"invalid_input_file_data"/)
})

void test('OpenAI responses maps toggle-settle failures onto a stable 500 contract', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        input: 'enable deepThink',
        deepseek_options: {
          deep_think: 'on',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.reject(
            createDeepSeekComposerToggleSettleError({
              toggle: 'deepThink',
              targetState: 'on',
              currentState: 'off',
              requestedChatMode: 'expert',
              resolvedChatMode: 'expert',
              pageUrl: 'https://chat.deepseek.com/',
            }),
          )
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 500)
  assert.match(response.body, /"type":"api_error"/)
  assert.match(response.body, /"code":"deepseek_deep_think_toggle_settle_failed"/)
})

void test('OpenAI responses buffered route executes through the shared bridge and returns a response object payload', async () => {
  const response = createMockResponse()
  let seenExecution: unknown = null

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        input: 'Explain the diff.',
        instructions: 'Answer in bullet points.',
        metadata: {
          topic: 'diff',
          source: 'route-test',
        },
        deepseek_options: {
          deep_think: 'on',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
        'x-request-id': 'req-openai-responses',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          seenExecution = input
          return Promise.resolve({
            result: createBufferedReplyResult(),
            outputMode: {
              stream: false,
              format: 'json',
              jsonShape: 'openai-responses',
              transport: 'buffered',
              outputFamily: 'json',
            },
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['x-request-id'], 'req-openai-responses')
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')

  const payload = JSON.parse(response.body) as {
    object: string
    model: string
    output_text: string | null
    previous_response_id: string | null
    store: boolean
    metadata: Record<string, string>
    background: null
    reasoning: null
    output: Array<{
      type: string
      role?: string
    }>
  }
  assert.equal(payload.object, 'response')
  assert.equal(payload.model, 'deepseek-expert-browser')
  assert.equal(payload.output_text, 'Hello from DeepSeek')
  assert.equal(payload.previous_response_id, null)
  assert.equal(payload.store, true)
  assert.deepEqual(payload.metadata, {
    topic: 'diff',
    source: 'route-test',
  })
  assert.equal(payload.background, null)
  assert.equal(payload.reasoning, null)
  assert.equal(payload.output[0]?.type, 'message')
  assert.equal(payload.output[0]?.role, 'assistant')

  const execution = seenExecution as {
    reply: {
      prompt: string
      waitUntil: string
      url?: string
      sessionStoreDir?: string
      composerMode?: {
        chatMode: string
        deepThink: string
        search: string
      }
      cdpUrl: string
      timeoutMs: number
    }
    output: {
      stream: boolean
      format: string
      jsonShape: string
    }
  }
  assert.equal(
    execution.reply.prompt,
    'System:\nAnswer in bullet points.\n\nUser:\nExplain the diff.',
  )
  assert.equal(execution.reply.waitUntil, 'domcontentloaded')
  assert.equal(execution.reply.url, 'https://chat.deepseek.com/')
  assert.equal(execution.reply.sessionStoreDir, '.deepseek-cdp-cli/sessions')
  assert.equal(execution.reply.composerMode?.chatMode, 'expert')
  assert.equal(execution.reply.composerMode?.deepThink, 'on')
  assert.equal(execution.reply.composerMode?.search, 'off')
  assert.equal(execution.reply.cdpUrl, 'http://127.0.0.1:9222')
  assert.equal(execution.reply.timeoutMs, 30_000)
  assert.equal(execution.output.stream, false)
  assert.equal(execution.output.format, 'json')
  assert.equal(execution.output.jsonShape, 'openai-responses')
})

void test('OpenAI responses accepts official web_search_preview tools and reasoning and routes them through the shared composer-mode bridge', async () => {
  const response = createMockResponse()
  let seenExecution: unknown = null

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        input: 'Explain the diff.',
        tools: [
          {
            type: 'web_search_preview_2025_03_11',
            search_context_size: 'high',
            search_content_types: ['text'],
          },
        ],
        reasoning: {},
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          seenExecution = input
          return Promise.resolve({
            result: createBufferedReplyResult(),
            outputMode: {
              stream: false,
              format: 'json',
              jsonShape: 'openai-responses',
              transport: 'buffered',
              outputFamily: 'json',
            },
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  const execution = seenExecution as {
    reply: {
      composerMode?: {
        chatMode: string
        deepThink: string
        search: string
      }
    }
  }

  assert.equal(response.statusCode, 200)
  assert.equal(execution.reply.composerMode?.chatMode, 'expert')
  assert.equal(execution.reply.composerMode?.deepThink, 'on')
  assert.equal(execution.reply.composerMode?.search, 'on')
})

void test('OpenAI responses rejects conflicting official reasoning ingress and deepseek_options before execution starts', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: 'hello',
        reasoning: {},
        deepseek_options: {
          deep_think: 'off',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"invalid_deep_think_control_conflict"/)
})

void test('OpenAI responses streaming route emits SSE events before completion and closes with [DONE]', async () => {
  const response = createMockResponse()
  const streamResult = createStreamingReplyResult()
  const deferred = createDeferred<Awaited<ReturnType<typeof executeDeepSeekReply>>>()
  const executeReplyStarted = createDeferred<void>()
  let liveHandler: ((event: DeepSeekReplyLiveEvent) => void) | null = null

  const requestPromise = handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        input: 'stream responses please',
        metadata: {
          source: 'stream-test',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
        'x-request-id': 'req-openai-responses-stream',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          liveHandler =
            input.live?.onEvent
              ? event => {
                  input.live?.onEvent?.(event)
                }
              : null
          executeReplyStarted.resolve()
          return deferred.promise
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  await executeReplyStarted.promise
  const emitLive = liveHandler as ((event: DeepSeekReplyLiveEvent) => void) | null
  assert.ok(emitLive)

  emitLive(createAttemptStartedEvent(1, 'openai-responses'))
  emitLive(
    createStreamingTextDeltaEvent({
      attemptNumber: 1,
      delta: 'Hello',
      jsonShape: 'openai-responses',
    }),
  )

  await Promise.resolve()

  const framesBeforeCompletion = parseSseFrames(response.body)
  const dataFramesBeforeCompletion =
    framesBeforeCompletion
      .filter(frame => frame.data !== '[DONE]')
      .map(frame => ({
        event: frame.event,
        data: JSON.parse(frame.data) as {
          type: string
          sequence_number: number
          response?: {
            metadata: Record<string, string>
            background: null
          }
        },
      }))

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(response.headers['connection'], 'keep-alive')
  assert.equal(response.headers['x-accel-buffering'], 'no')
  assert.equal(response.flushCount, 1)
  assert.equal(response.headers['x-request-id'], 'req-openai-responses-stream')
  assert.equal(response.ended, false)
  assert.deepEqual(
    dataFramesBeforeCompletion.map(frame => frame.data.type),
    [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
    ],
  )
  assert.deepEqual(
    dataFramesBeforeCompletion.map(frame => frame.event),
    dataFramesBeforeCompletion.map(frame => frame.data.type),
  )
  assert.equal(dataFramesBeforeCompletion[0]?.data.response?.background, null)
  assert.deepEqual(dataFramesBeforeCompletion[0]?.data.response?.metadata ?? null, {
    source: 'stream-test',
  })
  assert.ok(!dataFramesBeforeCompletion.some(frame => frame.data.type === 'response.queued'))

  emitLive(
    createStreamingCompletedEvent({
      attemptNumber: 1,
      result: streamResult,
      jsonShape: 'openai-responses',
    }),
  )
  deferred.resolve({
    result: streamResult,
    outputMode: createStreamingExecutionOutputMode('openai-responses'),
  })

  await requestPromise

  const frames = parseSseFrames(response.body)
  const terminalDataFrames =
    frames
      .filter(frame => frame.data !== '[DONE]')
      .map(frame => JSON.parse(frame.data) as { type: string; response?: { status: string } })

  assert.equal(response.ended, true)
  assert.ok(terminalDataFrames.some(frame => frame.type === 'response.output_text.done'))
  assert.ok(terminalDataFrames.some(frame => frame.type === 'response.output_item.done'))
  assert.equal(terminalDataFrames.at(-1)?.type, 'response.completed')
  assert.equal(terminalDataFrames.at(-1)?.response?.status, 'completed')
  assert.deepEqual(frames.at(-1), {
    event: null,
    data: '[DONE]',
  })
})

void test('OpenAI responses stream emits error plus response.failed when execution fails after the first event', async () => {
  const response = createMockResponse()
  const deferred = createDeferred<Awaited<ReturnType<typeof executeDeepSeekReply>>>()
  const executeReplyStarted = createDeferred<void>()
  let liveHandler: ((event: DeepSeekReplyLiveEvent) => void) | null = null

  const requestPromise = handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        input: 'fail after stream start',
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
        'x-request-id': 'req-openai-responses-stream-failed',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          liveHandler =
            input.live?.onEvent
              ? event => {
                  input.live?.onEvent?.(event)
                }
              : null
          executeReplyStarted.resolve()
          return deferred.promise
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  await executeReplyStarted.promise
  const emitLive = liveHandler as ((event: DeepSeekReplyLiveEvent) => void) | null
  assert.ok(emitLive)

  emitLive(createAttemptStartedEvent(1, 'openai-responses'))
  emitLive(
    createStreamingTextDeltaEvent({
      attemptNumber: 1,
      delta: 'Partial output',
      jsonShape: 'openai-responses',
    }),
  )

  await Promise.resolve()

  deferred.reject(new Error('DeepSeek upstream rate limit cooldown in progress'))
  await requestPromise

  const frames = parseSseFrames(response.body)
  const dataFrames =
    frames
      .filter(frame => frame.data !== '[DONE]')
      .map(frame => ({
        event: frame.event,
        data: JSON.parse(frame.data) as {
          type: string
          code?: string | null
          response?: {
            status: string
            error: {
              code: string
              message: string
            } | null
            output_text: string | null
          }
        },
      }))

  const errorFrame = dataFrames.find(frame => frame.data.type === 'error')
  const failedFrame = dataFrames.find(frame => frame.data.type === 'response.failed')

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(response.ended, true)
  assert.equal(errorFrame?.event, 'error')
  assert.equal(errorFrame?.data.code, 'upstream_rate_limit')
  assert.equal(failedFrame?.event, 'response.failed')
  assert.equal(failedFrame?.data.response?.status, 'failed')
  assert.equal(failedFrame?.data.response?.error?.code, 'upstream_rate_limit')
  assert.equal(failedFrame?.data.response?.output_text, 'Partial output')
  assert.deepEqual(frames.at(-1), {
    event: null,
    data: '[DONE]',
  })
})

void test('OpenAI responses streaming route can fall back to canonical response events when no live event was emitted', async () => {
  const response = createMockResponse()
  const streamResult = createStreamingReplyResult()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-expert-browser',
        stream: true,
        input: 'fallback response stream',
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.resolve({
            result: streamResult,
            outputMode: createStreamingExecutionOutputMode('openai-responses'),
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  const frames = parseSseFrames(response.body)
  const dataFrames =
    frames
      .filter(frame => frame.data !== '[DONE]')
      .map(frame => JSON.parse(frame.data) as { type: string; response?: { model: string } })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(response.flushCount, 1)
  assert.equal(dataFrames[0]?.type, 'response.created')
  assert.ok(dataFrames.some(frame => frame.type === 'response.output_text.delta'))
  assert.equal(dataFrames.at(-1)?.type, 'response.completed')
  assert.equal(dataFrames.at(-1)?.response?.model, 'deepseek-expert-browser')
  assert.deepEqual(frames.at(-1), {
    event: null,
    data: '[DONE]',
  })
})

void test('OpenAI responses stream preserves the JSON error envelope when execution fails before the first event', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        stream: true,
        input: 'hit rate limit before stream start',
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply() {
          return Promise.reject(new Error('DeepSeek upstream rate limit cooldown in progress'))
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 429)
  assert.equal(response.flushCount, 0)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.match(response.body, /"type":"rate_limit_error"/)
  assert.match(response.body, /"code":"upstream_rate_limit"/)
})

void test('HTTP container emits 405 with allow header before route logic runs', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'GET',
      url: '/',
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['rpc'],
      rpcRoute: createRpcRoute(),
    }),
  )

  assert.equal(response.statusCode, 405)
  assert.equal(response.headers['allow'], 'POST')
  assert.match(response.body, /"code":"method_not_allowed"/)
})

void test('OpenAI chat completions rejects explicitly unsupported fields fail-closed', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        tools: [],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"type":"invalid_request_error"/)
  assert.match(response.body, /"code":"unsupported_tools"/)
})

void test('OpenAI chat completions rejects unknown fields fail-closed', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        foo: 'bar',
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_foo"/)
})

void test('OpenAI chat completions rejects unsupported model aliases', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_model"/)
})

void test('OpenAI chat completions rejects non-text content blocks', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: 'https://example.com/image.png',
                },
              },
            ],
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_messages_0_content"/)
})

void test('OpenAI chat completions rejects unsupported official tool messages fail-closed', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'tool',
            tool_call_id: 'tool_123',
            content: 'tool output',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_messages_0_role"/)
})

void test('OpenAI chat completions rejects n values other than 1', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        n: 2,
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_n"/)
})

void test('OpenAI responses rejects explicitly unsupported fields fail-closed', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: 'hello',
        attachments: [],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_attachments"/)
})

void test('OpenAI chat completions accepts deepseek_options and maps omitted keys back to alias defaults', async () => {
  const response = createMockResponse()
  let seenExecution: unknown = null

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        deepseek_options: {
          search: 'on',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          seenExecution = input
          return Promise.resolve({
            result: createBufferedReplyResult(),
            outputMode: {
              stream: false,
              format: 'json',
              jsonShape: 'openai-chat-completions',
              transport: 'buffered',
              outputFamily: 'json',
            },
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  const execution = seenExecution as {
    reply: {
      composerMode?: {
        chatMode: string
        deepThink: string
        search: string
      }
    }
  }

  assert.equal(response.statusCode, 200)
  assert.equal(execution.reply.composerMode?.chatMode, 'instant')
  assert.equal(execution.reply.composerMode?.deepThink, 'off')
  assert.equal(execution.reply.composerMode?.search, 'on')
})

void test('OpenAI chat completions accepts official web_search_options and reasoning_effort and routes them through the shared composer-mode bridge', async () => {
  const response = createMockResponse()
  let seenExecution: unknown = null

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        web_search_options: {
          search_context_size: 'low',
        },
        reasoning_effort: 'high',
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions({
        executeReply(input) {
          seenExecution = input
          return Promise.resolve({
            result: createBufferedReplyResult(),
            outputMode: {
              stream: false,
              format: 'json',
              jsonShape: 'openai-chat-completions',
              transport: 'buffered',
              outputFamily: 'json',
            },
          })
        },
      }),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  const execution = seenExecution as {
    reply: {
      composerMode?: {
        chatMode: string
        deepThink: string
        search: string
      }
    }
  }

  assert.equal(response.statusCode, 200)
  assert.equal(execution.reply.composerMode?.chatMode, 'instant')
  assert.equal(execution.reply.composerMode?.deepThink, 'on')
  assert.equal(execution.reply.composerMode?.search, 'on')
})

void test('OpenAI chat completions rejects conflicting official search ingress and deepseek_options before execution starts', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        web_search_options: {},
        deepseek_options: {
          search: 'off',
        },
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"invalid_search_control_conflict"/)
})

void test('OpenAI responses persists response handles and reuses previous_response_id for continuation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c20-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const executions: Array<Awaited<Parameters<typeof executeDeepSeekReply>[0]>> = []
    const firstResult = createBufferedReplyResult({
      sessionFile: join(sessionStoreDir, 'session-001.json'),
    })
    await saveStoredSessionFixture({
      prompt: 'hello',
      result: firstResult,
    })

    const firstResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'hello',
          metadata: {
            topic: 'first-turn',
          },
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      firstResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply(input) {
            executions.push(input)
            return Promise.resolve({
              result: firstResult,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const firstPayload = JSON.parse(firstResponse.body) as {
      id: string
      store: boolean
      metadata: Record<string, string>
    }
    const firstHandle = await loadOpenAIHttpResponseHandleRecord(firstPayload.id, {
      sessionStoreDir,
    })

    assert.equal(firstResponse.statusCode, 200)
    assert.ok(firstPayload.id.startsWith('resp_'))
    assert.equal(firstPayload.store, true)
    assert.deepEqual(firstPayload.metadata, {
      topic: 'first-turn',
    })
    assert.equal(executions[0]?.reply.sessionId, undefined)
    assert.equal(firstHandle?.sessionId, 'session-001')
    assert.equal(firstHandle?.sessionFile, firstResult.sessionFile)
    assert.equal(firstHandle?.store, true)
    assert.deepEqual(firstHandle?.metadata, {
      topic: 'first-turn',
    })

    const secondResponse = createMockResponse()
    const firstRun = firstResult.generationRuns[0]!
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'follow up only',
          previous_response_id: firstPayload.id,
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      secondResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply(input) {
            executions.push(input)
            return Promise.resolve({
              result: createBufferedReplyResult({
                entryMode: 'existing-session',
                sessionFile: firstResult.sessionFile,
                generationRuns: [
                  {
                    ...firstRun,
                    context: {
                      ...firstRun.context,
                      runId: 'run-003',
                    },
                  },
                ],
              }),
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const secondPayload = JSON.parse(secondResponse.body) as {
      id: string
      previous_response_id: string | null
    }

    assert.equal(secondResponse.statusCode, 200)
    assert.equal(executions[1]?.reply.sessionId, 'session-001')
    assert.equal(executions[1]?.reply.sessionFile, firstResult.sessionFile)
    assert.equal(executions[1]?.reply.prompt, 'follow up only')
    assert.notEqual(secondPayload.id, firstPayload.id)
    assert.equal(secondPayload.previous_response_id, firstPayload.id)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses rejects unknown previous_response_id fail-closed', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c20-miss-'))
  try {
    const response = createMockResponse()

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'hello',
          previous_response_id: 'resp_missing',
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({
            sessionStoreDir: join(tempDir, 'sessions'),
          }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 400)
    assert.match(response.body, /"code":"invalid_previous_response_id"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses persists store=false receipts, backfills the response object, and rejects later reuse explicitly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c21-store-false-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const firstResult = createBufferedReplyResult({
      sessionId: 'session-store-false',
      sessionFile: join(sessionStoreDir, 'session-store-false.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-store-false',
      generationRuns: [
        {
          ...createBufferedReplyResult().generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-store-false',
          context: {
            ...createBufferedReplyResult().generationRuns[0]!.context,
            runId: 'run-store-false',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-store-false',
            sessionId: 'session-store-false',
          },
        },
      ],
    })
    await saveStoredSessionFixture({
      prompt: 'hello',
      result: firstResult,
    })

    const firstResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'hello',
          store: false,
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      firstResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result: firstResult,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const firstPayload = JSON.parse(firstResponse.body) as {
      id: string
      store: boolean
    }
    const storedHandle = await loadOpenAIHttpResponseHandleRecord(firstPayload.id, {
      sessionStoreDir,
    })

    assert.equal(firstResponse.statusCode, 200)
    assert.equal(firstPayload.store, false)
    assert.equal(storedHandle?.store, false)
    assert.equal(storedHandle?.response?.id, firstPayload.id)
    assert.ok(Array.isArray(storedHandle?.inputItems))

    const secondResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'follow up only',
          previous_response_id: firstPayload.id,
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      secondResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(secondResponse.statusCode, 400)
    assert.match(secondResponse.body, /"code":"store_disabled_previous_response_id"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('HTTP container resolves 405 for templated stored response routes before route logic runs', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'GET',
      url: '/v1/responses/resp_123/cancel',
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 405)
  assert.equal(response.headers['allow'], 'POST')
  assert.match(response.body, /"code":"method_not_allowed"/)
})

void test('OpenAI responses stored route family retrieves persisted response snapshots and input items', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c80-retrieve-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const responseResult = createBufferedReplyResult({
      sessionId: 'session-c80-retrieve',
      sessionFile: join(sessionStoreDir, 'session-c80-retrieve.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-c80-retrieve',
      generationRuns: [
        {
          ...createBufferedReplyResult().generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-c80-retrieve',
          context: {
            ...createBufferedReplyResult().generationRuns[0]!.context,
            runId: 'run-c80-retrieve',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-c80-retrieve',
            sessionId: 'session-c80-retrieve',
          },
        },
      ],
    })
    await saveStoredSessionFixture({
      prompt: 'Summarize the attached brief.',
      result: responseResult,
    })

    const createResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: [
            {
              role: 'system',
              content: 'Answer tersely.',
            },
            {
              role: 'user',
              content: 'Bring the transcript up to date.',
            },
            {
              role: 'assistant',
              content: 'Prior answer.',
            },
            {
              role: 'user',
              content: 'Summarize the attached brief.',
            },
            {
              type: 'input_file',
              filename: 'brief.txt',
              file_data: Buffer.from('brief body', 'utf8').toString('base64'),
            },
          ],
          metadata: {
            topic: 'stored-routes',
          },
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      createResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result: responseResult,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const createdPayload = JSON.parse(createResponse.body) as {
      id: string
      metadata: Record<string, string>
    }
    const storedHandle = await loadOpenAIHttpResponseHandleRecord(createdPayload.id, {
      sessionStoreDir,
    })
    assert.equal(createResponse.statusCode, 200)
    assert.equal(storedHandle?.response?.id, createdPayload.id)
    assert.equal(storedHandle?.inputItems?.length, 5)

    const retrieveResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: `/v1/responses/${createdPayload.id}`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      retrieveResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const retrievedPayload = JSON.parse(retrieveResponse.body) as {
      id: string
      metadata: Record<string, string>
      previous_response_id: string | null
    }
    assert.equal(retrieveResponse.statusCode, 200)
    assert.equal(retrievedPayload.id, createdPayload.id)
    assert.deepEqual(retrievedPayload.metadata, {
      topic: 'stored-routes',
    })
    assert.equal(retrievedPayload.previous_response_id, null)

    const inputItemsResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: `/v1/responses/${createdPayload.id}/input_items?order=asc&limit=5`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      inputItemsResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const inputItemsPayload = JSON.parse(inputItemsResponse.body) as {
      object: string
      first_id: string | null
      last_id: string | null
      has_more: boolean
      data: Array<{
        id: string
        role: string
        content: Array<{
          type: string
          text?: string
          filename?: string
        }>
      }>
    }
    assert.equal(inputItemsResponse.statusCode, 200)
    assert.equal(inputItemsPayload.object, 'list')
    assert.equal(inputItemsPayload.has_more, false)
    assert.equal(inputItemsPayload.data.length, 5)
    assert.equal(inputItemsPayload.first_id, inputItemsPayload.data[0]?.id ?? null)
    assert.equal(inputItemsPayload.last_id, inputItemsPayload.data[4]?.id ?? null)
    assert.equal(inputItemsPayload.data[0]?.role, 'system')
    assert.equal(inputItemsPayload.data[0]?.content[0]?.type, 'input_text')
    assert.equal(inputItemsPayload.data[0]?.content[0]?.text, 'Answer tersely.')
    assert.equal(inputItemsPayload.data[4]?.role, 'user')
    assert.equal(inputItemsPayload.data[4]?.content[0]?.type, 'input_file')
    assert.equal(inputItemsPayload.data[4]?.content[0]?.filename, 'brief.txt')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses stored route family rejects store=false receipts explicitly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c80-store-false-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const result = createBufferedReplyResult({
      sessionId: 'session-c80-store-false',
      sessionFile: join(sessionStoreDir, 'session-c80-store-false.json'),
    })

    const createResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'store disabled receipt',
          store: false,
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      createResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const createdPayload = JSON.parse(createResponse.body) as {
      id: string
    }

    const retrieveResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: `/v1/responses/${createdPayload.id}`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      retrieveResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const deleteResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'DELETE',
        url: `/v1/responses/${createdPayload.id}`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      deleteResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(retrieveResponse.statusCode, 404)
    assert.match(retrieveResponse.body, /"code":"response_not_stored"/)
    assert.equal(deleteResponse.statusCode, 404)
    assert.match(deleteResponse.body, /"code":"response_not_stored"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses delete removes stored response retrieval and continuation surfaces together', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c80-delete-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const result = createBufferedReplyResult({
      sessionId: 'session-c80-delete',
      sessionFile: join(sessionStoreDir, 'session-c80-delete.json'),
    })

    const createResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'delete me later',
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      createResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const createdPayload = JSON.parse(createResponse.body) as {
      id: string
    }

    const deleteResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'DELETE',
        url: `/v1/responses/${createdPayload.id}`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      deleteResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const retrieveResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: `/v1/responses/${createdPayload.id}`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      retrieveResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const continuationResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'continue after delete',
          previous_response_id: createdPayload.id,
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      continuationResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(deleteResponse.statusCode, 200)
    assert.equal(retrieveResponse.statusCode, 404)
    assert.match(retrieveResponse.body, /"code":"invalid_response_id"/)
    assert.equal(continuationResponse.statusCode, 400)
    assert.match(continuationResponse.body, /"code":"invalid_previous_response_id"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses cancel route is explicit and does not fall back to 404', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c80-cancel-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const result = createBufferedReplyResult({
      sessionId: 'session-c80-cancel',
      sessionFile: join(sessionStoreDir, 'session-c80-cancel.json'),
    })

    const createResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'cancel route probe',
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      createResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const createdPayload = JSON.parse(createResponse.body) as {
      id: string
    }

    const cancelResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: `/v1/responses/${createdPayload.id}/cancel`,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      cancelResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(cancelResponse.statusCode, 400)
    assert.match(cancelResponse.body, /"code":"response_not_cancellable"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('HTTP container resolves 405 for templated stored chat completion routes before route logic runs', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/chat/completions/chatcmpl_123/messages',
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 405)
  assert.equal(response.headers['allow'], 'GET')
  assert.match(response.body, /"code":"method_not_allowed"/)
})

void test('OpenAI chat completions stored route family lists, retrieves, updates, deletes, and exposes create-side request messages', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c81-chat-stored-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await saveChatCompletionFixture({
      completionId: 'chatcmpl_alpha',
      model: 'deepseek-chat-browser',
      store: true,
      sessionStoreDir,
      requestClassification: 'new-turn',
      messages: [
        {
          role: 'user',
          content: 'alpha request',
        },
      ],
      metadata: {
        topic: 'alpha',
      },
      assistantContent: 'alpha reply',
      created: 1_744_622_801,
    })
    await saveChatCompletionFixture({
      completionId: 'chatcmpl_beta',
      model: 'deepseek-expert-browser',
      store: true,
      sessionStoreDir,
      requestClassification: 'history-bootstrap',
      messages: [
        {
          role: 'developer',
          content: 'Answer tersely.',
        },
        {
          role: 'user',
          content: 'beta request',
        },
      ],
      metadata: {
        topic: 'beta',
      },
      assistantContent: 'beta reply',
      created: 1_744_622_802,
    })

    const listResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions?order=desc&limit=1',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      listResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const listedPageOne = JSON.parse(listResponse.body) as {
      object: string
      first_id: string | null
      last_id: string | null
      has_more: boolean
      data: Array<{
        id: string
        metadata: Record<string, string>
      }>
    }
    assert.equal(listResponse.statusCode, 200)
    assert.equal(listedPageOne.object, 'list')
    assert.equal(listedPageOne.data.length, 1)
    assert.equal(listedPageOne.data[0]?.id, 'chatcmpl_beta')
    assert.deepEqual(listedPageOne.data[0]?.metadata, {
      topic: 'beta',
    })
    assert.equal(listedPageOne.first_id, 'chatcmpl_beta')
    assert.equal(listedPageOne.last_id, 'chatcmpl_beta')
    assert.equal(listedPageOne.has_more, true)

    const filteredListResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions?model=deepseek-expert-browser&metadata[topic]=beta',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      filteredListResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const filteredListPayload = JSON.parse(filteredListResponse.body) as {
      data: Array<{
        id: string
      }>
      has_more: boolean
    }
    assert.equal(filteredListResponse.statusCode, 200)
    assert.deepEqual(
      filteredListPayload.data.map(item => item.id),
      ['chatcmpl_beta'],
    )
    assert.equal(filteredListPayload.has_more, false)

    const secondPageResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions?order=desc&after=chatcmpl_beta',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      secondPageResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const secondPagePayload = JSON.parse(secondPageResponse.body) as {
      data: Array<{
        id: string
      }>
    }
    assert.equal(secondPageResponse.statusCode, 200)
    assert.deepEqual(
      secondPagePayload.data.map(item => item.id),
      ['chatcmpl_alpha'],
    )

    const retrieveResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions/chatcmpl_beta',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      retrieveResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const retrievedPayload = JSON.parse(retrieveResponse.body) as {
      id: string
      metadata: Record<string, string>
      choices: Array<{
        message: {
          content: string | null
        }
      }>
    }
    assert.equal(retrieveResponse.statusCode, 200)
    assert.equal(retrievedPayload.id, 'chatcmpl_beta')
    assert.deepEqual(retrievedPayload.metadata, {
      topic: 'beta',
    })
    assert.equal(retrievedPayload.choices[0]?.message.content, 'beta reply')

    const messagesResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions/chatcmpl_beta/messages?after=chatcmpl_beta-0',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      messagesResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const messagesPayload = JSON.parse(messagesResponse.body) as {
      object: string
      data: Array<{
        id: string
        role: string
        content: string
        name: null
        content_parts: null
      }>
    }
    assert.equal(messagesResponse.statusCode, 200)
    assert.equal(messagesPayload.object, 'list')
    assert.deepEqual(messagesPayload.data, [
      {
        id: 'chatcmpl_beta-1',
        role: 'user',
        content: 'beta request',
        name: null,
        content_parts: null,
      },
    ])

    const updateResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/chat/completions/chatcmpl_beta',
        body: JSON.stringify({
          metadata: {
            topic: 'beta',
            ticket: '81',
          },
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      updateResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const updatedPayload = JSON.parse(updateResponse.body) as {
      metadata: Record<string, string>
    }
    const updatedRecord = await loadOpenAIHttpChatCompletionRecord('chatcmpl_beta', {
      sessionStoreDir,
    })
    assert.equal(updateResponse.statusCode, 200)
    assert.deepEqual(updatedPayload.metadata, {
      topic: 'beta',
      ticket: '81',
    })
    assert.deepEqual(updatedRecord?.metadata, {
      topic: 'beta',
      ticket: '81',
    })
    assert.deepEqual(updatedRecord?.completion.metadata, {
      topic: 'beta',
      ticket: '81',
    })

    const deleteResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'DELETE',
        url: '/v1/chat/completions/chatcmpl_beta',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      deleteResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    const deletedPayload = JSON.parse(deleteResponse.body) as {
      id: string
      object: string
      deleted: boolean
    }
    assert.equal(deleteResponse.statusCode, 200)
    assert.deepEqual(deletedPayload, {
      id: 'chatcmpl_beta',
      object: 'chat.completion.deleted',
      deleted: true,
    })

    const missingResponse = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions/chatcmpl_beta',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      missingResponse as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(missingResponse.statusCode, 404)
    assert.match(missingResponse.body, /"code":"invalid_completion_id"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI chat completions stored routes reject non-stored registry entries explicitly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c81-chat-store-false-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await saveChatCompletionFixture({
      completionId: 'chatcmpl_hidden',
      model: 'deepseek-chat-browser',
      store: false,
      sessionStoreDir,
      requestClassification: 'new-turn',
      messages: [
        {
          role: 'user',
          content: 'hidden request',
        },
      ],
      metadata: {
        topic: 'hidden',
      },
      assistantContent: 'hidden reply',
      created: 1_744_622_803,
    })

    const response = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'GET',
        url: '/v1/chat/completions/chatcmpl_hidden',
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 404)
    assert.match(response.body, /"code":"completion_not_stored"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI auxiliary route inventory returns explicit unsupported errors instead of framework 404', async () => {
  const cases = [
    {
      method: 'POST',
      url: '/v1/conversations',
      body: JSON.stringify({
        metadata: {
          topic: 'demo',
        },
      }),
      code: 'unsupported_conversation',
    },
    {
      method: 'GET',
      url: '/v1/conversations/conv_123/items?limit=10',
      code: 'unsupported_conversation',
    },
    {
      method: 'DELETE',
      url: '/v1/conversations/conv_123/items/msg_123',
      code: 'unsupported_conversation',
    },
    {
      method: 'POST',
      url: '/v1/responses/input_tokens',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: 'count this',
      }),
      code: 'unsupported_response_input_tokens',
    },
    {
      method: 'POST',
      url: '/v1/responses/compact',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: 'compact this',
      }),
      code: 'unsupported_response_compact',
    },
  ] as const

  for (const testCase of cases) {
    const response = createMockResponse()
    const requestOverrides = 'body' in testCase ? { body: testCase.body } : {}
    await handleHttpRequest(
      createMockRequest({
        method: testCase.method,
        url: testCase.url,
        ...requestOverrides,
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 400)
    assert.match(response.body, new RegExp(`"code":"${testCase.code}"`, 'u'))
    assert.doesNotMatch(response.body, /"code":"route_not_found"/u)
  }
})

void test('OpenAI auxiliary unsupported routes still participate in method_not_allowed resolution', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'GET',
      url: '/v1/responses/input_tokens',
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 405)
  assert.equal(response.headers['allow'], 'POST')
  assert.match(response.body, /"code":"method_not_allowed"/)
})

void test('OpenAI responses rejects previous_response_id model mismatches explicitly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c21-model-mismatch-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const result = createBufferedReplyResult({
      sessionId: 'session-model-mismatch',
      sessionFile: join(sessionStoreDir, 'session-model-mismatch.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-model-mismatch',
      generationRuns: [
        {
          ...createBufferedReplyResult().generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-model-mismatch',
          context: {
            ...createBufferedReplyResult().generationRuns[0]!.context,
            runId: 'run-model-mismatch',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-model-mismatch',
            sessionId: 'session-model-mismatch',
          },
        },
      ],
    })
    await saveStoredSessionFixture({
      prompt: 'hello',
      result,
    })
    await saveResponseHandleFixture({
      responseId: 'resp_model_mismatch',
      model: 'deepseek-chat-browser',
      store: true,
      sessionStoreDir,
      result,
      requestClassification: 'new-turn',
    })

    const response = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-expert-browser',
          input: 'follow up only',
          previous_response_id: 'resp_model_mismatch',
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 400)
    assert.match(response.body, /"code":"invalid_previous_response_id_model_mismatch"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses rejects previous_response_id session mismatches explicitly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c21-session-mismatch-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    await saveResponseHandleFixture({
      responseId: 'resp_session_mismatch',
      model: 'deepseek-chat-browser',
      store: true,
      sessionStoreDir,
      result: createBufferedReplyResult({
        sessionId: 'session-session-mismatch',
        sessionFile: join(sessionStoreDir, 'missing-session.json'),
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-session-mismatch',
        generationRuns: [
          {
            ...createBufferedReplyResult().generationRuns[0]!,
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-session-mismatch',
            context: {
              ...createBufferedReplyResult().generationRuns[0]!.context,
              runId: 'run-session-mismatch',
              routeUrl: 'https://chat.deepseek.com/a/chat/s/session-session-mismatch',
              sessionId: 'session-session-mismatch',
            },
          },
        ],
      }),
      requestClassification: 'new-turn',
    })

    const response = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'follow up only',
          previous_response_id: 'resp_session_mismatch',
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 400)
    assert.match(response.body, /"code":"invalid_previous_response_id_session_mismatch"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses classifies continuation restore failures without degrading into a generic runtime error', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-c21-restore-failed-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const result = createBufferedReplyResult({
      sessionId: 'session-restore',
      sessionFile: join(sessionStoreDir, 'session-restore.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-restore',
      generationRuns: [
        {
          ...createBufferedReplyResult().generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-restore',
          context: {
            ...createBufferedReplyResult().generationRuns[0]!.context,
            runId: 'run-restore',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-restore',
            sessionId: 'session-restore',
          },
        },
      ],
    })
    await saveStoredSessionFixture({
      prompt: 'hello',
      result,
    })
    await saveResponseHandleFixture({
      responseId: 'resp_restore',
      model: 'deepseek-chat-browser',
      store: true,
      sessionStoreDir,
      result,
      requestClassification: 'new-turn',
    })

    const response = createMockResponse()
    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: 'follow up only',
          previous_response_id: 'resp_restore',
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.reject(
              new Error(
                'DeepSeek route mismatch: expected session session-restore, but browser is on session-other.',
              ),
            )
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 500)
    assert.match(response.body, /"type":"api_error"/)
    assert.match(response.body, /"code":"previous_response_id_restore_failed"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses stages parsed input_file items, preserves toggle requests, and cleans them up after execute', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-route-stage-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()
    let seenBootstrapArtifactPath: string | null = null
    let seenBootstrapArtifactContent: string | null = null
    let seenRequestFilePath: string | null = null
    let seenRequestFileContent: string | null = null
    let seenPrompt: string | null = null
    let seenComposerMode: unknown = null
    const baseResult = createBufferedReplyResult()
    const result = createBufferedReplyResult({
      sessionId: 'session-responses-history-bootstrap',
      sessionFile: join(sessionStoreDir, 'session-responses-history-bootstrap.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-responses-history-bootstrap',
      generationRuns: [
        {
          ...baseResult.generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-responses-history-bootstrap',
          context: {
            ...baseResult.generationRuns[0]!.context,
            runId: 'run-responses-history-bootstrap',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-responses-history-bootstrap',
            sessionId: 'session-responses-history-bootstrap',
          },
        },
      ],
    })

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: [
            {
              role: 'assistant',
              content: 'Earlier context.',
            },
            {
              role: 'user',
              content: 'Latest turn.',
            },
            {
              type: 'input_file',
              filename: 'brief.txt',
              file_data: Buffer.from('hello from stage', 'utf8').toString('base64'),
            },
          ],
          deepseek_options: {
            search: 'on',
            deep_think: 'on',
          },
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          async executeReply(input) {
            seenPrompt = input.reply.prompt
            seenComposerMode = input.reply.composerMode
            seenBootstrapArtifactPath = input.reply.files?.[0] ?? null
            seenBootstrapArtifactContent =
              seenBootstrapArtifactPath === null
                ? null
                : await readFile(seenBootstrapArtifactPath, 'utf8')
            seenRequestFilePath = input.reply.files?.[1] ?? null
            seenRequestFileContent =
              seenRequestFilePath === null
                ? null
                : await readFile(seenRequestFilePath, 'utf8')
            await saveStoredSessionFixture({
              prompt: input.reply.prompt,
              result,
            })
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 200)
    assert.equal(seenPrompt, 'Latest turn.')
    assert.deepEqual(seenComposerMode, {
      chatMode: 'instant',
      deepThink: 'on',
      search: 'on',
    })
    assert.match(seenBootstrapArtifactContent ?? '', /Assistant:\nEarlier context\./u)
    assert.equal(seenRequestFileContent, 'hello from stage')
    assert.match(seenBootstrapArtifactPath ?? '', /openai-http\/staged-input-files\//u)
    assert.match(seenRequestFilePath ?? '', /openai-http\/staged-input-files\//u)

    const storedSession = await loadStoredSessionFromFile(result.sessionFile)
    assert.equal(storedSession.metadata?.openaiHistoryBootstrap?.endpoint, '/v1/responses')
    assert.equal(storedSession.metadata?.openaiHistoryBootstrap?.historyItemCount, 1)
    assert.equal(storedSession.metadata?.openaiHistoryBootstrap?.latestTurnFileCount, 1)

    await assert.rejects(
      stat(seenBootstrapArtifactPath ?? '/tmp/missing'),
      /ENOENT/u,
    )
    await assert.rejects(
      stat(seenRequestFilePath ?? '/tmp/missing'),
      /ENOENT/u,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses accepts official nested message.content input_text/input_file content and stages files through the shared route path', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-route-official-input-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()
    let seenBootstrapArtifactPath: string | null = null
    let seenBootstrapArtifactContent: string | null = null
    let seenRequestFilePath: string | null = null
    let seenRequestFileContent: string | null = null
    let seenPrompt: string | null = null
    const baseResult = createBufferedReplyResult()
    const result = createBufferedReplyResult({
      sessionId: 'session-official-nested-input',
      sessionFile: join(sessionStoreDir, 'session-official-nested-input.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-official-nested-input',
      generationRuns: [
        {
          ...baseResult.generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-official-nested-input',
          context: {
            ...baseResult.generationRuns[0]!.context,
            runId: 'run-official-nested-input',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-official-nested-input',
            sessionId: 'session-official-nested-input',
          },
        },
      ],
    })

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: [
            {
              type: 'message',
              role: 'developer',
              content: [
                {
                  type: 'input_text',
                  text: 'Answer tersely.',
                },
              ],
            },
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Read ',
                },
                {
                  type: 'input_file',
                  filename: 'brief.txt',
                  file_data: Buffer.from('hello from official nested input', 'utf8').toString('base64'),
                },
                {
                  type: 'input_text',
                  text: 'this file.',
                },
              ],
            },
          ],
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          async executeReply(input) {
            seenPrompt = input.reply.prompt
            seenBootstrapArtifactPath = input.reply.files?.[0] ?? null
            seenBootstrapArtifactContent =
              seenBootstrapArtifactPath === null
                ? null
                : await readFile(seenBootstrapArtifactPath, 'utf8')
            seenRequestFilePath = input.reply.files?.[1] ?? null
            seenRequestFileContent =
              seenRequestFilePath === null
                ? null
                : await readFile(seenRequestFilePath, 'utf8')
            await saveStoredSessionFixture({
              prompt: input.reply.prompt,
              result,
            })
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 200)
    assert.equal(seenPrompt, 'Read this file.')
    assert.match(seenBootstrapArtifactContent ?? '', /Developer:\nAnswer tersely\./u)
    assert.equal(seenRequestFileContent, 'hello from official nested input')
    assert.equal(seenBootstrapArtifactPath === null, false)
    assert.equal(seenRequestFilePath === null, false)
    if (seenBootstrapArtifactPath !== null) {
      const fileStats = await stat(seenBootstrapArtifactPath).catch(() => null)
      assert.equal(fileStats, null)
    }
    if (seenRequestFilePath !== null) {
      const fileStats = await stat(seenRequestFilePath).catch(() => null)
      assert.equal(fileStats, null)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses preserves official nested multi-file order after bootstrap artifact staging and cleans every staged file', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-route-official-multi-file-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()
    let seenFilePaths: string[] = []
    let seenFileContents: string[] = []
    let seenPrompt: string | null = null
    const baseResult = createBufferedReplyResult()
    const result = createBufferedReplyResult({
      sessionId: 'session-official-multi-file',
      sessionFile: join(sessionStoreDir, 'session-official-multi-file.json'),
      finalUrl: 'https://chat.deepseek.com/a/chat/s/session-official-multi-file',
      generationRuns: [
        {
          ...baseResult.generationRuns[0]!,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-official-multi-file',
          context: {
            ...baseResult.generationRuns[0]!.context,
            runId: 'run-official-multi-file',
            routeUrl: 'https://chat.deepseek.com/a/chat/s/session-official-multi-file',
            sessionId: 'session-official-multi-file',
          },
        },
      ],
    })

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: [
            {
              type: 'message',
              role: 'developer',
              content: [
                {
                  type: 'input_text',
                  text: 'Use the files in order.',
                },
              ],
            },
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Compare ',
                },
                {
                  type: 'input_file',
                  filename: 'alpha.txt',
                  file_data: Buffer.from('alpha-content', 'utf8').toString('base64'),
                },
                {
                  type: 'input_text',
                  text: 'with ',
                },
                {
                  type: 'input_file',
                  filename: 'beta.txt',
                  file_data: Buffer.from('beta-content', 'utf8').toString('base64'),
                },
                {
                  type: 'input_text',
                  text: 'carefully.',
                },
              ],
            },
          ],
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          async executeReply(input) {
            seenPrompt = input.reply.prompt
            seenFilePaths = input.reply.files ?? []
            seenFileContents = await Promise.all(
              seenFilePaths.map(filePath => readFile(filePath, 'utf8')),
            )
            await saveStoredSessionFixture({
              prompt: input.reply.prompt,
              result,
            })
            return Promise.resolve({
              result,
              outputMode: {
                stream: false,
                format: 'json',
                jsonShape: 'openai-responses',
                transport: 'buffered',
                outputFamily: 'json',
              },
            })
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 200)
    assert.equal(seenPrompt, 'Compare with carefully.')
    assert.equal(seenFilePaths.length, 3)
    assert.match(seenFileContents[0] ?? '', /Developer:\nUse the files in order\./u)
    assert.deepEqual(seenFileContents.slice(1), ['alpha-content', 'beta-content'])

    for (const filePath of seenFilePaths) {
      const fileStats = await stat(filePath).catch(() => null)
      assert.equal(fileStats, null)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses rejects history bootstrap requests that place input_file inside historical context', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: [
          {
            role: 'assistant',
            content: 'Earlier context.',
          },
          {
            type: 'input_file',
            filename: 'brief.txt',
            file_data: Buffer.from('hello from stage', 'utf8').toString('base64'),
          },
          {
            role: 'user',
            content: 'Latest turn.',
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
      openaiRoutes: createOpenAIRouteOptions(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"invalid_input_endpoint_incompatible"/)
})

void test('OpenAI responses maps missing settled file input onto a stable invalid_request_error contract', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-route-file-input-unavailable-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()
    let seenFilePath: string | null = null

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-expert-browser',
          input: [
            {
              role: 'user',
              content: 'Upload this under expert mode.',
            },
            {
              type: 'input_file',
              filename: 'brief.txt',
              file_data: Buffer.from('hello from blocked stage', 'utf8').toString('base64'),
            },
          ],
          deepseek_options: {
            search: 'on',
            deep_think: 'on',
          },
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply(input) {
            seenFilePath = input.reply.files?.[0] ?? null
            return Promise.reject(
              createDeepSeekComposerFileInputUnavailableError({
                requestedChatMode: 'expert',
                resolvedChatMode: 'expert',
                requestedFileCount: input.reply.files?.length ?? 0,
                pageUrl: 'https://chat.deepseek.com/',
              }),
            )
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 400)
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
    assert.match(response.body, /"type":"invalid_request_error"/)
    assert.match(response.body, /"code":"unsupported_requested_file_input"/)
    await assert.rejects(
      stat(seenFilePath ?? '/tmp/missing'),
      /ENOENT/u,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses maps structured non-retryable upload failures onto a stable invalid_request_error contract', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-route-file-upload-rejected-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: [
            {
              role: 'user',
              content: 'Process this file.',
            },
            {
              type: 'input_file',
              filename: 'alpha.txt',
              file_data: Buffer.from('alpha', 'utf8').toString('base64'),
            },
          ],
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.reject(
              createDeepSeekFileUploadError(
                createFileUploadFailureBatch({
                  problemCode: 'fetch_files_failed',
                  message: 'fetch_files settled with status FAILED for alpha.txt.',
                  fileName: 'alpha.txt',
                  fileId: 'file-1',
                  uploaded: true,
                  fetchedStatus: 'FAILED',
                  settled: true,
                }),
              ),
            )
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 400)
    assert.match(response.body, /"type":"invalid_request_error"/)
    assert.match(response.body, /"code":"input_file_processing_failed"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses maps retryable upload settlement failures onto a stable 500 contract', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-route-file-upload-timeout-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const response = createMockResponse()

    await handleHttpRequest(
      createMockRequest({
        method: 'POST',
        url: '/v1/responses',
        body: JSON.stringify({
          model: 'deepseek-chat-browser',
          input: [
            {
              role: 'user',
              content: 'Wait for this file to settle.',
            },
            {
              type: 'input_file',
              filename: 'alpha.txt',
              file_data: Buffer.from('alpha', 'utf8').toString('base64'),
            },
          ],
        }),
        headers: {
          authorization: 'Bearer local-dev-key',
        },
      }) as never,
      response as never,
      buildHttpServiceRoutes({
        surfaces: ['openai'],
        rpcRoute: createRpcRoute(),
        openaiRoutes: createOpenAIRouteOptions({
          environment: createOpenAIEnvironment({ sessionStoreDir }),
          executeReply() {
            return Promise.reject(
              createDeepSeekFileUploadError(
                createFileUploadFailureBatch({
                  problemCode: 'fetch_files_processing_timeout',
                  message: 'fetch_files last observed status was PARSING before timeout.',
                  fileName: 'alpha.txt',
                  fileId: 'file-1',
                  uploaded: true,
                  fetchedStatus: 'PARSING',
                  settled: false,
                }),
              ),
            )
          },
        }),
      }),
      {
        apiKey: 'local-dev-key',
      },
    )

    assert.equal(response.statusCode, 500)
    assert.match(response.body, /"type":"api_error"/)
    assert.match(response.body, /"code":"input_file_settlement_timeout"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI responses rejects non-text input items', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: JSON.stringify({
        model: 'deepseek-chat-browser',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_image',
                image_url: 'https://example.com/image.png',
              },
            ],
          },
        ],
      }),
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"unsupported_input_0_content"/)
})

void test('OpenAI routes reject malformed JSON before protocol handling', async () => {
  const response = createMockResponse()

  await handleHttpRequest(
    createMockRequest({
      method: 'POST',
      url: '/v1/responses',
      body: '{"model":"deepseek-chat-browser"',
      headers: {
        authorization: 'Bearer local-dev-key',
      },
    }) as never,
    response as never,
    buildHttpServiceRoutes({
      surfaces: ['openai'],
      rpcRoute: createRpcRoute(),
    }),
    {
      apiKey: 'local-dev-key',
    },
  )

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /"code":"invalid_json"/)
})

interface MockResponse {
  body: string
  ended: boolean
  flushCount: number
  headers: Record<string, string>
  headersSent: boolean
  statusCode: number
  writableEnded: boolean
  writes: string[]
  end: (chunk?: string) => void
  flushHeaders: () => void
  getHeader: (name: string) => string | undefined
  setHeader: (name: string, value: string) => void
  write: (chunk: string) => void
}

function createRpcRoute(): HttpRouteDefinition {
  return buildJsonRpcHttpRoute({
    async streamPayload() {
      await Promise.resolve()
    },
  })
}

function createOpenAIRouteOptions(input: {
  environment?: OpenAIHttpExecutionEnvironment | undefined
  executeReply?: typeof executeDeepSeekReply | undefined
} = {}) {
  return {
    environment: input.environment ?? createOpenAIEnvironment(),
    ...(input.executeReply ? { executeReply: input.executeReply } : {}),
  }
}

function createOpenAIEnvironment(
  overrides: Partial<OpenAIHttpExecutionEnvironment> = {},
): OpenAIHttpExecutionEnvironment {
  return {
    managedChromeOptions: {
      cdpUrl: 'http://127.0.0.1:9222',
      timeoutMs: 30_000,
      cloneChromeProfile: false,
      headless: false,
      keepTempChromeProfile: false,
    },
    waitUntil: 'domcontentloaded',
    url: 'https://chat.deepseek.com/',
    sessionStoreDir: '.deepseek-cdp-cli/sessions',
    ...overrides,
  }
}

function createBufferedReplyResult(
  overrides: Partial<DeepSeekReplyResult> = {},
): DeepSeekReplyResult {
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

  return {
    entryMode: 'new-session',
    streamRequested: false,
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    sessionFile: '/tmp/session-001.json',
    sessionCreate: null,
    completionRequestObserved: true,
    generationObservations: [],
    generationRuns: [
      {
        endpoint: '/api/v0/chat/completion' as const,
        transport: 'sse' as const,
        routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
        context,
        finalized,
        eventCount: 2,
        unknownObservationCount: 0,
        unknownObservationLabels: [],
      },
    ],
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
    assistantTextSource: 'generation-stream',
    transcriptRecovery: null,
    session: {
      id: 'session-001',
      agentId: 'chat',
      title: 'Session 001',
      createdAt: '2026-04-05T00:00:00.000Z',
      branches: [],
    },
    output: {
      mode: 'buffered',
      canonicalEvents: [],
      canonicalRuns: [],
      finalizedAssistantText: 'Hello from DeepSeek',
    },
    ...overrides,
  }
}

function createStreamingReplyResult(
  overrides: Partial<DeepSeekReplyResult> = {},
): DeepSeekReplyResult {
  const buffered = createBufferedReplyResult()
  const context = buffered.generationRuns[0]!.context
  const finalized = buffered.generationRuns[0]!.finalized
  const textDeltaEvent = {
    kind: 'text.delta' as const,
    sequence: 1,
    occurredAt: '2026-04-05T00:00:01.000Z',
    context,
    delta: 'Hello from DeepSeek',
    accumulatedText: 'Hello from DeepSeek',
  }
  const completedEvent = {
    kind: 'completed' as const,
    sequence: 2,
    occurredAt: finalized.completedAt,
    context,
    result: finalized,
  }

  return {
    ...buffered,
    streamRequested: true,
    output: {
      mode: 'stream',
      canonicalEvents: [textDeltaEvent, completedEvent],
      canonicalRuns: [
        {
          endpoint: '/api/v0/chat/completion' as const,
          transport: 'sse' as const,
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
          context,
          events: [textDeltaEvent, completedEvent],
          finalized,
          unknownObservations: [],
          unknownObservationCount: 0,
          unknownObservationLabels: [],
        },
      ],
      finalizedAssistantText: 'Hello from DeepSeek',
    },
    ...overrides,
  }
}

function createStreamingExecutionOutputMode(
  jsonShape: 'openai-chat-completions' | 'openai-responses' = 'openai-chat-completions',
) {
  return {
    stream: true,
    format: 'stream-json' as const,
    jsonShape,
    transport: 'streaming' as const,
    outputFamily: 'json' as const,
  }
}

function createAttemptStartedEvent(
  attemptNumber: number,
  jsonShape: 'openai-chat-completions' | 'openai-responses' = 'openai-chat-completions',
): DeepSeekReplyLiveEvent {
  return {
    kind: 'attempt.started',
    attemptNumber,
    outputMode: createStreamingExecutionOutputMode(jsonShape),
  }
}

function createStreamingTextDeltaEvent(input: {
  attemptNumber: number
  delta: string
  jsonShape?: 'openai-chat-completions' | 'openai-responses'
}): DeepSeekReplyLiveEvent {
  const streamResult = createStreamingReplyResult()
  const context =
    streamResult.output.mode === 'stream'
      ? streamResult.output.canonicalRuns[0]!.context
      : createBufferedReplyResult().generationRuns[0]!.context

  return {
    kind: 'generation.event',
    attemptNumber: input.attemptNumber,
    outputMode: createStreamingExecutionOutputMode(input.jsonShape),
    source: 'live',
    event: {
      kind: 'text.delta',
      sequence: 1,
      occurredAt: '2026-04-05T00:00:01.000Z',
      context,
      delta: input.delta,
      accumulatedText: input.delta,
    },
  }
}

function createStreamingCompletedEvent(input: {
  attemptNumber: number
  result: DeepSeekReplyResult
  jsonShape?: 'openai-chat-completions' | 'openai-responses'
}): DeepSeekReplyLiveEvent {
  if (input.result.output.mode !== 'stream') {
    throw new Error('Streaming completed event requires a streaming reply result.')
  }

  return {
    kind: 'generation.event',
    attemptNumber: input.attemptNumber,
    outputMode: createStreamingExecutionOutputMode(input.jsonShape),
    source: 'finalize',
    event: input.result.output.canonicalRuns[0]!.events[1]!,
  }
}

function parseSseFrames(body: string): Array<{
  event: string | null
  data: string
}> {
  return body
    .split('\n\n')
    .filter(frame => frame.trim())
    .map(frame => {
      const lines = frame.split('\n')
      const event =
        lines.find(line => line.startsWith('event: '))?.slice('event: '.length) ?? null
      const data = lines.find(line => line.startsWith('data: '))?.slice('data: '.length) ?? ''

      return {
        event,
        data,
      }
    })
}

async function saveStoredSessionFixture(input: {
  prompt: string
  result: DeepSeekReplyResult
}): Promise<void> {
  const { sessionFile, budget, ...firstMessageResult } = input.result
  void budget
  await saveStoredSessionToFile(
    sessionFile,
    createStoredSessionFromFirstMessage({
      prompt: input.prompt,
      result: firstMessageResult,
    }),
  )
}

async function saveResponseHandleFixture(input: {
  responseId: string
  model: 'deepseek-chat-browser' | 'deepseek-expert-browser'
  store: boolean
  sessionStoreDir: string
  result: DeepSeekReplyResult
  requestClassification: 'new-turn' | 'history-bootstrap' | 'session-continuation'
}): Promise<void> {
  await saveOpenAIHttpResponseHandleRecord(
    createOpenAIHttpResponseHandleRecordFromReply({
      responseId: input.responseId,
      model: input.model,
      store: input.store,
      requestClassification: input.requestClassification,
      result: input.result,
    }),
    {
      sessionStoreDir: input.sessionStoreDir,
    },
  )
}

async function saveChatCompletionFixture(input: {
  completionId: string
  model: 'deepseek-chat-browser' | 'deepseek-expert-browser'
  store: boolean
  sessionStoreDir: string
  requestClassification: 'new-turn' | 'history-bootstrap'
  messages: Array<{
    role: 'assistant' | 'developer' | 'system' | 'user'
    content: string
  }>
  metadata?: Record<string, string> | undefined
  assistantContent: string
  created: number
  result?: DeepSeekReplyResult | undefined
}): Promise<void> {
  const result =
    input.result ??
    createBufferedReplyResult({
      sessionId: `${input.completionId}-session`,
      sessionFile: join(input.sessionStoreDir, `${input.completionId}-session.json`),
    })

  await saveOpenAIHttpChatCompletionRecord(
    createOpenAIHttpChatCompletionRecordFromReply({
      model: input.model,
      store: input.store,
      metadata: input.metadata ?? {},
      requestClassification: input.requestClassification,
      messages: input.messages,
      completion: {
        id: input.completionId,
        object: 'chat.completion',
        created: input.created,
        model: input.model,
        metadata: input.metadata ?? {},
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: input.assistantContent,
              refusal: null,
              annotations: [],
            },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
      },
      result,
    }),
    {
      sessionStoreDir: input.sessionStoreDir,
    },
  )
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function createMockResponse(): MockResponse {
  return {
    body: '',
    ended: false,
    flushCount: 0,
    headers: {},
    headersSent: false,
    statusCode: 200,
    writableEnded: false,
    writes: [],
    end(chunk) {
      if (chunk) {
        this.body += chunk
        this.writes.push(chunk)
      }
      this.ended = true
      this.writableEnded = true
      this.headersSent = true
    },
    flushHeaders() {
      this.flushCount += 1
      this.headersSent = true
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()]
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    write(chunk) {
      this.body += chunk
      this.writes.push(chunk)
      this.headersSent = true
    },
  }
}

function createMockRequest(input: {
  method: string
  url: string
  body?: string | undefined
  headers?: Record<string, string> | undefined
}): AsyncIterable<Uint8Array> & {
  headers: Record<string, string>
  method: string
  url: string
} {
  return {
    headers: input.headers ?? {},
    method: input.method,
    url: input.url,
    async *[Symbol.asyncIterator]() {
      await Promise.resolve()
      if (input.body !== undefined) {
        yield Buffer.from(input.body)
      }
    },
  }
}

function createFileUploadFailureBatch(input: {
  problemCode:
    | 'fetch_files_failed'
    | 'fetch_files_processing_timeout'
  message: string
  fileName: string
  fileId: string
  uploaded: boolean
  fetchedStatus: string
  settled: boolean
}) {
  return {
    fileInput: {
      found: true,
      selector: 'input[type="file"]',
      accept: '.txt',
      acceptedExtensions: ['.txt'],
      multiple: true,
      hidden: true,
    },
    requestedPaths: [`/tmp/${input.fileName}`],
    acceptedPaths: [`/tmp/${input.fileName}`],
    problems: [],
    files: [
      {
        path: `/tmp/${input.fileName}`,
        fileName: input.fileName,
        extension: '.txt',
        sizeBytes: 11,
        acceptedByPreflight: true,
        uploaded: input.uploaded,
        settled: input.settled,
        mounted: false,
        fileId: input.fileId,
        serverStatus: input.fetchedStatus,
        previewable: false,
        tokenUsage: null,
        previewUrl: null,
        errorCode: null,
        errorMessage: null,
        upload: null,
        fetched: {
          id: input.fileId,
          status: input.fetchedStatus,
          fileName: input.fileName,
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
            code: input.problemCode,
            message: input.message,
            path: `/tmp/${input.fileName}`,
            fileName: input.fileName,
          },
        ],
      },
    ],
    fetches: [],
    settled: input.settled,
    blockingIssues: true,
  }
}
