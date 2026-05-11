import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { parseDeepSeekGenerationCapturedExchange } from '../src/infrastructure/deepseek/deepSeekGenerationStreamParser.js'
import type { DeepSeekGenerationCapturedExchange } from '../src/types/deepseek-generation-parser.types.js'
import type { DeepSeekGenerationCompletedEvent } from '../src/types/deepseek-stream.types.js'

const FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')

void test('completion fixture parses into canonical reasoning, text, usage, finish, and completed events', async () => {
  const fixture = await loadFixture('completion.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.equal(result.transport, 'sse')
  assert.equal(result.context.endpoint, '/api/v0/chat/completion')
  assert.equal(result.context.sessionId, 'session-redacted')
  assert.equal(result.context.modeFact?.rawModelType, 'default')
  assert.equal(result.context.modeFact?.resolvedMode, 'instant')
  assert.equal(result.context.modeFact?.sourceLayer, 'canonical-generation-context')
  assert.equal(result.context.modeFact?.derivedFromLayer, 'generation-ready-sse')
  assert.ok(result.events.some(event => event.kind === 'reasoning.delta'))
  assert.ok(result.events.some(event => event.kind === 'text.delta'))
  assert.ok(result.events.some(event => event.kind === 'usage.update'))
  assert.ok(result.events.some(event => event.kind === 'finish'))
  assert.equal(result.events.at(-1)?.kind, 'completed')
  assert.equal(completed.result.status, 'completed')
  assert.equal(completed.result.finishReason, 'stop')
  assert.equal(
    completed.result.outputText,
    'The fixture is fully captured. All completion criteria are met. The process ends here.',
  )
  assert.equal(completed.result.usage?.outputTokens, 60)
  assert.equal(completed.result.error, null)
  assert.ok(
    result.unknownObservations.some(observation => observation.label === 'unhandled_elapsed_secs_patch'),
  )
  assert.ok(
    result.unknownObservations.some(observation => observation.label === 'unhandled_event:title'),
  )
})

void test('regenerate fixture reuses the same parser contract and reaches a completed terminal state', async () => {
  const fixture = await loadFixture('regenerate.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.equal(result.context.endpoint, '/api/v0/chat/regenerate')
  assert.equal(completed.result.status, 'completed')
  assert.equal(completed.result.finishReason, 'stop')
  assert.equal(completed.result.outputText, 'The fixture is now fully captured. All completion data has been recorded. The process is complete.')
  assert.equal(completed.result.usage?.outputTokens, 62)
})

void test('edit_message fixture preserves the endpoint-specific request context and finalized assistant text', async () => {
  const fixture = await loadFixture('edit_message.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.equal(result.context.endpoint, '/api/v0/chat/edit_message')
  assert.equal(result.context.sessionId, 'session-redacted')
  assert.equal(completed.result.status, 'completed')
  assert.equal(completed.result.finishReason, 'stop')
  assert.ok(completed.result.reasoningText.includes('exactly two short sentences'))
  assert.ok(completed.result.outputText.length > 10)
  assert.equal(completed.result.usage?.outputTokens, 86)
})

void test('continue fixture resumes an existing assistant message and keeps prior output token usage', async () => {
  const fixture = await loadFixture('continue.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)
  const usageEvents = result.events.filter(
    event => event.kind === 'usage.update',
  )

  assert.equal(result.context.endpoint, '/api/v0/chat/continue')
  assert.equal(result.context.assistantMessageId, '2')
  assert.ok(result.events.some(event => event.kind === 'text.delta'))
  assert.equal(usageEvents[0]?.kind, 'usage.update')
  assert.equal(usageEvents[0]?.usage.outputTokens, 52)
  assert.equal(completed.result.status, 'completed')
  assert.equal(completed.result.usage?.outputTokens, 651)
  assert.ok(completed.result.outputText.includes('120 Capture continue fixture'))
})

void test('resume_stream fixture parses as a canonical resumed generation run', async () => {
  const fixture = await loadFixture('resume_stream.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.equal(result.context.endpoint, '/api/v0/chat/resume_stream')
  assert.equal(result.context.sessionId, 'session-redacted')
  assert.equal(result.context.assistantMessageId, '2')
  assert.equal(completed.result.status, 'completed')
  assert.equal(completed.result.finishReason, 'stop')
  assert.equal(completed.result.usage?.outputTokens, 8057)
  assert.ok(completed.result.outputText.includes('2999'))
  assert.ok(
    result.unknownObservations.some(observation => observation.label === 'unhandled_event:title'),
  )
})

void test('stopped completion fixture maps manual abort into stopped and completed terminal events', async () => {
  const fixture = await loadFixture('completion.stopped.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.ok(result.events.some(event => event.kind === 'stopped'))
  assert.ok(result.events.some(event => event.kind === 'finish'))
  assert.equal(completed.result.status, 'stopped')
  assert.equal(completed.result.finishReason, 'stopped')
  assert.equal(completed.result.outputText, '')
  assert.equal(completed.result.reasoningText, '')
  assert.equal(completed.result.error, null)
})

void test('search-enabled completion fixture maps TOOL_SEARCH, TOOL_OPEN, and RESPONSE.references into canonical search and citation state', async () => {
  const fixture = await loadFixture('completion.search.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  const searchEvents = result.events.filter(event => event.kind === 'search.patch')
  const citationEvents = result.events.filter(event => event.kind === 'citation.patch')

  assert.equal(result.context.endpoint, '/api/v0/chat/completion')
  assert.equal(result.context.sessionId, 'session-search-redacted')
  assert.equal(result.context.modeFact?.rawModelType, 'default')
  assert.ok(searchEvents.length >= 2)
  assert.equal(citationEvents.length, 1)
  assert.equal(completed.result.status, 'completed')
  assert.equal(completed.result.finishReason, 'stop')
  assert.equal(completed.result.searches.length, 1)
  assert.equal(completed.result.searches[0]?.query, 'OpenAI Responses API streaming events data structure official documentation')
  assert.equal(completed.result.searches[0]?.status, 'completed')
  assert.equal(completed.result.searches[0]?.results[0]?.title, 'Agent Streaming Architecture in OpenAI Agents SDK¶')
  assert.equal(completed.result.searches[0]?.results[0]?.source, 'Sylph AI')
  assert.equal(completed.result.citations.length, 1)
  assert.equal(completed.result.citations[0]?.title, 'Agent Streaming Architecture in OpenAI Agents SDK¶')
  assert.equal(completed.result.citations[0]?.annotation?.source, 'search')
  assert.equal(completed.result.outputText, '让我先搜索资料...[reference:0]')
  assert.equal(completed.result.usage?.outputTokens, 321)
})

void test('search rate-limit fixture maps SSE hint and close retry signal into a failed canonical run without pretending UI retry is confirmed', async () => {
  const fixture = await loadFixture('completion.search.rate-limit.real.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.equal(result.transport, 'sse')
  assert.ok(result.events.some(event => event.kind === 'error'))
  assert.equal(completed.result.status, 'failed')
  assert.equal(completed.result.finishReason, 'error')
  assert.equal(completed.result.outputText, '')
  assert.equal(completed.result.error?.code, 'rate_limit_exceeded')
  assert.equal(completed.result.error?.cause, 'rate_limit_reached')
  assert.equal(completed.result.error?.message, 'Messages too frequent. Try again later.')
  assert.ok(result.unknownObservations.some(item => item.label === 'rate_limit_retry_close'))
})

void test('synthetic transport error fixture maps to error and failed completed events', async () => {
  const fixture = await loadFixture('completion.error.synthetic.fixture.json')
  const result = parseDeepSeekGenerationCapturedExchange(fixture)
  const completed = findCompleted(result)

  assert.equal(result.transport, 'json')
  assert.ok(result.events.some(event => event.kind === 'error'))
  assert.equal(completed.result.status, 'failed')
  assert.equal(completed.result.finishReason, 'error')
  assert.equal(completed.result.outputText, '')
  assert.equal(completed.result.reasoningText, '')
  assert.equal(completed.result.error?.code, 'rate_limit_exceeded')
  assert.equal(completed.result.error?.message, 'Too many generation requests')
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

function findCompleted(result: ReturnType<typeof parseDeepSeekGenerationCapturedExchange>): DeepSeekGenerationCompletedEvent {
  const completed = result.events.findLast(event => event.kind === 'completed')
  assert.ok(completed)
  return completed
}
