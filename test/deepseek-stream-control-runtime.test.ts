import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createGenerationRunAccumulator } from '../src/infrastructure/deepseek/generationRunAccumulator.js'
import { parseDeepSeekGenerationCapturedExchange } from '../src/infrastructure/deepseek/deepSeekGenerationStreamParser.js'
import {
  inferDeepSeekResumableCandidateFromHistoryCapture,
  judgeDeepSeekGenerationSettlement,
  observeDeepSeekStreamControlResponses,
  summarizeObservedDeepSeekStreamControls,
} from '../src/infrastructure/deepseek/deepSeekStreamControlRuntime.js'
import type { DeepSeekGenerationCapturedExchange } from '../src/types/deepseek-generation-parser.types.js'
import type { DeepSeekHistoryMessagesCapturedExchange } from '../src/types/deepseek-history-messages.types.js'
import type { DeepSeekStreamControlCapturedExchange } from '../src/types/deepseek-stream-control.types.js'

const GENERATION_FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')
const STREAM_CONTROL_FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-stream-control')

void test('stop_stream fixture is summarized as an acknowledged control-plane stop request', async () => {
  const capture = await loadStreamControlFixture('stop_stream.real.fixture.json')
  const observations = summarizeObservedDeepSeekStreamControls({
    captures: [capture],
  })

  assert.equal(observations.length, 1)
  assert.equal(observations[0]?.endpoint, '/api/v0/chat/stop_stream')
  assert.equal(observations[0]?.sessionId, 'session-redacted')
  assert.equal(observations[0]?.messageId, '2')
  assert.equal(observations[0]?.acknowledged, true)
  assert.equal(observations[0]?.error, null)
})

void test('stream control observer keeps a short collection window after stop() so late stop_stream responses are not dropped', async () => {
  const page = new EventEmitter()
  const observer = observeDeepSeekStreamControlResponses(page as never)
  const stopPromise = observer.stop(250)

  setTimeout(() => {
    page.emit('response', createFakeStreamControlResponse())
  }, 20)

  const captures = await stopPromise
  const observations = summarizeObservedDeepSeekStreamControls({
    captures,
  })

  assert.equal(captures.length, 1)
  assert.equal(observations[0]?.endpoint, '/api/v0/chat/stop_stream')
  assert.equal(observations[0]?.acknowledged, true)
})

void test('resume_stream fixture is summarized as a resumed canonical generation run', async () => {
  const capture = await loadStreamControlFixture('resume_stream.real.fixture.json', GENERATION_FIXTURE_DIR)
  const observations = summarizeObservedDeepSeekStreamControls({
    captures: [capture],
  })

  assert.equal(observations.length, 1)
  assert.equal(observations[0]?.endpoint, '/api/v0/chat/resume_stream')
  assert.equal(observations[0]?.transport, 'sse')
  assert.equal(observations[0]?.acknowledged, true)
  assert.equal(observations[0]?.run?.finalized.status, 'completed')
  assert.equal(observations[0]?.run?.finalized.usage?.outputTokens, 8057)
})

void test('history_messages WIP fixture exposes a resumable assistant candidate', async () => {
  const capture = await loadHistoryFixture('history-messages.wip.real.fixture.json')
  const candidate = inferDeepSeekResumableCandidateFromHistoryCapture(capture)

  assert.ok(candidate)
  assert.equal(candidate?.sessionId, 'session-redacted')
  assert.equal(candidate?.assistantMessageId, '2')
  assert.equal(candidate?.status, 'WIP')
})

void test('settlement prefers explicit stop acknowledgements over route changes', async () => {
  const generationRun = await loadParsedGenerationRun('completion.stopped.real.fixture.json')
  const stopObservation = summarizeObservedDeepSeekStreamControls({
    captures: [await loadStreamControlFixture('stop_stream.real.fixture.json')],
  })

  const settlement = judgeDeepSeekGenerationSettlement({
    generationRuns: [generationRun],
    streamControls: stopObservation,
  })

  assert.equal(settlement.status, 'stopped')
  assert.equal(settlement.source, 'stop_stream')
  assert.equal(settlement.stopAcknowledged, true)
  assert.equal(settlement.assistantMessageId, '2')
})

void test('settlement treats stop_stream plus a completed finishReason=stop run as stopped for latest DeepSeek stop behavior', async () => {
  const generationRun = await loadParsedGenerationRun('completion.stopped.real.fixture.json')
  const stopObservation = summarizeObservedDeepSeekStreamControls({
    captures: [await loadStreamControlFixture('stop_stream.real.fixture.json')],
  })

  const settlement = judgeDeepSeekGenerationSettlement({
    generationRuns: [
      {
        ...generationRun,
        finalized: {
          ...generationRun.finalized,
          status: 'completed',
          finishReason: 'stop',
        },
      },
    ],
    streamControls: stopObservation,
  })

  assert.equal(settlement.status, 'stopped')
  assert.equal(settlement.source, 'stop_stream')
  assert.equal(settlement.stopAcknowledged, true)
  assert.equal(settlement.assistantMessageId, '2')
  assert.equal(settlement.finalized?.finishReason, 'stop')
})

