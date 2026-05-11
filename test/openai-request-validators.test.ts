import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpServiceError } from '../src/interfaces/http/httpErrors.js'
import {
  assertOpenAIRequestUsesCurrentlyImplementedFeatures,
  validateOpenAIChatCompletionsRequest,
  validateOpenAIResponsesRequest,
} from '../src/interfaces/http/openaiRequestValidators.js'

void test('chat completions validator classifies a single user message as new-turn', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    deepseek_options: {},
  })

  assert.equal(request.requestClassification, 'new-turn')
  assert.equal(request.historyBootstrap, null)
  assert.deepEqual(request.deepseekOptions, {})
  assert.equal(request.streamOptions, null)
})

void test('chat completions validator classifies multi-message transcripts as history-bootstrap', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-expert-browser',
    messages: [
      {
        role: 'system',
        content: 'You are terse.',
      },
      {
        role: 'user',
        content: 'Summarize this page.',
      },
    ],
  })

  assert.equal(request.requestClassification, 'history-bootstrap')
  assert.deepEqual(request.historyBootstrap, {
    historyMessages: [
      {
        role: 'system',
        content: 'You are terse.',
      },
    ],
    latestTurnMessages: [
      {
        role: 'user',
        content: 'Summarize this page.',
      },
    ],
    latestActionableUserTurn: {
      itemIndex: 1,
      message: {
        role: 'user',
        content: 'Summarize this page.',
      },
    },
  })
})

void test('chat completions validator accepts official developer messages and text-part content arrays', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-expert-browser',
    messages: [
      {
        role: 'developer',
        content: [
          {
            type: 'text',
            text: 'Answer tersely.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Summarize ',
          },
          {
            type: 'text',
            text: 'this page.',
          },
        ],
      },
    ],
  })

  assert.equal(request.requestClassification, 'history-bootstrap')
  assert.deepEqual(request.messages, [
    {
      role: 'developer',
      content: 'Answer tersely.',
    },
    {
      role: 'user',
      content: 'Summarize this page.',
    },
  ])
  assert.deepEqual(request.historyBootstrap, {
    historyMessages: [
      {
        role: 'developer',
        content: 'Answer tersely.',
      },
    ],
    latestTurnMessages: [
      {
        role: 'user',
        content: 'Summarize this page.',
      },
    ],
    latestActionableUserTurn: {
      itemIndex: 1,
      message: {
        role: 'user',
        content: 'Summarize this page.',
      },
    },
  })
})

void test('chat completions validator accepts official store and metadata fields as a create-side subset', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    store: true,
    metadata: {
      topic: 'demo',
      ticket: '42',
    },
  })

  assert.equal(request.store, true)
  assert.deepEqual(request.metadata, {
    topic: 'demo',
    ticket: '42',
  })
})

void test('chat completions validator accepts official web_search_options and reasoning_effort and normalizes them onto DeepSeek toggles', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    web_search_options: {
      user_location: {
        type: 'approximate',
        approximate: {
          country: 'US',
          timezone: 'America/Los_Angeles',
        },
      },
      search_context_size: 'high',
    },
    reasoning_effort: 'medium',
  })

  assert.deepEqual(request.deepseekOptions, {
    search: 'on',
    deepThink: 'on',
  })
})

void test('chat completions validator rejects conflicting official search ingress and deepseek_options fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        web_search_options: {},
        deepseek_options: {
          search: 'off',
        },
      })
    },
    error => {
      assertHttpError(error, 'invalid_search_control_conflict')
      return true
    },
  )
})

void test('chat completions validator maps reasoning_effort=none onto a DeepSeek deep_think=off signal', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    reasoning_effort: 'none',
  })

  assert.deepEqual(request.deepseekOptions, {
    deepThink: 'off',
  })
})

void test('chat completions validator treats the full supported reasoning_effort ladder as a many-to-one DeepThink toggle', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    reasoning_effort: 'xhigh',
  })

  assert.deepEqual(request.deepseekOptions, {
    deepThink: 'on',
  })
})

void test('chat completions validator accepts stream_options.include_usage as an official streaming subset', () => {
  const request = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    stream: true,
    stream_options: {
      include_usage: true,
    },
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  })

  assert.deepEqual(request.streamOptions, {
    includeUsage: true,
  })
})

void test('chat completions validator rejects malformed metadata fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
        metadata: {
          topic: 123,
        },
      })
    },
    error => {
      assertHttpError(error, 'invalid_metadata_topic')
      return true
    },
  )
})

void test('chat completions validator rejects malformed stream_options.include_usage fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        stream: true,
        stream_options: {
          include_usage: 'yes',
        },
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_stream_options_include_usage')
      return true
    },
  )
})

