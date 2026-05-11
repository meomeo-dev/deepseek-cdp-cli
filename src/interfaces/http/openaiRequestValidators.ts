import { createHttpServiceError } from './httpErrors.js'
import type {
  OpenAIChatCompletionsSubsetRequest,
  OpenAICompatibleModelAlias,
  OpenAIHttpDeepSeekOptions,
  OpenAIResponsesInputFileItem,
  OpenAIResponsesInputItem,
  OpenAIResponsesSubsetRequest,
} from '../../types/openai-http-service.types.js'
import requestControlContract from '../../infrastructure/openai/openaiHttpRequestControlContract.json' with { type: 'json' }

const SUPPORTED_MODEL_ALIASES = new Set<OpenAICompatibleModelAlias>([
  'deepseek-chat-browser',
  'deepseek-expert-browser',
])

const CHAT_COMPLETIONS_ACCEPTED_FIELDS = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'n',
  'store',
  'metadata',
  'web_search_options',
  'reasoning_effort',
  'deepseek_options',
])

const RESPONSES_ACCEPTED_FIELDS = new Set([
  'model',
  'input',
  'instructions',
  'stream',
  'tools',
  'reasoning',
  'deepseek_options',
  'previous_response_id',
  'store',
  'metadata',
])

const CHAT_COMPLETIONS_EXPLICITLY_UNSUPPORTED_FIELDS = new Set([
  'conversation',
  'previous_response_id',
  'file_id',
  'file_url',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'audio',
  'modalities',
  'response_format',
  'temperature',
  'top_p',
  'stop',
  'seed',
  'logprobs',
  'top_logprobs',
  'presence_penalty',
  'frequency_penalty',
  'max_tokens',
  'max_completion_tokens',
  'reasoning',
  'search',
  'deep_think',
  'deepThink',
])

const RESPONSES_EXPLICITLY_UNSUPPORTED_FIELDS = new Set([
  'conversation',
  'background',
  'file_id',
  'file_url',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'attachments',
  'include',
  'stream_options',
  'truncation',
  'temperature',
  'top_p',
  'max_output_tokens',
  'search',
  'deep_think',
  'deepThink',
])

const INPUT_FILE_ACCEPTED_FIELDS = new Set([
  'type',
  'filename',
  'file_data',
])

const INPUT_FILE_EXPLICITLY_UNSUPPORTED_FIELDS = new Set([
  'file_id',
  'file_url',
])

const RESPONSES_MESSAGE_ACCEPTED_FIELDS = new Set([
  'role',
  'content',
  'type',
])

const RESPONSES_TEXT_CONTENT_ACCEPTED_FIELDS = new Set([
  'type',
  'text',
])

const CHAT_MESSAGE_ACCEPTED_FIELDS = new Set([
  'role',
  'content',
])

const CHAT_MESSAGE_EXPLICITLY_UNSUPPORTED_FIELDS = new Set([
  'name',
  'audio',
  'tool_calls',
  'function_call',
  'tool_call_id',
  'refusal',
])

const CHAT_TEXT_CONTENT_ACCEPTED_FIELDS = new Set([
  'type',
  'text',
])

const CHAT_STREAM_OPTIONS_ACCEPTED_FIELDS = new Set([
  'include_usage',
])

const CHAT_WEB_SEARCH_OPTIONS_ACCEPTED_FIELDS = new Set(
  requestControlContract.chat.officialSearch.acceptedTopLevelFields,
)

const CHAT_WEB_SEARCH_LOCATION_ACCEPTED_FIELDS = new Set(
  requestControlContract.chat.officialSearch.locationFields,
)

const WEB_SEARCH_APPROXIMATE_ACCEPTED_FIELDS = new Set(
  requestControlContract.chat.officialSearch.approximateFields,
)

const RESPONSES_REASONING_ACCEPTED_FIELDS = new Set(
  requestControlContract.responses.officialReasoning.acceptedTopLevelFields,
)

const RESPONSES_TOOL_ACCEPTED_FIELDS = new Set(
  requestControlContract.responses.officialSearch.acceptedTopLevelFields,
)

const RESPONSES_TOOL_USER_LOCATION_ACCEPTED_FIELDS = new Set(
  requestControlContract.responses.officialSearch.userLocationFields,
)

export function parseOpenAIJsonBody(body: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw invalidRequest('invalid_json', 'Request body must be valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw invalidRequest('invalid_request', 'Request body must be a JSON object.')
  }

  return parsed
}

