import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  adaptDeepSeekCompletedToOpenAIResponse,
  adaptDeepSeekGenerationEventsToOpenAIResponsesStream,
  createOpenAIResponsesStreamAdapter,
} from '../src/infrastructure/deepseek/openaiResponsesAdapter.js'
import { parseDeepSeekGenerationCapturedExchange } from '../src/infrastructure/deepseek/deepSeekGenerationStreamParser.js'
import type { DeepSeekGenerationCapturedExchange } from '../src/types/deepseek-generation-parser.types.js'
import type { DeepSeekGenerationRunContext } from '../src/types/deepseek-stream.types.js'

const FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')

void test('adapts a completed canonical DeepSeek run into an OpenAI responses JSON object', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = parsed.events.findLast(event => event.kind === 'completed')
  assert.ok(completed && completed.kind === 'completed')

  const response = adaptDeepSeekCompletedToOpenAIResponse({
    context: parsed.context,
    result: completed.result,
  })

  assert.equal(response.object, 'response')
  assert.equal(response.status, 'completed')
  assert.equal(response.output_text, completed.result.outputText)
  assert.equal(response.usage?.output_tokens, 60)
  assert.ok(response.output.some(item => item.type === 'message'))
  assert.ok(response.output.some(item => item.type === 'reasoning'))
  assert.deepEqual(response.metadata, {})
  assert.equal(response.background, null)
  assert.equal(response.reasoning, null)
  assert.equal(response.conversation, null)
  assert.deepEqual(response.tools, [])
  assert.equal(response.tool_choice, 'auto')
  assert.equal(response.text.format.type, 'text')
})

void test('maps a stopped DeepSeek run to an OpenAI incomplete response instead of completed', async () => {
  const fixture = await loadFixture('completion.stopped.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = parsed.events.findLast(event => event.kind === 'completed')
  assert.ok(completed && completed.kind === 'completed')

  const response = adaptDeepSeekCompletedToOpenAIResponse({
    context: parsed.context,
    result: completed.result,
  })

  assert.equal(response.status, 'incomplete')
  assert.equal(response.error, null)
  assert.equal(response.output_text, null)
})

void test('maps a DeepSeek transport error into an OpenAI failed response', async () => {
  const fixture = await loadFixture('completion.error.synthetic.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = parsed.events.findLast(event => event.kind === 'completed')
  assert.ok(completed && completed.kind === 'completed')

  const response = adaptDeepSeekCompletedToOpenAIResponse({
    context: parsed.context,
    result: completed.result,
  })

  assert.equal(response.status, 'failed')
  assert.equal(response.error?.code, 'rate_limit_exceeded')
  assert.equal(response.output.length, 0)
})

void test('adapts canonical generation events into an OpenAI responses stream event sequence', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const stream = adaptDeepSeekGenerationEventsToOpenAIResponsesStream({
    context: parsed.context,
    events: parsed.events,
  })

  assert.equal(stream[0]?.type, 'response.created')
  assert.equal(stream[1]?.type, 'response.in_progress')
  assert.equal(stream[0]?.response.metadata ? Object.keys(stream[0].response.metadata).length : -1, 0)
  assert.equal(stream[0]?.response.background, null)
  assert.equal(stream[1]?.response.status, 'in_progress')
  assert.ok(stream.some(event => event.type === 'response.output_item.added'))
  assert.ok(stream.some(event => event.type === 'response.content_part.added'))
  assert.ok(stream.some(event => event.type === 'response.output_text.delta'))
  assert.ok(stream.some(event => event.type === 'response.output_text.done'))
  assert.equal(stream.at(-1)?.type, 'response.completed')
})

void test('stream adapter keeps manual stop as response.incomplete and never emits response.completed', async () => {
  const fixture = await loadFixture('completion.stopped.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const stream = adaptDeepSeekGenerationEventsToOpenAIResponsesStream({
    context: parsed.context,
    events: parsed.events,
  })

  assert.ok(stream.some(event => event.type === 'response.incomplete'))
  assert.ok(!stream.some(event => event.type === 'response.completed'))
})

void test('stream adapter can terminate an already-started response stream with error plus response.failed', () => {
  const context = createTestContext()
  const adapter = createOpenAIResponsesStreamAdapter({
    context,
  })

  adapter.push({
    kind: 'text.delta',
    sequence: 1,
    occurredAt: '2026-04-04T00:00:02.000Z',
    context,
    delta: 'Partial output',
    accumulatedText: 'Partial output',
  })

  const events = adapter.fail({
    code: 'upstream_rate_limit',
    message: 'DeepSeek upstream rate limit cooldown in progress',
  })

  const errorEvent = events.find(
    (event): event is Extract<(typeof events)[number], { type: 'error' }> => event.type === 'error',
  )
  const failedEvent = events.find(
    (event): event is Extract<(typeof events)[number], { type: 'response.failed' }> =>
      event.type === 'response.failed',
  )

  assert.equal(errorEvent?.type, 'error')
  assert.equal(errorEvent?.code, 'upstream_rate_limit')
  assert.ok(events.some(event => event.type === 'response.output_text.done'))
  assert.equal(events.at(-1)?.type, 'response.failed')
  assert.equal(failedEvent?.response.status, 'failed')
  assert.equal(failedEvent?.response.error?.code, 'upstream_rate_limit')
  assert.equal(failedEvent?.response.output_text, 'Partial output')
})

void test('stream adapter emits search and citation compatible events for canonical search/citation patches', () => {
  const context = createTestContext()
  const adapter = createOpenAIResponsesStreamAdapter({
    context,
  })

  const events = adapter.pushMany([
    {
      kind: 'search.patch',
      sequence: 1,
      occurredAt: '2026-04-04T00:00:01.000Z',
      context,
      patchMode: 'append',
      search: {
        query: 'deepseek browser automation',
        status: 'searching',
        results: [],
      },
    },
    {
      kind: 'text.delta',
      sequence: 2,
      occurredAt: '2026-04-04T00:00:02.000Z',
      context,
      delta: 'See [1] for reference.',
      accumulatedText: 'See [1] for reference.',
    },
    {
      kind: 'citation.patch',
      sequence: 3,
      occurredAt: '2026-04-04T00:00:03.000Z',
      context,
      patchMode: 'append',
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
    },
    {
      kind: 'completed',
      sequence: 4,
      occurredAt: '2026-04-04T00:00:04.000Z',
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
        searches: [
          {
            query: 'deepseek browser automation',
            status: 'completed',
            results: [
              {
                id: 'search-1',
                title: 'DeepSeek Docs',
                url: 'https://example.com/docs',
              },
            ],
          },
        ],
        usage: {
          inputTokens: null,
          outputTokens: 9,
          totalTokens: 9,
          reasoningTokens: null,
        },
        error: null,
        completedAt: '2026-04-04T00:00:04.000Z',
      },
    },
  ])

  assert.ok(events.some(event => event.type === 'response.web_search_call.in_progress'))
  assert.ok(events.some(event => event.type === 'response.web_search_call.searching'))
  assert.ok(events.some(event => event.type === 'response.web_search_call.completed'))
  assert.ok(events.some(event => event.type === 'response.output_text.annotation.added'))
  assert.equal(events.at(-1)?.type, 'response.completed')
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
