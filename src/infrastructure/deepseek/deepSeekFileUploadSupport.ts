import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { DeepSeekAttachment } from '../../types/deepseek-session.types.js'
import type {
  DeepSeekComposerFileInput,
  DeepSeekFetchFilesObservation,
  DeepSeekFetchedFileRecord,
  DeepSeekFileCapturedExchange,
  DeepSeekFileExchangeRequest,
  DeepSeekFilePreflightProblem,
  DeepSeekFilePreviewObservation,
  DeepSeekLocalFileCandidate,
  DeepSeekUploadedFileResult,
  DeepSeekUploadFileObservation,
  DeepSeekFileUploadBatchResult,
} from '../../types/deepseek-file.types.js'

export const DEEPSEEK_MAX_FILE_COUNT = 50
export const DEEPSEEK_MAX_FILE_SIZE_BYTES = 104_857_600

export async function preflightDeepSeekComposerFiles(input: {
  requestedPaths: string[]
  fileInput: DeepSeekComposerFileInput
}): Promise<{
  acceptedFiles: DeepSeekLocalFileCandidate[]
  files: DeepSeekUploadedFileResult[]
  problems: DeepSeekFilePreflightProblem[]
}> {
  const files: DeepSeekUploadedFileResult[] = []
  const problems: DeepSeekFilePreflightProblem[] = []

  for (const path of normalizeRequestedFilePaths(input.requestedPaths)) {
    const candidate = await inspectLocalFileCandidate(path)
    const result = createUploadedFileResult(candidate)
    files.push(result)

    if (candidate.sizeBytes === null) {
      const problem: DeepSeekFilePreflightProblem = {
        code: candidate.fileName ? 'not_a_file' : 'file_not_found',
        message: candidate.fileName
          ? `Path is not a regular file: ${path}`
          : `File does not exist: ${path}`,
        path,
        ...(candidate.fileName ? { fileName: candidate.fileName } : {}),
      }
      result.problems.push(problem)
      problems.push(problem)
      continue
    }
  }

  const candidates = files.filter(file => file.sizeBytes !== null)
  if (candidates.length > DEEPSEEK_MAX_FILE_COUNT) {
    const problem: DeepSeekFilePreflightProblem = {
      code: 'exceed_count',
      message: `DeepSeek composer currently allows at most ${DEEPSEEK_MAX_FILE_COUNT} attachments per unsent message.`,
      limit: DEEPSEEK_MAX_FILE_COUNT,
    }
    problems.push(problem)
    for (const file of candidates) {
      file.problems.push(problem)
    }
    return {
      acceptedFiles: [],
      files,
      problems,
    }
  }

  const acceptedFiles: DeepSeekLocalFileCandidate[] = []
  for (const file of candidates) {
    const sizeBytes = file.sizeBytes as number
    if (sizeBytes > DEEPSEEK_MAX_FILE_SIZE_BYTES) {
      const problem: DeepSeekFilePreflightProblem = {
        code: 'exceed_size',
        message: `File exceeds DeepSeek composer limit of ${DEEPSEEK_MAX_FILE_SIZE_BYTES} bytes.`,
        path: file.path,
        fileName: file.fileName,
        sizeBytes,
        limit: DEEPSEEK_MAX_FILE_SIZE_BYTES,
      }
      file.problems.push(problem)
      problems.push(problem)
      continue
    }

    if (!isFileAcceptedByComposer(file.extension, input.fileInput.acceptedExtensions, input.fileInput.accept)) {
      const problem: DeepSeekFilePreflightProblem = {
        code: 'unsupported_file_type',
        message: `File extension is not accepted by the DeepSeek composer input: ${file.extension ?? '(none)'}.`,
        path: file.path,
        fileName: file.fileName,
        accept: input.fileInput.accept ?? undefined,
      }
      file.problems.push(problem)
      problems.push(problem)
      continue
    }

    file.acceptedByPreflight = true
    acceptedFiles.push({
      path: file.path,
      fileName: file.fileName,
      extension: file.extension,
      sizeBytes,
    })
  }

  return {
    acceptedFiles,
    files,
    problems,
  }
}

