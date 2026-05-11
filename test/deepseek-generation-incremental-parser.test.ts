import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  createDeepSeekIncrementalGenerationParser,
  parseDeepSeekGenerationCapturedExchange,
} from '../src/infrastructure/deepseek/deepSeekGenerationStreamParser.js'
import { createGenerationRunAccumulator } from '../src/infrastructure/deepseek/generationRunAccumulator.js'
import type { DeepSeekGenerationCapturedExchange } from '../src/types/deepseek-generation-parser.types.js'

const FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')
const REPRESENTATIVE_FIXTURES = [
  'completion.real.fixture.json',
  'completion.search.real.fixture.json',
  'completion.search.rate-limit.real.fixture.json',
  'completion.stopped.real.fixture.json',
  'continue.real.fixture.json',
  'completion.error.synthetic.fixture.json',
] as const

void test('incremental parser matches buffered canonical output across representative fixtures', async t => {
  for (const fileName of REPRESENTATIVE_FIXTURES) {
    await t.test(fileName, async () => {
      const fixture = await loadFixture(fileName)
      const buffered = parseDeepSeekGenerationCapturedExchange(fixture)
      const parser = createDeepSeekIncrementalGenerationParser(fixture)
      const streamedEvents = []
      const streamedUnknownObservations = []

      for (const chunk of splitIntoChunks(fixture.response.bodyText)) {
        const delta = parser.pushBodyChunk(chunk)
        streamedEvents.push(...delta.events)
        streamedUnknownObservations.push(...delta.unknownObservations)
      }

      const finalized = parser.finalize()
      streamedEvents.push(...finalized.newEvents)
      streamedUnknownObservations.push(...finalized.newUnknownObservations)

      assert.deepEqual(finalized.transport, buffered.transport)
      assert.deepEqual(finalized.context, buffered.context)
      assert.deepEqual(finalized.events, buffered.events)
      assert.deepEqual(finalized.unknownObservations, buffered.unknownObservations)
      assert.deepEqual(streamedEvents, buffered.events)
      assert.deepEqual(streamedUnknownObservations, buffered.unknownObservations)
      assert.deepEqual(finalized.snapshot, {
        transport: buffered.transport,
        context: buffered.context,
        eventCount: buffered.events.length,
        unknownObservationCount: buffered.unknownObservations.length,
        finalized: true,
      })
    })
  }
})

void test('incremental live accumulator seals to the same finalized run as buffered parsing while keeping terminal completion at finalize time', async () => {
  const fixture = await loadFixture('completion.search.real.fixture.json')
  const buffered = parseDeepSeekGenerationCapturedExchange(fixture)
  const bufferedAccumulator = createGenerationRunAccumulator({
    context: buffered.context,
  })
  bufferedAccumulator.pushMany(buffered.events)
  const bufferedFinalized = bufferedAccumulator.seal()

  const parser = createDeepSeekIncrementalGenerationParser(fixture)
  const liveAccumulator = createGenerationRunAccumulator({
    context: parser.snapshot().context,
  })
  let sawCompletedBeforeFinalize = false

  for (const chunk of splitIntoChunks(fixture.response.bodyText)) {
    const delta = parser.pushBodyChunk(chunk)
    if (delta.events.some(event => event.kind === 'completed')) {
      sawCompletedBeforeFinalize = true
    }
    liveAccumulator.pushMany(delta.events)
  }

  const beforeFinalizeSnapshot = liveAccumulator.snapshot()
  const finalized = parser.finalize()
  liveAccumulator.pushMany(finalized.newEvents)
  const liveFinalized = liveAccumulator.seal()

  assert.equal(sawCompletedBeforeFinalize, false)
  assert.equal(beforeFinalizeSnapshot.sealed, false)
  assert.equal(beforeFinalizeSnapshot.status, 'running')
  assert.ok(finalized.newEvents.some(event => event.kind === 'completed'))
  assert.deepEqual(liveFinalized, bufferedFinalized)
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

function splitIntoChunks(value: string): string[] {
  if (!value) {
    return ['']
  }

  const chunkSizes = [1, 2, 3, 5, 8, 13, 21, 34]
  const chunks: string[] = []
  let offset = 0
  let chunkIndex = 0

  while (offset < value.length) {
    const size = chunkSizes[chunkIndex % chunkSizes.length]!
    chunks.push(value.slice(offset, offset + size))
    offset += size
    chunkIndex += 1
  }

  return chunks
}
