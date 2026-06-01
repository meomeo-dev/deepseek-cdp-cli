import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import { cleanupOpenAIHttpStagedInputFiles } from '../../infrastructure/openai/openaiHttpInputFileStaging.js'
import {
  applyOpenAIHistoryBootstrapMetadataToStoredSession,
} from '../../infrastructure/deepseek/deepSeekStoredSession.js'
import {
  loadStoredSessionFromFile,
  saveStoredSessionToFile,
} from '../../infrastructure/deepseek/fileSystemSessionStore.js'
import type {
  OpenAIChatCompletionsSubsetRequest,
  OpenAICompatibleModelAlias,
  OpenAIHttpDeepSeekOptions,
  OpenAIHttpExecutedReply,
  OpenAIHttpExecutionEnvironment,
  OpenAIHttpExecutionFailure,
  OpenAIHttpMappedComposerMode,
  OpenAIHttpPreparedResponsesInput,
  OpenAIHttpPreparedReplyExecution,
  OpenAIHttpResponseHandleRecord,
  OpenAIHttpStagedInputFile,
  OpenAIResponsesInputItem,
  OpenAIResponsesInputFileItem,
  OpenAIResponsesSubsetRequest,
  OpenAIResponsesTextInputMessage,
} from '../../types/openai-http-service.types.js'
import type {
  DeepSeekReplyExecutionInput,
  DeepSeekReplyLiveDeliveryInput,
} from '../../types/deepseek-reply-output.types.js'
import type { ReplyDeepSeekMessageInput } from '../usecases/replyDeepSeekMessage.js'
import { executeDeepSeekReply } from './executeDeepSeekReply.js'
import { resolveDeepSeekReplyOutputMode } from './deepSeekReplyOutputMode.js'
import { isDeepSeekComposerModeError } from '../../shared/errors/deepSeekComposerModeError.js'
import {
  isDeepSeekFileUploadError,
  type DeepSeekFileUploadError,
} from '../../shared/errors/deepSeekFileUploadError.js'

export class OpenAIHttpReplyBridgeError extends Error {
  readonly failure: OpenAIHttpExecutionFailure
  override readonly cause: unknown

  constructor(
    failure: OpenAIHttpExecutionFailure,
    cause: unknown,
  ) {
    super(failure.message)
    this.name = 'OpenAIHttpReplyBridgeError'
    this.failure = failure
    this.cause = cause
  }
}

export function isOpenAIHttpReplyBridgeError(
  error: unknown,
): error is OpenAIHttpReplyBridgeError {
  return error instanceof OpenAIHttpReplyBridgeError
}

export function resolveOpenAIHttpComposerMode(
  model: OpenAICompatibleModelAlias,
  deepseekOptions: OpenAIHttpDeepSeekOptions = {},
): OpenAIHttpMappedComposerMode {
  const aliasDefaults = resolveOpenAIHttpAliasComposerMode(model)
  switch (model) {
    case 'deepseek-chat-browser':
    case 'deepseek-expert-browser':
      return {
        chatMode: aliasDefaults.chatMode,
        deepThink: deepseekOptions.deepThink ?? aliasDefaults.deepThink,
        search: deepseekOptions.search ?? aliasDefaults.search,
      }
  }
}

export function prepareOpenAIHttpReplyExecution(input: {
  requestId: string
  request: OpenAIChatCompletionsSubsetRequest | OpenAIResponsesSubsetRequest
  environment: OpenAIHttpExecutionEnvironment
  stagedInputFiles?: OpenAIHttpStagedInputFile[] | undefined
  responseHandle?: Pick<
    OpenAIHttpResponseHandleRecord,
    'branchId' | 'responseId' | 'sessionFile' | 'sessionId'
  > | null | undefined
}): OpenAIHttpPreparedReplyExecution {
  switch (input.request.endpoint) {
    case '/v1/chat/completions':
      return prepareOpenAIChatCompletionsReplyExecution({
        requestId: input.requestId,
        request: input.request,
        environment: input.environment,
        stagedInputFiles: input.stagedInputFiles,
      })
    case '/v1/responses':
      return prepareOpenAIResponsesReplyExecution({
        requestId: input.requestId,
        request: input.request,
        environment: input.environment,
        stagedInputFiles: input.stagedInputFiles,
        responseHandle: input.responseHandle,
      })
  }
}