export function summarizeUploadFileCapture(
  capture: DeepSeekFileCapturedExchange,
): DeepSeekUploadFileObservation {
  const payload = parseJsonIfPossible(capture.response.bodyText)
  const record = isRecord(payload) ? payload : null
  const data = readRecord(record, 'data')
  const bizData = readRecord(data, 'biz_data')

  return {
    endpoint: '/api/v0/file/upload_file',
    requestUrl: capture.request.url,
    status: capture.response.status,
    code: readNumber(record?.['code']),
    message: readString(record?.['msg']),
    bizCode: readNumber(data?.['biz_code']),
    bizMessage: readString(data?.['biz_msg']),
    fileId: readString(bizData?.['id']),
    fileName: readString(bizData?.['file_name']),
    fileStatus: readString(bizData?.['status']),
    previewable: readBoolean(bizData?.['previewable']),
    fileSize: readNumber(bizData?.['file_size']),
    tokenUsage: readNumber(bizData?.['token_usage']),
    errorCode: stringifyNullablePrimitive(bizData?.['error_code']),
    acknowledged:
      capture.response.status >= 200 &&
      capture.response.status < 300 &&
      readNumber(record?.['code']) === 0 &&
      readNumber(data?.['biz_code']) === 0 &&
      bizData !== null,
  }
}

export function summarizeFetchFilesCapture(
  capture: DeepSeekFileCapturedExchange,
): DeepSeekFetchFilesObservation {
  const payload = parseJsonIfPossible(capture.response.bodyText)
  const record = isRecord(payload) ? payload : null
  const data = readRecord(record, 'data')
  const bizData = readRecord(data, 'biz_data')
  const rawFiles = Array.isArray(bizData?.['files']) ? bizData['files'] : []

  return {
    endpoint: '/api/v0/file/fetch_files',
    requestUrl: capture.request.url,
    status: capture.response.status,
    code: readNumber(record?.['code']),
    message: readString(record?.['msg']),
    bizCode: readNumber(data?.['biz_code']),
    bizMessage: readString(data?.['biz_msg']),
    files: rawFiles
      .map(normalizeFetchedFileRecord)
      .filter((value): value is DeepSeekFetchedFileRecord => value !== null),
    acknowledged:
      capture.response.status >= 200 &&
      capture.response.status < 300 &&
      readNumber(record?.['code']) === 0 &&
      readNumber(data?.['biz_code']) === 0,
  }
}

export function summarizeFilePreviewCapture(
  capture: DeepSeekFileCapturedExchange,
): DeepSeekFilePreviewObservation {
  const payload = parseJsonIfPossible(capture.response.bodyText)
  const record = isRecord(payload) ? payload : null
  const data = readRecord(record, 'data')
  const bizData = readRecord(data, 'biz_data')
  const requestUrl = new URL(capture.request.url)

  return {
    endpoint: '/api/v0/file/preview',
    requestUrl: capture.request.url,
    status: capture.response.status,
    code: readNumber(record?.['code']),
    message: readString(record?.['msg']),
    bizCode: readNumber(data?.['biz_code']),
    bizMessage: readString(data?.['biz_msg']),
    fileId: requestUrl.searchParams.get('file_id'),
    previewUrl: readString(bizData?.['url']),
    acknowledged:
      capture.response.status >= 200 &&
      capture.response.status < 300 &&
      readNumber(record?.['code']) === 0 &&
      readNumber(data?.['biz_code']) === 0 &&
      typeof bizData?.['url'] === 'string',
  }
}

export function mergeUploadCapturesIntoFileResults(
  fileResults: DeepSeekUploadedFileResult[],
  acceptedFiles: DeepSeekLocalFileCandidate[],
  uploadCaptures: DeepSeekFileCapturedExchange[],
): void {
  const pendingResults = fileResults.filter(file => file.acceptedByPreflight)

  for (const [index] of acceptedFiles.entries()) {
    const result = pendingResults[index]
    const capture = uploadCaptures[index]
    if (!result || !capture) {
      continue
    }

    const upload = summarizeUploadFileCapture(capture)
    result.upload = upload
    result.fileId = upload.fileId
    result.uploaded = upload.acknowledged
    result.serverStatus = upload.fileStatus
    result.previewable = upload.previewable
    result.tokenUsage = upload.tokenUsage
    result.settled = isUploadFileTerminalSuccess(upload)
    result.errorCode = upload.errorCode ?? (upload.bizCode !== 0 ? String(upload.bizCode) : null)
    result.errorMessage = upload.acknowledged
      ? null
      : upload.bizMessage ?? upload.message ?? 'upload_file rejected the file.'

    if (!upload.acknowledged) {
      result.problems.push({
        code: 'upload_rejected',
        message: result.errorMessage ?? 'upload_file rejected the file.',
        path: result.path,
        fileName: result.fileName,
      })
    }
  }
}

