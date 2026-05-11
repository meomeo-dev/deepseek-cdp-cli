import { createHash } from 'node:crypto'
import type { HttpRouteContext, HttpRouteDefinition } from './httpServer.js'
import { createHttpServiceError } from './httpErrors.js'
import { buildDeepSeekBufferedReplyOutput } from '../../application/services/deepSeekReplyOutputOrchestrator.js'
import {
  cleanupOpenAIHttpPreparedReplyExecutionArtifacts,
  executeOpenAIHttpReplyBridge,
  prepareOpenAIChatCompletionsReplyExecution,
  prepareOpenAIResponsesReplyExecution,
  resolveOpenAIHttpExecutionFailure,
} from '../../application/services/openaiHttpReplyBridge.js'
import type { executeDeepSeekReply } from '../../application/services/executeDeepSeekReply.js'
import { resolveDeepSeekSessionTarget } from '../../infrastructure/deepseek/deepSeekSessionRestore.js'
import {
  cleanupOpenAIHttpStagedInputFiles,
  stageOpenAIHttpInputFiles,
} from '../../infrastructure/openai/openaiHttpInputFileStaging.js'
import { stageOpenAIHttpHistoryBootstrapArtifact } from '../../infrastructure/openai/openaiHttpHistoryBootstrapArtifacts.js'
import type {
  OpenAIHttpStagedInputFile,
  OpenAIResponsesInputFileItem,
} from '../../types/openai-http-service.types.js'
import {
  createOpenAIHttpResponseHandleRecordFromReply,
  deleteOpenAIHttpResponseHandleRecord,
  loadOpenAIHttpResponseHandleRecord,
  saveOpenAIHttpResponseHandleRecord,
} from '../../infrastructure/openai/openaiHttpResponseHandleRegistry.js'
import {
  createOpenAIHttpChatCompletionRecordFromReply,
  deleteOpenAIHttpChatCompletionRecord,
  listOpenAIHttpChatCompletionRecords,
  loadOpenAIHttpChatCompletionRecord,
  saveOpenAIHttpChatCompletionRecord,
  updateOpenAIHttpChatCompletionRecordMetadata,
} from '../../infrastructure/openai/openaiHttpChatCompletionRegistry.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  OpenAIChatCompletionsTextMessage,
  OpenAIHttpExecutionEnvironment,
  OpenAIHttpPreparedReplyExecution,
  OpenAIResponsesInputItem,
} from '../../types/openai-http-service.types.js'
import type {
  OpenAIChatCompletionDeletedObject,
  OpenAIChatCompletionListObject,
  OpenAIChatCompletionMessageListObject,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionStoredMessage,
} from '../../types/openai-chat-completions.types.js'
import type {
  OpenAIResponseObject,
  OpenAIResponsesDeletedObject,
  OpenAIResponsesInputContent,
  OpenAIResponsesInputMessageItem,
  OpenAIResponsesItemListObject,
} from '../../types/openai-responses.types.js'
import { createOpenAIChatCompletionsSseController } from './openaiChatCompletionsSse.js'
import { createOpenAIResponsesSseController } from './openaiResponsesSse.js'
import { createDefaultOpenAIHttpExecutionEnvironment } from './openaiHttpExecutionEnvironment.js'
import {
  assertOpenAIRequestUsesCurrentlyImplementedFeatures,
  parseOpenAIJsonBody,
  validateOptionalMetadata,
  validateOpenAIChatCompletionsRequest,
  validateOpenAIResponsesRequest,
} from './openaiRequestValidators.js'

export interface OpenAIHttpRouteOptions {
  environment?: OpenAIHttpExecutionEnvironment | undefined
  executeReply?: typeof executeDeepSeekReply | undefined
  logger?: RuntimeLogger | undefined
}

interface ResolvedOpenAIHttpRouteOptions {
  environment: OpenAIHttpExecutionEnvironment
  executeReply?: typeof executeDeepSeekReply | undefined
  logger?: RuntimeLogger | undefined
}

const RESPONSE_ROUTE_PARAM_PATTERNS = {
  response_id: /^resp_[a-zA-Z0-9._-]+$/u,
} as const

const CHAT_COMPLETION_ROUTE_PARAM_PATTERNS = {
  completion_id: /^chatcmpl[-_][a-zA-Z0-9._-]+$/u,
} as const

export function buildOpenAIHttpRoutes(
  options: OpenAIHttpRouteOptions = {},
): HttpRouteDefinition[] {
  const resolved = resolveOpenAIHttpRouteOptions(options)

  return [
    buildChatCompletionsRoute(resolved),
    buildListStoredChatCompletionsRoute(resolved),
    buildRetrieveStoredChatCompletionRoute(resolved),
    buildUpdateStoredChatCompletionRoute(resolved),
    buildDeleteStoredChatCompletionRoute(resolved),
    buildListStoredChatCompletionMessagesRoute(resolved),
    buildCreateConversationRoute(),
    buildRetrieveConversationRoute(),
    buildDeleteConversationRoute(),
    buildUpdateConversationRoute(),
    buildCreateConversationItemsRoute(),
    buildListConversationItemsRoute(),
    buildRetrieveConversationItemRoute(),
    buildDeleteConversationItemRoute(),
    buildResponsesRoute(resolved),
    buildRetrieveStoredResponseRoute(resolved),
    buildDeleteStoredResponseRoute(resolved),
    buildCancelStoredResponseRoute(resolved),
    buildListStoredResponseInputItemsRoute(resolved),
    buildResponsesInputTokensRoute(),
    buildResponsesCompactRoute(),
  ]
}

function buildChatCompletionsRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.chat-completions',
    surface: 'openai',
    method: 'POST',
    path: '/v1/chat/completions',
    async handler(context) {
      const body = parseOpenAIJsonBody(await context.readBody())
      const request = validateOpenAIChatCompletionsRequest(body)
      assertOpenAIRequestUsesCurrentlyImplementedFeatures(request)
      const stagedInputFiles = await stageOpenAIChatCompletionsRequestArtifacts({
        requestId: context.requestId,
        request,
        environment: options.environment,
      })
      let prepared:
        | ReturnType<typeof prepareOpenAIChatCompletionsReplyExecution>
        | null = null

      try {
        prepared = prepareOpenAIChatCompletionsReplyExecution({
          requestId: context.requestId,
          request,
          environment: options.environment,
          stagedInputFiles,
        })

        if (request.stream) {
          await handleStreamingChatCompletionsRequest(context.response, prepared, options)
          return
        }

        await handleBufferedChatCompletionsRequest(context.response, prepared, options)
      } finally {
        if (prepared !== null) {
          await cleanupOpenAIHttpPreparedReplyExecutionArtifacts(prepared, {
            sessionStoreDir: options.environment.sessionStoreDir,
          })
        } else if (stagedInputFiles.length > 0) {
          await cleanupOpenAIHttpStagedInputFiles({
            stagedFiles: stagedInputFiles,
            sessionStoreDir: options.environment.sessionStoreDir,
          })
        }
      }
    },
  }
}

function buildListStoredChatCompletionsRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.chat-completions.list',
    surface: 'openai',
    method: 'GET',
    path: '/v1/chat/completions',
    async handler(context) {
      const query = parseStoredChatCompletionsListQuery(context)
      const records = await listOpenAIHttpChatCompletionRecords({
        sessionStoreDir: options.environment.sessionStoreDir,
      })
      const filteredRecords = sortStoredChatCompletionRecords(
        records.filter(record => doesStoredChatCompletionRecordMatchListQuery(record, query)),
        query.order,
      )
      const startIndex =
        query.after === null
          ? 0
          : resolveStoredChatCompletionStartIndex(filteredRecords, query.after)
      const pagedRecords = filteredRecords.slice(startIndex, startIndex + query.limit)
      const payload: OpenAIChatCompletionListObject = {
        object: 'list',
        data: pagedRecords.map(record => record.completion),
        first_id: pagedRecords[0]?.completion.id ?? null,
        last_id: pagedRecords[pagedRecords.length - 1]?.completion.id ?? null,
        has_more: startIndex + query.limit < filteredRecords.length,
      }

      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(payload))
    },
  }
}

function buildRetrieveStoredChatCompletionRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.chat-completions.retrieve',
    surface: 'openai',
    method: 'GET',
    path: '/v1/chat/completions/{completion_id}',
    pathParamPatterns: CHAT_COMPLETION_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      assertNoQueryParams(context)
      const completionId = readRequiredPathParam(context, 'completion_id')
      const record = await loadStoredChatCompletionRecordOrThrow(
        completionId,
        options.environment,
      )

      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(record.completion))
    },
  }
}

function buildUpdateStoredChatCompletionRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.chat-completions.update',
    surface: 'openai',
    method: 'POST',
    path: '/v1/chat/completions/{completion_id}',
    pathParamPatterns: CHAT_COMPLETION_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      assertNoQueryParams(context)
      const completionId = readRequiredPathParam(context, 'completion_id')
      await loadStoredChatCompletionRecordOrThrow(completionId, options.environment)
      const body = parseOpenAIJsonBody(await context.readBody())
      const metadata = validateStoredChatCompletionUpdateRequest(body)
      const updated = await updateOpenAIHttpChatCompletionRecordMetadata(
        completionId,
        metadata,
        {
          sessionStoreDir: options.environment.sessionStoreDir,
        },
      )
      if (updated === null) {
        throw createStoredChatCompletionNotFoundError(completionId)
      }

      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(updated.completion))
    },
  }
}

function buildDeleteStoredChatCompletionRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.chat-completions.delete',
    surface: 'openai',
    method: 'DELETE',
    path: '/v1/chat/completions/{completion_id}',
    pathParamPatterns: CHAT_COMPLETION_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      assertNoQueryParams(context)
      const completionId = readRequiredPathParam(context, 'completion_id')
      await loadStoredChatCompletionRecordOrThrow(completionId, options.environment)
      await deleteOpenAIHttpChatCompletionRecord(completionId, {
        sessionStoreDir: options.environment.sessionStoreDir,
      })

      const payload: OpenAIChatCompletionDeletedObject = {
        id: completionId,
        object: 'chat.completion.deleted',
        deleted: true,
      }
      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(payload))
    },
  }
}

function buildListStoredChatCompletionMessagesRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.chat-completions.messages',
    surface: 'openai',
    method: 'GET',
    path: '/v1/chat/completions/{completion_id}/messages',
    pathParamPatterns: CHAT_COMPLETION_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      const completionId = readRequiredPathParam(context, 'completion_id')
      const query = parseStoredChatCompletionMessagesQuery(context)
      const record = await loadStoredChatCompletionRecordOrThrow(
        completionId,
        options.environment,
      )
      const storedMessages = buildStoredChatCompletionMessages(record.messages, completionId)
      const orderedMessages =
        query.order === 'asc'
          ? storedMessages
          : [...storedMessages].reverse()
      const startIndex =
        query.after === null
          ? 0
          : resolveStoredChatCompletionMessageStartIndex(orderedMessages, query.after)
      const pagedMessages = orderedMessages.slice(startIndex, startIndex + query.limit)
      const payload: OpenAIChatCompletionMessageListObject = {
        object: 'list',
        data: pagedMessages,
        first_id: pagedMessages[0]?.id ?? null,
        last_id: pagedMessages[pagedMessages.length - 1]?.id ?? null,
        has_more: startIndex + query.limit < orderedMessages.length,
      }

      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(payload))
    },
  }
}

function buildCreateConversationRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.create',
    method: 'POST',
    path: '/v1/conversations',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. This service only exposes server-side continuation through `/v1/responses.previous_response_id + store` and does not implement conversation objects or lifecycle APIs.',
  })
}

function buildRetrieveConversationRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.retrieve',
    method: 'GET',
    path: '/v1/conversations/{conversation_id}',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. No authoritative conversation object registry is available behind this compatibility surface.',
  })
}

function buildDeleteConversationRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.delete',
    method: 'DELETE',
    path: '/v1/conversations/{conversation_id}',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. Conversation deletion cannot be truthfully exposed because this service does not implement OpenAI conversation objects.',
  })
}

function buildUpdateConversationRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.update',
    method: 'POST',
    path: '/v1/conversations/{conversation_id}',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. Conversation metadata updates are unavailable because conversation objects are not implemented.',
  })
}

function buildCreateConversationItemsRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.items.create',
    method: 'POST',
    path: '/v1/conversations/{conversation_id}/items',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}/items` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. This service does not expose authoritative conversation item lifecycle APIs.',
  })
}

function buildListConversationItemsRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.items.list',
    method: 'GET',
    path: '/v1/conversations/{conversation_id}/items',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}/items` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. Use `/v1/responses/{response_id}/input_items` for the currently implemented stored input-item subset.',
  })
}

function buildRetrieveConversationItemRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.items.retrieve',
    method: 'GET',
    path: '/v1/conversations/{conversation_id}/items/{item_id}',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}/items/{item_id}` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. No authoritative conversation item registry exists behind this compatibility surface.',
  })
}

function buildDeleteConversationItemRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.conversations.items.delete',
    method: 'DELETE',
    path: '/v1/conversations/{conversation_id}/items/{item_id}',
    code: 'unsupported_conversation',
    message:
      'The official `/v1/conversations/{conversation_id}/items/{item_id}` route family is not supported in the current DeepSeek CDP-backed OpenAI subset. Conversation item deletion cannot be truthfully exposed because conversation items are not implemented.',
  })
}

async function handleBufferedChatCompletionsRequest(
  response: HttpRouteContext['response'],
  prepared: ReturnType<typeof prepareOpenAIChatCompletionsReplyExecution>,
  options: ResolvedOpenAIHttpRouteOptions,
): Promise<void> {
  let executed
  try {
    executed = await executePreparedOpenAIReply(prepared, options)
  } catch (error) {
    throw toOpenAIHttpExecutionError(error)
  }

  const output = buildBufferedOpenAIChatCompletionPayload(executed)

  await persistOpenAIChatCompletionRecord(
    executed,
    output,
    options.environment,
  )

  response.statusCode = 200
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(output))
}

async function handleStreamingChatCompletionsRequest(
  response: HttpRouteContext['response'],
  prepared: ReturnType<typeof prepareOpenAIChatCompletionsReplyExecution>,
  options: ResolvedOpenAIHttpRouteOptions,
): Promise<void> {
  const sse = createOpenAIChatCompletionsSseController({
    response,
    model: prepared.meta.model,
    outputMode: prepared.meta.outputMode,
    includeUsage: prepared.request.streamOptions?.includeUsage ?? false,
  })

  try {
    const executed = await executePreparedOpenAIReply(prepared, options, {
      onEvent: event => {
        sse.onEvent(event)
      },
    })
    const completion = buildBufferedOpenAIChatCompletionPayload(executed)
    await persistOpenAIChatCompletionRecord(
      executed,
      completion,
      options.environment,
    )
    sse.finish(executed.delivery.result)
  } catch (error) {
    if (sse.hasStarted()) {
      sse.abort()
      return
    }

    throw toOpenAIHttpExecutionError(error)
  }
}

function buildResponsesRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.responses',
    surface: 'openai',
    method: 'POST',
    path: '/v1/responses',
    async handler(context) {
      const body = parseOpenAIJsonBody(await context.readBody())
      const request = validateOpenAIResponsesRequest(body)
      assertOpenAIRequestUsesCurrentlyImplementedFeatures(request)
      const responseHandle = await resolveOpenAIResponsesContinuationHandle(
        request,
        options.environment,
      )
      const stagedInputFiles = await stageOpenAIResponsesRequestArtifacts({
        requestId: context.requestId,
        request,
        environment: options.environment,
      })
      let prepared:
        | ReturnType<typeof prepareOpenAIResponsesReplyExecution>
        | null = null

      try {
        prepared = prepareOpenAIResponsesReplyExecution({
          requestId: context.requestId,
          request,
          environment: options.environment,
          stagedInputFiles,
          ...(responseHandle ? { responseHandle } : {}),
        })

        if (request.stream) {
          await handleStreamingResponsesRequest(context.response, prepared, options)
          return
        }

        await handleBufferedResponsesRequest(context.response, prepared, options)
      } finally {
        if (prepared !== null) {
          await cleanupOpenAIHttpPreparedReplyExecutionArtifacts(prepared, {
            sessionStoreDir: options.environment.sessionStoreDir,
          })
        } else if (stagedInputFiles.length > 0) {
          await cleanupOpenAIHttpStagedInputFiles({
            stagedFiles: stagedInputFiles,
            sessionStoreDir: options.environment.sessionStoreDir,
          })
        }
      }
    },
  }
}

function buildRetrieveStoredResponseRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.responses.retrieve',
    surface: 'openai',
    method: 'GET',
    path: '/v1/responses/{response_id}',
    pathParamPatterns: RESPONSE_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      assertNoUnsupportedResponsesRetrieveQueryParams(context)
      const responseId = readRequiredPathParam(context, 'response_id')
      const record = await loadStoredResponseRecordOrThrow(responseId, options.environment)
      if (record.response === null) {
        throw createStoredResponseStateUnavailableError(
          'stored_response_snapshot_unavailable',
          `Response ${responseId} predates stored response snapshot persistence and cannot be retrieved from the current registry.`,
        )
      }

      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(record.response))
    },
  }
}

function buildDeleteStoredResponseRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.responses.delete',
    surface: 'openai',
    method: 'DELETE',
    path: '/v1/responses/{response_id}',
    pathParamPatterns: RESPONSE_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      assertNoQueryParams(context)
      const responseId = readRequiredPathParam(context, 'response_id')
      await loadStoredResponseRecordOrThrow(responseId, options.environment)
      await deleteOpenAIHttpResponseHandleRecord(responseId, {
        sessionStoreDir: options.environment.sessionStoreDir,
      })

      const payload: OpenAIResponsesDeletedObject = {
        id: responseId,
        object: 'response',
        deleted: true,
      }
      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(payload))
    },
  }
}

function buildCancelStoredResponseRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.responses.cancel',
    surface: 'openai',
    method: 'POST',
    path: '/v1/responses/{response_id}/cancel',
    pathParamPatterns: RESPONSE_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      assertNoQueryParams(context)
      const responseId = readRequiredPathParam(context, 'response_id')
      await loadStoredResponseRecordOrThrow(responseId, options.environment)
      throw createHttpServiceError({
        statusCode: 400,
        surface: 'openai',
        type: 'invalid_request_error',
        code: 'response_not_cancellable',
        message:
          `Response ${responseId} cannot be cancelled because the current DeepSeek CDP-backed /v1/responses surface does not create background responses.`,
      })
    },
  }
}

function buildListStoredResponseInputItemsRoute(
  options: ResolvedOpenAIHttpRouteOptions,
): HttpRouteDefinition {
  return {
    id: 'openai.responses.input-items',
    surface: 'openai',
    method: 'GET',
    path: '/v1/responses/{response_id}/input_items',
    pathParamPatterns: RESPONSE_ROUTE_PARAM_PATTERNS,
    async handler(context) {
      const responseId = readRequiredPathParam(context, 'response_id')
      const query = parseResponsesInputItemsQuery(context)
      const record = await loadStoredResponseRecordOrThrow(responseId, options.environment)
      if (record.inputItems === null) {
        throw createStoredResponseStateUnavailableError(
          'stored_response_input_items_unavailable',
          `Response ${responseId} predates stored input-item persistence and cannot list input items from the current registry.`,
        )
      }

      const orderedItems =
        query.order === 'asc'
          ? record.inputItems
          : [...record.inputItems].reverse()
      const startIndex =
        query.after === null
          ? 0
          : resolveInputItemsStartIndex(orderedItems, query.after)
      const pagedItems = orderedItems.slice(startIndex, startIndex + query.limit)
      const payload: OpenAIResponsesItemListObject = {
        object: 'list',
        data: pagedItems,
        first_id: pagedItems[0]?.id ?? null,
        last_id: pagedItems[pagedItems.length - 1]?.id ?? null,
        has_more: startIndex + query.limit < orderedItems.length,
      }

      context.response.statusCode = 200
      context.response.setHeader('content-type', 'application/json; charset=utf-8')
      context.response.end(JSON.stringify(payload))
    },
  }
}

function buildResponsesInputTokensRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.responses.input-tokens',
    method: 'POST',
    path: '/v1/responses/input_tokens',
    code: 'unsupported_response_input_tokens',
    message:
      'The official `POST /v1/responses/input_tokens` route is not supported in the current DeepSeek CDP-backed OpenAI subset. This bridge cannot truthfully expose OpenAI-compatible token counts for DeepSeek-backed requests.',
  })
}

function buildResponsesCompactRoute(): HttpRouteDefinition {
  return buildUnsupportedOpenAIRoute({
    id: 'openai.responses.compact',
    method: 'POST',
    path: '/v1/responses/compact',
    code: 'unsupported_response_compact',
    message:
      'The official `POST /v1/responses/compact` route is not supported in the current DeepSeek CDP-backed OpenAI subset. Response compaction and compacted response objects are not implemented behind this compatibility surface.',
  })
}

function resolveOpenAIHttpRouteOptions(
  options: OpenAIHttpRouteOptions,
): ResolvedOpenAIHttpRouteOptions {
  return {
    environment: options.environment ?? createDefaultOpenAIHttpExecutionEnvironment(),
    executeReply: options.executeReply,
    logger: options.logger,
  }
}

async function executePreparedOpenAIReply<
  TPrepared extends OpenAIHttpPreparedReplyExecution,
>(
  prepared: TPrepared,
  options: ResolvedOpenAIHttpRouteOptions,
  live?: Parameters<typeof executeOpenAIHttpReplyBridge>[0]['live'],
) {
  return executeOpenAIHttpReplyBridge({
    prepared,
    ...(options.executeReply ? { executeReply: options.executeReply } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(live ? { live } : {}),
  })
}

async function handleBufferedResponsesRequest(
  response: HttpRouteContext['response'],
  prepared: ReturnType<typeof prepareOpenAIResponsesReplyExecution>,
  options: ResolvedOpenAIHttpRouteOptions,
): Promise<void> {
  let executed
  try {
    executed = await executePreparedOpenAIReply(prepared, options)
  } catch (error) {
    throw toOpenAIHttpExecutionError(error)
  }

  const output = buildBufferedOpenAIResponsePayload(executed)
  await persistOpenAIResponsesHandle(executed, output, options.environment)

  response.statusCode = 200
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(output))
}

async function handleStreamingResponsesRequest(
  response: HttpRouteContext['response'],
  prepared: ReturnType<typeof prepareOpenAIResponsesReplyExecution>,
  options: ResolvedOpenAIHttpRouteOptions,
): Promise<void> {
  const sse = createOpenAIResponsesSseController({
    response,
    outputMode: prepared.meta.outputMode,
    adapterOptions: buildOpenAIResponsesAdapterOptions(prepared),
  })

  try {
    const executed = await executePreparedOpenAIReply(prepared, options, {
      onEvent: event => {
        sse.onEvent(event)
      },
    })
    const responseObject = buildBufferedOpenAIResponsePayload(executed)
    await persistOpenAIResponsesHandle(
      executed,
      responseObject,
      options.environment,
    )
    sse.finish(executed.delivery.result)
  } catch (error) {
    if (sse.hasStarted()) {
      sse.fail(resolveOpenAIHttpExecutionFailure(error, prepared))
      return
    }

    throw toOpenAIHttpExecutionError(error)
  }
}

function toOpenAIHttpExecutionError(error: unknown) {
  const failure = resolveOpenAIHttpExecutionFailure(error)
  return createHttpServiceError({
    statusCode: failure.statusCode,
    surface: 'openai',
    type: failure.type,
    code: failure.code,
    message: failure.message,
  })
}

function buildOpenAIResponsesAdapterOptions(
  prepared: ReturnType<typeof prepareOpenAIResponsesReplyExecution>,
) {
  return {
    model: prepared.meta.model,
    instructions: prepared.request.instructions,
    previousResponseId: prepared.request.previousResponseId,
    store: resolveOpenAIResponsesEffectiveStore(prepared.request.store),
    ...(prepared.request.metadata ? { metadata: prepared.request.metadata } : {}),
  }
}

function buildOpenAIChatCompletionsAdapterOptions(
  prepared: ReturnType<typeof prepareOpenAIChatCompletionsReplyExecution>,
) {
  return {
    model: prepared.meta.model,
    includeUsage: prepared.request.streamOptions?.includeUsage ?? false,
    ...(prepared.request.metadata ? { metadata: prepared.request.metadata } : {}),
  }
}

function buildBufferedOpenAIChatCompletionPayload(
  executed: Awaited<
    ReturnType<typeof executePreparedOpenAIReply<ReturnType<typeof prepareOpenAIChatCompletionsReplyExecution>>>
  >,
): OpenAIChatCompletionResponse {
  const output = buildDeepSeekBufferedReplyOutput({
    result: executed.delivery.result,
    outputMode: executed.delivery.outputMode,
    openAIAdapterOptions: buildOpenAIChatCompletionsAdapterOptions(executed.prepared),
  })

  if (output.format !== 'json' || output.jsonShape !== 'openai-chat-completions') {
    throw createHttpServiceError({
      statusCode: 500,
      surface: 'openai',
      type: 'api_error',
      code: 'invalid_chat_completion_output',
      message:
        'OpenAI HTTP route /v1/chat/completions produced a non-chat-completion buffered payload.',
    })
  }

  return output.data as OpenAIChatCompletionResponse
}

function buildBufferedOpenAIResponsePayload(
  executed: Awaited<
    ReturnType<typeof executePreparedOpenAIReply<ReturnType<typeof prepareOpenAIResponsesReplyExecution>>>
  >,
): OpenAIResponseObject {
  const output = buildDeepSeekBufferedReplyOutput({
    result: executed.delivery.result,
    outputMode: executed.delivery.outputMode,
    openAIAdapterOptions: buildOpenAIResponsesAdapterOptions(executed.prepared),
  })

  if (output.format !== 'json' || output.jsonShape !== 'openai-responses') {
    throw createHttpServiceError({
      statusCode: 500,
      surface: 'openai',
      type: 'api_error',
      code: 'invalid_response_object_output',
      message:
        'OpenAI HTTP route /v1/responses produced a non-response buffered payload.',
    })
  }

  return output.data as OpenAIResponseObject
}

async function resolveOpenAIResponsesContinuationHandle(
  request: ReturnType<typeof validateOpenAIResponsesRequest>,
  environment: OpenAIHttpExecutionEnvironment,
) {
  if (request.previousResponseId === null) {
    return null
  }

  const record = await loadOpenAIHttpResponseHandleRecord(
    request.previousResponseId,
    {
      sessionStoreDir: environment.sessionStoreDir,
    },
  )
  if (record !== null) {
    if (!record.store) {
      throw createHttpServiceError({
        statusCode: 400,
        surface: 'openai',
        type: 'invalid_request_error',
        code: 'store_disabled_previous_response_id',
        message:
          `Response ${request.previousResponseId} was created with \`store=false\` and cannot be reused via \`previous_response_id\`.`,
      })
    }

    if (record.model !== request.model) {
      throw createHttpServiceError({
        statusCode: 400,
        surface: 'openai',
        type: 'invalid_request_error',
        code: 'invalid_previous_response_id_model_mismatch',
        message:
          `Response ${request.previousResponseId} was created for model \`${record.model}\`, but this request asked for \`${request.model}\`.`,
      })
    }

    try {
      await resolveDeepSeekSessionTarget({
        sessionId: record.sessionId,
        sessionFile: record.sessionFile,
        sessionStoreDir: environment.sessionStoreDir,
      })
    } catch (error) {
      throw createHttpServiceError({
        statusCode: 400,
        surface: 'openai',
        type: 'invalid_request_error',
        code: 'invalid_previous_response_id_session_mismatch',
        message: buildOpenAIResponsesSessionMismatchMessage(
          request.previousResponseId,
          error,
        ),
      })
    }

    return record
  }

  throw createHttpServiceError({
    statusCode: 400,
    surface: 'openai',
    type: 'invalid_request_error',
    code: 'invalid_previous_response_id',
    message:
      `Unknown \`previous_response_id\` ${request.previousResponseId}; no stored OpenAI response handle was found.`,
  })
}

