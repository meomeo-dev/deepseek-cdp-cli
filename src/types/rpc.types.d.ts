export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: TParams
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: '2.0'
  method: string
  params: TParams
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: '2.0'
  id: string | number | null
  result: TResult
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: JsonRpcErrorObject
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccess<TResult>
  | JsonRpcFailure

export type JsonRpcMessage<TResult = unknown, TParams = unknown> =
  | JsonRpcResponse<TResult>
  | JsonRpcNotification<TParams>
