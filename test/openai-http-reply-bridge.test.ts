import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeOpenAIHttpReplyBridge,
  isOpenAIHttpReplyBridgeError,
  prepareOpenAIChatCompletionsReplyExecution,
  prepareOpenAIHttpReplyExecution,
  prepareOpenAIResponsesReplyExecution,
  resolveOpenAIHttpComposerMode,
  resolveOpenAIHttpExecutionFailure,
} from '../src/application/services/openaiHttpReplyBridge.js'
import {
  createDeepSeekComposerFileInputUnavailableError,
  createDeepSeekComposerToggleSettleError,
  createDeepSeekComposerToggleUnavailableError,
} from '../src/shared/errors/deepSeekComposerModeError.js'
import { createDeepSeekFileUploadError } from '../src/shared/errors/deepSeekFileUploadError.js'
import type {
  OpenAIChatCompletionsSubsetRequest,
  OpenAIHttpExecutionEnvironment,
  OpenAIHttpStagedInputFile,
  OpenAIResponsesSubsetRequest,
} from '../src/types/openai-http-service.types.js'

void test('OpenAI HTTP composer mode mapping freezes canonical aliases onto deterministic DeepSeek defaults', () => {
  assert.deepEqual(resolveOpenAIHttpComposerMode('deepseek-chat-browser'), {
    chatMode: 'instant',
    deepThink: 'off',
    search: 'off',
  })
  assert.deepEqual(resolveOpenAIHttpComposerMode('deepseek-expert-browser'), {
    chatMode: 'expert',
    deepThink: 'off',
    search: 'off',
  })
})

void test('OpenAI HTTP composer mode mapping lets deepseek_options override alias defaults without inheriting page state', () => {
  assert.deepEqual(
    resolveOpenAIHttpComposerMode('deepseek-chat-browser', {
      search: 'on',
    }),
    {
      chatMode: 'instant',
      deepThink: 'off',
      search: 'on',
    },
  )
  assert.deepEqual(
    resolveOpenAIHttpComposerMode('deepseek-expert-browser', {
      deepThink: 'on',
      search: 'off',
    }),
    {
      chatMode: 'expert',
      deepThink: 'on',
      search: 'off',
    },
  )
})

void test('chat completions bridge maps single-user prompts onto the shared reply execution contract', () => {
  const prepared = prepareOpenAIChatCompletionsReplyExecution({
    requestId: 'req-chat-1',
    request: {
      endpoint: '/v1/chat/completions',
      model: 'deepseek-chat-browser',
      messages: [
        {
          role: 'user',
          content: 'Summarize this page.',
        },
      ],
      stream: false,
      streamOptions: null,
      n: 1,
      store: null,
      metadata: null,
      deepseekOptions: {
        search: 'on',
      },
      requestClassification: 'new-turn',
      historyBootstrap: null,
    },
    environment: createEnvironment(),
  })

  assert.equal(prepared.meta.prompt, 'Summarize this page.')
  assert.equal(prepared.meta.promptEncoding, 'raw-user-prompt')
  assert.equal(prepared.meta.outputMode.transport, 'buffered')
  assert.equal(prepared.meta.outputMode.jsonShape, 'openai-chat-completions')
  assert.deepEqual(prepared.execution.output, {
    stream: false,
    format: 'json',
    jsonShape: 'openai-chat-completions',
  })
  assert.deepEqual(prepared.execution.reply.composerMode, {
    chatMode: 'instant',
    deepThink: 'off',
    search: 'on',
  })
  assert.equal(prepared.execution.reply.url, 'https://chat.deepseek.com/')
  assert.equal(prepared.execution.reply.waitUntil, 'domcontentloaded')
})

