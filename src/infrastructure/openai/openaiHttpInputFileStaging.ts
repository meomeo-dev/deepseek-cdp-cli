import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type {
  OpenAIHttpEndpoint,
  OpenAIHttpStagedInputFile,
  OpenAIResponsesInputFileItem,
} from '../../types/openai-http-service.types.js'
import {
  buildOpenAIHttpStagedInputFileDirectoryPath,
  buildOpenAIHttpStagedInputFileManifestPath,
  buildOpenAIHttpStagedInputFilePath,
  normalizeStagedFilename,
} from './openaiHttpPersistencePaths.js'

export async function stageOpenAIHttpInputFile(input: {
  requestId: string
  file: OpenAIResponsesInputFileItem
  endpoint?: OpenAIHttpEndpoint | undefined
  source?: OpenAIHttpStagedInputFile['source'] | undefined
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
  createdAt?: string | undefined
  stageId?: string | undefined
}): Promise<OpenAIHttpStagedInputFile> {
  const stageId =
    input.stageId ?? `input-file-${sanitizeStageToken(input.requestId)}-${randomUUID()}`
  const createdAt = input.createdAt ?? new Date().toISOString()
  const stagingDirectory = buildOpenAIHttpStagedInputFileDirectoryPath(
    stageId,
    input.sessionStoreDir,
    input.cwd,
  )
  const stagedFilename = normalizeStagedFilename(input.file.filename)
  const filePath = buildOpenAIHttpStagedInputFilePath(
    stageId,
    stagedFilename,
    input.sessionStoreDir,
    input.cwd,
  )
  try {
    const fileBytes = decodeBase64FileData(input.file.fileData, stagedFilename)

    await mkdir(stagingDirectory, { recursive: true })
    await writeFile(filePath, fileBytes)

    const stagedFile: OpenAIHttpStagedInputFile = {
      kind: 'openai-http-staged-input-file',
      version: 1,
      stageId,
      endpoint: input.endpoint ?? '/v1/responses',
      source: input.source ?? 'request-input',
      requestId: input.requestId,
      originalFilename: input.file.filename,
      stagedFilename,
      stagingDirectory,
      filePath,
      byteSize: fileBytes.byteLength,
      createdAt,
    }

    await writeFile(
      buildOpenAIHttpStagedInputFileManifestPath(stageId, input.sessionStoreDir, input.cwd),
      `${JSON.stringify(stagedFile, null, 2)}\n`,
      'utf8',
    )

    return stagedFile
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function stageOpenAIHttpInputFiles(input: {
  requestId: string
  files: readonly OpenAIResponsesInputFileItem[]
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
  createdAt?: string | undefined
}): Promise<OpenAIHttpStagedInputFile[]> {
  const createdAt = input.createdAt ?? new Date().toISOString()
  const stagedFiles: OpenAIHttpStagedInputFile[] = []
  try {
    for (const [index, file] of input.files.entries()) {
      stagedFiles.push(
        await stageOpenAIHttpInputFile({
          requestId: input.requestId,
          file,
          sessionStoreDir: input.sessionStoreDir,
          cwd: input.cwd,
          createdAt,
          stageId: `input-file-${sanitizeStageToken(input.requestId)}-${index + 1}-${randomUUID()}`,
        }),
      )
    }
    return stagedFiles
  } catch (error) {
    await cleanupOpenAIHttpStagedInputFiles({
      stagedFiles,
      sessionStoreDir: input.sessionStoreDir,
      cwd: input.cwd,
    })
    throw error
  }
}

export async function loadOpenAIHttpStagedInputFile(
  stageId: string,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<OpenAIHttpStagedInputFile | null> {
  const manifestPath = buildOpenAIHttpStagedInputFileManifestPath(
    stageId,
    input.sessionStoreDir,
    input.cwd,
  )
  const parsed = await readJsonFile(manifestPath)
  if (parsed === null) {
    return null
  }
  if (!isOpenAIHttpStagedInputFile(parsed)) {
    throw new Error(`OpenAI HTTP staged input file ${stageId} is invalid: ${manifestPath}.`)
  }
  return parsed
}

export async function cleanupOpenAIHttpStagedInputFile(
  stageId: string,
  input: {
    sessionStoreDir?: string | undefined
    cwd?: string | undefined
  } = {},
): Promise<boolean> {
  const stagingDirectory = buildOpenAIHttpStagedInputFileDirectoryPath(
    stageId,
    input.sessionStoreDir,
    input.cwd,
  )
  const existed = await pathExists(stagingDirectory)
  await rm(stagingDirectory, { recursive: true, force: true })
  return existed
}

export async function cleanupOpenAIHttpStagedInputFiles(input: {
  stagedFiles: readonly Pick<OpenAIHttpStagedInputFile, 'stageId'>[]
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
}): Promise<void> {
  for (const stagedFile of input.stagedFiles) {
    await cleanupOpenAIHttpStagedInputFile(stagedFile.stageId, {
      sessionStoreDir: input.sessionStoreDir,
      cwd: input.cwd,
    })
  }
}

function decodeBase64FileData(
  fileData: string,
  filename: string,
): Buffer {
  const normalized = fileData.replace(/\s+/g, '')
  if (!normalized) {
    throw new Error(`OpenAI HTTP input_file ${filename} is empty; file_data must be base64-encoded.`)
  }
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    throw new Error(
      `OpenAI HTTP input_file ${filename} has invalid base64 file_data and cannot be staged.`,
    )
  }

  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.byteLength === 0) {
    throw new Error(`OpenAI HTTP input_file ${filename} decoded to an empty file.`)
  }
  if (decoded.toString('base64') !== normalized) {
    throw new Error(
      `OpenAI HTTP input_file ${filename} has non-canonical base64 file_data and cannot be staged.`,
    )
  }

  return decoded
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

function isOpenAIHttpStagedInputFile(
  value: unknown,
): value is OpenAIHttpStagedInputFile {
  return (
    isRecord(value) &&
    value['kind'] === 'openai-http-staged-input-file' &&
    value['version'] === 1 &&
    (value['endpoint'] === '/v1/chat/completions' || value['endpoint'] === '/v1/responses') &&
    (value['source'] === 'request-input' || value['source'] === 'history-bootstrap-artifact') &&
    typeof value['stageId'] === 'string' &&
    typeof value['requestId'] === 'string' &&
    typeof value['originalFilename'] === 'string' &&
    typeof value['stagedFilename'] === 'string' &&
    typeof value['stagingDirectory'] === 'string' &&
    typeof value['filePath'] === 'string' &&
    typeof value['byteSize'] === 'number' &&
    typeof value['createdAt'] === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error['code'] === code
}

function sanitizeStageToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
