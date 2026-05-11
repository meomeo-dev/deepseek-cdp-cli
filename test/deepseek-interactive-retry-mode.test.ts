import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDeepSeekInteractiveRetryModeCommand,
  createDeepSeekInteractiveRetryModeState,
  serializeDeepSeekInteractiveRetryModeState,
} from '../src/interfaces/interactive/deepSeekInteractiveRetryMode.js'

void test('interactive retry mode can enable automatic rate-limit retries', () => {
  const state = applyDeepSeekInteractiveRetryModeCommand(
    createDeepSeekInteractiveRetryModeState(undefined),
    'on',
  )

  assert.equal(state.requested.onRateLimit, true)
  assert.equal(state.resolved.onRateLimit, true)
  assert.equal(state.resolved.maxRetries, 0)
})

void test('interactive retry mode can set max retries and auto cooldown', () => {
  const withMax = applyDeepSeekInteractiveRetryModeCommand(
    createDeepSeekInteractiveRetryModeState({
      onRateLimit: true,
    }),
    'max 2',
  )
  const withAutoCooldown = applyDeepSeekInteractiveRetryModeCommand(
    withMax,
    'cooldown auto',
  )

  assert.equal(withAutoCooldown.resolved.maxRetries, 2)
  assert.equal(withAutoCooldown.resolved.cooldownMs, null)
})

void test('interactive retry mode exposes the shared API retry boundary', () => {
  const state = createDeepSeekInteractiveRetryModeState({
    onRateLimit: true,
  })
  const serialized = JSON.parse(serializeDeepSeekInteractiveRetryModeState(state)) as {
    deliveryBoundary: {
      strategy: string
      uiRetryControlStatus: string
      note: string
    }
  }

  assert.equal(serialized.deliveryBoundary.strategy, 'api-cooldown-replay')
  assert.equal(serialized.deliveryBoundary.uiRetryControlStatus, 'ui-observation-pending')
  assert.match(
    serialized.deliveryBoundary.note,
    /do not click a confirmed DeepSeek UI retry control/i,
  )
})

void test('interactive retry mode rejects invalid commands', () => {
  assert.throws(
    () =>
      applyDeepSeekInteractiveRetryModeCommand(
        createDeepSeekInteractiveRetryModeState(undefined),
        'max nope',
      ),
    /Usage: retry max <count>/,
  )
})