void test('chat completions bridge turns history bootstrap context into an uploaded artifact and keeps only the latest turn in the prompt', () => {
  const historyArtifact = createStagedInputFile({
    stageId: 'stage-chat-history',
    endpoint: '/v1/chat/completions',
    source: 'history-bootstrap-artifact',
    filePath: '/tmp/stage-chat-history/context.txt',
    stagedFilename: 'context.txt',
    originalFilename: 'openai-chat-completions-history-bootstrap.txt',
  })
  const prepared = prepareOpenAIChatCompletionsReplyExecution({
    requestId: 'req-chat-2',
    request: {
      endpoint: '/v1/chat/completions',
      model: 'deepseek-expert-browser',
      messages: [
        {
          role: 'system',
          content: 'You are terse.',
        },
        {
          role: 'assistant',
          content: 'Previous answer.',
        },
        {
          role: 'user',
          content: 'Refine it in one sentence.',
        },
      ],
      stream: true,
      streamOptions: null,
      n: 1,
      store: null,
      metadata: null,
      deepseekOptions: {},
      requestClassification: 'history-bootstrap',
      historyBootstrap: {
        historyMessages: [
          {
            role: 'system',
            content: 'You are terse.',
          },
          {
            role: 'assistant',
            content: 'Previous answer.',
          },
        ],
        latestTurnMessages: [
          {
            role: 'user',
            content: 'Refine it in one sentence.',
          },
        ],
        latestActionableUserTurn: {
          itemIndex: 2,
          message: {
            role: 'user',
            content: 'Refine it in one sentence.',
          },
        },
      },
    },
    environment: createEnvironment(),
    stagedInputFiles: [historyArtifact],
  })

  assert.equal(prepared.meta.prompt, 'Refine it in one sentence.')
  assert.equal(prepared.meta.promptEncoding, 'raw-user-prompt')
  assert.equal(prepared.meta.messageCount, 1)
  assert.equal(prepared.meta.inputFileCount, 1)
  assert.equal(prepared.meta.outputMode.transport, 'streaming')
  assert.equal(prepared.meta.outputMode.format, 'stream-json')
  assert.deepEqual(prepared.execution.reply.composerMode, {
    chatMode: 'expert',
    deepThink: 'off',
    search: 'off',
  })
  assert.deepEqual(prepared.execution.reply.files, ['/tmp/stage-chat-history/context.txt'])
  assert.deepEqual(prepared.cleanup, {
    stagedInputFiles: [historyArtifact],
  })
})

void test('chat completions bridge fails closed when history bootstrap reaches the bridge without a staged artifact', () => {
  assert.throws(
    () => {
      prepareOpenAIChatCompletionsReplyExecution({
        requestId: 'req-chat-developer-missing-artifact',
        request: {
          endpoint: '/v1/chat/completions',
          model: 'deepseek-chat-browser',
          messages: [
            {
              role: 'developer',
              content: 'Answer tersely.',
            },
            {
              role: 'user',
              content: 'Summarize this page.',
            },
          ],
          stream: false,
          streamOptions: null,
          n: 1,
          store: null,
          metadata: null,
          deepseekOptions: {},
          requestClassification: 'history-bootstrap',
          historyBootstrap: {
            historyMessages: [
              {
                role: 'developer',
                content: 'Answer tersely.',
              },
            ],
            latestTurnMessages: [
              {
                role: 'user',
                content: 'Summarize this page.',
              },
            ],
            latestActionableUserTurn: {
              itemIndex: 1,
              message: {
                role: 'user',
                content: 'Summarize this page.',
              },
            },
          },
        },
        environment: createEnvironment(),
      })
    },
    /expected exactly 1 staged bootstrap artifact/u,
  )
})

