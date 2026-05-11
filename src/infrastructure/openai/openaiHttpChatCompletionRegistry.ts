import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  OpenAIChatCompletionsTextMessage,
  OpenAICompatibleModelAlias,
  OpenAIHttpChatCompletionRecord,
} from '../../types/openai-http-service.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { OpenAIChatCompletionResponse } from '../../types/openai-chat-completions.types.js'
import {
  buildOpenAIHttpChatCompletionFilePath,
  resolveOpenAIHttpChatCompletionRegistryDir,
} from './openaiHttpPersistencePaths.js'

export function createOpenAIHttpChatCompletionRecord(input: {
  completionId: string
  model: OpenAICompatibleModelAlias
  sessionId: string
  sessionFile: string
  branchId: string | null
  agentId: string | null
  store: boolean
  metadata: Record<string, string>
  requestId?: string | null | undefined
  requestClassification: OpenAIHttpChatCompletionRecord['requestClassification']
  messages: OpenAIChatCompletionsTextMessage[]
  completion: OpenAIChatCompletionResponse
  createdAt?: string | undefined
}): OpenAIHttpChatCompletionRecord {
  const timestamp = input.createdAt ?? new Date().toISOString()
  return {
    kind: 'openai-http-chat-completion',
    version: 1,
    completionId: input.completionId,
    endpoint: '/v1/chat/completions',
    model: input.model,
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    branchId: input.branchId,
    agentId: input.agentId,
    store: input.store,
    metadata: { ...input.metadata },
    requestId: input.requestId ?? null,
    requestClassification: input.requestClassification,
    messages: input.messages.map(message => ({ ...message })),
    completion: cloneOpenAIChatCompletionResponse(input.completion),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createOpenAIHttpChatCompletionRecordFromReply(input: {
  model: OpenAICompatibleModelAlias
  store: boolean
  metadata: Record<string, string>
  requestId?: string | null | undefined
  requestClassification: OpenAIHttpChatCompletionRecord['requestClassification']
  messages: OpenAIChatCompletionsTextMessage[]
  completion: OpenAIChatCompletionResponse
  result: Pick<DeepSeekReplyResult, 'agentId' | 'sessionId' | 'sessionFile' | 'generationRuns'>
  createdAt?: string | undefined
}): OpenAIHttpChatCompletionRecord {
  return createOpenAIHttpChatCompletionRecord({
    completionId: input.completion.id,
    model: input.model,
    sessionId: input.result.sessionId,
    sessionFile: input.result.sessionFile,
    branchId: resolveLatestObservedBranchId(input.result.generationRuns),
    agentId: input.result.agentId,
    store: input.store,
    metadata: input.metadata,
    requestId: input.requestId,
    requestClassification: input.requestClassification,
    messages: input.messages,
    completion: input.completion,
    createdAt: input.createdAt,
  })
}

export async function saveOpenAIHttpChatCompletionRecord(
  record: OpenAIHttpChatCompletionRecord,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<string> {
  const filePath = buildOpenAIHttpChatCompletionFilePath(
    record.completionId,
    input.sessionStoreDir,
    input.cwd,
  )
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return filePath
}

export async function loadOpenAIHttpChatCompletionRecord(
  completionId: string,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<OpenAIHttpChatCompletionRecord | null> {
  const filePath = buildOpenAIHttpChatCompletionFilePath(
    completionId,
    input.sessionStoreDir,
    input.cwd,
  )
  const parsed = await readJsonFile(filePath)
  if (parsed === null) {
    return null
  }
  if (!isOpenAIHttpChatCompletionRecord(parsed)) {
    throw new Error(`OpenAI HTTP chat completion ${completionId} is invalid: ${filePath}.`)
  }
  return parsed
}

export async function listOpenAIHttpChatCompletionRecords(input: {
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
} = {}): Promise<OpenAIHttpChatCompletionRecord[]> {
  const directory = resolveOpenAIHttpChatCompletionRegistryDir(
    input.sessionStoreDir,
    input.cwd,
  )
  const entryNames = await readDirectoryJsonEntries(directory)
  const records: OpenAIHttpChatCompletionRecord[] = []

  for (const entryName of entryNames) {
    const filePath = join(directory, entryName)
    const parsed = await readJsonFile(filePath)
    if (parsed === null) {
      continue
    }
    if (!isOpenAIHttpChatCompletionRecord(parsed)) {
      throw new Error(`OpenAI HTTP chat completion registry entry is invalid: ${filePath}.`)
    }
    records.push(parsed)
  }

  return records
}

export async function updateOpenAIHttpChatCompletionRecordMetadata(
  completionId: string,
  metadata: Record<string, string>,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
    updatedAt?: string | undefined
  } = {},
): Promise<OpenAIHttpChatCompletionRecord | null> {
  const existing = await loadOpenAIHttpChatCompletionRecord(completionId, input)
  if (existing === null) {
    return null
  }

  const updated: OpenAIHttpChatCompletionRecord = {
    ...existing,
    metadata: { ...metadata },
    completion: cloneOpenAIChatCompletionResponse({
      ...existing.completion,
      metadata: { ...metadata },
    }),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }

  await saveOpenAIHttpChatCompletionRecord(updated, input)
  return updated
}

export async function deleteOpenAIHttpChatCompletionRecord(
  completionId: string,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<boolean> {
  const filePath = buildOpenAIHttpChatCompletionFilePath(
    completionId,
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

function cloneOpenAIChatCompletionResponse(
  response: OpenAIChatCompletionResponse,
): OpenAIChatCompletionResponse {
  return {
    ...response,
    metadata: { ...response.metadata },
    choices: response.choices.map(choice => ({
      ...choice,
      message: {
        ...choice.message,
        annotations: choice.message.annotations.map(annotation => ({
          ...annotation,
          url_citation: {
            ...annotation.url_citation,
          },
        })),
      },
    })),
    ...(response.usage ? { usage: { ...response.usage } } : {}),
  }
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

async function readDirectoryJsonEntries(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }
}

function isOpenAIHttpChatCompletionRecord(
  value: unknown,
): value is OpenAIHttpChatCompletionRecord {
  return (
    isRecord(value) &&
    value['kind'] === 'openai-http-chat-completion' &&
    value['version'] === 1 &&
    value['endpoint'] === '/v1/chat/completions' &&
    typeof value['completionId'] === 'string' &&
    typeof value['model'] === 'string' &&
    typeof value['sessionId'] === 'string' &&
    typeof value['sessionFile'] === 'string' &&
    (typeof value['branchId'] === 'string' || value['branchId'] === null) &&
    (typeof value['agentId'] === 'string' || value['agentId'] === null) &&
    typeof value['store'] === 'boolean' &&
    isStringRecord(value['metadata']) &&
    (typeof value['requestId'] === 'string' || value['requestId'] === null) &&
    (value['requestClassification'] === 'new-turn' ||
      value['requestClassification'] === 'history-bootstrap') &&
    Array.isArray(value['messages']) &&
    value['messages'].every(isOpenAIChatTextMessage) &&
    isOpenAIChatCompletionResponse(value['completion']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  )
}

function isOpenAIChatTextMessage(value: unknown): value is OpenAIChatCompletionsTextMessage {
  return (
    isRecord(value) &&
    (value['role'] === 'developer' ||
      value['role'] === 'system' ||
      value['role'] === 'user' ||
      value['role'] === 'assistant') &&
    typeof value['content'] === 'string'
  )
}

function isOpenAIChatCompletionResponse(
  value: unknown,
): value is OpenAIChatCompletionResponse {
  return (
    isRecord(value) &&
    value['object'] === 'chat.completion' &&
    typeof value['id'] === 'string' &&
    typeof value['created'] === 'number' &&
    typeof value['model'] === 'string' &&
    isStringRecord(value['metadata']) &&
    Array.isArray(value['choices'])
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