async function persistOpenAIResponsesHandle(
  executed: Awaited<
    ReturnType<typeof executePreparedOpenAIReply<ReturnType<typeof prepareOpenAIResponsesReplyExecution>>>
  >,
  responseObject: OpenAIResponseObject,
  environment: OpenAIHttpExecutionEnvironment,
): Promise<void> {
  const request = executed.prepared.request
  if (request.endpoint !== '/v1/responses') {
    return
  }

  await saveOpenAIHttpResponseHandleRecord(
    createOpenAIHttpResponseHandleRecordFromReply({
      responseId: responseObject.id,
      model: executed.prepared.meta.model,
      store: resolveOpenAIResponsesEffectiveStore(request.store),
      metadata: responseObject.metadata,
      requestId: executed.prepared.meta.requestId,
      requestClassification: request.requestClassification,
      response: responseObject,
      inputItems: buildStoredResponseInputItems(responseObject.id, request.input),
      result: executed.delivery.result,
    }),
    {
      sessionStoreDir: environment.sessionStoreDir,
    },
  )
}

async function persistOpenAIChatCompletionRecord(
  executed: Awaited<
    ReturnType<typeof executePreparedOpenAIReply<ReturnType<typeof prepareOpenAIChatCompletionsReplyExecution>>>
  >,
  completion: OpenAIChatCompletionResponse,
  environment: OpenAIHttpExecutionEnvironment,
): Promise<void> {
  const request = executed.prepared.request
  const effectiveStore = resolveOpenAIChatCompletionsEffectiveStore(request.store)
  if (!effectiveStore) {
    return
  }

  await saveOpenAIHttpChatCompletionRecord(
    createOpenAIHttpChatCompletionRecordFromReply({
      model: executed.prepared.meta.model,
      store: effectiveStore,
      metadata: request.metadata ?? {},
      requestId: executed.prepared.meta.requestId,
      requestClassification: request.requestClassification,
      messages: request.messages,
      completion,
      result: executed.delivery.result,
    }),
    {
      sessionStoreDir: environment.sessionStoreDir,
    },
  )
}