void test('responses bridge keeps developer history in a bootstrap artifact instead of replaying it inline', () => {
  const historyArtifact = createStagedInputFile({
    stageId: 'stage-responses-history',
    source: 'history-bootstrap-artifact',
    filePath: '/tmp/stage-responses-history/context.txt',
    stagedFilename: 'context.txt',
    originalFilename: 'openai-responses-history-bootstrap.txt',
  })
  const prepared = prepareOpenAIResponsesReplyExecution({
    requestId: 'req-responses-developer-1',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-chat-browser',
      input: [
        {
          role: 'developer',
          content: 'Answer tersely.',
        },
        {
          role: 'user',
          content: 'Explain the diff.',
        },
      ],
      instructions: null,
      stream: false,
      deepseekOptions: {},
      previousResponseId: null,
      store: null,
      metadata: null,
      requestClassification: 'history-bootstrap',
      historyBootstrap: {
        historyItems: [
          {
            role: 'developer',
            content: 'Answer tersely.',
          },
        ],
        latestTurnItems: [
          {
            role: 'user',
            content: 'Explain the diff.',
          },
        ],
        latestActionableUserTurn: {
          itemIndex: 1,
          message: {
            role: 'user',
            content: 'Explain the diff.',
          },
        },
      },
    },
    environment: createEnvironment(),
    stagedInputFiles: [historyArtifact],
  })

  assert.equal(prepared.meta.prompt, 'Explain the diff.')
  assert.equal(prepared.meta.promptEncoding, 'raw-user-prompt')
  assert.equal(prepared.meta.messageCount, 1)
  assert.equal(prepared.meta.inputFileCount, 1)
  assert.deepEqual(prepared.execution.reply.files, ['/tmp/stage-responses-history/context.txt'])
  assert.deepEqual(prepared.cleanup, {
    stagedInputFiles: [historyArtifact],
  })
})

void test('responses bridge injects instructions as a system message and targets the responses output shape', () => {
  const prepared = prepareOpenAIResponsesReplyExecution({
    requestId: 'req-responses-1',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-chat-browser',
      input: 'Explain the diff.',
      instructions: 'Answer in bullet points.',
      stream: true,
      deepseekOptions: {
        deepThink: 'on',
      },
      previousResponseId: null,
      store: null,
      metadata: null,
      requestClassification: 'new-turn',
      historyBootstrap: null,
    },
    environment: createEnvironment(),
  })

  assert.equal(
    prepared.meta.prompt,
    'System:\nAnswer in bullet points.\n\nUser:\nExplain the diff.',
  )
  assert.equal(prepared.meta.promptEncoding, 'message-transcript')
  assert.equal(prepared.meta.outputMode.jsonShape, 'openai-responses')
  assert.equal(prepared.meta.outputMode.transport, 'streaming')
  assert.deepEqual(prepared.execution.output, {
    stream: true,
    format: 'stream-json',
    jsonShape: 'openai-responses',
  })
  assert.deepEqual(prepared.execution.reply.composerMode, {
    chatMode: 'instant',
    deepThink: 'on',
    search: 'off',
  })
  assert.equal(prepared.meta.inputFileCount, 0)
})

void test('responses bridge sends the bootstrap artifact before latest-turn request files and keeps the prompt on the newest turn only', () => {
  const historyArtifact = createStagedInputFile({
    stageId: 'stage-history',
    source: 'history-bootstrap-artifact',
    filePath: '/tmp/stage-history/context.txt',
    stagedFilename: 'context.txt',
    originalFilename: 'openai-responses-history-bootstrap.txt',
  })
  const stagedFile = createStagedInputFile({
    stageId: 'stage-brief',
    filePath: '/tmp/stage-brief/brief.txt',
    stagedFilename: 'brief.txt',
    originalFilename: 'brief.txt',
  })
  const prepared = prepareOpenAIResponsesReplyExecution({
    requestId: 'req-responses-file-1',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-expert-browser',
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
          fileData: 'YnJpZWY=',
        },
      ],
      instructions: null,
      stream: false,
      deepseekOptions: {},
      previousResponseId: null,
      store: null,
      metadata: null,
      requestClassification: 'history-bootstrap',
      historyBootstrap: {
        historyItems: [
          {
            role: 'assistant',
            content: 'Earlier context.',
          },
        ],
        latestTurnItems: [
          {
            role: 'user',
            content: 'Latest turn.',
          },
          {
            type: 'input_file',
            filename: 'brief.txt',
            fileData: 'YnJpZWY=',
          },
        ],
        latestActionableUserTurn: {
          itemIndex: 1,
          message: {
            role: 'user',
            content: 'Latest turn.',
          },
        },
      },
    },
    environment: createEnvironment(),
    stagedInputFiles: [historyArtifact, stagedFile],
  })

  assert.equal(prepared.meta.prompt, 'Latest turn.')
  assert.equal(prepared.meta.promptEncoding, 'raw-user-prompt')
  assert.equal(prepared.meta.inputFileCount, 2)
  assert.deepEqual(prepared.execution.reply.files, [
    '/tmp/stage-history/context.txt',
    '/tmp/stage-brief/brief.txt',
  ])
  assert.deepEqual(prepared.cleanup, {
    stagedInputFiles: [historyArtifact, stagedFile],
  })
})

