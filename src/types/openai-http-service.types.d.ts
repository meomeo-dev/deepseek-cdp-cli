import type { DeepSeekResolvedOutputMode } from './deepseek-output-modes.types.js'
import type {
  DeepSeekReplyExecutionInput,
  DeepSeekReplyExecutionResult,
} from './deepseek-reply-output.types.js'
import type { DeepSeekReplyResult } from './deepseek-reply.types.js'
import type { ManagedChromeOptions, WaitUntil } from './managed-chrome.types.js'
import type { OpenAIChatCompletionResponse } from './openai-chat-completions.types.js'
import type {
  OpenAIResponseObject,
  OpenAIResponsesInputMessageItem,
} from './openai-responses.types.js'

export type OpenAICompatibleModelAlias =
  | 'deepseek-chat-browser'
  | 'deepseek-expert-browser'

export type OpenAIHttpEndpoint =
  | '/v1/chat/completions'
  | '/v1/responses'

export type OpenAIHttpRequestClassification =
  | 'new-turn'
  | 'history-bootstrap'
  | 'session-continuation'

export type OpenAIHttpPromptEncoding =
  | 'raw-user-prompt'
  | 'message-transcript'

export interface OpenAIHttpDeepSeekOptions {
  search?: 'on' | 'off' | undefined
  deepThink?: 'on' | 'off' | undefined
}

export interface OpenAIChatCompletionsStreamOptions {
  includeUsage: boolean
}

export interface OpenAIHttpMappedComposerMode {
  chatMode: 'instant' | 'expert'
  deepThink: 'on' | 'off'
  search: 'on' | 'off'
}

export type OpenAIChatCompletionsMessageRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'developer'

export interface OpenAIChatCompletionsTextMessage {
  role: OpenAIChatCompletionsMessageRole
  content: string
}

export interface OpenAIChatCompletionsUserMessage extends OpenAIChatCompletionsTextMessage {
  role: 'user'
}

export interface OpenAIHttpLatestActionableUserTurn<TUserMessage> {
  itemIndex: number
  message: TUserMessage
}

export interface OpenAIChatCompletionsHistoryBootstrap {
  historyMessages: OpenAIChatCompletionsTextMessage[]
  latestTurnMessages: [OpenAIChatCompletionsUserMessage]
  latestActionableUserTurn: OpenAIHttpLatestActionableUserTurn<OpenAIChatCompletionsUserMessage>
}

export interface OpenAIChatCompletionsSubsetRequest {
  endpoint: '/v1/chat/completions'
  model: OpenAICompatibleModelAlias
  messages: OpenAIChatCompletionsTextMessage[]
  stream: boolean
  streamOptions: OpenAIChatCompletionsStreamOptions | null
  n: 1
  store: boolean | null
  metadata: Record<string, string> | null
  deepseekOptions: OpenAIHttpDeepSeekOptions
  requestClassification: Exclude<OpenAIHttpRequestClassification, 'session-continuation'>
  historyBootstrap: OpenAIChatCompletionsHistoryBootstrap | null
}

export type OpenAIResponsesInputMessageRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'developer'

export interface OpenAIResponsesTextInputMessage {
  role: OpenAIResponsesInputMessageRole
  content: string
}

export interface OpenAIResponsesUserInputMessage extends OpenAIResponsesTextInputMessage {
  role: 'user'
}

export interface OpenAIResponsesInputFileItem {
  type: 'input_file'
  filename: string
  fileData: string
}

export type OpenAIResponsesInputItem =
  | OpenAIResponsesTextInputMessage
  | OpenAIResponsesInputFileItem

export interface OpenAIResponsesHistoryBootstrap {
  historyItems: OpenAIResponsesTextInputMessage[]
  latestTurnItems:
    | [OpenAIResponsesUserInputMessage]
    | [OpenAIResponsesUserInputMessage, ...OpenAIResponsesInputFileItem[]]
  latestActionableUserTurn: OpenAIHttpLatestActionableUserTurn<OpenAIResponsesUserInputMessage>
}

export interface OpenAIResponsesSubsetRequest {
  endpoint: '/v1/responses'
  model: OpenAICompatibleModelAlias
  input: string | OpenAIResponsesInputItem[]
  instructions: string | null
  stream: boolean
  deepseekOptions: OpenAIHttpDeepSeekOptions
  previousResponseId: string | null
  store: boolean | null
  metadata: Record<string, string> | null
  requestClassification: OpenAIHttpRequestClassification
  historyBootstrap: OpenAIResponsesHistoryBootstrap | null
}

