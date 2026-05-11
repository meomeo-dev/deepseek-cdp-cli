import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  describeDeepSeekHistoryMessagesPayloadUnsettled,
  isDeepSeekHistoryMessagesPayloadSettled,
  recoverDeepSeekSessionFromHistoryMessagesOnPage,
  recoverDeepSeekSessionFromHistoryMessagesCaptures,
  recoverDeepSeekSessionFromHistoryMessagesCapture,
} from '../src/infrastructure/deepseek/deepSeekHistoryMessages.js'
import type { DeepSeekHistoryMessagesCapturedExchange } from '../src/types/deepseek-history-messages.types.js'

void test('recovers an authoritative session from a real audited history_messages capture', async () => {
  const capture = await loadFixture('history-messages.real.fixture.json')

  const recovered = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture,
    attempts: 1,
  })

  assert.equal(recovered.outcome, 'recovered')
  assert.equal(recovered.recovery.status, 'recovered')
  assert.equal(recovered.recovery.requestUrl, capture.request.url)
  assert.equal(recovered.recovery.branchCount, 1)
  assert.equal(recovered.recovery.messageCount, 2)
  assert.equal(recovered.session.branches[0]?.messages[1]?.text, 'history probe ok.')
})

void test('explicit history recovery fetches full history without cache_version before reload fallback', async () => {
  const capture = await loadFixture('history-messages.real.fixture.json')
  const page = {
    evaluate: (_source: unknown, requestPath: string) => {
      assert.equal(requestPath, '/api/v0/chat/history_messages?chat_session_id=session-redacted')
      return {
        requestUrl: `https://chat.deepseek.com${requestPath}`,
        status: capture.response.status,
        contentType: capture.response.contentType,
        bodyText: capture.response.bodyText,
      }
    },
    reload: () => {
      throw new Error('reload should not be needed after full history fetch')
    },
    goto: () => {
      throw new Error('goto should not be needed after full history fetch')
    },
  }

  const recovered = await recoverDeepSeekSessionFromHistoryMessagesOnPage(page as never, {
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-redacted',
    sessionId: 'session-redacted',
    timeoutMs: 5_000,
    maxAttempts: 1,
  })

  assert.equal(recovered.outcome, 'recovered')
  assert.equal(recovered.recovery.requestUrl, 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-redacted')
  assert.equal(recovered.recovery.messageCount, 2)
})

void test('treats WIP history_messages payloads as incomplete and refuses transcript promotion', () => {
  const capture: DeepSeekHistoryMessagesCapturedExchange = {
    endpoint: '/api/v0/chat/history_messages',
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-wip',
    sessionId: 'session-wip',
    request: {
      method: 'GET',
      url: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-wip',
      postData: null,
    },
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: JSON.stringify({
        code: 0,
        msg: '',
        data: {
          biz_code: 0,
          biz_msg: '',
          biz_data: {
            chat_session: {
              id: 'session-wip',
              title: 'WIP Session',
              agent: 'chat',
              inserted_at: 1775290437.779,
            },
            chat_messages: [
              {
                message_id: 1,
                parent_id: null,
                role: 'USER',
                status: 'FINISHED',
                inserted_at: 1775290440.556,
                files: [],
                fragments: [
                  {
                    id: 1,
                    type: 'REQUEST',
                    content: 'hello',
                  },
                ],
                has_pending_fragment: false,
                incomplete_message: null,
              },
              {
                message_id: 2,
                parent_id: 1,
                role: 'ASSISTANT',
                status: 'WIP',
                inserted_at: 1775290440.5579998,
                files: [],
                fragments: [
                  {
                    id: 2,
                    type: 'RESPONSE',
                    content: 'partial',
                    references: [],
                  },
                ],
                has_pending_fragment: true,
                incomplete_message: 'partial',
              },
            ],
          },
        },
      }),
    },
  }

  const payload = JSON.parse(capture.response.bodyText) as unknown
  const recovered = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture,
    attempts: 2,
  })

  assert.equal(isDeepSeekHistoryMessagesPayloadSettled(payload), false)
  assert.match(
    describeDeepSeekHistoryMessagesPayloadUnsettled(payload) ?? '',
    /message 2 \(ASSISTANT\) status=WIP/i,
  )
  assert.equal(recovered.outcome, 'failed')
  assert.equal(recovered.recovery.status, 'failed')
  assert.equal(recovered.recovery.settled, false)
  assert.match(recovered.recovery.errorMessage ?? '', /incomplete/i)
  assert.equal(recovered.session?.branches[0]?.messages[1]?.text, 'partial')
})