void test('chat completions validator rejects unsupported official stream_options members fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        stream: true,
        stream_options: {
          include_obfuscation: false,
        },
        messages: [
          {
            role: 'user',
            content: 'hello',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_stream_options_include_obfuscation')
      return true
    },
  )
})

void test('responses validator parses request controls and session-continuation fields', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        role: 'user',
        content: 'continue from here',
      },
    ],
    previous_response_id: 'resp_123',
    store: true,
    deepseek_options: {
      search: 'on',
      deep_think: 'off',
    },
  })

  assert.equal(request.requestClassification, 'session-continuation')
  assert.equal(request.historyBootstrap, null)
  assert.equal(request.previousResponseId, 'resp_123')
  assert.equal(request.store, true)
  assert.deepEqual(request.deepseekOptions, {
    search: 'on',
    deepThink: 'off',
  })
})

void test('responses validator accepts official metadata as a create-side subset', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    metadata: {
      topic: 'demo',
      ticket: '42',
    },
  })

  assert.deepEqual(request.metadata, {
    topic: 'demo',
    ticket: '42',
  })
})

void test('responses validator accepts official web_search_preview tools and reasoning objects and normalizes them onto DeepSeek toggles', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    tools: [
      {
        type: 'web_search_preview',
        user_location: {
          type: 'approximate',
          country: 'US',
          city: 'San Francisco',
        },
        search_context_size: 'medium',
        search_content_types: ['text'],
      },
    ],
    reasoning: {
      effort: 'high',
    },
  })

  assert.deepEqual(request.deepseekOptions, {
    search: 'on',
    deepThink: 'on',
  })
})

void test('responses validator accepts the versioned official web_search_preview tool variant and still normalizes it onto the shared search toggle', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    tools: [
      {
        type: 'web_search_preview_2025_03_11',
        search_context_size: 'low',
      },
    ],
  })

  assert.deepEqual(request.deepseekOptions, {
    search: 'on',
  })
})

void test('responses validator treats reasoning object presence as deep_think=on unless effort=none', () => {
  const enabledRequest = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    reasoning: {},
  })
  assert.deepEqual(enabledRequest.deepseekOptions, {
    deepThink: 'on',
  })

  const disabledRequest = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    reasoning: {
      effort: 'none',
    },
  })
  assert.deepEqual(disabledRequest.deepseekOptions, {
    deepThink: 'off',
  })
})

void test('responses validator rejects reasoning summary controls that cannot be truthfully mapped', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        reasoning: {
          summary: 'detailed',
        },
      })
    },
    error => {
      assertHttpError(error, 'unsupported_reasoning_summary')
      return true
    },
  )
})

void test('responses validator rejects reasoning.generate_summary controls that cannot be truthfully mapped', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        reasoning: {
          generate_summary: 'concise',
        },
      })
    },
    error => {
      assertHttpError(error, 'unsupported_reasoning_generate_summary')
      return true
    },
  )
})

void test('responses validator rejects malformed metadata fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        metadata: {
          topic: 123,
        },
      })
    },
    error => {
      assertHttpError(error, 'invalid_metadata_topic')
      return true
    },
  )
})

void test('responses validator rejects conflicting official reasoning ingress and deepseek_options fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        reasoning: {},
        deepseek_options: {
          deep_think: 'off',
        },
      })
    },
    error => {
      assertHttpError(error, 'invalid_deep_think_control_conflict')
      return true
    },
  )
})

void test('responses validator rejects unsupported search content types outside the current text-only search subset', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        tools: [
          {
            type: 'web_search_preview',
            search_content_types: ['image'],
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_tools_0_search_content_types_0')
      return true
    },
  )
})

void test('responses validator classifies multi-turn transcripts as history-bootstrap', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        role: 'assistant',
        content: 'previous answer',
      },
      {
        role: 'user',
        content: 'refine it',
      },
    ],
  })

  assert.equal(request.requestClassification, 'history-bootstrap')
  assert.deepEqual(request.historyBootstrap, {
    historyItems: [
      {
        role: 'assistant',
        content: 'previous answer',
      },
    ],
    latestTurnItems: [
      {
        role: 'user',
        content: 'refine it',
      },
    ],
    latestActionableUserTurn: {
      itemIndex: 1,
      message: {
        role: 'user',
        content: 'refine it',
      },
    },
  })
})

