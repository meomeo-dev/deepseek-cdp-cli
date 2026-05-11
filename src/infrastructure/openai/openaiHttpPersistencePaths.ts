import { basename, join } from 'node:path'
import { resolveDeepSeekSessionStoreDir } from '../deepseek/deepSeekStoredSession.js'

const OPENAI_HTTP_ARTIFACTS_DIRNAME = 'openai-http'
const OPENAI_HTTP_CHAT_COMPLETION_DIRNAME = 'chat-completions'
const OPENAI_HTTP_RESPONSE_HANDLE_DIRNAME = 'response-handles'
const OPENAI_HTTP_STAGED_INPUT_FILE_DIRNAME = 'staged-input-files'
const OPENAI_HTTP_STAGED_INPUT_FILE_MANIFEST_NAME = 'manifest.json'

export function resolveOpenAIHttpArtifactsRootDir(
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveDeepSeekSessionStoreDir(sessionStoreDir, cwd),
    OPENAI_HTTP_ARTIFACTS_DIRNAME,
  )
}

export function resolveOpenAIHttpResponseHandleRegistryDir(
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveOpenAIHttpArtifactsRootDir(sessionStoreDir, cwd),
    OPENAI_HTTP_RESPONSE_HANDLE_DIRNAME,
  )
}

export function resolveOpenAIHttpChatCompletionRegistryDir(
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveOpenAIHttpArtifactsRootDir(sessionStoreDir, cwd),
    OPENAI_HTTP_CHAT_COMPLETION_DIRNAME,
  )
}

export function buildOpenAIHttpChatCompletionFilePath(
  completionId: string,
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveOpenAIHttpChatCompletionRegistryDir(sessionStoreDir, cwd),
    `${sanitizePathSegment(completionId)}.json`,
  )
}

export function buildOpenAIHttpResponseHandleFilePath(
  responseId: string,
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveOpenAIHttpResponseHandleRegistryDir(sessionStoreDir, cwd),
    `${sanitizePathSegment(responseId)}.json`,
  )
}

export function resolveOpenAIHttpStagedInputFileRootDir(
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveOpenAIHttpArtifactsRootDir(sessionStoreDir, cwd),
    OPENAI_HTTP_STAGED_INPUT_FILE_DIRNAME,
  )
}

export function buildOpenAIHttpStagedInputFileDirectoryPath(
  stageId: string,
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    resolveOpenAIHttpStagedInputFileRootDir(sessionStoreDir, cwd),
    sanitizePathSegment(stageId),
  )
}

export function buildOpenAIHttpStagedInputFileManifestPath(
  stageId: string,
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    buildOpenAIHttpStagedInputFileDirectoryPath(stageId, sessionStoreDir, cwd),
    OPENAI_HTTP_STAGED_INPUT_FILE_MANIFEST_NAME,
  )
}

export function buildOpenAIHttpStagedInputFilePath(
  stageId: string,
  filename: string,
  sessionStoreDir?: string,
  cwd?: string,
): string {
  return join(
    buildOpenAIHttpStagedInputFileDirectoryPath(stageId, sessionStoreDir, cwd),
    normalizeStagedFilename(filename),
  )
}

export function normalizeStagedFilename(filename: string): string {
  const normalized = basename(filename).trim()
  if (!normalized || normalized === '.' || normalized === '..') {
    return 'input-file'
  }
  return normalized
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