function resolveOpenAIChatCompletionsEffectiveStore(
  store: boolean | null,
): boolean {
  return store ?? false
}

function resolveOpenAIResponsesEffectiveStore(
  store: boolean | null,
): boolean {
  return store ?? true
}

function buildUnsupportedOpenAIRoute(input: {
  id: string
  method: HttpRouteDefinition['method']
  path: string
  code: string
  message: string
}): HttpRouteDefinition {
  return {
    id: input.id,
    surface: 'openai',
    method: input.method,
    path: input.path,
    handler() {
      return Promise.reject(createHttpServiceError({
        statusCode: 400,
        surface: 'openai',
        type: 'invalid_request_error',
        code: input.code,
        message: input.message,
      }))
    },
  }
}

function buildOpenAIResponsesSessionMismatchMessage(
  previousResponseId: string,
  error: unknown,
): string {
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'stored session artifact is not recoverable.'

  return `Response ${previousResponseId} does not map to a recoverable stored session artifact: ${detail}`
}

function readRequiredPathParam(
  context: Pick<HttpRouteContext, 'path' | 'pathParams'>,
  name: string,
): string {
  const value = context.pathParams[name]
  if (typeof value === 'string' && value.trim()) {
    return value
  }

  throw createHttpServiceError({
    statusCode: 500,
    surface: 'openai',
    type: 'api_error',
    code: 'missing_route_path_param',
    message: `HTTP route ${context.path} is missing required path parameter \`${name}\`.`,
  })
}