export function mergeFetchFilesIntoFileResults(
  fileResults: DeepSeekUploadedFileResult[],
  latestFetch: DeepSeekFetchFilesObservation | null,
): void {
  if (!latestFetch) {
    return
  }

  for (const result of fileResults) {
    if (!result.fileId) {
      continue
    }

    const fetched = latestFetch.files.find(file => file.id === result.fileId)
    if (!fetched) {
      continue
    }

    result.fetched = { ...fetched }
    result.serverStatus = fetched.status
    result.previewable = fetched.previewable
    result.tokenUsage = fetched.tokenUsage
    result.errorCode = fetched.errorCode
    result.settled = normalizeStatus(fetched.status) === 'success'
    if (fetched.errorCode) {
      result.errorMessage = fetched.errorCode
    }
  }
}

export function finalizeDeepSeekFileUploadBatch(input: {
  fileInput: DeepSeekComposerFileInput
  requestedPaths: string[]
  acceptedPaths: string[]
  problems: DeepSeekFilePreflightProblem[]
  files: DeepSeekUploadedFileResult[]
  fetches: DeepSeekFetchFilesObservation[]
  allowSettledUnverifiedMount?: boolean | undefined
}): DeepSeekFileUploadBatchResult {
  const latestFetch = input.fetches.at(-1) ?? null
  const files = input.files.map(file => {
    const next = cloneUploadedFileResult(file)
    if (next.acceptedByPreflight && !next.uploaded && next.problems.length === 0) {
      next.problems.push({
        code: 'missing_upload_response',
        message: 'No upload_file response was observed for this file.',
        path: next.path,
        fileName: next.fileName,
      })
    }

    if (next.uploaded && !next.settled && next.problems.length === 0) {
      next.problems.push(classifyIncompleteFetchFilesProblem(next, latestFetch))
    }

    if (
      input.allowSettledUnverifiedMount &&
      next.acceptedByPreflight &&
      next.uploaded &&
      next.settled &&
      !next.mounted &&
      next.fileId &&
      !next.errorCode &&
      next.problems.length === 0
    ) {
      next.mounted = true
    }

    if (next.settled && !next.mounted && next.problems.length === 0) {
      next.problems.push({
        code: 'mount_unverified',
        message: 'The file reached SUCCESS but the unsent composer attachment was not verified.',
        path: next.path,
        fileName: next.fileName,
      })
    }

    if (next.problems.length > 0 && !next.errorMessage) {
      next.errorMessage = next.problems[0]?.message ?? null
    }

    return next
  })

  return {
    fileInput: {
      ...input.fileInput,
      acceptedExtensions: [...input.fileInput.acceptedExtensions],
    },
    requestedPaths: [...input.requestedPaths],
    acceptedPaths: [...input.acceptedPaths],
    problems: input.problems.map(problem => ({ ...problem })),
    files,
    fetches: input.fetches.map(fetch => ({
      ...fetch,
      files: fetch.files.map(file => ({ ...file })),
    })),
    settled: files.every(file => !file.acceptedByPreflight || file.settled),
    blockingIssues: files.some(file => !file.mounted),
  }
}

export function mapUploadedFilesToDeepSeekAttachments(
  batch: DeepSeekFileUploadBatchResult | null | undefined,
): DeepSeekAttachment[] {
  if (!batch) {
    return []
  }

  return batch.files
    .filter(file => file.mounted && file.fileId)
    .map(file => ({
      id: file.fileId as string,
      name: file.fileName,
      sizeBytes: file.sizeBytes ?? undefined,
      ...(file.previewUrl ? { url: file.previewUrl } : {}),
    }))
}

export function cloneUploadedFileResult(value: DeepSeekUploadedFileResult): DeepSeekUploadedFileResult {
  return {
    ...value,
    upload: value.upload ? { ...value.upload } : null,
    fetched: value.fetched ? { ...value.fetched } : null,
    preview: value.preview ? { ...value.preview } : null,
    problems: value.problems.map(problem => ({ ...problem })),
  }
}

export function cloneFileCapturedExchange(value: DeepSeekFileCapturedExchange): DeepSeekFileCapturedExchange {
  return {
    endpoint: value.endpoint,
    request: cloneFileExchangeRequest(value.request),
    response: {
      ...value.response,
    },
  }
}

export function normalizeRequestedFilePaths(filePaths: string[]): string[] {
  return filePaths
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
}