export function validateOpenAIChatCompletionsRequest(
  body: Record<string, unknown>,
): OpenAIChatCompletionsSubsetRequest {
  rejectUnknownOrUnsupportedFields({
    body,
    acceptedFields: CHAT_COMPLETIONS_ACCEPTED_FIELDS,
    explicitlyUnsupportedFields: CHAT_COMPLETIONS_EXPLICITLY_UNSUPPORTED_FIELDS,
    endpoint: '/v1/chat/completions',
  })

  const model = validateModelAlias(body['model'])
  const messages = validateChatMessages(body['messages'])
  const stream = validateOptionalBoolean(body['stream'], 'stream')
  const streamOptions = validateOptionalChatStreamOptions(body['stream_options'])
  const n = validateOptionalN(body['n'])
  const store = validateOptionalNullableBoolean(body['store'], 'store')
  const metadata = validateOptionalMetadata(body['metadata'], 'metadata')
  const deepseekOptions = normalizeOpenAIRequestControls({
    deepseekOptions: validateOptionalDeepSeekOptions(body['deepseek_options']),
    officialSearch: validateOptionalChatWebSearchOptions(body['web_search_options']),
    officialDeepThink: validateOptionalChatReasoningEffort(body['reasoning_effort']),
  })
  const historyAnalysis = analyzeChatCompletionsRequest(messages)

  return {
    endpoint: '/v1/chat/completions',
    model,
    messages,
    stream,
    streamOptions,
    n,
    store,
    metadata,
    deepseekOptions,
    requestClassification: historyAnalysis.requestClassification,
    historyBootstrap: historyAnalysis.historyBootstrap,
  }
}

export function validateOpenAIResponsesRequest(
  body: Record<string, unknown>,
): OpenAIResponsesSubsetRequest {
  rejectUnknownOrUnsupportedFields({
    body,
    acceptedFields: RESPONSES_ACCEPTED_FIELDS,
    explicitlyUnsupportedFields: RESPONSES_EXPLICITLY_UNSUPPORTED_FIELDS,
    endpoint: '/v1/responses',
  })

  const model = validateModelAlias(body['model'])
  const input = validateResponsesInput(body['input'])
  const instructions = validateOptionalString(body['instructions'], 'instructions')
  const stream = validateOptionalBoolean(body['stream'], 'stream')
  const deepseekOptions = normalizeOpenAIRequestControls({
    deepseekOptions: validateOptionalDeepSeekOptions(body['deepseek_options']),
    officialSearch: validateOptionalResponsesTools(body['tools']),
    officialDeepThink: validateOptionalResponsesReasoning(body['reasoning']),
  })
  const previousResponseId = validateOptionalIdentifier(
    body['previous_response_id'],
    'previous_response_id',
  )
  const store = validateOptionalNullableBoolean(body['store'], 'store')
  const metadata = validateOptionalMetadata(body['metadata'], 'metadata')
  const historyAnalysis = analyzeResponsesRequest({
    input,
    previousResponseId,
  })

  return {
    endpoint: '/v1/responses',
    model,
    input,
    instructions,
    stream,
    deepseekOptions,
    previousResponseId,
    store,
    metadata,
    requestClassification: historyAnalysis.requestClassification,
    historyBootstrap: historyAnalysis.historyBootstrap,
  }
}

export function assertOpenAIRequestUsesCurrentlyImplementedFeatures(
  request: OpenAIChatCompletionsSubsetRequest | OpenAIResponsesSubsetRequest,
): void {
  void request
}

function rejectUnknownOrUnsupportedFields(input: {
  body: Record<string, unknown>
  acceptedFields: ReadonlySet<string>
  explicitlyUnsupportedFields: ReadonlySet<string>
  endpoint: '/v1/chat/completions' | '/v1/responses'
}): void {
  for (const key of Object.keys(input.body)) {
    if (input.acceptedFields.has(key)) {
      continue
    }

    if (input.explicitlyUnsupportedFields.has(key)) {
      throw unsupportedField(
        key,
        `${input.endpoint} does not support \`${key}\` in the current compatibility subset.`,
      )
    }

    throw unsupportedField(
      key,
      `${input.endpoint} does not support unknown field \`${key}\`; unsupported fields are rejected fail-closed.`,
    )
  }
}

function validateModelAlias(value: unknown): OpenAICompatibleModelAlias {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidField('model', '`model` is required and must be a non-empty string.')
  }

  const normalized = value.trim()
  if (!SUPPORTED_MODEL_ALIASES.has(normalized as OpenAICompatibleModelAlias)) {
    throw unsupportedField(
      'model',
      `Unsupported model \`${normalized}\`. Supported models: deepseek-chat-browser, deepseek-expert-browser.`,
    )
  }

  return normalized as OpenAICompatibleModelAlias
}

function validateChatMessages(
  value: unknown,
): OpenAIChatCompletionsSubsetRequest['messages'] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidField('messages', '`messages` must be a non-empty array.')
  }

  return value.map((message, index) => normalizeChatTextMessage(message, `messages[${index}]`))
}

function validateResponsesInput(
  value: unknown,
): OpenAIResponsesSubsetRequest['input'] {
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw invalidField('input', '`input` string must not be empty.')
    }

    return value
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw invalidField(
      'input',
      '`input` must be either a non-empty string or a non-empty input array of message items and/or legacy first-stage `input_file` items.',
    )
  }

  return value.flatMap((item, index) => normalizeResponsesInputItem(item, `input[${index}]`))
}

