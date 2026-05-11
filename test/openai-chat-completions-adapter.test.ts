import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  adaptDeepSeekCompletedToOpenAIChatCompletion,
  adaptDeepSeekGenerationEventsToOpenAIChatCompletionsStream,
  createOpenAIChatCompletionsStreamAdapter,
} from '../src/infrastructure/deepseek/openaiChatCompletionsAdapter.js'
import { parseDeepSeekGenerationCapturedExchange } from '../src/infrastructure/deepseek/deepSeekGenerationStreamParser.js'
import type { DeepSeekGenerationCapturedExchange } from '../src/types/deepseek-generation-parser.types.js'
import type { DeepSeekGenerationRunContext } from '../src/types/deepseek-stream.types.js'

const FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')

void test('adapts a completed canonical run into an OpenAI chat completion response', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = parsed.events.findLast(event => event.kind === 'completed')
  assert.ok(completed && completed.kind === 'completed')

  const response = adaptDeepSeekCompletedToOpenAIChatCompletion({
    context: parsed.context,
    result: completed.result,
  })

  assert.equal(response.object, 'chat.completion')
  assert.equal(response.choices.length, 1)
  assert.equal(response.choices[0]?.message.role, 'assistant')
  assert.equal(
    response.choices[0]?.message.content,
    'The fixture is fully captured. All completion criteria are met. The process ends here.',
  )
  assert.equal(response.choices[0]?.finish_reason, 'stop')
  assert.equal(response.usage?.completion_tokens, 60)
})

void test('maps canonical citations into chat completion annotations on buffered json output', () => {
  const context = createTestContext()
  const response = adaptDeepSeekCompletedToOpenAIChatCompletion({
    context,
    result: {
      status: 'completed',
      finishReason: 'stop',
      outputText: 'See [1] for reference.',
      reasoningText: '',
      reasoningKind: 'unknown',
      citations: [
        {
          id: 'cite-1',
          title: 'DeepSeek Docs',
          url: 'https://example.com/docs',
          annotation: {
            source: 'search',
            startIndex: 4,
            endIndex: 7,
          },
        },
      ],
      responseReferences: [],
      searches: [],
      usage: null,
      error: null,
      completedAt: '2026-04-04T00:00:04.000Z',
    },
  })

  assert.equal(response.choices[0]?.message.annotations.length, 1)
  assert.equal(response.choices[0]?.message.annotations[0]?.type, 'url_citation')
  assert.equal(
    response.choices[0]?.message.annotations[0]?.url_citation.url,
    'https://example.com/docs',
  )
})

void test('adapts canonical events into standard chat completion chunks', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const chunks = adaptDeepSeekGenerationEventsToOpenAIChatCompletionsStream({
    context: parsed.context,
    events: parsed.events,
  })
  const streamedText = chunks
    .map(chunk => chunk.choices[0]?.delta.content ?? '')
    .join('')

  assert.equal(chunks[0]?.object, 'chat.completion.chunk')
  assert.equal(chunks[0]?.choices[0]?.delta.role, 'assistant')
  assert.equal(chunks[1]?.choices[0]?.delta.content, 'The')
  assert.equal(
    streamedText,
    'The fixture is fully captured. All completion criteria are met. The process ends here.',
  )
  assert.equal(chunks.at(-1)?.choices[0]?.finish_reason, 'stop')
  assert.equal(chunks.at(-1)?.usage, undefined)
})

void test('adapts canonical events into official usage chunks when includeUsage is requested', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const chunks = adaptDeepSeekGenerationEventsToOpenAIChatCompletionsStream({
    context: parsed.context,
    events: parsed.events,
    options: {
      includeUsage: true,
    },
  })

  const terminalFinishChunk = chunks.at(-2)
  const usageChunk = chunks.at(-1)

  assert.equal(chunks[0]?.usage, null)
  assert.equal(chunks[1]?.usage, null)
  assert.equal(terminalFinishChunk?.choices[0]?.finish_reason, 'stop')
  assert.equal(terminalFinishChunk?.usage, null)
  assert.deepEqual(usageChunk?.choices, [])
  assert.equal(usageChunk?.usage?.completion_tokens, 60)
})