function assertNoQueryParams(
  context: Pick<HttpRouteContext, 'searchParams'>,
): void {
  const firstEntry = context.searchParams.entries().next()
  if (firstEntry.done) {
    return
  }
  const [queryParamName] = firstEntry.value

  throw createUnsupportedQueryParameterError(
    queryParamName,
    `Query parameter \`${queryParamName}\` is not supported on this route in the current OpenAI compatibility subset.`,
  )
}

function assertNoUnsupportedResponsesRetrieveQueryParams(
  context: Pick<HttpRouteContext, 'searchParams'>,
): void {
  const queryKeys = [...new Set(context.searchParams.keys())]
  for (const key of queryKeys) {
    switch (key) {
      case 'include':
      case 'stream':
      case 'starting_after':
      case 'include_obfuscation':
        throw createUnsupportedQueryParameterError(
          key,
          `Query parameter \`${key}\` is part of the official GET /v1/responses/{response_id} surface but is not supported in the current stored-response subset.`,
        )
      default:
        throw createUnsupportedQueryParameterError(
          key,
          `Unknown query parameter \`${key}\` is not supported on GET /v1/responses/{response_id}.`,
        )
    }
  }
}

function parseStoredChatCompletionsListQuery(
  context: Pick<HttpRouteContext, 'searchParams'>,
): {
  limit: number
  order: 'asc' | 'desc'
  after: string | null
  model: string | null
  metadata: Record<string, string>
} {
  let limit = 20
  let order: 'asc' | 'desc' = 'asc'
  let after: string | null = null
  let model: string | null = null
  const metadata: Record<string, string> = {}

  const queryKeys = [...new Set(context.searchParams.keys())]
  for (const key of queryKeys) {
    switch (key) {
      case 'limit':
        limit = parseLimitQueryParam(context.searchParams, key)
        break
      case 'order':
        order = parseOrderQueryParam(context.searchParams, key)
        break
      case 'after':
        after = parseAfterQueryParam(context.searchParams, key)
        break
      case 'model':
        model = parseOptionalStringQueryParam(context.searchParams, key)
        break
      default:
        if (isMetadataQueryKey(key)) {
          const metadataKey = parseMetadataQueryKey(key)
          metadata[metadataKey] = parseMetadataQueryValue(
            context.searchParams,
            key,
            metadataKey,
          )
          break
        }

        throw createUnsupportedQueryParameterError(
          key,
          `Unknown query parameter \`${key}\` is not supported on GET /v1/chat/completions.`,
        )
    }
  }

  return {
    limit,
    order,
    after,
    model,
    metadata,
  }
}

function parseStoredChatCompletionMessagesQuery(
  context: Pick<HttpRouteContext, 'searchParams'>,
): {
  limit: number
  order: 'asc' | 'desc'
  after: string | null
} {
  let limit = 20
  let order: 'asc' | 'desc' = 'asc'
  let after: string | null = null

  const queryKeys = [...new Set(context.searchParams.keys())]
  for (const key of queryKeys) {
    switch (key) {
      case 'limit':
        limit = parseLimitQueryParam(context.searchParams, key)
        break
      case 'order':
        order = parseOrderQueryParam(context.searchParams, key)
        break
      case 'after':
        after = parseAfterQueryParam(context.searchParams, key)
        break
      default:
        throw createUnsupportedQueryParameterError(
          key,
          `Unknown query parameter \`${key}\` is not supported on GET /v1/chat/completions/{completion_id}/messages.`,
        )
    }
  }

  return {
    limit,
    order,
    after,
  }
}

function parseResponsesInputItemsQuery(
  context: Pick<HttpRouteContext, 'searchParams'>,
): {
  limit: number
  order: 'asc' | 'desc'
  after: string | null
} {
  let limit = 20
  let order: 'asc' | 'desc' = 'desc'
  let after: string | null = null

  const queryKeys = [...new Set(context.searchParams.keys())]
  for (const key of queryKeys) {
    switch (key) {
      case 'limit':
        limit = parseLimitQueryParam(context.searchParams, key)
        break
      case 'order':
        order = parseOrderQueryParam(context.searchParams, key)
        break
      case 'after':
        after = parseAfterQueryParam(context.searchParams, key)
        break
      case 'include':
        throw createUnsupportedQueryParameterError(
          key,
          'Query parameter `include` is part of the official input-items surface but is not supported in the current subset.',
        )
      default:
        throw createUnsupportedQueryParameterError(
          key,
          `Unknown query parameter \`${key}\` is not supported on GET /v1/responses/{response_id}/input_items.`,
        )
    }
  }

  return {
    limit,
    order,
    after,
  }
}

function parseLimitQueryParam(searchParams: URLSearchParams, key: string): number {
  const values = searchParams.getAll(key)
  if (values.length !== 1) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_limit',
      message: 'Query parameter `limit` must appear at most once.',
    })
  }

  const parsed = Number.parseInt(values[0] ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_limit',
      message: 'Query parameter `limit` must be an integer between 1 and 100.',
    })
  }

  return parsed
}

function parseOrderQueryParam(
  searchParams: URLSearchParams,
  key: string,
): 'asc' | 'desc' {
  const values = searchParams.getAll(key)
  if (values.length !== 1) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_order',
      message: 'Query parameter `order` must appear at most once.',
    })
  }

  const value = values[0]
  if (value !== 'asc' && value !== 'desc') {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_order',
      message: 'Query parameter `order` must be either `asc` or `desc`.',
    })
  }

  return value
}