function normalizeChatTextMessage(
  value: unknown,
  path: string,
): OpenAIChatCompletionsSubsetRequest['messages'][number] {
  if (!isRecord(value)) {
    throw invalidField(path, `\`${path}\` must be an object with role and text-only content.`)
  }

  const role = value['role']
  if (role === 'tool' || role === 'function') {
    throw unsupportedField(
      `${path}.role`,
      `\`${path}.role\`=${role} is part of the official Chat Completions schema but is not supported in the current text-only compatibility subset.`,
    )
  }

  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'developer') {
    throw invalidField(
      `${path}.role`,
      `\`${path}.role\` must be one of developer, system, user, or assistant in the current supported subset.`,
    )
  }

  for (const key of Object.keys(value)) {
    if (CHAT_MESSAGE_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    if (CHAT_MESSAGE_EXPLICITLY_UNSUPPORTED_FIELDS.has(key)) {
      throw unsupportedField(
        `${path}.${key}`,
        `\`${path}.${key}\` is part of the official Chat Completions schema but is not supported in the current text-only compatibility subset.`,
      )
    }

    throw unsupportedField(
      `${path}.${key}`,
      `\`${path}.${key}\` is not supported in the current /v1/chat/completions message subset.`,
    )
  }

  return {
    role,
    content: normalizeChatTextContent(value['content'], `${path}.content`),
  }
}

function normalizeResponsesInputItem(
  value: unknown,
  path: string,
): OpenAIResponsesInputItem[] {
  if (!isRecord(value)) {
    throw invalidField(
      path,
      `\`${path}\` must be a message object or a legacy top-level \`input_file\` item.`,
    )
  }

  if (looksLikeResponsesMessageItem(value)) {
    return normalizeResponsesMessage(value, path)
  }

  if (looksLikeLegacyTopLevelInputFileItem(value)) {
    return [validateInputFileItem(value, path)]
  }

  throw invalidField(
    path,
    `\`${path}\` must be an EasyInputMessage-compatible object or a legacy top-level \`input_file\` item.`,
  )
}

function validateInputFileItem(
  value: Record<string, unknown>,
  path: string,
): OpenAIResponsesInputFileItem {
  for (const key of Object.keys(value)) {
    if (INPUT_FILE_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    if (INPUT_FILE_EXPLICITLY_UNSUPPORTED_FIELDS.has(key)) {
      throw unsupportedField(
        `${path}.${key}`,
        `\`${path}.${key}\` is not supported in the current file-input subset.`,
      )
    }

    throw unsupportedField(
      `${path}.${key}`,
      `\`${path}.${key}\` is not supported; unknown nested fields are rejected fail-closed.`,
    )
  }

  const type = value['type']
  if (type === undefined) {
    throw invalidField(`${path}.type`, `\`${path}.type\` is required for \`input_file\` items.`)
  }

  if (type !== 'input_file') {
    throw unsupportedField(
      `${path}.type`,
      `\`${path}.type\`=${formatUnsupportedValue(type)} is not supported; only \`input_file\` items are accepted in this subset.`,
    )
  }

  return {
    type: 'input_file',
    filename: validateRequiredNonEmptyString(value['filename'], `${path}.filename`),
    fileData: validateRequiredNonEmptyString(value['file_data'], `${path}.file_data`, {
      trim: false,
    }),
  }
}

function normalizeResponsesMessage(
  value: Record<string, unknown>,
  path: string,
): OpenAIResponsesInputItem[] {
  for (const key of Object.keys(value)) {
    if (RESPONSES_MESSAGE_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    throw unsupportedField(
      `${path}.${key}`,
      `\`${path}.${key}\` is not supported in the current /v1/responses message subset.`,
    )
  }

  if (hasOwn(value, 'type') && value['type'] !== 'message') {
    throw unsupportedField(
      `${path}.type`,
      `\`${path}.type\`=${formatUnsupportedValue(value['type'])} is not supported; only \`message\` is accepted for official /v1/responses input messages.`,
    )
  }

  const role = value['role']
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'developer') {
    throw invalidField(
      `${path}.role`,
      `\`${path}.role\` must be one of system, user, assistant, or developer.`,
    )
  }

  const normalizedContent = normalizeResponsesMessageContent(value['content'], `${path}.content`)
  const normalizedItems: OpenAIResponsesInputItem[] = []

  if (normalizedContent.text !== null) {
    normalizedItems.push({
      role,
      content: normalizedContent.text,
    })
  }

  normalizedItems.push(...normalizedContent.inputFiles)
  return normalizedItems
}

function normalizeResponsesMessageContent(
  value: unknown,
  path: string,
): {
  text: string | null
  inputFiles: OpenAIResponsesInputFileItem[]
} {
  if (typeof value === 'string') {
    return {
      text: value,
      inputFiles: [],
    }
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw invalidField(
      path,
      `\`${path}\` must be a string or a non-empty content array using the current supported OpenAI /v1/responses content subset.`,
    )
  }

  const textParts: string[] = []
  const inputFiles: OpenAIResponsesInputFileItem[] = []

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw invalidField(
        `${path}[${index}]`,
        `\`${path}[${index}]\` must be a supported input content object.`,
      )
    }

    if (item['type'] === 'input_file') {
      inputFiles.push(validateInputFileItem(item, `${path}[${index}]`))
      continue
    }

    if (item['type'] !== 'input_text' && item['type'] !== 'text') {
      throw unsupportedField(
        path,
        `\`${path}[${index}].type\`=${String(item['type'])} is not supported; only \`input_text\`, legacy \`text\`, and \`input_file\` content blocks are accepted in the current subset.`,
      )
    }

    for (const key of Object.keys(item)) {
      if (RESPONSES_TEXT_CONTENT_ACCEPTED_FIELDS.has(key)) {
        continue
      }

      throw unsupportedField(
        `${path}[${index}].${key}`,
        `\`${path}[${index}].${key}\` is not supported in the current /v1/responses text content subset.`,
      )
    }

    const text = item['text']
    if (typeof text !== 'string') {
      throw invalidField(
        `${path}[${index}].text`,
        `\`${path}[${index}].text\` must be a string.`,
      )
    }

    textParts.push(text)
  }

  if (inputFiles.length > 0 && textParts.length === 0) {
    throw invalidHistoryBootstrapField(
      'input',
      'endpoint_incompatible',
      `\`${path}\` must include at least one supported text part when it carries nested \`input_file\` blocks; file-only official message content is not supported in the current /v1/responses subset.`,
    )
  }

  return {
    text: textParts.length > 0 ? textParts.join('') : null,
    inputFiles,
  }
}

