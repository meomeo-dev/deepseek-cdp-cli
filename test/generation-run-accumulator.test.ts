import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createGenerationRunAccumulator } from '../src/infrastructure/deepseek/generationRunAccumulator.js'
import { parseDeepSeekGenerationCapturedExchange } from '../src/infrastructure/deepseek/deepSeekGenerationStreamParser.js'
import type { DeepSeekGenerationCapturedExchange } from '../src/types/deepseek-generation-parser.types.js'
import type { DeepSeekGenerationRunContext } from '../src/types/deepseek-stream.types.js'

const FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')

void test('accumulator seals a successful parser run without relying on a completed event', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const accumulator = createGenerationRunAccumulator({
    context: parsed.context,
  })

  accumulator.pushMany(parsed.events.filter(event => event.kind !== 'completed'))
  const snapshot = accumulator.snapshot()
  const completed = accumulator.seal()

  assert.equal(snapshot.status, 'running')
  assert.equal(snapshot.finishReason, 'stop')
  assert.equal(completed.status, 'completed')
  assert.equal(completed.finishReason, 'stop')
  assert.equal(
    completed.outputText,
    'The fixture is fully captured. All completion criteria are met. The process ends here.',
  )
  assert.equal(completed.usage?.outputTokens, 60)
  assert.equal(accumulator.snapshot().sealed, true)
})

void test('accumulator preserves stopped status when sealing an aborted run', async () => {
  const fixture = await loadFixture('completion.stopped.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const accumulator = createGenerationRunAccumulator({
    context: parsed.context,
  })

  accumulator.pushMany(parsed.events.filter(event => event.kind !== 'completed'))
  const completed = accumulator.seal()

  assert.equal(completed.status, 'stopped')
  assert.equal(completed.finishReason, 'stopped')
  assert.equal(completed.outputText, '')
  assert.equal(completed.reasoningText, '')
  assert.equal(accumulator.snapshot().stopReason, 'user')
})

void test('accumulator preserves failed status when sealing an error run', async () => {
  const fixture = await loadFixture('completion.error.synthetic.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const accumulator = createGenerationRunAccumulator({
    context: parsed.context,
  })

  accumulator.pushMany(parsed.events.filter(event => event.kind !== 'completed'))
  const completed = accumulator.seal()

  assert.equal(completed.status, 'failed')
  assert.equal(completed.finishReason, 'error')
  assert.equal(completed.outputText, '')
  assert.equal(completed.error?.code, 'rate_limit_exceeded')
  assert.equal(accumulator.snapshot().error?.code, 'rate_limit_exceeded')
})

void test('completed events remain authoritative when they are present', async () => {
  const fixture = await loadFixture('regenerate.real.fixture.json')
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const accumulator = createGenerationRunAccumulator({
    context: parsed.context,
  })

  accumulator.pushMany(parsed.events)
  const snapshot = accumulator.snapshot()
  const completed = accumulator.seal()

  assert.equal(snapshot.status, 'completed')
  assert.equal(snapshot.completedAt, completed.completedAt)
  assert.equal(
    completed.outputText,
    'The fixture is now fully captured. All completion data has been recorded. The process is complete.',
  )
  assert.equal(completed.usage?.outputTokens, 62)
})

void test('accumulator merges search and citation patches without losing prior results', () => {
  const context = createTestContext()
  const accumulator = createGenerationRunAccumulator({
    context,
  })

  accumulator.push({
    kind: 'search.patch',
    sequence: 1,
    occurredAt: '2026-04-04T00:00:01.000Z',
    context,
    patchMode: 'append',
    search: {
      query: 'deepseek api',
      status: 'searching',
      results: [],
    },
  })
  accumulator.push({
    kind: 'search.patch',
    sequence: 2,
    occurredAt: '2026-04-04T00:00:02.000Z',
    context,
    patchMode: 'append',
    search: {
      query: 'deepseek api',
      status: 'completed',
      results: [
        {
          id: 'search-1',
          title: 'DeepSeek Docs',
          url: 'https://example.com/docs',
        },
      ],
    },
  })
  accumulator.push({
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
          startIndex: 0,
          endIndex: 8,
        },
      },
    ],
  })

  const completed = accumulator.seal()

  assert.equal(completed.searches.length, 1)
  assert.equal(completed.searches[0]?.status, 'completed')
  assert.equal(completed.searches[0]?.results.length, 1)
  assert.equal(completed.citations.length, 1)
  assert.equal(completed.citations[0]?.annotation?.source, 'search')
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