export function prepareOpenAIChatCompletionsReplyExecution(input: {
  requestId: string
  request: OpenAIChatCompletionsSubsetRequest
  environment: OpenAIHttpExecutionEnvironment
  stagedInputFiles?: OpenAIHttpStagedInputFile[] | undefined
}): OpenAIHttpPreparedReplyExecution & { request: OpenAIChatCompletionsSubsetRequest } {
  const composerMode = resolveOpenAIHttpComposerMode(
    input.request.model,
    input.request.deepseekOptions,
  )
  const historyBootstrapArtifact = resolveOpenAIHttpHistoryBootstrapArtifact({
    endpoint: input.request.endpoint,
    requestClassification: input.request.requestClassification,
    historyBootstrap: input.request.historyBootstrap,
    stagedInputFiles: input.stagedInputFiles,
  })
  const promptMessages =
    input.request.historyBootstrap?.latestTurnMessages ?? input.request.messages
  const prompt = renderOpenAITranscriptPrompt(promptMessages)
  const output = {
    stream: input.request.stream,
    format: input.request.stream ? 'stream-json' : 'json',
    jsonShape: 'openai-chat-completions',
  } satisfies NonNullable<DeepSeekReplyExecutionInput['output']>
  const outputMode = resolveDeepSeekReplyOutputMode(output)

  return {
    request: input.request,
    execution: {
      reply: buildReplyExecutionInput({
        environment: input.environment,
        prompt: prompt.prompt,
        composerMode,
        files:
          historyBootstrapArtifact === null
            ? []
            : [historyBootstrapArtifact.filePath],
      }),
      output,
    },
    meta: {
      requestId: input.requestId,
      endpoint: input.request.endpoint,
      model: input.request.model,
      stream: input.request.stream,
      requestClassification: input.request.requestClassification,
      prompt: prompt.prompt,
      promptEncoding: prompt.promptEncoding,
      messageCount: prompt.messageCount,
      inputFileCount: historyBootstrapArtifact === null ? 0 : 1,
      promptCharacterCount: prompt.prompt.length,
      composerMode,
      outputMode,
    },
    ...(historyBootstrapArtifact === null
      ? {}
      : {
          cleanup: {
            stagedInputFiles: [historyBootstrapArtifact],
          },
        }),
  }
}

export function prepareOpenAIResponsesReplyExecution(input: {
  requestId: string
  request: OpenAIResponsesSubsetRequest
  environment: OpenAIHttpExecutionEnvironment
  stagedInputFiles?: OpenAIHttpStagedInputFile[] | undefined
  responseHandle?: Pick<
    OpenAIHttpResponseHandleRecord,
    'branchId' | 'responseId' | 'sessionFile' | 'sessionId'
  > | null | undefined
}): OpenAIHttpPreparedReplyExecution & { request: OpenAIResponsesSubsetRequest } {
  const responseHandle = input.responseHandle ?? null
  if (input.request.previousResponseId !== null && responseHandle === null) {
    throw new Error(
      'OpenAI HTTP responses continuation requires a resolved response handle before preparing reply execution.',
    )
  }

  const composerMode = resolveOpenAIHttpComposerMode(
    input.request.model,
    input.request.deepseekOptions,
  )
  const normalizedInput = normalizeResponsesExecutionInput({
    request: input.request,
    stagedInputFiles: input.stagedInputFiles,
  })
  const promptMessages = resolveOpenAIResponsesPromptMessages({
    request: input.request,
    normalizedInput,
  })
  const transcriptMessages =
    input.request.instructions === null
      ? promptMessages
      : [
          {
            role: 'system' as const,
            content: input.request.instructions,
          },
          ...promptMessages,
        ]
  const prompt = renderOpenAITranscriptPrompt(transcriptMessages)
  const output = {
    stream: input.request.stream,
    format: input.request.stream ? 'stream-json' : 'json',
    jsonShape: 'openai-responses',
  } satisfies NonNullable<DeepSeekReplyExecutionInput['output']>
  const outputMode = resolveDeepSeekReplyOutputMode(output)

  return {
    request: input.request,
    execution: {
      reply: buildReplyExecutionInput({
        environment: input.environment,
        prompt: prompt.prompt,
        composerMode,
        files: [
          ...(normalizedInput.historyBootstrapArtifact === null
            ? []
            : [normalizedInput.historyBootstrapArtifact.filePath]),
          ...normalizedInput.requestStagedFiles.map(file => file.filePath),
        ],
        ...(responseHandle
          ? {
              sessionId: responseHandle.sessionId,
              sessionFile: responseHandle.sessionFile,
            }
          : {}),
      }),
      output,
    },
    meta: {
      requestId: input.requestId,
      endpoint: input.request.endpoint,
      model: input.request.model,
      stream: input.request.stream,
      requestClassification: input.request.requestClassification,
      prompt: prompt.prompt,
      promptEncoding: prompt.promptEncoding,
      messageCount: prompt.messageCount,
      inputFileCount: normalizedInput.stagedFiles.length,
      promptCharacterCount: prompt.prompt.length,
      composerMode,
      outputMode,
    },
    ...(normalizedInput.stagedFiles.length > 0
      ? {
          cleanup: {
            stagedInputFiles: normalizedInput.stagedFiles,
          },
        }
      : {}),
  }
}