function normalizeChatTextContent(value: unknown, path: string): string {
  if (typeof value === 'string') {
    return value
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw invalidField(
      path,
      `\`${path}\` must be a string or a non-empty text-only content array.`,
    )
  }

  const textParts: string[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw invalidField(
        `${path}[${index}]`,
        `\`${path}[${index}]\` must be a text content object.`,
      )
    }

    if (item['type'] !== 'text') {
      throw unsupportedField(
        path,
        `\`${path}[${index}].type\`=${String(item['type'])} is not supported; only official \`type=text\` content blocks are accepted in the current /v1/chat/completions subset.`,
      )
    }

    for (const key of Object.keys(item)) {
      if (CHAT_TEXT_CONTENT_ACCEPTED_FIELDS.has(key)) {
        continue
      }

      throw unsupportedField(
        `${path}[${index}].${key}`,
        `\`${path}[${index}].${key}\` is not supported in the current /v1/chat/completions text content subset.`,
      )
    }

    const text = item['text']
    if (typeof text !== 'string') {
      throw invalidField(
        `${path}[${index}].text`,
        `\`${path}[${index}].text\` must be a string.`,
      )
    }

    textParts.push(text)
  }

  return textParts.join('')
}

function validateOptionalDeepSeekOptions(value: unknown): OpenAIHttpDeepSeekOptions {
  if (value === undefined) {
    return {}
  }

  if (!isRecord(value)) {
    throw invalidField(
      'deepseek_options',
      '`deepseek_options` must be an object when provided.',
    )
  }

  const options: OpenAIHttpDeepSeekOptions = {}

  for (const key of Object.keys(value)) {
    if (key === 'deepThink') {
      throw unsupportedField(
        'deepseek_options.deepThink',
        '`deepseek_options.deepThink` is not supported; use `deepseek_options.deep_think`.',
      )
    }

    if (key !== 'search' && key !== 'deep_think') {
      throw unsupportedField(
        `deepseek_options.${key}`,
        `\`deepseek_options.${key}\` is not supported in the current compatibility subset.`,
      )
    }
  }

  if (hasOwn(value, 'search')) {
    options.search = validateDeepSeekToggleValue(
      value['search'],
      'deepseek_options.search',
    )
  }

  if (hasOwn(value, 'deep_think')) {
    options.deepThink = validateDeepSeekToggleValue(
      value['deep_think'],
      'deepseek_options.deep_think',
    )
  }

  return options
}

function validateOptionalChatWebSearchOptions(value: unknown): 'on' | null {
  if (value === undefined) {
    return null
  }

  if (!isRecord(value)) {
    throw invalidField(
      'web_search_options',
      '`web_search_options` must be an object when provided.',
    )
  }

  for (const key of Object.keys(value)) {
    if (CHAT_WEB_SEARCH_OPTIONS_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    throw unsupportedField(
      `web_search_options.${key}`,
      `\`web_search_options.${key}\` is not supported; unknown nested fields are rejected fail-closed.`,
    )
  }

  if (hasOwn(value, 'user_location')) {
    validateChatWebSearchLocation(value['user_location'])
  }

  if (hasOwn(value, 'search_context_size')) {
    validateWebSearchContextSize(
      value['search_context_size'],
      'web_search_options.search_context_size',
    )
  }

  return 'on'
}

function validateChatWebSearchLocation(value: unknown): void {
  if (value === null) {
    return
  }

  if (!isRecord(value)) {
    throw invalidField(
      'web_search_options.user_location',
      '`web_search_options.user_location` must be an object or null when provided.',
    )
  }

  for (const key of Object.keys(value)) {
    if (CHAT_WEB_SEARCH_LOCATION_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    throw unsupportedField(
      `web_search_options.user_location.${key}`,
      `\`web_search_options.user_location.${key}\` is not supported; unknown nested fields are rejected fail-closed.`,
    )
  }

  if (value['type'] !== 'approximate') {
    throw invalidField(
      'web_search_options.user_location.type',
      '`web_search_options.user_location.type` must be `approximate`.',
    )
  }

  if (!hasOwn(value, 'approximate')) {
    throw invalidField(
      'web_search_options.user_location.approximate',
      '`web_search_options.user_location.approximate` is required when `web_search_options.user_location` is provided.',
    )
  }

  validateWebSearchApproximateLocation(
    value['approximate'],
    'web_search_options.user_location.approximate',
    {
      allowNull: false,
    },
  )
}

function validateOptionalChatReasoningEffort(value: unknown): 'on' | 'off' | null {
  if (value === undefined || value === null) {
    return null
  }

  return validateReasoningEffortValue(value, 'reasoning_effort')
}

function validateOptionalResponsesTools(value: unknown): 'on' | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    throw invalidField('tools', '`tools` must be an array when provided.')
  }

  if (value.length === 0) {
    return null
  }

  if (value.length > 1) {
    throw unsupportedField(
      'tools',
      `\`tools\` currently supports at most ${requestControlContract.responses.officialSearch.maxTools} official \`web_search_preview*\` tool in this compatibility subset.`,
    )
  }

  for (const [index, tool] of value.entries()) {
    validateResponsesTool(tool, `tools[${index}]`)
  }

  return 'on'
}