export interface OpenAIHttpExecutionEnvironment {
  managedChromeOptions: ManagedChromeOptions
  waitUntil: WaitUntil
  url?: string | undefined
  sessionStoreDir?: string | undefined
}

export interface OpenAIHttpResponseHandleRecord {
  kind: 'openai-http-response-handle'
  version: 1
  responseId: string
  endpoint: '/v1/responses'
  model: OpenAICompatibleModelAlias
  sessionId: string
  sessionFile: string
  branchId: string | null
  agentId: DeepSeekReplyResult['agentId'] | null
  store: boolean
  metadata: Record<string, string>
  requestId: string | null
  requestClassification: OpenAIHttpRequestClassification
  response: OpenAIResponseObject | null
  inputItems: OpenAIResponsesInputMessageItem[] | null
  createdAt: string
  updatedAt: string
}

export interface OpenAIHttpChatCompletionRecord {
  kind: 'openai-http-chat-completion'
  version: 1
  completionId: string
  endpoint: '/v1/chat/completions'
  model: OpenAICompatibleModelAlias
  sessionId: string
  sessionFile: string
  branchId: string | null
  agentId: DeepSeekReplyResult['agentId'] | null
  store: boolean
  metadata: Record<string, string>
  requestId: string | null
  requestClassification: Exclude<OpenAIHttpRequestClassification, 'session-continuation'>
  messages: OpenAIChatCompletionsTextMessage[]
  completion: OpenAIChatCompletionResponse
  createdAt: string
  updatedAt: string
}

export type OpenAIHttpStagedInputFileSource =
  | 'request-input'
  | 'history-bootstrap-artifact'

export interface OpenAIHttpStagedInputFile {
  kind: 'openai-http-staged-input-file'
  version: 1
  stageId: string
  endpoint: OpenAIHttpEndpoint
  source: OpenAIHttpStagedInputFileSource
  requestId: string
  originalFilename: string
  stagedFilename: string
  stagingDirectory: string
  filePath: string
  byteSize: number
  createdAt: string
}

export type OpenAIHttpPreparedResponsesInputItem =
  | {
      kind: 'message'
      message: OpenAIResponsesTextInputMessage
    }
  | {
      kind: 'input_file'
      stagedFile: OpenAIHttpStagedInputFile
    }

export interface OpenAIHttpPreparedResponsesInput {
  orderedItems: OpenAIHttpPreparedResponsesInputItem[]
  textMessages: OpenAIResponsesTextInputMessage[]
  requestStagedFiles: OpenAIHttpStagedInputFile[]
  historyBootstrapArtifact: OpenAIHttpStagedInputFile | null
  stagedFiles: OpenAIHttpStagedInputFile[]
}

export interface OpenAIHttpPreparedReplyExecutionCleanup {
  stagedInputFiles: OpenAIHttpStagedInputFile[]
}

export interface OpenAIHttpPreparedRequestMeta {
  requestId: string
  endpoint: OpenAIHttpEndpoint
  model: OpenAICompatibleModelAlias
  stream: boolean
  requestClassification: OpenAIHttpRequestClassification
  prompt: string
  promptEncoding: OpenAIHttpPromptEncoding
  messageCount: number
  inputFileCount: number
  promptCharacterCount: number
  composerMode: OpenAIHttpMappedComposerMode
  outputMode: DeepSeekResolvedOutputMode
}

export interface OpenAIHttpPreparedReplyExecution {
  request: OpenAIChatCompletionsSubsetRequest | OpenAIResponsesSubsetRequest
  execution: DeepSeekReplyExecutionInput
  meta: OpenAIHttpPreparedRequestMeta
  cleanup?: OpenAIHttpPreparedReplyExecutionCleanup | undefined
}

export interface OpenAIHttpExecutionFailure {
  statusCode: number
  type: 'invalid_request_error' | 'api_error' | 'rate_limit_error'
  code: string
  message: string
}

export interface OpenAIHttpExecutedReply {
  prepared: OpenAIHttpPreparedReplyExecution
  delivery: DeepSeekReplyExecutionResult
}