function parseOptionalStringQueryParam(
  searchParams: URLSearchParams,
  key: string,
): string {
  const values = searchParams.getAll(key)
  if (values.length !== 1) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: `invalid_${sanitizeErrorCodeSegment(key)}`,
      message: `Query parameter \`${key}\` must appear at most once.`,
    })
  }

  const value = values[0]?.trim() ?? ''
  if (!value) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: `invalid_${sanitizeErrorCodeSegment(key)}`,
      message: `Query parameter \`${key}\` must be a non-empty string.`,
    })
  }

  return value
}

function isMetadataQueryKey(key: string): boolean {
  return key.startsWith('metadata[')
}

function parseMetadataQueryKey(key: string): string {
  const match = /^metadata\[([^\]]+)\]$/u.exec(key)
  if (!match?.[1]) {
    throw createUnsupportedQueryParameterError(
      'metadata',
      'Query parameters for metadata filters must use the official `metadata[key]=value` form.',
    )
  }

  return match[1]
}

function parseMetadataQueryValue(
  searchParams: URLSearchParams,
  rawKey: string,
  metadataKey: string,
): string {
  const values = searchParams.getAll(rawKey)
  if (values.length !== 1) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_metadata',
      message:
        `Metadata query parameter \`${rawKey}\` must appear at most once when filtering stored chat completions.`,
    })
  }

  if (!metadataKey.trim()) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_metadata',
      message: 'Metadata filter keys must be non-empty.',
    })
  }

  return values[0] ?? ''
}

function parseAfterQueryParam(
  searchParams: URLSearchParams,
  key: string,
): string | null {
  const values = searchParams.getAll(key)
  if (values.length !== 1) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_after',
      message: 'Query parameter `after` must appear at most once.',
    })
  }

  const value = values[0]?.trim() ?? ''
  if (!value) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_after',
      message: 'Query parameter `after` must be a non-empty item id.',
    })
  }

  return value
}

function resolveInputItemsStartIndex(
  items: OpenAIResponsesInputMessageItem[],
  after: string,
): number {
  const index = items.findIndex(item => item.id === after)
  if (index < 0) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_after',
      message: `Unknown \`after\` cursor ${after}; no stored response input item matched that id.`,
    })
  }

  return index + 1
}

function validateStoredChatCompletionUpdateRequest(
  body: Record<string, unknown>,
): Record<string, string> {
  for (const key of Object.keys(body)) {
    if (key === 'metadata') {
      continue
    }

    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: `unsupported_${sanitizeErrorCodeSegment(key)}`,
      message:
        `Stored chat completion updates only support the \`metadata\` field in the current compatibility subset; received unsupported field \`${key}\`.`,
    })
  }

  const metadata = validateOptionalMetadata(body['metadata'], 'metadata')
  if (metadata === null) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_metadata',
      message: '`metadata` is required when updating a stored chat completion.',
    })
  }

  return metadata
}

function doesStoredChatCompletionRecordMatchListQuery(
  record: Awaited<ReturnType<typeof listOpenAIHttpChatCompletionRecords>>[number],
  query: ReturnType<typeof parseStoredChatCompletionsListQuery>,
): boolean {
  if (!record.store) {
    return false
  }
  if (query.model !== null && record.model !== query.model) {
    return false
  }

  for (const [key, value] of Object.entries(query.metadata)) {
    if (record.metadata[key] !== value) {
      return false
    }
  }

  return true
}

function sortStoredChatCompletionRecords(
  records: Awaited<ReturnType<typeof listOpenAIHttpChatCompletionRecords>>,
  order: 'asc' | 'desc',
) {
  return [...records].sort((left, right) => {
    const createdDelta = left.completion.created - right.completion.created
    if (createdDelta !== 0) {
      return order === 'asc' ? createdDelta : -createdDelta
    }

    return order === 'asc'
      ? left.completion.id.localeCompare(right.completion.id)
      : right.completion.id.localeCompare(left.completion.id)
  })
}

function resolveStoredChatCompletionStartIndex(
  records: Awaited<ReturnType<typeof listOpenAIHttpChatCompletionRecords>>,
  after: string,
): number {
  const index = records.findIndex(record => record.completion.id === after)
  if (index < 0) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_after',
      message: `Unknown \`after\` cursor ${after}; no stored chat completion matched that id.`,
    })
  }

  return index + 1
}

function buildStoredChatCompletionMessages(
  messages: OpenAIChatCompletionsTextMessage[],
  completionId: string,
): OpenAIChatCompletionStoredMessage[] {
  return messages.map((message, index) => ({
    id: `${completionId}-${index}`,
    role: message.role,
    content: message.content,
    name: null,
    content_parts: null,
  }))
}

function resolveStoredChatCompletionMessageStartIndex(
  messages: OpenAIChatCompletionStoredMessage[],
  after: string,
): number {
  const index = messages.findIndex(message => message.id === after)
  if (index < 0) {
    throw createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_after',
      message: `Unknown \`after\` cursor ${after}; no stored chat completion message matched that id.`,
    })
  }

  return index + 1
}

async function loadStoredChatCompletionRecordOrThrow(
  completionId: string,
  environment: OpenAIHttpExecutionEnvironment,
) {
  const record = await loadOpenAIHttpChatCompletionRecord(completionId, {
    sessionStoreDir: environment.sessionStoreDir,
  })
  if (record === null) {
    throw createStoredChatCompletionNotFoundError(completionId)
  }
  if (!record.store) {
    throw createStoredChatCompletionNotStoredError(completionId)
  }
  return record
}

function createStoredChatCompletionNotFoundError(completionId: string) {
  return createHttpServiceError({
    statusCode: 404,
    surface: 'openai',
    type: 'invalid_request_error',
    code: 'invalid_completion_id',
    message: `No stored chat completion with id ${completionId} was found.`,
  })
}

function createStoredChatCompletionNotStoredError(completionId: string) {
  return createHttpServiceError({
    statusCode: 404,
    surface: 'openai',
    type: 'invalid_request_error',
    code: 'completion_not_stored',
    message:
      `Chat completion ${completionId} was created with \`store=false\` and is not available through stored-object routes.`,
  })
}

async function loadStoredResponseRecordOrThrow(
  responseId: string,
  environment: OpenAIHttpExecutionEnvironment,
) {
  const record = await loadOpenAIHttpResponseHandleRecord(responseId, {
    sessionStoreDir: environment.sessionStoreDir,
  })
  if (record === null) {
    throw createStoredResponseNotFoundError(responseId)
  }
  if (!record.store) {
    throw createStoredResponseNotStoredError(responseId)
  }
  return record
}

