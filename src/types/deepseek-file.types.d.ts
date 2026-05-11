import type { DeepSeekAttachment } from './deepseek-session.types.js'

export type DeepSeekFileEndpoint =
  | '/api/v0/file/upload_file'
  | '/api/v0/file/fetch_files'
  | '/api/v0/file/preview'

export type DeepSeekFilePreflightProblemCode =
  | 'exceed_count'
  | 'exceed_size'
  | 'unsupported_file_type'
  | 'file_not_found'
  | 'not_a_file'
  | 'missing_upload_response'
  | 'upload_rejected'
  | 'fetch_files_timeout'
  | 'fetch_files_processing_timeout'
  | 'fetch_files_failed'
  | 'fetch_files_rejected'
  | 'preview_failed'
  | 'mount_unverified'

export type DeepSeekFileUploadFailureKind =
  | 'local_input'
  | 'unsupported_type'
  | 'limit_exceeded'
  | 'upload_rejected'
  | 'upload_response_missing'
  | 'settlement_timeout'
  | 'processing_failed'
  | 'fallback_rejected'
  | 'mount_verification_failed'
  | 'mixed'

export interface DeepSeekFileUploadFailureDetail {
  scope: 'batch' | 'file'
  kind: Exclude<DeepSeekFileUploadFailureKind, 'mixed'>
  problemCode: DeepSeekFilePreflightProblemCode
  retryable: boolean
  fileName: string | null
  path: string | null
  message: string
  serverStatus: string | null
  errorCode: string | null
}

export interface DeepSeekFileUploadFailureReport {
  kind: DeepSeekFileUploadFailureKind
  retryable: boolean
  blockingIssues: boolean
  settled: boolean
  requestedFileCount: number
  acceptedFileCount: number
  mountedFileCount: number
  detailCount: number
  details: DeepSeekFileUploadFailureDetail[]
}

export interface DeepSeekStructuredFileUploadErrorData {
  category: 'deepseek_file_upload'
  report: DeepSeekFileUploadFailureReport
  batch: DeepSeekFileUploadBatchResult
}

export interface DeepSeekComposerFileInput {
  found: boolean
  selector: string | null
  accept: string | null
  acceptedExtensions: string[]
  multiple: boolean
  hidden: boolean
}

export interface DeepSeekLocalFileCandidate {
  path: string
  fileName: string
  extension: string | null
  sizeBytes: number | null
}

export interface DeepSeekFilePreflightProblem {
  code: DeepSeekFilePreflightProblemCode
  message: string
  path?: string | undefined
  fileName?: string | undefined
  sizeBytes?: number | undefined
  limit?: number | undefined
  accept?: string | undefined
}

export interface DeepSeekFileExchangeRequest {
  method: string
  url: string
  headers: Record<string, string>
  bodyText: string | null
}

export interface DeepSeekFileExchangeResponse {
  status: number
  contentType: string | null
  bodyText: string
}

export interface DeepSeekFileCapturedExchange {
  endpoint: DeepSeekFileEndpoint
  request: DeepSeekFileExchangeRequest
  response: DeepSeekFileExchangeResponse
}

export interface DeepSeekUploadFileObservation {
  endpoint: '/api/v0/file/upload_file'
  requestUrl: string
  status: number
  code: number | null
  message: string | null
  bizCode: number | null
  bizMessage: string | null
  fileId: string | null
  fileName: string | null
  fileStatus: string | null
  previewable: boolean | null
  fileSize: number | null
  tokenUsage: number | null
  errorCode: string | null
  acknowledged: boolean
}

export interface DeepSeekFetchedFileRecord {
  id: string
  status: string | null
  fileName: string | null
  previewable: boolean | null
  fileSize: number | null
  tokenUsage: number | null
  errorCode: string | null
  insertedAt: string | null
  updatedAt: string | null
}

export interface DeepSeekFetchFilesObservation {
  endpoint: '/api/v0/file/fetch_files'
  requestUrl: string
  status: number
  code: number | null
  message: string | null
  bizCode: number | null
  bizMessage: string | null
  files: DeepSeekFetchedFileRecord[]
  acknowledged: boolean
}

export interface DeepSeekFilePreviewObservation {
  endpoint: '/api/v0/file/preview'
  requestUrl: string
  status: number
  code: number | null
  message: string | null
  bizCode: number | null
  bizMessage: string | null
  fileId: string | null
  previewUrl: string | null
  acknowledged: boolean
}

export interface DeepSeekUploadedFileResult extends DeepSeekLocalFileCandidate {
  acceptedByPreflight: boolean
  uploaded: boolean
  settled: boolean
  mounted: boolean
  fileId: string | null
  serverStatus: string | null
  previewable: boolean | null
  tokenUsage: number | null
  previewUrl: string | null
  errorCode: string | null
  errorMessage: string | null
  upload: DeepSeekUploadFileObservation | null
  fetched: DeepSeekFetchedFileRecord | null
  preview: DeepSeekFilePreviewObservation | null
  problems: DeepSeekFilePreflightProblem[]
}

export interface DeepSeekFileUploadBatchResult {
  fileInput: DeepSeekComposerFileInput
  requestedPaths: string[]
  acceptedPaths: string[]
  problems: DeepSeekFilePreflightProblem[]
  files: DeepSeekUploadedFileResult[]
  fetches: DeepSeekFetchFilesObservation[]
  settled: boolean
  blockingIssues: boolean
}

export interface DeepSeekUploadComposerFilesInput {
  filePaths: string[]
  timeoutMs: number
  pollIntervalMs?: number | undefined
  allowSettledUnverifiedMount?: boolean | undefined
}

export interface DeepSeekFilePreviewRequest {
  fileId: string
  unsent?: boolean | undefined
}

export type DeepSeekSuccessfulUploadedAttachment = Pick<
  DeepSeekUploadedFileResult,
  'fileId' | 'fileName' | 'sizeBytes' | 'previewUrl' | 'mounted'
>

export type DeepSeekUploadedAttachment = DeepSeekAttachment