void test('responses bridge fails closed when history bootstrap reaches the bridge without a staged artifact', () => {
  assert.throws(
    () => {
      prepareOpenAIResponsesReplyExecution({
        requestId: 'req-responses-history-missing-artifact',
        request: {
          endpoint: '/v1/responses',
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
          ],
          instructions: null,
          stream: false,
          deepseekOptions: {},
          previousResponseId: null,
          store: null,
          metadata: null,
          requestClassification: 'history-bootstrap',
          historyBootstrap: {
            historyItems: [
              {
                role: 'assistant',
                content: 'Earlier context.',
              },
            ],
            latestTurnItems: [
              {
                role: 'user',
                content: 'Latest turn.',
              },
            ],
            latestActionableUserTurn: {
              itemIndex: 1,
              message: {
                role: 'user',
                content: 'Latest turn.',
              },
            },
          },
        },
        environment: createEnvironment(),
      })
    },
    /expected exactly 1 staged bootstrap artifact/u,
  )
})

void test('responses bridge fails closed when input_file items reach the bridge without staged file records', () => {
  assert.throws(
    () => {
      prepareOpenAIResponsesReplyExecution({
        requestId: 'req-responses-file-missing-stage',
        request: {
          endpoint: '/v1/responses',
          model: 'deepseek-chat-browser',
          input: [
            {
              role: 'user',
              content: 'Latest turn.',
            },
            {
              type: 'input_file',
              filename: 'brief.txt',
              fileData: 'YnJpZWY=',
            },
          ],
          instructions: null,
          stream: false,
          deepseekOptions: {},
          previousResponseId: null,
          store: null,
          metadata: null,
          requestClassification: 'new-turn',
          historyBootstrap: null,
        },
        environment: createEnvironment(),
      })
    },
    /expected 1 staged input file/u,
  )
})

void test('responses bridge maps previous_response_id onto an existing DeepSeek session target', () => {
  const prepared = prepareOpenAIResponsesReplyExecution({
    requestId: 'req-responses-continuation',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-chat-browser',
      input: 'Only send the new turn.',
      instructions: null,
      stream: false,
      deepseekOptions: {},
      previousResponseId: 'resp_prev',
      store: null,
      metadata: null,
      requestClassification: 'session-continuation',
      historyBootstrap: null,
    },
    environment: createEnvironment(),
    responseHandle: {
      responseId: 'resp_prev',
      sessionId: 'session-prev',
      sessionFile: '/tmp/session-prev.json',
      branchId: 'branch-prev',
    },
  })

  assert.equal(prepared.meta.prompt, 'Only send the new turn.')
  assert.equal(prepared.execution.reply.sessionId, 'session-prev')
  assert.equal(prepared.execution.reply.sessionFile, '/tmp/session-prev.json')
})