void test('responses validator accepts official nested input_text and input_file content parts and freezes the current flattening semantics', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'summarize ',
          },
          {
            type: 'input_file',
            filename: 'brief.txt',
            file_data: 'Zm9v',
          },
          {
            type: 'input_text',
            text: 'this file',
          },
        ],
      },
    ],
  })

  assert.equal(request.requestClassification, 'new-turn')
  assert.equal(request.historyBootstrap, null)
  assert.equal(typeof request.input === 'string', false)
  if (typeof request.input === 'string') {
    assert.fail('expected normalized array input')
  }
  assert.deepEqual(request.input, [
    {
      role: 'user',
      content: 'summarize this file',
    },
    {
      type: 'input_file',
      filename: 'brief.txt',
      fileData: 'Zm9v',
    },
  ])
})

void test('responses validator preserves nested input_file relative order when multiple files appear inside one official message', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'compare ',
          },
          {
            type: 'input_file',
            filename: 'alpha.txt',
            file_data: 'YWxwaGE=',
          },
          {
            type: 'input_text',
            text: 'and ',
          },
          {
            type: 'input_file',
            filename: 'beta.txt',
            file_data: 'YmV0YQ==',
          },
          {
            type: 'input_text',
            text: 'now',
          },
        ],
      },
    ],
  })

  assert.equal(request.requestClassification, 'new-turn')
  assert.equal(request.historyBootstrap, null)
  assert.equal(typeof request.input === 'string', false)
  if (typeof request.input === 'string') {
    assert.fail('expected normalized array input')
  }
  assert.deepEqual(request.input, [
    {
      role: 'user',
      content: 'compare and now',
    },
    {
      type: 'input_file',
      filename: 'alpha.txt',
      fileData: 'YWxwaGE=',
    },
    {
      type: 'input_file',
      filename: 'beta.txt',
      fileData: 'YmV0YQ==',
    },
  ])
})

void test('responses validator rejects official file-only message content because the current nested file subset requires a text carrier', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_file',
                filename: 'brief.txt',
                file_data: 'Zm9v',
              },
            ],
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_input_endpoint_incompatible')
      return true
    },
  )
})

void test('responses validator accepts developer role official message items and preserves history-bootstrap classification', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: 'Answer tersely.',
          },
        ],
      },
      {
        type: 'message',
        role: 'user',
        content: 'hello',
      },
    ],
  })

  assert.equal(request.requestClassification, 'history-bootstrap')
  assert.deepEqual(request.historyBootstrap, {
    historyItems: [
      {
        role: 'developer',
        content: 'Answer tersely.',
      },
    ],
    latestTurnItems: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    latestActionableUserTurn: {
      itemIndex: 1,
      message: {
        role: 'user',
        content: 'hello',
      },
    },
  })
})

void test('responses validator keeps the legacy top-level input_file subset during C60 transition', () => {
  const request = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        role: 'user',
        content: 'summarize this file',
      },
      {
        type: 'input_file',
        filename: 'brief.txt',
        file_data: 'Zm9v',
      },
    ],
  })

  assert.equal(request.requestClassification, 'new-turn')
  assert.equal(request.historyBootstrap, null)
  assert.equal(typeof request.input === 'string', false)
  if (typeof request.input === 'string') {
    assert.fail('expected normalized array input')
  }
  assert.deepEqual(request.input[1], {
    type: 'input_file',
    filename: 'brief.txt',
    fileData: 'Zm9v',
  })
})

void test('responses validator rejects unsupported official nested content parts fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_image',
                image_url: 'https://example.com/image.png',
              },
            ],
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_input_0_content')
      return true
    },
  )
})

void test('validator rejects deepseek_options.deepThink and unknown request-control aliases', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        deepseek_options: {
          deepThink: 'on',
        },
      })
    },
    error => {
      assertHttpError(error, 'unsupported_deepseek_options_deepthink')
      return true
    },
  )
})

void test('chat completions validator rejects unsupported official tool messages fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'tool',
            tool_call_id: 'tool_123',
            content: 'tool output',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_messages_0_role')
      return true
    },
  )
})

void test('chat completions validator rejects unsupported official function messages fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'function',
            name: 'lookup',
            content: 'function output',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_messages_0_role')
      return true
    },
  )
})

void test('chat completions validator rejects assistant tool-call fields instead of silently ignoring them', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'assistant',
            content: 'prior reply',
            function_call: {
              name: 'lookup',
              arguments: '{}',
            },
          },
          {
            role: 'user',
            content: 'continue',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_messages_0_function_call')
      return true
    },
  )
})

void test('chat completions validator rejects user multimodal content blocks outside the current text subset', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: 'https://example.com/image.png',
                },
              },
            ],
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_messages_0_content')
      return true
    },
  )
})