function validateResponsesTool(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw invalidField(path, `\`${path}\` must be a tool object.`)
  }

  for (const key of Object.keys(value)) {
    if (RESPONSES_TOOL_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    throw unsupportedField(
      `${path}.${key}`,
      `\`${path}.${key}\` is not supported in the current /v1/responses tool subset.`,
    )
  }

  const type = value['type']
  if (!requestControlContract.responses.officialSearch.acceptedToolTypes.includes(String(type))) {
    throw unsupportedField(
      `${path}.type`,
      `\`${path}.type\`=${formatUnsupportedValue(type)} is not supported; only official \`web_search_preview*\` tools are accepted in the current /v1/responses subset.`,
    )
  }

  if (hasOwn(value, 'user_location')) {
    validateWebSearchApproximateLocation(
      value['user_location'],
      `${path}.user_location`,
      {
        allowNull: true,
      },
    )
  }

  if (hasOwn(value, 'search_context_size')) {
    validateWebSearchContextSize(
      value['search_context_size'],
      `${path}.search_context_size`,
    )
  }

  if (hasOwn(value, 'search_content_types')) {
    validateResponsesToolSearchContentTypes(
      value['search_content_types'],
      `${path}.search_content_types`,
    )
  }
}

function validateResponsesToolSearchContentTypes(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw invalidField(path, `\`${path}\` must be an array when provided.`)
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string') {
      throw invalidField(`${path}[${index}]`, `\`${path}[${index}]\` must be a string.`)
    }

    if (!requestControlContract.responses.officialSearch.searchContentTypes.includes(item)) {
      throw unsupportedField(
        `${path}[${index}]`,
        `\`${path}[${index}]\`=${item} is not supported; only \`${requestControlContract.responses.officialSearch.searchContentTypes.join('|')}\` search content is accepted in the current subset.`,
      )
    }
  }
}

function validateOptionalResponsesReasoning(value: unknown): 'on' | 'off' | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw invalidField('reasoning', '`reasoning` must be an object when provided.')
  }

  for (const key of Object.keys(value)) {
    if (RESPONSES_REASONING_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    throw unsupportedField(
      `reasoning.${key}`,
      `\`reasoning.${key}\` is not supported; unknown nested fields are rejected fail-closed.`,
    )
  }

  if (hasOwn(value, 'summary') && value['summary'] !== null) {
    throw unsupportedField(
      'reasoning.summary',
      '`reasoning.summary` is not supported in the current DeepSeek-backed compatibility subset; reasoning is currently normalized to a binary DeepThink toggle, so summary controls cannot be truthfully mapped.',
    )
  }

  if (hasOwn(value, 'generate_summary') && value['generate_summary'] !== null) {
    throw unsupportedField(
      'reasoning.generate_summary',
      '`reasoning.generate_summary` is not supported in the current DeepSeek-backed compatibility subset; reasoning is currently normalized to a binary DeepThink toggle, so summary controls cannot be truthfully mapped.',
    )
  }

  if (hasOwn(value, 'effort')) {
    const effort = validateResponsesReasoningEffort(value['effort'])
    return effort ?? 'on'
  }

  return 'on'
}

function validateResponsesReasoningEffort(value: unknown): 'on' | 'off' | null {
  if (value === null) {
    return null
  }

  return validateReasoningEffortValue(value, 'reasoning.effort')
}

function validateReasoningEffortValue(
  value: unknown,
  field: string,
): 'on' | 'off' {
  if (typeof value !== 'string') {
    throw invalidField(field, `\`${field}\` must be a string when provided.`)
  }

  if (value === requestControlContract.chat.officialReasoning.offValue) {
    return 'off'
  }

  if (requestControlContract.chat.officialReasoning.manyToOneValues.includes(value)) {
    return 'on'
  }

  throw unsupportedField(
    field,
    `\`${field}\` only supports the official values \`${requestControlContract.chat.officialReasoning.acceptedValues.join('|')}\` in the current subset.`,
  )
}