void test('treats terminal INCOMPLETE history messages without pending fragments as settled', () => {
  const payload = {
    code: 0,
    msg: '',
    data: {
      biz_code: 0,
      biz_msg: '',
      biz_data: {
        chat_session: {
          id: 'session-terminal-incomplete',
          title: 'Terminal Incomplete Session',
          agent: 'chat',
          inserted_at: 1775290437.779,
        },
        chat_messages: [
          {
            message_id: 1,
            parent_id: null,
            role: 'USER',
            status: 'FINISHED',
            inserted_at: 1775290440.556,
            fragments: [{ id: 1, type: 'REQUEST', content: 'hello' }],
            has_pending_fragment: false,
            incomplete_message: null,
          },
          {
            message_id: 2,
            parent_id: 1,
            role: 'ASSISTANT',
            status: 'INCOMPLETE',
            inserted_at: 1775290440.5579998,
            fragments: [{ id: 2, type: 'RESPONSE', content: 'stopped but persisted' }],
            has_pending_fragment: false,
            incomplete_message: null,
          },
        ],
      },
    },
  }
  const capture: DeepSeekHistoryMessagesCapturedExchange = {
    endpoint: '/api/v0/chat/history_messages',
    routeUrl: 'https://chat.deepseek.com/a/chat/s/session-terminal-incomplete',
    sessionId: 'session-terminal-incomplete',
    request: {
      method: 'GET',
      url: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-terminal-incomplete',
      postData: null,
    },
    response: {
      status: 200,
      contentType: 'application/json',
      bodyText: JSON.stringify(payload),
    },
  }

  const recovered = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture,
    attempts: 1,
  })

  assert.equal(isDeepSeekHistoryMessagesPayloadSettled(payload), true)
  assert.equal(describeDeepSeekHistoryMessagesPayloadUnsettled(payload), null)
  assert.equal(recovered.outcome, 'recovered')
  assert.equal(recovered.session.branches[0]?.messages[1]?.text, 'stopped but persisted')
})

void test('prefers an earlier recovered history_messages capture over a later incomplete one', async () => {
  const recoveredCapture = await loadFixture('history-messages.real.fixture.json')
  const failedCapture = await loadFixture('history-messages.regenerate.empty-merge.real.fixture.json')

  const recovered = recoverDeepSeekSessionFromHistoryMessagesCaptures({
    captures: [recoveredCapture, failedCapture],
    attempts: 1,
  })

  assert.ok(recovered)
  assert.equal(recovered?.outcome, 'recovered')
  assert.equal(recovered?.recovery.status, 'recovered')
  assert.equal(recovered?.session.branches[0]?.messages[1]?.text, 'history probe ok.')
})

void test('treats regenerate empty MERGE payloads as incomplete and refuses transcript promotion', async () => {
  const capture = await loadFixture('history-messages.regenerate.empty-merge.real.fixture.json')

  const recovered = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture,
    attempts: 3,
  })

  assert.equal(recovered.outcome, 'failed')
  assert.equal(recovered.recovery.status, 'failed')
  assert.equal(recovered.recovery.settled, false)
  assert.equal(recovered.recovery.branchCount, 0)
  assert.equal(recovered.recovery.messageCount, 0)
  assert.match(recovered.recovery.errorMessage ?? '', /could not find any messages/i)
  assert.equal(recovered.session, null)
})

async function loadFixture(fileName: string): Promise<DeepSeekHistoryMessagesCapturedExchange> {
  return JSON.parse(
    await readFile(
      join(process.cwd(), 'test/fixtures/deepseek-history-messages', fileName),
      'utf8',
    ),
  ) as DeepSeekHistoryMessagesCapturedExchange
}