export async function cleanupOpenAIHttpPreparedReplyExecutionArtifacts(
  prepared: OpenAIHttpPreparedReplyExecution,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<void> {
  const stagedInputFiles = prepared.cleanup?.stagedInputFiles ?? []
  if (stagedInputFiles.length === 0) {
    return
  }

  await cleanupOpenAIHttpStagedInputFiles({
    stagedFiles: stagedInputFiles,
    sessionStoreDir: input.sessionStoreDir,
    cwd: input.cwd,
  })
}

export async function executeOpenAIHttpReplyBridge<
  TPrepared extends OpenAIHttpPreparedReplyExecution,
>(input: {
  prepared: TPrepared
  executeReply?: typeof executeDeepSeekReply
  logger?: RuntimeLogger
  live?: DeepSeekReplyLiveDeliveryInput | undefined
}): Promise<OpenAIHttpExecutedReply & { prepared: TPrepared }> {
  const executeReply = input.executeReply ?? executeDeepSeekReply
  const logger =
    input.logger ?? new RuntimeLogger({ level: 'info', scope: 'openai-http' })
  const scopedLogger = logger.child(
    input.prepared.meta.endpoint === '/v1/chat/completions'
      ? 'chat-completions'
      : 'responses',
  )

  scopedLogger.info('Executing OpenAI HTTP reply bridge', buildExecutionLogPayload(input.prepared))

  try {
    const execution =
      input.live
        ? {
            ...input.prepared.execution,
            live: input.live,
          }
        : input.prepared.execution
    const delivery = await executeReply(
      execution,
      scopedLogger.child('reply'),
    )

    await persistOpenAIHistoryBootstrapProvenance({
      prepared: input.prepared,
      sessionFile: delivery.result.sessionFile,
      logger: scopedLogger.child('history-bootstrap'),
    })

    scopedLogger.info('Completed OpenAI HTTP reply bridge', {
      requestId: input.prepared.meta.requestId,
      sessionId: delivery.result.sessionId,
      finalUrl: delivery.result.finalUrl,
      settledAfterMs: delivery.result.settledAfterMs,
      outputMode: delivery.outputMode,
    })

    return {
      prepared: input.prepared,
      delivery,
    }
  } catch (error) {
    const failure = resolveOpenAIHttpExecutionFailure(error, input.prepared)
    scopedLogger.error('OpenAI HTTP reply bridge failed', {
      requestId: input.prepared.meta.requestId,
      endpoint: input.prepared.meta.endpoint,
      model: input.prepared.meta.model,
      statusCode: failure.statusCode,
      type: failure.type,
      code: failure.code,
      message: failure.message,
    })
    throw new OpenAIHttpReplyBridgeError(failure, error)
  }
}

export function resolveOpenAIHttpExecutionFailure(
  error: unknown,
  prepared?: OpenAIHttpPreparedReplyExecution,
): OpenAIHttpExecutionFailure {
  if (isOpenAIHttpReplyBridgeError(error)) {
    return error.failure
  }

  if (isDeepSeekComposerModeError(error)) {
    switch (error.code) {
      case 'unsupported_requested_deep_think_toggle':
      case 'unsupported_requested_search_toggle':
      case 'unsupported_expert_search_temporarily_disabled':
      case 'unsupported_requested_file_input':
      case 'unsupported_expert_file_input_temporarily_disabled':
        return {
          statusCode: 400,
          type: 'invalid_request_error',
          code: error.code,
          message: error.message,
        }
      case 'deepseek_deep_think_toggle_settle_failed':
      case 'deepseek_search_toggle_settle_failed':
      case 'deepseek_chat_mode_settle_failed':
        return {
          statusCode: 500,
          type: 'api_error',
          code: error.code,
          message: error.message,
        }
    }
  }

  if (isDeepSeekFileUploadError(error)) {
    return resolveOpenAIHttpFileUploadExecutionFailure(error)
  }

  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : 'DeepSeek reply execution failed.'

  if (looksLikeRateLimitFailure(message)) {
    return {
      statusCode: 429,
      type: 'rate_limit_error',
      code: 'upstream_rate_limit',
      message,
    }
  }

  if (
    prepared?.request.endpoint === '/v1/responses' &&
    prepared.request.previousResponseId !== null &&
    looksLikeOpenAIResponsesRestoreFailure(message)
  ) {
    return {
      statusCode: 500,
      type: 'api_error',
      code: 'previous_response_id_restore_failed',
      message:
        `Failed to restore the stored DeepSeek session referenced by \`previous_response_id\` ${prepared.request.previousResponseId}: ${message}`,
    }
  }

  return {
    statusCode: 500,
    type: 'api_error',
    code: 'upstream_execution_failed',
    message,
  }
}

function resolveOpenAIHttpFileUploadExecutionFailure(
  error: DeepSeekFileUploadError,
): OpenAIHttpExecutionFailure {
  switch (error.report.kind) {
    case 'unsupported_type':
      return {
        statusCode: 400,
        type: 'invalid_request_error',
        code: 'unsupported_input_file_type',
        message: error.message,
      }
    case 'limit_exceeded':
      return {
        statusCode: 400,
        type: 'invalid_request_error',
        code: 'input_file_limit_exceeded',
        message: error.message,
      }
    case 'upload_rejected':
      return {
        statusCode: 400,
        type: 'invalid_request_error',
        code: 'input_file_upload_rejected',
        message: error.message,
      }
    case 'processing_failed':
      return {
        statusCode: 400,
        type: 'invalid_request_error',
        code: 'input_file_processing_failed',
        message: error.message,
      }
    case 'upload_response_missing':
      return {
        statusCode: 500,
        type: 'api_error',
        code: 'input_file_upload_response_missing',
        message: error.message,
      }
    case 'settlement_timeout':
      return {
        statusCode: 500,
        type: 'api_error',
        code: 'input_file_settlement_timeout',
        message: error.message,
      }
    case 'fallback_rejected':
      return {
        statusCode: 500,
        type: 'api_error',
        code: 'input_file_fetch_rejected',
        message: error.message,
      }
    case 'mount_verification_failed':
      return {
        statusCode: 500,
        type: 'api_error',
        code: 'input_file_mount_verification_failed',
        message: error.message,
      }
    case 'local_input':
    case 'mixed':
      return {
        statusCode: 500,
        type: 'api_error',
        code: 'input_file_upload_failed',
        message: error.message,
      }
  }
}

function renderOpenAITranscriptPrompt(
  messages: readonly { role: 'system' | 'user' | 'assistant' | 'developer'; content: string }[],
): {
  prompt: string
  promptEncoding: 'raw-user-prompt' | 'message-transcript'
  messageCount: number
} {
  const singleUserMessage = messages.length === 1 && messages[0]?.role === 'user'
  const singleUserContent = messages[0]?.content ?? ''
  if (singleUserMessage && singleUserContent.trim()) {
    return {
      prompt: singleUserContent,
      promptEncoding: 'raw-user-prompt',
      messageCount: 1,
    }
  }

  return {
    prompt: messages
      .map(message => `${formatRoleLabel(message.role)}:\n${message.content || '<empty message>'}`)
      .join('\n\n'),
    promptEncoding: 'message-transcript',
    messageCount: messages.length,
  }
}

function buildReplyExecutionInput(input: {
  environment: OpenAIHttpExecutionEnvironment
  prompt: string
  composerMode: OpenAIHttpMappedComposerMode
  files?: string[] | undefined
  sessionId?: string | undefined
  sessionFile?: string | undefined
}): ReplyDeepSeekMessageInput {
  return {
    ...input.environment.managedChromeOptions,
    prompt: input.prompt,
    waitUntil: input.environment.waitUntil,
    composerMode: input.composerMode,
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
    ...(input.environment.url ? { url: input.environment.url } : {}),
    ...(input.environment.sessionStoreDir
      ? { sessionStoreDir: input.environment.sessionStoreDir }
      : {}),
  }
}

function formatRoleLabel(role: 'system' | 'user' | 'assistant' | 'developer'): string {
  switch (role) {
    case 'developer':
      return 'Developer'
    case 'system':
      return 'System'
    case 'user':
      return 'User'
    case 'assistant':
      return 'Assistant'
  }
}

function resolveOpenAIHttpAliasComposerMode(
  model: OpenAICompatibleModelAlias,
): OpenAIHttpMappedComposerMode {
  switch (model) {
    case 'deepseek-chat-browser':
      return {
        chatMode: 'instant',
        deepThink: 'off',
        search: 'off',
      }
    case 'deepseek-expert-browser':
      return {
        chatMode: 'expert',
        deepThink: 'off',
        search: 'off',
      }
  }
}

function looksLikeRateLimitFailure(message: string): boolean {
  return /rate[\s-]?limit|too many requests|cooldown|429/i.test(message)
}

function looksLikeOpenAIResponsesRestoreFailure(message: string): boolean {
  return (
    /stored session authority mismatch/i.test(message) ||
    /stored session .* is inconsistent/i.test(message) ||
    /stored finalurl authority mismatch/i.test(message) ||
    /deepseek route mismatch/i.test(message) ||
    /expected a deepseek session route/i.test(message) ||
    /history_messages recovered the wrong session/i.test(message) ||
    /enoent/i.test(message)
  )
}

async function persistOpenAIHistoryBootstrapProvenance(input: {
  prepared: OpenAIHttpPreparedReplyExecution
  sessionFile: string
  logger: RuntimeLogger
}): Promise<void> {
  if (input.prepared.request.historyBootstrap === null) {
    return
  }

  const artifact = resolveOpenAIHttpHistoryBootstrapArtifact({
    endpoint: input.prepared.request.endpoint,
    requestClassification: input.prepared.request.requestClassification,
    historyBootstrap: input.prepared.request.historyBootstrap,
    stagedInputFiles: input.prepared.cleanup?.stagedInputFiles,
  })
  if (artifact === null) {
    throw new Error(
      'OpenAI HTTP history bootstrap request completed without a staged bootstrap artifact.',
    )
  }

  const storedSession = await loadStoredSessionFromFile(input.sessionFile)
  const updatedStoredSession = applyOpenAIHistoryBootstrapMetadataToStoredSession({
    storedSession,
    requestId: input.prepared.meta.requestId,
    endpoint: input.prepared.request.endpoint,
    historyItemCount:
      input.prepared.request.endpoint === '/v1/chat/completions'
        ? input.prepared.request.historyBootstrap.historyMessages.length
        : input.prepared.request.historyBootstrap.historyItems.length,
    latestActionableUserTurnIndex:
      input.prepared.request.historyBootstrap.latestActionableUserTurn.itemIndex,
    latestTurnFileCount:
      input.prepared.request.endpoint === '/v1/chat/completions'
        ? 0
        : input.prepared.request.historyBootstrap.latestTurnItems.filter(isResponsesInputFileItem).length,
    artifact,
  })
  await saveStoredSessionToFile(input.sessionFile, updatedStoredSession)

  input.logger.info('Persisted OpenAI HTTP history bootstrap provenance', {
    requestId: input.prepared.meta.requestId,
    endpoint: input.prepared.request.endpoint,
    sessionFile: input.sessionFile,
    historyItemCount: updatedStoredSession.metadata?.openaiHistoryBootstrap?.historyItemCount ?? null,
    artifactStageId: artifact.stageId,
    artifactFilename: artifact.stagedFilename,
  })
}

function buildExecutionLogPayload(
  prepared: OpenAIHttpPreparedReplyExecution,
): Record<string, unknown> {
  return {
    requestId: prepared.meta.requestId,
    endpoint: prepared.meta.endpoint,
    model: prepared.meta.model,
    stream: prepared.meta.stream,
    requestClassification: prepared.meta.requestClassification,
    promptEncoding: prepared.meta.promptEncoding,
    messageCount: prepared.meta.messageCount,
    inputFileCount: prepared.meta.inputFileCount,
    promptCharacterCount: prepared.meta.promptCharacterCount,
    composerMode: prepared.meta.composerMode,
    outputMode: prepared.meta.outputMode,
    ...(prepared.request.historyBootstrap
      ? {
          historyBootstrap: {
            historyItemCount:
              prepared.request.endpoint === '/v1/chat/completions'
                ? prepared.request.historyBootstrap.historyMessages.length
                : prepared.request.historyBootstrap.historyItems.length,
            latestActionableUserTurnIndex:
              prepared.request.historyBootstrap.latestActionableUserTurn.itemIndex,
            latestTurnFileCount:
              prepared.request.endpoint === '/v1/chat/completions'
                ? 0
                : prepared.request.historyBootstrap.latestTurnItems.filter(isResponsesInputFileItem).length,
            artifactFileCount: countOpenAIHttpHistoryBootstrapArtifacts(
              prepared.cleanup?.stagedInputFiles,
            ),
          },
        }
      : {}),
    ...(prepared.request.endpoint === '/v1/responses'
      ? {
          previousResponseId: prepared.request.previousResponseId,
          store: prepared.request.store,
          restoredSessionId: prepared.execution.reply.sessionId ?? null,
        }
      : {}),
  }
}

function countOpenAIHttpHistoryBootstrapArtifacts(
  stagedInputFiles: readonly OpenAIHttpStagedInputFile[] | undefined,
): number {
  if (!stagedInputFiles) {
    return 0
  }

  return stagedInputFiles.filter(file => file.source === 'history-bootstrap-artifact').length
}

function resolveOpenAIResponsesPromptMessages(input: {
  request: OpenAIResponsesSubsetRequest
  normalizedInput: OpenAIHttpPreparedResponsesInput
}): OpenAIResponsesTextInputMessage[] {
  if (input.request.historyBootstrap === null) {
    return input.normalizedInput.textMessages
  }

  const latestTurnMessages: OpenAIResponsesTextInputMessage[] = []
  for (const item of input.request.historyBootstrap.latestTurnItems) {
    if (isOpenAIResponsesTextInputMessage(item)) {
      latestTurnMessages.push(item)
    }
  }

  return latestTurnMessages
}

function resolveOpenAIHttpHistoryBootstrapArtifact(input: {
  endpoint: OpenAIHttpPreparedReplyExecution['request']['endpoint']
  requestClassification: OpenAIHttpPreparedReplyExecution['request']['requestClassification']
  historyBootstrap: OpenAIHttpPreparedReplyExecution['request']['historyBootstrap']
  stagedInputFiles?: readonly OpenAIHttpStagedInputFile[] | undefined
}): OpenAIHttpStagedInputFile | null {
  const { requestInputFiles, historyBootstrapArtifacts } = partitionOpenAIHttpStagedInputFiles({
    endpoint: input.endpoint,
    stagedInputFiles: input.stagedInputFiles,
  })

  if (input.endpoint === '/v1/chat/completions' && requestInputFiles.length > 0) {
    throw new Error(
      'OpenAI HTTP chat completions cannot receive request-input staged files in the current subset.',
    )
  }

  if (input.historyBootstrap === null) {
    if (historyBootstrapArtifacts.length > 0) {
      throw new Error(
        'OpenAI HTTP new-turn or continuation request unexpectedly received a staged history bootstrap artifact.',
      )
    }
    return null
  }

  if (input.requestClassification !== 'history-bootstrap') {
    throw new Error(
      'OpenAI HTTP request carried history bootstrap slices without a history-bootstrap classification.',
    )
  }

  if (historyBootstrapArtifacts.length !== 1) {
    throw new Error(
      `OpenAI HTTP history bootstrap request expected exactly 1 staged bootstrap artifact, but resolved ${String(historyBootstrapArtifacts.length)}.`,
    )
  }

  return historyBootstrapArtifacts[0] ?? null
}

function partitionOpenAIHttpStagedInputFiles(input: {
  endpoint: OpenAIHttpPreparedReplyExecution['request']['endpoint']
  stagedInputFiles?: readonly OpenAIHttpStagedInputFile[] | undefined
}): {
  requestInputFiles: OpenAIHttpStagedInputFile[]
  historyBootstrapArtifacts: OpenAIHttpStagedInputFile[]
} {
  const stagedInputFiles = input.stagedInputFiles ? [...input.stagedInputFiles] : []
  const requestInputFiles: OpenAIHttpStagedInputFile[] = []
  const historyBootstrapArtifacts: OpenAIHttpStagedInputFile[] = []

  for (const stagedFile of stagedInputFiles) {
    if (stagedFile.endpoint !== input.endpoint) {
      throw new Error(
        `OpenAI HTTP staged input file ${stagedFile.stageId} targets ${stagedFile.endpoint}, but the request endpoint is ${input.endpoint}.`,
      )
    }

    if (stagedFile.source === 'history-bootstrap-artifact') {
      historyBootstrapArtifacts.push(stagedFile)
      continue
    }

    requestInputFiles.push(stagedFile)
  }

  return {
    requestInputFiles,
    historyBootstrapArtifacts,
  }
}

function normalizeResponsesExecutionInput(input: {
  request: OpenAIResponsesSubsetRequest
  stagedInputFiles?: readonly OpenAIHttpStagedInputFile[] | undefined
}): OpenAIHttpPreparedResponsesInput {
  const stagedInputFiles = input.stagedInputFiles ? [...input.stagedInputFiles] : []
  const { requestInputFiles, historyBootstrapArtifacts } = partitionOpenAIHttpStagedInputFiles({
    endpoint: input.request.endpoint,
    stagedInputFiles,
  })

  let historyBootstrapArtifact: OpenAIHttpStagedInputFile | null = null
  if (input.request.historyBootstrap === null) {
    if (historyBootstrapArtifacts.length > 0) {
      throw new Error(
        'OpenAI HTTP new-turn or continuation responses request unexpectedly received a staged history bootstrap artifact.',
      )
    }
  } else {
    if (historyBootstrapArtifacts.length !== 1) {
      throw new Error(
        `OpenAI HTTP responses history bootstrap request expected exactly 1 staged bootstrap artifact, but resolved ${String(historyBootstrapArtifacts.length)}.`,
      )
    }
    historyBootstrapArtifact = historyBootstrapArtifacts[0] ?? null
  }

  if (typeof input.request.input === 'string') {
    if (requestInputFiles.length > 0) {
      throw new Error(
        'OpenAI HTTP responses staging produced files for a string-only input request.',
      )
    }

    const message = { role: 'user', content: input.request.input } satisfies OpenAIResponsesTextInputMessage
    return {
      orderedItems: [
        {
          kind: 'message',
          message,
        },
      ],
      textMessages: [message],
      requestStagedFiles: [],
      historyBootstrapArtifact,
      stagedFiles: stagedInputFiles,
    }
  }

  const expectedFileCount = input.request.input.filter(isResponsesInputFileItem).length
  if (expectedFileCount !== requestInputFiles.length) {
    throw new Error(
      `OpenAI HTTP responses request expected ${String(expectedFileCount)} staged input file(s), but resolved ${String(requestInputFiles.length)}.`,
    )
  }

  const orderedItems: OpenAIHttpPreparedResponsesInput['orderedItems'] = []
  const textMessages: OpenAIResponsesTextInputMessage[] = []
  let stagedFileIndex = 0

  for (const item of input.request.input) {
    if (isResponsesInputFileItem(item)) {
      const stagedFile = requestInputFiles[stagedFileIndex]
      if (!stagedFile) {
        throw new Error(
          'OpenAI HTTP responses request with `input_file` reached the reply bridge without a staged file record.',
        )
      }
      orderedItems.push({
        kind: 'input_file',
        stagedFile,
      })
      stagedFileIndex += 1
      continue
    }

    orderedItems.push({
      kind: 'message',
      message: item,
    })
    textMessages.push(item)
  }

  return {
    orderedItems,
    textMessages,
    requestStagedFiles: requestInputFiles,
    historyBootstrapArtifact,
    stagedFiles: stagedInputFiles,
  }
}

function isOpenAIResponsesTextInputMessage(
  item: OpenAIResponsesInputItem,
): item is OpenAIResponsesTextInputMessage {
  return !isResponsesInputFileItem(item)
}

function isResponsesInputFileItem(
  item: OpenAIResponsesInputItem,
): item is OpenAIResponsesInputFileItem {
  return typeof item === 'object' && item !== null && 'type' in item
}
