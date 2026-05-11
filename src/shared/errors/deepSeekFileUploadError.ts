import type {
  DeepSeekFilePreflightProblem,
  DeepSeekFilePreflightProblemCode,
  DeepSeekFileUploadBatchResult,
  DeepSeekFileUploadFailureDetail,
  DeepSeekFileUploadFailureReport,
  DeepSeekStructuredFileUploadErrorData,
  DeepSeekUploadedFileResult,
} from '../../types/deepseek-file.types.js'

export class DeepSeekFileUploadError extends Error {
  public readonly code = 'deepseek_file_upload_failed'
  public readonly batch: DeepSeekFileUploadBatchResult
  public readonly report: DeepSeekFileUploadFailureReport

  public constructor(batch: DeepSeekFileUploadBatchResult) {
    const report = buildDeepSeekFileUploadFailureReport(batch)
    super(formatDeepSeekFileUploadFailureMessage(report))
    this.name = 'DeepSeekFileUploadError'
    this.batch = cloneDeepSeekFileUploadBatch(batch)
    this.report = report
  }

  public toStructuredData(): DeepSeekStructuredFileUploadErrorData {
    return {
      category: 'deepseek_file_upload',
      report: cloneDeepSeekFileUploadFailureReport(this.report),
      batch: cloneDeepSeekFileUploadBatch(this.batch),
    }
  }
}

export function createDeepSeekFileUploadError(
  batch: DeepSeekFileUploadBatchResult,
): DeepSeekFileUploadError {
  return new DeepSeekFileUploadError(batch)
}

export function isDeepSeekFileUploadError(
  error: unknown,
): error is DeepSeekFileUploadError {
  return error instanceof DeepSeekFileUploadError
}

export function buildDeepSeekFileUploadFailureReport(
  batch: DeepSeekFileUploadBatchResult,
): DeepSeekFileUploadFailureReport {
  const details: DeepSeekFileUploadFailureDetail[] = [
    ...batch.problems.map(problem => mapBatchProblemToFailureDetail(problem)),
    ...batch.files.flatMap(file =>
      file.problems.map(problem => mapFileProblemToFailureDetail(file, problem)),
    ),
  ]
  const kinds = [...new Set(details.map(detail => detail.kind))]

  return {
    kind:
      kinds.length === 0
        ? 'mixed'
        : kinds.length === 1
          ? kinds[0] ?? 'mixed'
          : 'mixed',
    retryable: details.length > 0 && details.every(detail => detail.retryable),
    blockingIssues: batch.blockingIssues,
    settled: batch.settled,
    requestedFileCount: batch.requestedPaths.length,
    acceptedFileCount: batch.acceptedPaths.length,
    mountedFileCount: batch.files.filter(file => file.mounted).length,
    detailCount: details.length,
    details,
  }
}

export function formatDeepSeekFileUploadFailureMessage(
  report: DeepSeekFileUploadFailureReport,
): string {
  const lines = [
    `DeepSeek file upload failed [classification=${report.kind}, retryable=${String(report.retryable)}].`,
    `Requested=${report.requestedFileCount}, accepted=${report.acceptedFileCount}, mounted=${report.mountedFileCount}, settled=${String(report.settled)}, blockingIssues=${String(report.blockingIssues)}.`,
  ]

  for (const detail of report.details) {
    lines.push(formatDeepSeekFileUploadFailureDetail(detail))
  }

  return lines.join('\n')
}

export function formatDeepSeekConsoleError(error: unknown): string {
  if (isDeepSeekFileUploadError(error)) {
    return error.message
  }

  return error instanceof Error
    ? error.message
    : 'deepseek failed with an unknown error.'
}

export function extractDeepSeekStructuredError(error: unknown): {
  code: string
  message: string
  data?: unknown
} | null {
  if (isDeepSeekFileUploadError(error)) {
    return {
      code: error.code,
      message: error.message,
      data: error.toStructuredData(),
    }
  }

  return null
}