void test('settlement marks WIP history as resumable until a resumed stream completes', async () => {
  const settlement = judgeDeepSeekGenerationSettlement({
    historyCapture: await loadHistoryFixture('history-messages.wip.real.fixture.json'),
  })

  assert.equal(settlement.status, 'resumable')
  assert.equal(settlement.source, 'history_messages')
  assert.equal(settlement.assistantMessageId, '2')
  assert.equal(settlement.resumable?.status, 'WIP')
})

void test('settlement accepts resume_stream as an authoritative completed result', async () => {
  const streamControls = summarizeObservedDeepSeekStreamControls({
    captures: [await loadStreamControlFixture('resume_stream.real.fixture.json', GENERATION_FIXTURE_DIR)],
  })

  const settlement = judgeDeepSeekGenerationSettlement({
    streamControls,
  })

  assert.equal(settlement.status, 'completed')
  assert.equal(settlement.source, 'resume_stream')
  assert.equal(settlement.finalized?.usage?.outputTokens, 8057)
})

void test('settlement falls back to failed when the canonical generation run ends in error', async () => {
  const generationRun = await loadParsedGenerationRun('completion.error.synthetic.fixture.json')
  const settlement = judgeDeepSeekGenerationSettlement({
    generationRuns: [generationRun],
  })

  assert.equal(settlement.status, 'failed')
  assert.equal(settlement.source, 'generation')
  assert.equal(settlement.error?.code, 'rate_limit_exceeded')
})

async function loadParsedGenerationRun(fileName: string) {
  const fixture = await loadGenerationFixture(fileName)
  const parsed = parseDeepSeekGenerationCapturedExchange(fixture)
  const accumulator = createGenerationRunAccumulator({
    context: parsed.context,
  })
  accumulator.pushMany(parsed.events)

  return {
    endpoint: fixture.endpoint,
    transport: parsed.transport,
    routeUrl: fixture.routeUrl ?? null,
    context: { ...parsed.context },
    events: parsed.events.map(event => ({ ...event })),
    finalized: accumulator.seal(),
    unknownObservations: parsed.unknownObservations.map(observation => ({
      ...observation,
    })),
    unknownObservationCount: parsed.unknownObservations.length,
    unknownObservationLabels: [...new Set(parsed.unknownObservations.map(item => item.label))],
  }
}

function createFakeStreamControlResponse() {
  return {
    url: () => 'https://chat.deepseek.com/api/v0/chat/stop_stream',
    status: () => 200,
    headers: () => ({
      'content-type': 'application/json; charset=utf-8',
    }),
    text: () =>
      Promise.resolve(
        JSON.stringify({
          code: 0,
          msg: '',
          data: {
            biz_code: 0,
            biz_msg: '',
            biz_data: {},
          },
        }),
      ),
    request: () => ({
      method: () => 'POST',
      url: () => 'https://chat.deepseek.com/api/v0/chat/stop_stream',
      postData: () =>
        JSON.stringify({
          chat_session_id: 'session-redacted',
          message_id: 2,
        }),
    }),
  }
}

async function loadGenerationFixture(fileName: string): Promise<
  DeepSeekGenerationCapturedExchange & { routeUrl?: string | null }
> {
  const raw = JSON.parse(await readFile(join(GENERATION_FIXTURE_DIR, fileName), 'utf8')) as {
    endpoint: DeepSeekGenerationCapturedExchange['endpoint']
    routeUrl?: string | null
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
    routeUrl: raw.routeUrl ?? null,
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

async function loadStreamControlFixture(
  fileName: string,
  fixtureDir = STREAM_CONTROL_FIXTURE_DIR,
): Promise<DeepSeekStreamControlCapturedExchange> {
  const raw = JSON.parse(await readFile(join(fixtureDir, fileName), 'utf8')) as {
    endpoint: DeepSeekStreamControlCapturedExchange['endpoint']
    routeUrl?: string | null
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
    routeUrl: raw.routeUrl ?? null,
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

async function loadHistoryFixture(fileName: string): Promise<DeepSeekHistoryMessagesCapturedExchange> {
  const raw = JSON.parse(await readFile(join(STREAM_CONTROL_FIXTURE_DIR, fileName), 'utf8')) as {
    endpoint: '/api/v0/chat/history_messages'
    routeUrl: string | null
    sessionId: string
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
    routeUrl: raw.routeUrl,
    sessionId: raw.sessionId,
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