function createUploadedFileResult(candidate: DeepSeekLocalFileCandidate): DeepSeekUploadedFileResult {
  return {
    ...candidate,
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
    problems: [],
  }
}

async function inspectLocalFileCandidate(path: string): Promise<DeepSeekLocalFileCandidate> {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) {
      return {
        path,
        fileName: basename(path),
        extension: normalizeExtension(extname(path)),
        sizeBytes: null,
      }
    }

    return {
      path,
      fileName: basename(path),
      extension: normalizeExtension(extname(path)),
      sizeBytes: stats.size,
    }
  } catch {
    return {
      path,
      fileName: '',
      extension: normalizeExtension(extname(path)),
      sizeBytes: null,
    }
  }
}

function normalizeFetchedFileRecord(value: unknown): DeepSeekFetchedFileRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value['id'])
  if (!id) {
    return null
  }

  return {
    id,
    status: readString(value['status']),
    fileName: readString(value['file_name']),
    previewable: readBoolean(value['previewable']),
    fileSize: readNumber(value['file_size']),
    tokenUsage: readNumber(value['token_usage']),
    errorCode: stringifyNullablePrimitive(value['error_code']),
    insertedAt: normalizeTimestamp(value['inserted_at']),
    updatedAt: normalizeTimestamp(value['updated_at']),
  }
}

function isFileAcceptedByComposer(
  extension: string | null,
  acceptedExtensions: string[],
  accept: string | null,
): boolean {
  if (!accept || acceptedExtensions.length === 0) {
    return true
  }

  if (extension && acceptedExtensions.includes(extension)) {
    return true
  }

  return accept
    .split(',')
    .map(token => token.trim().toLowerCase())
    .some(token => token.includes('/') || token === '*/*')
}

function normalizeExtension(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized : null
}

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function isUploadFileTerminalSuccess(upload: DeepSeekUploadFileObservation): boolean {
  return upload.acknowledged && normalizeStatus(upload.fileStatus) === 'success'
}

function classifyIncompleteFetchFilesProblem(
  file: DeepSeekUploadedFileResult,
  latestFetch: DeepSeekFetchFilesObservation | null,
): DeepSeekFilePreflightProblem {
  const normalizedFetchedStatus = normalizeStatus(file.fetched?.status)
  if (file.fetched?.errorCode || isFetchFilesFailedStatus(normalizedFetchedStatus)) {
    return {
      code: 'fetch_files_failed',
      message: [
        'fetch_files reported a terminal file failure before the attachment reached SUCCESS.',
        file.fetched?.status ? `Last status: ${file.fetched.status}.` : null,
        file.fetched?.errorCode ? `Error code: ${file.fetched.errorCode}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      path: file.path,
      fileName: file.fileName,
    }
  }

  if (isFetchFilesProcessingStatus(normalizedFetchedStatus)) {
    return {
      code: 'fetch_files_processing_timeout',
      message: `fetch_files last observed status was ${String(file.fetched?.status)} before timeout.`,
      path: file.path,
      fileName: file.fileName,
    }
  }

  if (latestFetch && !latestFetch.acknowledged) {
    const fetchMessage = latestFetch.bizMessage ?? latestFetch.message
    const detail =
      fetchMessage && fetchMessage.trim()
        ? `fetch_files did not return an acknowledged file list before timeout. Last endpoint response: ${fetchMessage}.`
        : 'fetch_files did not return an acknowledged file list before timeout.'
    return {
      code: 'fetch_files_rejected',
      message: detail,
      path: file.path,
      fileName: file.fileName,
    }
  }

  return {
    code: 'fetch_files_timeout',
    message: 'fetch_files did not settle this file to SUCCESS before timeout.',
    path: file.path,
    fileName: file.fileName,
  }
}

function isFetchFilesProcessingStatus(status: string): boolean {
  return ['pending', 'parsing', 'processing', 'queued', 'wip'].includes(status)
}

function isFetchFilesFailedStatus(status: string): boolean {
  return ['failed', 'error', 'rejected', 'cancelled', 'canceled', 'timeout'].includes(status)
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1_000).toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  return null
}

function parseJsonIfPossible(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function readRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!value) {
    return null
  }
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringifyNullablePrimitive(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneFileExchangeRequest(value: DeepSeekFileExchangeRequest): DeepSeekFileExchangeRequest {
  return {
    ...value,
    headers: { ...value.headers },
  }
}