void test('chat completions validator rejects transcripts without an actionable latest user turn', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'assistant',
            content: 'hello',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_messages_missing_latest_user_turn')
      if (error instanceof HttpServiceError) {
        assert.match(error.message, /assistant\/system\/developer-only/u)
      }
      return true
    },
  )
})

void test('chat completions validator rejects transcripts whose latest user turn is not at the tail', () => {
  assert.throws(
    () => {
      validateOpenAIChatCompletionsRequest({
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'user',
            content: 'question',
          },
          {
            role: 'assistant',
            content: 'answer',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_messages_history_structure')
      return true
    },
  )
})

void test('responses validator rejects file-only arrays because there is no latest actionable user turn', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            type: 'input_file',
            filename: 'brief.txt',
            file_data: 'Zm9v',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_input_missing_latest_user_turn')
      return true
    },
  )
})

void test('responses validator rejects transcripts whose final text message is not user', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            role: 'user',
            content: 'question',
          },
          {
            role: 'assistant',
            content: 'answer',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_input_history_structure')
      return true
    },
  )
})

void test('responses validator rejects history bootstrap requests that place files inside historical context', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            role: 'assistant',
            content: 'earlier context',
          },
          {
            type: 'input_file',
            filename: 'brief.txt',
            file_data: 'Zm9v',
          },
          {
            role: 'user',
            content: 'latest turn',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'invalid_input_endpoint_incompatible')
      return true
    },
  )
})

void test('validator rejects previous_response_id combined with replayed history', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            role: 'assistant',
            content: 'prior reply',
          },
          {
            role: 'user',
            content: 'continue',
          },
        ],
        previous_response_id: 'resp_123',
      })
    },
    error => {
      assertHttpError(error, 'invalid_previous_response_id')
      return true
    },
  )
})

void test('validator rejects file_id and file_url inside input_file items fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: [
          {
            type: 'input_file',
            filename: 'brief.txt',
            file_data: 'Zm9v',
            file_id: 'file-123',
          },
        ],
      })
    },
    error => {
      assertHttpError(error, 'unsupported_input_0_file_id')
      return true
    },
  )
})

void test('validator keeps conversation fail-closed and does not treat it as a previous_response_id alias', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        conversation: 'conv_123',
      })
    },
    error => {
      assertHttpError(error, 'unsupported_conversation')
      return true
    },
  )
})

void test('responses validator keeps background-only semantics fail-closed', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        background: true,
      })
    },
    error => {
      assertHttpError(error, 'unsupported_background')
      return true
    },
  )
})

void test('responses validator rejects official stream_options until a responses subset is explicitly frozen', () => {
  assert.throws(
    () => {
      validateOpenAIResponsesRequest({
        model: 'deepseek-chat-browser',
        input: 'hello',
        stream: true,
        stream_options: {
          include_obfuscation: false,
        },
      })
    },
    error => {
      assertHttpError(error, 'unsupported_stream_options')
      return true
    },
  )
})

void test('current execution subset guard allows request controls, response handles, store, and first-stage file input', () => {
  const chatStoreRequest = validateOpenAIChatCompletionsRequest({
    model: 'deepseek-chat-browser',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    store: true,
    metadata: {
      topic: 'demo',
    },
  })

  assert.doesNotThrow(() => {
    assertOpenAIRequestUsesCurrentlyImplementedFeatures(chatStoreRequest)
  })

  const requestControlsRequest = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    deepseek_options: {
      search: 'on',
    },
  })

  assert.doesNotThrow(() => {
    assertOpenAIRequestUsesCurrentlyImplementedFeatures(requestControlsRequest)
  })

  const continuationRequest = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    previous_response_id: 'resp_123',
  })

  assert.doesNotThrow(() => {
    assertOpenAIRequestUsesCurrentlyImplementedFeatures(continuationRequest)
  })

  const storeRequest = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: 'hello',
    store: true,
  })

  assert.doesNotThrow(() => {
    assertOpenAIRequestUsesCurrentlyImplementedFeatures(storeRequest)
  })

  const fileInputRequest = validateOpenAIResponsesRequest({
    model: 'deepseek-chat-browser',
    input: [
      {
        role: 'user',
        content: 'hello',
      },
      {
        type: 'input_file',
        filename: 'brief.txt',
        file_data: 'Zm9v',
      },
    ],
  })

  assert.doesNotThrow(() => {
    assertOpenAIRequestUsesCurrentlyImplementedFeatures(fileInputRequest)
  })
})

function assertHttpError(error: unknown, expectedCode: string): void {
  assert.equal(error instanceof HttpServiceError, true)
  if (!(error instanceof HttpServiceError)) {
    return
  }
  assert.equal(error.type, 'invalid_request_error')
  assert.equal(error.code, expectedCode)
}