function createStoredResponseNotFoundError(responseId: string) {
  return createHttpServiceError({
    statusCode: 404,
    surface: 'openai',
    type: 'invalid_request_error',
    code: 'invalid_response_id',
    message: `No stored response with id ${responseId} was found.`,
  })
}

function createStoredResponseNotStoredError(responseId: string) {
  return createHttpServiceError({
    statusCode: 404,
    surface: 'openai',
    type: 'invalid_request_error',
    code: 'response_not_stored',
    message:
      `Response ${responseId} was created with \`store=false\` and is not available through stored-object routes.`,
  })
}

function createStoredResponseStateUnavailableError(
  code: string,
  message: string,
) {
  return createHttpServiceError({
    statusCode: 409,
    surface: 'openai',
    type: 'invalid_request_error',
    code,
    message,
  })
}

function createUnsupportedQueryParameterError(
  key: string,
  message: string,
) {
  return createHttpServiceError({
    statusCode: 400,
    surface: 'openai',
    type: 'invalid_request_error',
    code: `unsupported_${sanitizeErrorCodeSegment(key)}`,
    message,
  })
}

function buildStoredResponseInputItems(
  responseId: string,
  input: string | OpenAIResponsesInputItem[],
): OpenAIResponsesInputMessageItem[] {
  const normalizedItems =
    typeof input === 'string'
      ? [
          buildStoredResponseInputMessageItem(
            responseId,
            0,
            'user',
            [
              {
                type: 'input_text',
                text: input,
              },
            ],
          ),
        ]
      : input.map((item, index) => {
          if (isResponsesTextInputMessage(item)) {
            return buildStoredResponseInputMessageItem(
              responseId,
              index,
              item.role,
              [
                {
                  type: 'input_text',
                  text: item.content,
                },
              ],
            )
          }

          return buildStoredResponseInputMessageItem(
            responseId,
            index,
            'user',
            [
              {
                type: 'input_file',
                filename: item.filename,
              },
            ],
          )
        })

  return normalizedItems
}

function buildStoredResponseInputMessageItem(
  responseId: string,
  index: number,
  role: OpenAIResponsesInputMessageItem['role'],
  content: OpenAIResponsesInputContent[],
): OpenAIResponsesInputMessageItem {
  return {
    id: buildStoredResponseInputItemId(responseId, index, role, content),
    type: 'message',
    role,
    status: 'completed',
    content,
  }
}

function buildStoredResponseInputItemId(
  responseId: string,
  index: number,
  role: OpenAIResponsesInputMessageItem['role'],
  content: OpenAIResponsesInputContent[],
): string {
  return `msg_${createHash('sha1')
    .update(JSON.stringify({ responseId, index, role, content }))
    .digest('hex')
    .slice(0, 24)}`
}

function isResponsesTextInputMessage(
  item: OpenAIResponsesInputItem,
): item is Exclude<OpenAIResponsesInputItem, OpenAIResponsesInputFileItem> {
  return 'role' in item
}

function sanitizeErrorCodeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'query'
}

async function stageOpenAIChatCompletionsRequestArtifacts(input: {
  requestId: string
  request: ReturnType<typeof validateOpenAIChatCompletionsRequest>
  environment: OpenAIHttpExecutionEnvironment
}): Promise<OpenAIHttpStagedInputFile[]> {
  const stagedFiles: OpenAIHttpStagedInputFile[] = []

  try {
    const historyBootstrapArtifact = await stageOpenAIHttpHistoryBootstrapArtifact({
      requestId: input.requestId,
      request: input.request,
      sessionStoreDir: input.environment.sessionStoreDir,
    })
    if (historyBootstrapArtifact !== null) {
      stagedFiles.push(historyBootstrapArtifact)
    }

    return stagedFiles
  } catch (error) {
    if (stagedFiles.length > 0) {
      await cleanupOpenAIHttpStagedInputFiles({
        stagedFiles,
        sessionStoreDir: input.environment.sessionStoreDir,
      })
    }
    throw toOpenAIHttpInputFilePreparationError(error)
  }
}

async function stageOpenAIResponsesRequestArtifacts(input: {
  requestId: string
  request: ReturnType<typeof validateOpenAIResponsesRequest>
  environment: OpenAIHttpExecutionEnvironment
}): Promise<OpenAIHttpStagedInputFile[]> {
  const stagedFiles: OpenAIHttpStagedInputFile[] = []
  const files = extractOpenAIResponsesInputFiles(input.request)

  try {
    const historyBootstrapArtifact = await stageOpenAIHttpHistoryBootstrapArtifact({
      requestId: input.requestId,
      request: input.request,
      sessionStoreDir: input.environment.sessionStoreDir,
    })
    if (historyBootstrapArtifact !== null) {
      stagedFiles.push(historyBootstrapArtifact)
    }

    if (files.length === 0) {
      return stagedFiles
    }

    stagedFiles.push(
      ...await stageOpenAIHttpInputFiles({
        requestId: input.requestId,
        files,
        sessionStoreDir: input.environment.sessionStoreDir,
      }),
    )

    return stagedFiles
  } catch (error) {
    if (stagedFiles.length > 0) {
      await cleanupOpenAIHttpStagedInputFiles({
        stagedFiles,
        sessionStoreDir: input.environment.sessionStoreDir,
      })
    }
    throw toOpenAIHttpInputFilePreparationError(error)
  }
}

function extractOpenAIResponsesInputFiles(
  request: ReturnType<typeof validateOpenAIResponsesRequest>,
): OpenAIResponsesInputFileItem[] {
  if (typeof request.input === 'string') {
    return []
  }

  return request.input.filter(isOpenAIResponsesInputFileItem)
}

function isOpenAIResponsesInputFileItem(
  item: OpenAIResponsesInputItem,
): item is OpenAIResponsesInputFileItem {
  return typeof item === 'object' && item !== null && 'type' in item
}

function toOpenAIHttpInputFilePreparationError(error: unknown): unknown {
  const message = error instanceof Error ? error.message.trim() : ''
  if (
    /OpenAI HTTP input_file .* (base64|decoded to an empty file|is empty)/iu.test(message)
  ) {
    return createHttpServiceError({
      statusCode: 400,
      surface: 'openai',
      type: 'invalid_request_error',
      code: 'invalid_input_file_data',
      message,
    })
  }

  return error
}