void test('stream adapter keeps chat completions chunks on the standard role/content/finish path', () => {
  const context = createTestContext()
  const adapter = createOpenAIChatCompletionsStreamAdapter({
    context,
  })

  const chunks = adapter.pushMany([
    {
      kind: 'reasoning.delta',
      sequence: 1,
      occurredAt: '2026-04-04T00:00:01.000Z',
      context,
      reasoningKind: 'thinking',
      delta: 'internal',
      accumulatedText: 'internal',
    },
    {
      kind: 'text.delta',
      sequence: 2,
      occurredAt: '2026-04-04T00:00:02.000Z',
      context,
      delta: 'Hello',
      accumulatedText: 'Hello',
    },
    {
      kind: 'completed',
      sequence: 3,
      occurredAt: '2026-04-04T00:00:03.000Z',
      context,
      result: {
        status: 'completed',
        finishReason: 'stop',
        outputText: 'Hello',
        reasoningText: 'internal',
        reasoningKind: 'thinking',
        citations: [],
        responseReferences: [],
        searches: [],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          reasoningTokens: 1,
        },
        error: null,
        completedAt: '2026-04-04T00:00:03.000Z',
      },
    },
  ])

  assert.equal(chunks.length, 3)
  assert.equal(chunks[0]?.choices[0]?.delta.role, 'assistant')
  assert.equal(chunks[1]?.choices[0]?.delta.content, 'Hello')
  assert.equal(chunks[2]?.choices[0]?.finish_reason, 'stop')
  assert.equal(chunks[2]?.usage, undefined)
})

void test('stream adapter emits usage-null chunks plus a final usage summary when requested', () => {
  const context = createTestContext()
  const adapter = createOpenAIChatCompletionsStreamAdapter({
    context,
    includeUsage: true,
  })

  const chunks = adapter.pushMany([
    {
      kind: 'text.delta',
      sequence: 1,
      occurredAt: '2026-04-04T00:00:02.000Z',
      context,
      delta: 'Hello',
      accumulatedText: 'Hello',
    },
    {
      kind: 'completed',
      sequence: 2,
      occurredAt: '2026-04-04T00:00:03.000Z',
      context,
      result: {
        status: 'completed',
        finishReason: 'stop',
        outputText: 'Hello',
        reasoningText: 'internal',
        reasoningKind: 'thinking',
        citations: [],
        responseReferences: [],
        searches: [],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          reasoningTokens: 1,
        },
        error: null,
        completedAt: '2026-04-04T00:00:03.000Z',
      },
    },
  ])

  assert.equal(chunks.length, 4)
  assert.equal(chunks[0]?.usage, null)
  assert.equal(chunks[1]?.usage, null)
  assert.equal(chunks[2]?.choices[0]?.finish_reason, 'stop')
  assert.equal(chunks[2]?.usage, null)
  assert.deepEqual(chunks[3]?.choices, [])
  assert.equal(chunks[3]?.usage?.total_tokens, 2)
})

async function loadFixture(fileName: string): Promise<DeepSeekGenerationCapturedExchange> {
  const raw = JSON.parse(await readFile(join(FIXTURE_DIR, fileName), 'utf8')) as {
    endpoint: DeepSeekGenerationCapturedExchange['endpoint']
    request: {
      method: string
      url: string
      bodyText: string | null
    }
    response: {
      status: number
      contentType: string | null
      bodyText: string
    }
  }

  return {
    endpoint: raw.endpoint,
    request: {
      method: raw.request.method,
      url: raw.request.url,
      postData: raw.request.bodyText,
    },
    response: {
      status: raw.response.status,
      contentType: raw.response.contentType,
      bodyText: raw.response.bodyText,
    },
  }
}

function createTestContext(): DeepSeekGenerationRunContext {
  return {
    runId: 'run-001',
    endpoint: '/api/v0/chat/completion',
    transport: 'sse',
    requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-001',
    agentId: 'chat',
    sessionId: 'session-001',
    branchId: 'branch-main',
    parentMessageId: 'message-user-1',
    assistantMessageId: 'message-assistant-1',
  }
}
