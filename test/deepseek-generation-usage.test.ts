import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  createDeepSeekGenerationObservation,
  extractDeepSeekOutputTokensFromJson,
  extractDeepSeekOutputTokensFromPayloadText,
  extractDeepSeekOutputTokensFromSse,
  sumDeepSeekObservedOutputTokens,
} from '../src/infrastructure/deepseek/deepSeekGenerationUsage.js'

void test('extracts output tokens from DeepSeek SSE payloads', () => {
  const observed = extractDeepSeekOutputTokensFromSse(
    [
      'event: ready',
      'data: {"request_message_id":1,"response_message_id":2,"model_type":"default"}',
      '',
      'data: {"v":{"response":{"accumulated_token_usage":0}}}',
      '',
      'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":36},{"p":"quasi_status","v":"FINISHED"}]}',
      '',
    ].join('\n'),
  )

  assert.equal(observed, 36)
})

void test('extracts output tokens from DeepSeek JSON payloads', () => {
  assert.equal(
    extractDeepSeekOutputTokensFromJson({
      usage: {
        output_tokens: 17,
      },
    }),
    17,
  )

  assert.equal(
    extractDeepSeekOutputTokensFromPayloadText(
      JSON.stringify({
        usage: {
          completion_tokens: 24,
        },
      }),
      'application/json',
    ),
    24,
  )
})

void test('generation observation preserves vision request model and ref_file_ids', () => {
  const observation = createDeepSeekGenerationObservation({
    endpoint: '/api/v0/chat/completion',
    url: 'https://chat.deepseek.com/api/v0/chat/completion',
    status: 200,
    contentType: 'text/event-stream',
    payloadText: [
      'event: ready',
      'data: {"request_message_id":1,"response_message_id":2,"model_type":"vision"}',
      '',
    ].join('\n'),
    requestPostData: JSON.stringify({
      model_type: 'vision',
      ref_file_ids: ['file-image-1', 'file-image-2'],
    }),
  })

  assert.equal(observation.requestModelType, 'vision')
  assert.deepEqual(observation.requestRefFileIds, ['file-image-1', 'file-image-2'])
})

void test('extracts output tokens from real audited DeepSeek SSE fixtures', async () => {
  const completionFixture = JSON.parse(
    await readFile(
      join(process.cwd(), 'test/fixtures/deepseek-generation-stream/completion.real.fixture.json'),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
      contentType: string | null
    }
  }
  const continueFixture = JSON.parse(
    await readFile(
      join(process.cwd(), 'test/fixtures/deepseek-generation-stream/continue.real.fixture.json'),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
      contentType: string | null
    }
  }

  assert.equal(
    extractDeepSeekOutputTokensFromPayloadText(
      completionFixture.response.bodyText,
      completionFixture.response.contentType,
    ),
    60,
  )
  assert.equal(
    extractDeepSeekOutputTokensFromPayloadText(
      continueFixture.response.bodyText,
      continueFixture.response.contentType,
    ),
    651,
  )
})

void test('sums only observed output token values', () => {
  assert.equal(
    sumDeepSeekObservedOutputTokens([
      {
        endpoint: '/api/v0/chat/completion',
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        status: 200,
        contentType: 'text/event-stream',
        outputTokens: 36,
      },
      {
        endpoint: '/api/v0/chat/continue',
        url: 'https://chat.deepseek.com/api/v0/chat/continue',
        status: 200,
        contentType: 'text/event-stream',
        outputTokens: null,
      },
    ]),
    36,
  )
})
