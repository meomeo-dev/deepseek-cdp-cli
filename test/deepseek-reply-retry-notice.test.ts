import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeepSeekReplyRetryNoticeHandler } from '../src/shared/runtime/deepSeekReplyRetryNotice.js'

void test('retry notice handler labels countdown as API-level browser-flow replay', () => {
  let output = ''
  const handle = createDeepSeekReplyRetryNoticeHandler({
    isTTY: false,
    write: chunk => {
      output += chunk
    },
  })

  handle({
    kind: 'retry.scheduled',
    attemptNumber: 1,
    nextAttemptNumber: 2,
    cooldownMs: 60_000,
    maxRetries: 2,
    rateLimit: {
      code: 'rate_limit_exceeded',
      message: 'Messages too frequent. Try again later.',
      retryable: true,
      scope: 'search',
      apiSignalStatus: 'confirmed',
      uiRetryControlStatus: 'ui-observation-pending',
      uiObservationStatus: 'ui-observation-pending',
      recommendedCooldownMs: 60_000,
      rawFinishReason: 'rate_limit_reached',
      clickBehavior: 'retry',
      note:
        'This is an API-level retry signal, not a confirmed clickable UI retry button.',
    },
  })

  assert.match(output, /\[api-rate-limit-retry\]/)
  assert.match(output, /browser-flow replay attempt 2\/3/)
})

void test('retry notice handler explains exhausted retries did not click a UI retry button', () => {
  let output = ''
  const handle = createDeepSeekReplyRetryNoticeHandler({
    isTTY: false,
    write: chunk => {
      output += chunk
    },
  })

  handle({
    kind: 'retry.exhausted',
    attemptNumber: 2,
    maxRetries: 1,
    rateLimit: {
      code: 'rate_limit_exceeded',
      message: 'Messages too frequent. Try again later.',
      retryable: true,
      scope: 'search',
      apiSignalStatus: 'confirmed',
      uiRetryControlStatus: 'ui-observation-pending',
      uiObservationStatus: 'ui-observation-pending',
      recommendedCooldownMs: 60_000,
      rawFinishReason: 'rate_limit_reached',
      clickBehavior: 'retry',
      note:
        'This is an API-level retry signal, not a confirmed clickable UI retry button.',
    },
  })

  assert.match(output, /automatic browser-flow retries/i)
  assert.match(output, /no confirmed UI retry button was clicked/i)
})

void test('retry notice handler explains when replay is waiting on sibling search attempts', () => {
  let output = ''
  const handle = createDeepSeekReplyRetryNoticeHandler({
    isTTY: false,
    write: chunk => {
      output += chunk
    },
  })

  handle({
    kind: 'retry.peer-wait',
    attemptNumber: 1,
    nextAttemptNumber: 2,
    activeSearchAttemptCount: 2,
  })

  assert.match(output, /waiting for 2 other active search attempts to settle/i)
  assert.match(output, /before replay attempt 2/i)
})
