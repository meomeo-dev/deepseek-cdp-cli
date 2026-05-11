import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  OpenAICompatibleModelAlias,
  OpenAIHttpRequestClassification,
  OpenAIHttpResponseHandleRecord,
} from '../../types/openai-http-service.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type {
  OpenAIResponseObject,
  OpenAIResponsesInputMessageItem,
} from '../../types/openai-responses.types.js'
import { buildOpenAIHttpResponseHandleFilePath } from './openaiHttpPersistencePaths.js'

export function createOpenAIHttpResponseHandleRecord(input: {
  responseId: string
  model: OpenAICompatibleModelAlias
  sessionId: string
  sessionFile: string
  branchId: string | null
  agentId: string | null
  store: boolean
  metadata?: Record<string, string> | undefined
  requestId?: string | null | undefined
  requestClassification: OpenAIHttpRequestClassification
  response?: OpenAIResponseObject | null | undefined
  inputItems?: OpenAIResponsesInputMessageItem[] | null | undefined
  createdAt?: string | undefined
}): OpenAIHttpResponseHandleRecord {
  const timestamp = input.createdAt ?? new Date().toISOString()
  return {
    kind: 'openai-http-response-handle',
    version: 1,
    responseId: input.responseId,
    endpoint: '/v1/responses',
    model: input.model,
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    branchId: input.branchId,
    agentId: input.agentId,
    store: input.store,
    metadata: input.metadata ? { ...input.metadata } : {},
    requestId: input.requestId ?? null,
    requestClassification: input.requestClassification,
    response: input.response ? cloneResponseObject(input.response) : null,
    inputItems: input.inputItems ? cloneInputMessageItems(input.inputItems) : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createOpenAIHttpResponseHandleRecordFromReply(input: {
  responseId: string
  model: OpenAICompatibleModelAlias
  store: boolean
  metadata?: Record<string, string> | undefined
  requestId?: string | null | undefined
  requestClassification: OpenAIHttpRequestClassification
  response?: OpenAIResponseObject | null | undefined
  inputItems?: OpenAIResponsesInputMessageItem[] | null | undefined
  result: Pick<DeepSeekReplyResult, 'agentId' | 'sessionId' | 'sessionFile' | 'generationRuns'>
  createdAt?: string | undefined
}): OpenAIHttpResponseHandleRecord {
  return createOpenAIHttpResponseHandleRecord({
    responseId: input.responseId,
    model: input.model,
    sessionId: input.result.sessionId,
    sessionFile: input.result.sessionFile,
    branchId: resolveLatestObservedBranchId(input.result.generationRuns),
    agentId: input.result.agentId,
    store: input.store,
    metadata: input.metadata,
    requestId: input.requestId,
    requestClassification: input.requestClassification,
    response: input.response,
    inputItems: input.inputItems,
    createdAt: input.createdAt,
  })
}

export async function saveOpenAIHttpResponseHandleRecord(
  record: OpenAIHttpResponseHandleRecord,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<string> {
  const filePath = buildOpenAIHttpResponseHandleFilePath(
    record.responseId,
    input.sessionStoreDir,
    input.cwd,
  )
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return filePath
}

export async function loadOpenAIHttpResponseHandleRecord(
  responseId: string,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<OpenAIHttpResponseHandleRecord | null> {
  const filePath = buildOpenAIHttpResponseHandleFilePath(
    responseId,
    input.sessionStoreDir,
    input.cwd,
  )
  const parsed = await readJsonFile(filePath)
  if (parsed === null) {
    return null
  }
  const normalized = normalizeOpenAIHttpResponseHandleRecord(parsed)
  if (normalized === null) {
    throw new Error(`OpenAI HTTP response handle ${responseId} is invalid: ${filePath}.`)
  }
  return normalized
}

export async function deleteOpenAIHttpResponseHandleRecord(
  responseId: string,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<boolean> {
  const filePath = buildOpenAIHttpResponseHandleFilePath(
    responseId,
    input.sessionStoreDir,
    input.cwd,
  )
  const existed = (await readJsonFile(filePath)) !== null
  await rm(filePath, { force: true })
  return existed
}

function resolveLatestObservedBranchId(
  generationRuns: Pick<DeepSeekReplyResult, 'generationRuns'>['generationRuns'],
): string | null {
  for (let index = generationRuns.length - 1; index >= 0; index -= 1) {
    const branchId = generationRuns[index]?.context.branchId
    if (branchId) {
      return branchId
    }
  }
  return null
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
}

function normalizeOpenAIHttpResponseHandleRecord(
  value: unknown,
): OpenAIHttpResponseHandleRecord | null {
  if (
    !isRecord(value) ||
    value['kind'] !== 'openai-http-response-handle' ||
    value['version'] !== 1 ||
    value['endpoint'] !== '/v1/responses' ||
    typeof value['responseId'] !== 'string' ||
    typeof value['model'] !== 'string' ||
    typeof value['sessionId'] !== 'string' ||
    typeof value['sessionFile'] !== 'string' ||
    (typeof value['branchId'] !== 'string' && value['branchId'] !== null) ||
    (typeof value['agentId'] !== 'string' && value['agentId'] !== null) ||
    typeof value['store'] !== 'boolean' ||
    (typeof value['requestId'] !== 'string' && value['requestId'] !== null) ||
    typeof value['requestClassification'] !== 'string' ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['updatedAt'] !== 'string'
  ) {
    return null
  }

  const metadataValue = value['metadata']
  if (metadataValue !== undefined && !isStringRecord(metadataValue)) {
    return null
  }
  const metadata =
    metadataValue === undefined ? {} : metadataValue
  const responseValue = value['response']
  if (responseValue !== undefined && responseValue !== null && !isResponseObject(responseValue)) {
    return null
  }
  const inputItemsValue = value['inputItems']
  if (
    inputItemsValue !== undefined &&
    inputItemsValue !== null &&
    (!Array.isArray(inputItemsValue) || !inputItemsValue.every(isInputMessageItem))
  ) {
    return null
  }

  return {
    kind: 'openai-http-response-handle',
    version: 1,
    responseId: value['responseId'],
    endpoint: '/v1/responses',
    model: value['model'] as OpenAICompatibleModelAlias,
    sessionId: value['sessionId'],
    sessionFile: value['sessionFile'],
    branchId: value['branchId'],
    agentId: value['agentId'],
    store: value['store'],
    metadata: { ...metadata },
    requestId: value['requestId'],
    requestClassification: value['requestClassification'] as OpenAIHttpRequestClassification,
    response: responseValue === undefined || responseValue === null
      ? null
      : cloneResponseObject(responseValue),
    inputItems:
      inputItemsValue === undefined || inputItemsValue === null
        ? null
        : cloneInputMessageItems(inputItemsValue),
    createdAt: value['createdAt'],
    updatedAt: value['updatedAt'],
  }
}

function cloneResponseObject(response: OpenAIResponseObject): OpenAIResponseObject {
  return deepCloneJsonValue(response)
}

function cloneInputMessageItems(
  items: OpenAIResponsesInputMessageItem[],
): OpenAIResponsesInputMessageItem[] {
  return deepCloneJsonValue(items)
}

function deepCloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isResponseObject(value: unknown): value is OpenAIResponseObject {
  return (
    isRecord(value) &&
    value['object'] === 'response' &&
    typeof value['id'] === 'string' &&
    typeof value['created_at'] === 'number' &&
    (typeof value['completed_at'] === 'number' || value['completed_at'] === null) &&
    typeof value['status'] === 'string' &&
    typeof value['model'] === 'string' &&
    Array.isArray(value['output']) &&
    typeof value['store'] === 'boolean' &&
    (typeof value['previous_response_id'] === 'string' ||
      value['previous_response_id'] === null) &&
    isStringRecord(value['metadata'])
  )
}

function isInputMessageItem(value: unknown): value is OpenAIResponsesInputMessageItem {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    value['type'] === 'message' &&
    (value['role'] === 'assistant' ||
      value['role'] === 'developer' ||
      value['role'] === 'system' ||
      value['role'] === 'user') &&
    (value['status'] === 'in_progress' ||
      value['status'] === 'completed' ||
      value['status'] === 'incomplete') &&
    Array.isArray(value['content']) &&
    value['content'].every(isInputContentPart)
  )
}

function isInputContentPart(value: unknown): boolean {
  return (
    isRecord(value) &&
    ((value['type'] === 'input_text' && typeof value['text'] === 'string') ||
      value['type'] === 'input_file')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string')
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error['code'] === code
}
