export type HttpErrorSurface = 'rpc' | 'openai'
export type HttpErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'rate_limit_error'
  | 'api_error'

export interface HttpServiceErrorOptions {
  statusCode: number
  surface: HttpErrorSurface
  type: HttpErrorType
  code: string
  message: string
  headers?: Record<string, string> | undefined
}

export class HttpServiceError extends Error {
  readonly statusCode: number
  readonly surface: HttpErrorSurface
  readonly type: HttpErrorType
  readonly code: string
  readonly headers: Record<string, string>

  constructor(options: HttpServiceErrorOptions) {
    super(options.message)
    this.name = 'HttpServiceError'
    this.statusCode = options.statusCode
    this.surface = options.surface
    this.type = options.type
    this.code = options.code
    this.headers = { ...(options.headers ?? {}) }
  }
}

export function createHttpServiceError(
  options: HttpServiceErrorOptions,
): HttpServiceError {
  return new HttpServiceError(options)
}

export function buildHttpErrorBody(error: HttpServiceError): string {
  return JSON.stringify({
    error: {
      message: error.message,
      type: error.type,
      param: null,
      code: error.code,
    },
  })
}