function validateWebSearchContextSize(value: unknown, field: string): void {
  if (typeof value !== 'string') {
    throw invalidField(field, `\`${field}\` must be a string when provided.`)
  }

  if (!requestControlContract.chat.officialSearch.contextSizes.includes(value)) {
    throw unsupportedField(
      field,
      `\`${field}\` only supports the official values \`${requestControlContract.chat.officialSearch.contextSizes.join('|')}\` in the current subset.`,
    )
  }
}

function validateWebSearchApproximateLocation(
  value: unknown,
  field: string,
  options: {
    allowNull: boolean
  },
): void {
  if (value === null) {
    if (options.allowNull) {
      return
    }

    throw invalidField(field, `\`${field}\` must be an object.`)
  }

  if (!isRecord(value)) {
    throw invalidField(field, `\`${field}\` must be an object when provided.`)
  }

  const acceptedFields =
    field === 'web_search_options.user_location.approximate'
      ? WEB_SEARCH_APPROXIMATE_ACCEPTED_FIELDS
      : RESPONSES_TOOL_USER_LOCATION_ACCEPTED_FIELDS

  for (const key of Object.keys(value)) {
    if (acceptedFields.has(key)) {
      continue
    }

    throw unsupportedField(
      `${field}.${key}`,
      `\`${field}.${key}\` is not supported; unknown nested fields are rejected fail-closed.`,
    )
  }

  if (hasOwn(value, 'type') && value['type'] !== 'approximate') {
    throw invalidField(`${field}.type`, `\`${field}.type\` must be \`approximate\`.`)
  }

  for (const key of ['country', 'region', 'city', 'timezone'] as const) {
    if (!hasOwn(value, key)) {
      continue
    }

    const entry = value[key]
    if (entry !== null && typeof entry !== 'string') {
      throw invalidField(`${field}.${key}`, `\`${field}.${key}\` must be a string or null.`)
    }
  }
}

function normalizeOpenAIRequestControls(input: {
  deepseekOptions: OpenAIHttpDeepSeekOptions
  officialSearch: 'on' | 'off' | null
  officialDeepThink: 'on' | 'off' | null
}): OpenAIHttpDeepSeekOptions {
  const normalized: OpenAIHttpDeepSeekOptions = {}

  const search = mergeOpenAIControlToggle({
    dimension: 'search',
    official: input.officialSearch,
    extension: input.deepseekOptions.search,
  })
  const deepThink = mergeOpenAIControlToggle({
    dimension: 'deep_think',
    official: input.officialDeepThink,
    extension: input.deepseekOptions.deepThink,
  })

  if (search !== undefined) {
    normalized.search = search
  }
  if (deepThink !== undefined) {
    normalized.deepThink = deepThink
  }

  return normalized
}

function mergeOpenAIControlToggle(input: {
  dimension: 'search' | 'deep_think'
  official: 'on' | 'off' | null
  extension: 'on' | 'off' | undefined
}): 'on' | 'off' | undefined {
  if (input.official === null) {
    return input.extension
  }

  if (input.extension === undefined) {
    return input.official
  }

  if (input.extension !== input.official) {
    throw invalidRequest(
      input.dimension === 'search'
        ? 'invalid_search_control_conflict'
        : 'invalid_deep_think_control_conflict',
      input.dimension === 'search'
        ? 'Official search ingress and `deepseek_options.search` resolved to conflicting toggle states; use one control surface or keep them consistent.'
        : 'Official reasoning ingress and `deepseek_options.deep_think` resolved to conflicting toggle states; use one control surface or keep them consistent.',
    )
  }

  return input.official
}

function validateDeepSeekToggleValue(
  value: unknown,
  field: string,
): 'on' | 'off' {
  if (typeof value !== 'string') {
    throw invalidField(field, `\`${field}\` must be either "on" or "off".`)
  }

  if (value !== 'on' && value !== 'off') {
    throw unsupportedField(
      field,
      `\`${field}\` only supports the string values "on" or "off" in the current subset.`,
    )
  }

  return value
}

function validateOptionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined) {
    return false
  }

  if (typeof value !== 'boolean') {
    throw invalidField(field, `\`${field}\` must be a boolean when provided.`)
  }

  return value
}

function validateOptionalNullableBoolean(
  value: unknown,
  field: string,
): boolean | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'boolean') {
    throw invalidField(field, `\`${field}\` must be a boolean when provided.`)
  }

  return value
}

export function validateOptionalMetadata(
  value: unknown,
  field: string,
): Record<string, string> | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw invalidField(field, `\`${field}\` must be an object with string values when provided.`)
  }

  const entries = Object.entries(value)
  if (entries.length > 16) {
    throw invalidField(field, `\`${field}\` supports at most 16 key/value pairs.`)
  }

  const metadata: Record<string, string> = {}
  for (const [key, entry] of entries) {
    if (!key.trim()) {
      throw invalidField(field, `\`${field}\` keys must be non-empty strings.`)
    }
    if (key.length > 64) {
      throw invalidField(
        `${field}.${key}`,
        `\`${field}.${key}\` exceeds the maximum key length of 64 characters.`,
      )
    }
    if (typeof entry !== 'string') {
      throw invalidField(
        `${field}.${key}`,
        `\`${field}.${key}\` must be a string.`,
      )
    }
    if (entry.length > 512) {
      throw invalidField(
        `${field}.${key}`,
        `\`${field}.${key}\` exceeds the maximum value length of 512 characters.`,
      )
    }
    metadata[key] = entry
  }

  return metadata
}