function formatDeepSeekFileUploadFailureDetail(
  detail: DeepSeekFileUploadFailureDetail,
): string {
  const target = detail.fileName ?? detail.path ?? 'batch'
  return `- ${target} [${detail.kind}/${detail.problemCode}, retryable=${String(detail.retryable)}]: ${detail.message}`
}

function mapBatchProblemToFailureDetail(
  problem: DeepSeekFilePreflightProblem,
): DeepSeekFileUploadFailureDetail {
  return {
    scope: 'batch',
    ...mapProblemCodeToFailureKind(problem.code, problem.message),
    problemCode: problem.code,
    fileName: problem.fileName ?? null,
    path: problem.path ?? null,
    message: problem.message,
    serverStatus: null,
    errorCode: null,
  }
}

function mapFileProblemToFailureDetail(
  file: DeepSeekUploadedFileResult,
  problem: DeepSeekFilePreflightProblem,
): DeepSeekFileUploadFailureDetail {
  return {
    scope: 'file',
    ...mapProblemCodeToFailureKind(problem.code, problem.message),
    problemCode: problem.code,
    fileName: file.fileName || problem.fileName || null,
    path: file.path || problem.path || null,
    message: problem.message,
    serverStatus: file.serverStatus,
    errorCode: file.errorCode,
  }
}

function mapProblemCodeToFailureKind(
  code: DeepSeekFilePreflightProblemCode,
  message: string,
): Pick<DeepSeekFileUploadFailureDetail, 'kind' | 'retryable'> {
  if (code === 'file_not_found' || code === 'not_a_file') {
    return {
      kind: 'local_input',
      retryable: false,
    }
  }

  if (code === 'unsupported_file_type') {
    return {
      kind: 'unsupported_type',
      retryable: false,
    }
  }

  if (code === 'exceed_count' || code === 'exceed_size' || looksLikeLimitExceeded(message)) {
    return {
      kind: 'limit_exceeded',
      retryable: false,
    }
  }

  if (code === 'missing_upload_response') {
    return {
      kind: 'upload_response_missing',
      retryable: true,
    }
  }

  if (code === 'upload_rejected') {
    return {
      kind: looksLikeLimitExceeded(message) ? 'limit_exceeded' : 'upload_rejected',
      retryable: false,
    }
  }

  if (code === 'fetch_files_timeout' || code === 'fetch_files_processing_timeout') {
    return {
      kind: 'settlement_timeout',
      retryable: true,
    }
  }

  if (code === 'fetch_files_failed') {
    return {
      kind: 'processing_failed',
      retryable: false,
    }
  }

  if (code === 'fetch_files_rejected') {
    return {
      kind: 'fallback_rejected',
      retryable: true,
    }
  }

  return {
    kind: 'mount_verification_failed',
    retryable: true,
  }
}

function looksLikeLimitExceeded(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('quota') ||
    normalized.includes('too large') ||
    normalized.includes('size limit') ||
    normalized.includes('exceeds') ||
    normalized.includes('limit')
  )
}

function cloneDeepSeekFileUploadFailureReport(
  report: DeepSeekFileUploadFailureReport,
): DeepSeekFileUploadFailureReport {
  return {
    ...report,
    details: report.details.map(detail => ({ ...detail })),
  }
}

function cloneDeepSeekFileUploadBatch(
  batch: DeepSeekFileUploadBatchResult,
): DeepSeekFileUploadBatchResult {
  return {
    fileInput: {
      ...batch.fileInput,
      acceptedExtensions: [...batch.fileInput.acceptedExtensions],
    },
    requestedPaths: [...batch.requestedPaths],
    acceptedPaths: [...batch.acceptedPaths],
    problems: batch.problems.map(problem => ({ ...problem })),
    files: batch.files.map(file => ({
      ...file,
      upload: file.upload ? { ...file.upload } : null,
      fetched: file.fetched ? { ...file.fetched } : null,
      preview: file.preview ? { ...file.preview } : null,
      problems: file.problems.map(problem => ({ ...problem })),
    })),
    fetches: batch.fetches.map(fetch => ({
      ...fetch,
      files: fetch.files.map(file => ({ ...file })),
    })),
    settled: batch.settled,
    blockingIssues: batch.blockingIssues,
  }
}
