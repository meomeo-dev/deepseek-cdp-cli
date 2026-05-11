import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractDeepSeekSessionCreateObservation,
  selectDeepSeekSessionCreateObservation,
  waitForDeepSeekSessionRoute,
} from '../src/infrastructure/deepseek/deepSeekSessionTransition.js'

void test('extracts session id and agent from chat_session/create payload', () => {
  const observation = extractDeepSeekSessionCreateObservation(
    {
      code: 0,
      msg: '',
      data: {
        biz_code: 0,
        biz_msg: '',
        biz_data: {
          chat_session: {
            id: '2462ed93-501f-4bfb-9899-08a8b80bea6b',
            agent: 'chat',
          },
        },
      },
    },
    'https://chat.deepseek.com/api/v0/chat_session/create',
    200,
  )

  assert.deepEqual(observation, {
    sessionId: '2462ed93-501f-4bfb-9899-08a8b80bea6b',
    agentId: 'chat',
    url: 'https://chat.deepseek.com/api/v0/chat_session/create',
    status: 200,
  })
})

void test('returns null when chat_session/create payload is malformed', () => {
  assert.equal(
    extractDeepSeekSessionCreateObservation(
      { code: 0, data: {} },
      'https://chat.deepseek.com/api/v0/chat_session/create',
      200,
    ),
    null,
  )
})

void test('prefers the create observation that matches the final route session id', () => {
  const selected = selectDeepSeekSessionCreateObservation(
    [
      {
        sessionId: 'session-old',
        agentId: 'chat',
        url: 'https://chat.deepseek.com/api/v0/chat_session/create',
        status: 200,
      },
      {
        sessionId: 'session-final',
        agentId: 'chat',
        url: 'https://chat.deepseek.com/api/v0/chat_session/create',
        status: 200,
      },
    ],
    'session-final',
  )

  assert.deepEqual(selected, {
    sessionId: 'session-final',
    agentId: 'chat',
    url: 'https://chat.deepseek.com/api/v0/chat_session/create',
    status: 200,
  })
})

void test('returns null when no create observation matches the final route session id', () => {
  const selected = selectDeepSeekSessionCreateObservation(
    [
      {
        sessionId: 'session-old',
        agentId: 'chat',
        url: 'https://chat.deepseek.com/api/v0/chat_session/create',
        status: 200,
      },
    ],
    'session-final',
  )

  assert.equal(selected, null)
})

void test('reports a clear error when the page closes while waiting for the session route', async () => {
  const page = {
    waitForFunction: () => Promise.reject(new Error('Target closed')),
    isClosed: () => true,
    url: () => 'https://chat.deepseek.com/',
  }

  await assert.rejects(
    () => waitForDeepSeekSessionRoute(page as never, 1_000),
    /DeepSeek page closed while waiting for the post-submit session route\./,
  )
})

void test('reports the last known url when session route waiting times out', async () => {
  const page = {
    waitForFunction: () => Promise.reject(new Error('Waiting failed: 30000ms exceeded')),
    isClosed: () => false,
    url: () => 'https://chat.deepseek.com/',
  }

  await assert.rejects(
    () => waitForDeepSeekSessionRoute(page as never, 1_000),
    /Timed out waiting for DeepSeek to reach a session route after submit\. Last known url: https:\/\/chat\.deepseek\.com\//,
  )
})