function validateOptionalChatStreamOptions(
  value: unknown,
): OpenAIChatCompletionsSubsetRequest['streamOptions'] {
  if (value === undefined || value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw invalidField(
      'stream_options',
      '`stream_options` must be an object when provided.',
    )
  }

  for (const key of Object.keys(value)) {
    if (CHAT_STREAM_OPTIONS_ACCEPTED_FIELDS.has(key)) {
      continue
    }

    if (key === 'include_obfuscation') {
      throw unsupportedField(
        'stream_options.include_obfuscation',
        '`stream_options.include_obfuscation` is part of the official Chat Completions schema but is not supported in the current compatibility subset.',
      )
    }

    throw unsupportedField(
      `stream_options.${key}`,
      `\`stream_options.${key}\` is not supported; unknown nested fields are rejected fail-closed.`,
    )
  }

  return {
    includeUsage: validateOptionalBoolean(
      value['include_usage'],
      'stream_options.include_usage',
    ),
  }
}

function validateOptionalString(value: unknown, field: string): string | null {
  if (value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    throw invalidField(field, `\`${field}\` must be a string when provided.`)
  }

  return value
}

function validateOptionalN(value: unknown): 1 {
  if (value === undefined) {
    return 1
  }

  if (value !== 1) {
    throw unsupportedField('n', '`n` is only supported when omitted or set to 1.')
  }

  return 1
}

function validateOptionalIdentifier(value: unknown, field: string): string | null {
  if (value === undefined) {
    return null
  }

  return validateRequiredNonEmptyString(value, field)
}

function validateRequiredNonEmptyString(
  value: unknown,
  field: string,
  options: { trim?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw invalidField(field, `\`${field}\` must be a non-empty string.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw invalidField(field, `\`${field}\` must be a non-empty string.`)
  }

  return options.trim === false ? value : trimmed
}

function analyzeChatCompletionsRequest(
  messages: OpenAIChatCompletionsSubsetRequest['messages'],
): Pick<
  OpenAIChatCompletionsSubsetRequest,
  'requestClassification' | 'historyBootstrap'
> {
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role !== 'user') {
    const hasUserMessage = messages.some(message => message.role === 'user')
    throw invalidHistoryBootstrapField(
      'messages',
      hasUserMessage
        ? 'history_structure'
        : 'missing_latest_user_turn',
      hasUserMessage
        ? '`messages` history bootstrap requires the final message to be the newest actionable `user` turn; trailing assistant/system/developer messages are not continuable in this subset.'
        : '`messages` must include a latest actionable `user` turn; assistant/system/developer-only transcripts cannot be continued.',
    )
  }

  if (!isChatCompletionsUserMessage(lastMessage)) {
    throw new Error('Expected the final chat completions message to be a user message.')
  }

  if (messages.length === 1) {
    return {
      requestClassification: 'new-turn',
      historyBootstrap: null,
    }
  }

  return {
    requestClassification: 'history-bootstrap',
    historyBootstrap: {
      historyMessages: messages.slice(0, -1),
      latestTurnMessages: [lastMessage],
      latestActionableUserTurn: {
        itemIndex: messages.length - 1,
        message: lastMessage,
      },
    },
  }
}

function analyzeResponsesRequest(input: {
  input: OpenAIResponsesSubsetRequest['input']
  previousResponseId: string | null
}): Pick<
  OpenAIResponsesSubsetRequest,
  'requestClassification' | 'historyBootstrap'
> {
  if (input.previousResponseId !== null) {
    assertValidResponsesRequestCombination(input.input)
    return {
      requestClassification: 'session-continuation',
      historyBootstrap: null,
    }
  }

  if (typeof input.input === 'string') {
    return {
      requestClassification: 'new-turn',
      historyBootstrap: null,
    }
  }

  const historyBootstrap = analyzeResponsesHistoryBootstrap(input.input)
  const hasHistoricalMessages = historyBootstrap.historyItems.length > 0
  return {
    requestClassification: hasHistoricalMessages ? 'history-bootstrap' : 'new-turn',
    historyBootstrap: hasHistoricalMessages ? historyBootstrap : null,
  }
}

function assertValidResponsesRequestCombination(
  input: OpenAIResponsesSubsetRequest['input'],
): void {
  if (typeof input === 'string') {
    return
  }

  const historyBootstrap = analyzeResponsesHistoryBootstrap(input)
  if (historyBootstrap.historyItems.length === 0) {
    return
  }

  throw invalidField(
    'previous_response_id',
    '`previous_response_id` requests must send only the newest user turn; replayed history must use history bootstrap without `previous_response_id`.',
  )
}