void test('responses bridge fails closed when continuation prep omits the resolved response handle', () => {
  assert.throws(
    () => {
      prepareOpenAIResponsesReplyExecution({
        requestId: 'req-responses-missing-handle',
        request: {
          endpoint: '/v1/responses',
          model: 'deepseek-chat-browser',
          input: 'Follow up.',
          instructions: null,
          stream: false,
          deepseekOptions: {},
          previousResponseId: 'resp_prev',
          store: null,
          metadata: null,
          requestClassification: 'session-continuation',
          historyBootstrap: null,
        },
        environment: createEnvironment(),
      })
    },
    /resolved response handle/u,
  )
})

void test('generic bridge dispatcher supports both validated OpenAI request families', () => {
  const chatPrepared = prepareOpenAIHttpReplyExecution({
    requestId: 'req-dispatch-chat',
    request: {
      endpoint: '/v1/chat/completions',
      model: 'deepseek-chat-browser',
      messages: [
        {
          role: 'user',
          content: 'hello',
        },
      ],
      stream: false,
      streamOptions: null,
      n: 1,
      store: null,
      metadata: null,
      deepseekOptions: {},
      requestClassification: 'new-turn',
      historyBootstrap: null,
    } satisfies OpenAIChatCompletionsSubsetRequest,
    environment: createEnvironment(),
  })
  const responsesPrepared = prepareOpenAIHttpReplyExecution({
    requestId: 'req-dispatch-responses',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-expert-browser',
      input: [
        {
          role: 'user',
          content: 'hello',
        },
      ],
      instructions: null,
      stream: false,
      deepseekOptions: {},
      previousResponseId: null,
      store: null,
      metadata: null,
      requestClassification: 'new-turn',
      historyBootstrap: null,
    } satisfies OpenAIResponsesSubsetRequest,
    environment: createEnvironment(),
  })

  assert.equal(chatPrepared.meta.endpoint, '/v1/chat/completions')
  assert.equal(responsesPrepared.meta.endpoint, '/v1/responses')
  assert.equal(chatPrepared.meta.outputMode.jsonShape, 'openai-chat-completions')
  assert.equal(responsesPrepared.meta.outputMode.jsonShape, 'openai-responses')
})

void test('OpenAI HTTP reply bridge executes through the shared DeepSeek reply runner without re-mapping inside routes', async () => {
  const prepared = prepareOpenAIChatCompletionsReplyExecution({
    requestId: 'req-execute-1',
    request: {
      endpoint: '/v1/chat/completions',
      model: 'deepseek-chat-browser',
      messages: [
        {
          role: 'user',
          content: 'Run the shared bridge.',
        },
      ],
      stream: false,
      streamOptions: null,
      n: 1,
      store: null,
      metadata: null,
      deepseekOptions: {},
      requestClassification: 'new-turn',
      historyBootstrap: null,
    },
    environment: createEnvironment(),
  })

  let seenExecution: unknown = null
  const execution = await executeOpenAIHttpReplyBridge({
    prepared,
    executeReply(input) {
      seenExecution = input
      return Promise.resolve({
        result: {
          sessionId: 'session-1',
          finalUrl: 'https://chat.deepseek.com/a/session-1',
          settledAfterMs: 1234,
        } as never,
        outputMode: prepared.meta.outputMode,
      })
    },
  })

  assert.deepEqual(seenExecution, prepared.execution)
  assert.equal(execution.prepared.meta.requestId, 'req-execute-1')
  assert.equal(execution.delivery.outputMode.jsonShape, 'openai-chat-completions')
})

void test('OpenAI HTTP reply bridge wraps dependency failures behind a shared execution failure seam', async () => {
  const prepared = prepareOpenAIResponsesReplyExecution({
    requestId: 'req-execute-2',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-chat-browser',
      input: 'trigger failure',
      instructions: null,
      stream: false,
      deepseekOptions: {},
      previousResponseId: null,
      store: null,
      metadata: null,
      requestClassification: 'new-turn',
      historyBootstrap: null,
    },
    environment: createEnvironment(),
  })

  await assert.rejects(
    executeOpenAIHttpReplyBridge({
      prepared,
      executeReply() {
        return Promise.reject(new Error('DeepSeek upstream rate limit cooldown in progress'))
      },
    }),
    error => {
      assert.equal(isOpenAIHttpReplyBridgeError(error), true)
      if (!isOpenAIHttpReplyBridgeError(error)) {
        return false
      }
      assert.equal(error.failure.statusCode, 429)
      assert.equal(error.failure.type, 'rate_limit_error')
      assert.equal(error.failure.code, 'upstream_rate_limit')
      return true
    },
  )
})

