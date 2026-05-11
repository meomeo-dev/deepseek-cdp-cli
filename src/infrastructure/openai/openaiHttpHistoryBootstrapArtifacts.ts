import { stageOpenAIHttpInputFile } from './openaiHttpInputFileStaging.js'
import type {
  OpenAIChatCompletionsSubsetRequest,
  OpenAIChatCompletionsTextMessage,
  OpenAIHttpStagedInputFile,
  OpenAIResponsesSubsetRequest,
  OpenAIResponsesTextInputMessage,
} from '../../types/openai-http-service.types.js'

export async function stageOpenAIHttpHistoryBootstrapArtifact(input: {
  requestId: string
  request: OpenAIChatCompletionsSubsetRequest | OpenAIResponsesSubsetRequest
  sessionStoreDir?: string | undefined
  cwd?: string | undefined
  createdAt?: string | undefined
}): Promise<OpenAIHttpStagedInputFile | null> {
  if (input.request.historyBootstrap === null) {
    return null
  }

  const artifactBody =
    input.request.endpoint === '/v1/chat/completions'
      ? buildOpenAIHttpHistoryBootstrapArtifactBody({
          endpoint: input.request.endpoint,
          historyMessages: input.request.historyBootstrap.historyMessages,
        })
      : buildOpenAIHttpHistoryBootstrapArtifactBody({
          endpoint: input.request.endpoint,
          historyMessages: input.request.historyBootstrap.historyItems,
        })

  return stageOpenAIHttpInputFile({
    requestId: input.requestId,
    endpoint: input.request.endpoint,
    source: 'history-bootstrap-artifact',
    sessionStoreDir: input.sessionStoreDir,
    cwd: input.cwd,
    createdAt: input.createdAt,
    file: {
      type: 'input_file',
      filename: resolveOpenAIHttpHistoryBootstrapArtifactFilename(input.request.endpoint),
      fileData: Buffer.from(artifactBody, 'utf8').toString('base64'),
    },
  })
}

function buildOpenAIHttpHistoryBootstrapArtifactBody(input: {
  endpoint: '/v1/chat/completions' | '/v1/responses'
  historyMessages:
    | readonly OpenAIChatCompletionsTextMessage[]
    | readonly OpenAIResponsesTextInputMessage[]
}): string {
  const transcript = input.historyMessages.length > 0
    ? input.historyMessages
      .map(message => `${formatRoleLabel(message.role)}:\n${message.content || '<empty message>'}`)
      .join('\n\n')
    : '<no historical transcript captured>'

  return [
    'OpenAI history bootstrap context',
    `endpoint: ${input.endpoint}`,
    `history_item_count: ${String(input.historyMessages.length)}`,
    'note: This file contains only prior transcript context imported into a fresh DeepSeek session.',
    'note: The newest actionable user turn is sent separately in the live prompt and is not duplicated here.',
    '',
    transcript,
    '',
  ].join('\n')
}

function resolveOpenAIHttpHistoryBootstrapArtifactFilename(
  endpoint: '/v1/chat/completions' | '/v1/responses',
): string {
  return endpoint === '/v1/chat/completions'
    ? 'openai-chat-completions-history-bootstrap.txt'
    : 'openai-responses-history-bootstrap.txt'
}

function formatRoleLabel(
  role: 'system' | 'user' | 'assistant' | 'developer',
): string {
  switch (role) {
    case 'developer':
      return 'Developer'
    case 'system':
      return 'System'
    case 'user':
      return 'User'
    case 'assistant':
      return 'Assistant'
  }
}