function analyzeResponsesHistoryBootstrap(
  items: OpenAIResponsesInputItem[],
): NonNullable<OpenAIResponsesSubsetRequest['historyBootstrap']> {
  const lastTextMessageIndex = findLastIndex(items, isResponsesTextInputMessage)
  if (lastTextMessageIndex === -1) {
    throw invalidHistoryBootstrapField(
      'input',
      'missing_latest_user_turn',
      '`input` must include a latest actionable `user` message; file-only requests are not supported in this subset.',
    )
  }

  const lastTextMessage = items[lastTextMessageIndex]
  if (lastTextMessage === undefined) {
    throw new Error('Expected the last text input item index to resolve to an input item.')
  }
  if (!isResponsesTextInputMessage(lastTextMessage)) {
    throw new Error('Expected the last text input item to be a text message.')
  }

  if (lastTextMessage.role !== 'user') {
    const hasUserMessage = items.some(item => isResponsesTextInputMessage(item) && item.role === 'user')
    throw invalidHistoryBootstrapField(
      'input',
      hasUserMessage
        ? 'history_structure'
        : 'missing_latest_user_turn',
      hasUserMessage
        ? '`input` history bootstrap requires the final text message to be the newest actionable `user` turn; trailing assistant/system messages are not continuable in this subset.'
        : '`input` must include a latest actionable `user` message; assistant/system/developer-only transcripts cannot be continued.',
    )
  }

  if (!isResponsesUserInputMessage(lastTextMessage)) {
    throw new Error('Expected the last text input item to be a user message.')
  }

  const historyItems = items.slice(0, lastTextMessageIndex)
  const hasHistoricalMessages = historyItems.some(isResponsesTextInputMessage)
  const hasHistoricalFiles = historyItems.some(isResponsesInputFileItem)
  if (hasHistoricalMessages && hasHistoricalFiles) {
    throw invalidHistoryBootstrapField(
      'input',
      'endpoint_incompatible',
      '`input_file` items cannot appear inside the historical context portion of a history bootstrap request; keep files on the newest actionable turn only.',
    )
  }

  const latestTurnItems = items.slice(lastTextMessageIndex)
  if (latestTurnItems.some(item => isResponsesTextInputMessage(item) && item !== lastTextMessage)) {
    throw invalidHistoryBootstrapField(
      'input',
      'history_structure',
      '`input` history bootstrap requires the newest actionable `user` turn to be the final text message; later text messages cannot be normalized.',
    )
  }

  const latestTurnFiles = latestTurnItems.filter(isResponsesInputFileItem)
  return {
    historyItems: historyItems.filter(isResponsesTextInputMessage),
    latestTurnItems: [lastTextMessage, ...latestTurnFiles],
    latestActionableUserTurn: {
      itemIndex: lastTextMessageIndex,
      message: lastTextMessage,
    },
  }
}

function isResponsesTextInputMessage(
  item: OpenAIResponsesInputItem,
): item is Exclude<OpenAIResponsesInputItem, OpenAIResponsesInputFileItem> {
  return !('type' in item)
}

function isChatCompletionsUserMessage(
  item: OpenAIChatCompletionsSubsetRequest['messages'][number],
): item is Extract<OpenAIChatCompletionsSubsetRequest['messages'][number], { role: 'user' }> {
  return item.role === 'user'
}

function isResponsesUserInputMessage(
  item: Exclude<OpenAIResponsesInputItem, OpenAIResponsesInputFileItem>,
): item is Extract<Exclude<OpenAIResponsesInputItem, OpenAIResponsesInputFileItem>, { role: 'user' }> {
  return item.role === 'user'
}

function isResponsesInputFileItem(
  item: OpenAIResponsesInputItem,
): item is OpenAIResponsesInputFileItem {
  return 'type' in item
}

function looksLikeResponsesMessageItem(value: Record<string, unknown>): boolean {
  return (
    hasOwn(value, 'role') ||
    hasOwn(value, 'content') ||
    value['type'] === 'message'
  )
}

function looksLikeLegacyTopLevelInputFileItem(value: Record<string, unknown>): boolean {
  return (
    value['type'] === 'input_file' ||
    hasOwn(value, 'filename') ||
    hasOwn(value, 'file_data') ||
    hasOwn(value, 'file_id') ||
    hasOwn(value, 'file_url')
  )
}

function invalidRequest(code: string, message: string) {
  return createHttpServiceError({
    statusCode: 400,
    surface: 'openai',
    type: 'invalid_request_error',
    code,
    message,
  })
}

function invalidField(field: string, message: string) {
  return invalidRequest(`invalid_${sanitizeFieldCode(field)}`, message)
}

function unsupportedField(field: string, message: string) {
  return invalidRequest(`unsupported_${sanitizeFieldCode(field)}`, message)
}

function sanitizeFieldCode(field: string): string {
  return field.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function formatUnsupportedValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  return Object.prototype.toString.call(value)
}

function invalidHistoryBootstrapField(
  field: string,
  reason: 'missing_latest_user_turn' | 'history_structure' | 'endpoint_incompatible',
  message: string,
) {
  return invalidRequest(`invalid_${sanitizeFieldCode(field)}_${reason}`, message)
}

function findLastIndex<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== undefined && predicate(value)) {
      return index
    }
  }

  return -1
}