void test('shared execution failure resolver keeps a stable fallback classification for generic runtime errors', () => {
  assert.deepEqual(resolveOpenAIHttpExecutionFailure(new Error('boom')), {
    statusCode: 500,
    type: 'api_error',
    code: 'upstream_execution_failed',
    message: 'boom',
  })
})

void test('shared execution failure resolver classifies responses continuation restore failures separately', () => {
  const prepared = prepareOpenAIResponsesReplyExecution({
    requestId: 'req-execute-restore',
    request: {
      endpoint: '/v1/responses',
      model: 'deepseek-chat-browser',
      input: 'continue',
      instructions: null,
      stream: false,
      deepseekOptions: {},
      previousResponseId: 'resp_restore',
      store: null,
      metadata: null,
      requestClassification: 'session-continuation',
      historyBootstrap: null,
    },
    environment: createEnvironment(),
    responseHandle: {
      responseId: 'resp_restore',
      sessionId: 'session-restore',
      sessionFile: '/tmp/session-restore.json',
      branchId: 'branch-main',
    },
  })

  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(
      new Error(
        'DeepSeek route mismatch: expected session session-restore, but browser is on session-other.',
      ),
      prepared,
    ),
    {
      statusCode: 500,
      type: 'api_error',
      code: 'previous_response_id_restore_failed',
      message:
        'Failed to restore the stored DeepSeek session referenced by `previous_response_id` resp_restore: DeepSeek route mismatch: expected session session-restore, but browser is on session-other.',
    },
  )
})

void test('shared execution failure resolver maps unavailable request toggles onto stable invalid_request_error codes', () => {
  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(
      createDeepSeekComposerToggleUnavailableError({
        toggle: 'search',
        targetState: 'on',
        requestedChatMode: 'instant',
        resolvedChatMode: 'instant',
        pageUrl: 'https://chat.deepseek.com/',
      }),
    ),
    {
      statusCode: 400,
      type: 'invalid_request_error',
      code: 'unsupported_requested_search_toggle',
      message: 'The DeepSeek Search toggle is unavailable, but on was requested.',
    },
  )

  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(
      createDeepSeekComposerFileInputUnavailableError({
        requestedChatMode: 'expert',
        resolvedChatMode: 'expert',
        requestedFileCount: 1,
        pageUrl: 'https://chat.deepseek.com/',
      }),
    ),
    {
      statusCode: 400,
      type: 'invalid_request_error',
      code: 'unsupported_requested_file_input',
      message:
        'DeepSeek file upload was blocked before send because the current chat mode does not expose a real file input. requestedChatMode=expert resolvedChatMode=expert requestedFileCount=1 pageUrl=https://chat.deepseek.com/ This command fails closed instead of pretending attachments were accepted in the current mode.',
    },
  )
})

void test('shared execution failure resolver maps toggle-settle failures onto stable api_error codes', () => {
  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(
      createDeepSeekComposerToggleSettleError({
        toggle: 'deepThink',
        targetState: 'on',
        currentState: 'off',
        requestedChatMode: 'expert',
        resolvedChatMode: 'expert',
        pageUrl: 'https://chat.deepseek.com/',
      }),
    ),
    {
      statusCode: 500,
      type: 'api_error',
      code: 'deepseek_deep_think_toggle_settle_failed',
      message: 'The DeepSeek DeepThink toggle did not reach on; current state is off.',
    },
  )
})

