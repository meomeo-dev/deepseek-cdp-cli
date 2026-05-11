import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDeepSeekInteractiveOutputModeCommand,
  createDeepSeekInteractiveOutputModeState,
} from '../src/interfaces/interactive/deepSeekInteractiveOutputMode.js'

void test('interactive output mode infers buffered json and streaming json from json shape', () => {
  const buffered = applyDeepSeekInteractiveOutputModeCommand(
    createDeepSeekInteractiveOutputModeState(undefined),
    'shape openai-responses',
  )
  const streaming = applyDeepSeekInteractiveOutputModeCommand(buffered, 'stream on')

  assert.equal(buffered.resolved.format, 'json')
  assert.equal(buffered.resolved.transport, 'buffered')
  assert.equal(streaming.resolved.format, 'stream-json')
  assert.equal(streaming.resolved.transport, 'streaming')
})

void test('invalid interactive output mode changes do not mutate the previous state', () => {
  const current = createDeepSeekInteractiveOutputModeState({
    format: 'json',
    jsonShape: 'native',
  })

  assert.throws(
    () => applyDeepSeekInteractiveOutputModeCommand(current, 'stream on'),
    /`json` output requires `stream=false`\./,
  )
  assert.equal(current.requested.stream, false)
  assert.equal(current.resolved.format, 'json')
  assert.equal(current.resolved.transport, 'buffered')
})

void test('interactive output mode reset clears explicit format and json shape', () => {
  const reset = applyDeepSeekInteractiveOutputModeCommand(
    createDeepSeekInteractiveOutputModeState({
      stream: true,
      jsonShape: 'openai-chat-completions',
    }),
    'reset',
  )

  assert.equal(reset.requested.stream, false)
  assert.equal(reset.requested.format, undefined)
  assert.equal(reset.requested.jsonShape, undefined)
  assert.equal(reset.resolved.format, 'text')
  assert.equal(reset.resolved.transport, 'buffered')
})