void test('shared execution failure resolver maps non-retryable file upload failures onto stable invalid_request_error codes', () => {
  const unsupportedTypeError = createDeepSeekFileUploadError(
    createFileUploadFailureBatch({
      problemCode: 'unsupported_file_type',
      message: 'Composer accepts .txt but this request staged report.pdf.',
      fileName: 'report.pdf',
    }),
  )
  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(unsupportedTypeError),
    {
      statusCode: 400,
      type: 'invalid_request_error',
      code: 'unsupported_input_file_type',
      message: unsupportedTypeError.message,
    },
  )

  const processingFailedError = createDeepSeekFileUploadError(
    createFileUploadFailureBatch({
      problemCode: 'fetch_files_failed',
      message: 'fetch_files settled with status FAILED for alpha.txt.',
      fileName: 'alpha.txt',
      fileId: 'file-1',
      uploaded: true,
      fetchedStatus: 'FAILED',
      settled: true,
    }),
  )
  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(processingFailedError),
    {
      statusCode: 400,
      type: 'invalid_request_error',
      code: 'input_file_processing_failed',
      message: processingFailedError.message,
    },
  )
})

void test('shared execution failure resolver maps retryable file upload failures onto stable api_error codes', () => {
  const settlementTimeoutError = createDeepSeekFileUploadError(
    createFileUploadFailureBatch({
      problemCode: 'fetch_files_processing_timeout',
      message: 'fetch_files last observed status was PARSING before timeout.',
      fileName: 'alpha.txt',
      fileId: 'file-1',
      uploaded: true,
      fetchedStatus: 'PARSING',
      settled: false,
    }),
  )
  assert.deepEqual(
    resolveOpenAIHttpExecutionFailure(settlementTimeoutError),
    {
      statusCode: 500,
      type: 'api_error',
      code: 'input_file_settlement_timeout',
      message: settlementTimeoutError.message,
    },
  )
})

function createEnvironment(): OpenAIHttpExecutionEnvironment {
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
    sessionStoreDir: '.tmp/sessions',
  }
}

function createStagedInputFile(
  overrides: Partial<OpenAIHttpStagedInputFile> = {},
): OpenAIHttpStagedInputFile {
  return {
    kind: 'openai-http-staged-input-file',
    version: 1,
    stageId: 'stage-default',
    endpoint: '/v1/responses',
    source: 'request-input',
    requestId: 'req-stage-default',
    originalFilename: 'default.txt',
    stagedFilename: 'default.txt',
    stagingDirectory: '/tmp/stage-default',
    filePath: '/tmp/stage-default/default.txt',
    byteSize: 7,
    createdAt: '2026-04-15T11:00:00.000Z',
    ...overrides,
  }
}

function createFileUploadFailureBatch(input: {
  problemCode:
    | 'unsupported_file_type'
    | 'fetch_files_failed'
    | 'fetch_files_processing_timeout'
  message: string
  fileName: string
  fileId?: string | null | undefined
  uploaded?: boolean | undefined
  fetchedStatus?: string | null | undefined
  settled?: boolean | undefined
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
        extension: input.fileName.includes('.')
          ? `.${input.fileName.split('.').pop() ?? ''}`
          : null,
        sizeBytes: 11,
        acceptedByPreflight: true,
        uploaded: input.uploaded ?? input.problemCode !== 'unsupported_file_type',
        settled: input.settled ?? false,
        mounted: false,
        fileId: input.fileId ?? null,
        serverStatus: input.fetchedStatus ?? null,
        previewable: false,
        tokenUsage: null,
        previewUrl: null,
        errorCode: null,
        errorMessage: null,
        upload: null,
        fetched:
          input.fileId && input.fetchedStatus
            ? {
                id: input.fileId,
                status: input.fetchedStatus,
                fileName: input.fileName,
                previewable: false,
                fileSize: 11,
                tokenUsage: null,
                errorCode: null,
                insertedAt: null,
                updatedAt: null,
              }
            : null,
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
    settled: input.settled ?? false,
    blockingIssues: true,
  }
}
