import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isDeepSeekOutputJsonShape,
  resolveDeepSeekOutputMode,
} from '../src/infrastructure/deepseek/deepSeekOutputModes.js'

void test('resolves text output by default when no json shape is requested', () => {
  const resolved = resolveDeepSeekOutputMode({
    stream: false,
  })

  assert.deepEqual(resolved, {
    stream: false,
    format: 'text',
    jsonShape: null,
    transport: 'buffered',
    outputFamily: 'text',
  })
})

void test('infers stream-json when stream mode requests a json shape', () => {
  const resolved = resolveDeepSeekOutputMode({
    stream: true,
    jsonShape: 'openai-responses',
  })

  assert.deepEqual(resolved, {
    stream: true,
    format: 'stream-json',
    jsonShape: 'openai-responses',
    transport: 'streaming',
    outputFamily: 'json',
  })
})

void test('accepts buffered json with openai chat completions shape', () => {
  const resolved = resolveDeepSeekOutputMode({
    stream: false,
    format: 'json',
    jsonShape: 'openai-chat-completions',
  })

  assert.equal(resolved.format, 'json')
  assert.equal(resolved.jsonShape, 'openai-chat-completions')
})

void test('infers buffered json when buffered mode requests a json shape', () => {
  const resolved = resolveDeepSeekOutputMode({
    stream: false,
    jsonShape: 'native',
  })

  assert.deepEqual(resolved, {
    stream: false,
    format: 'json',
    jsonShape: 'native',
    transport: 'buffered',
    outputFamily: 'json',
  })
})

void test('rejects json output in stream mode', () => {
  assert.throws(
    () =>
      resolveDeepSeekOutputMode({
        stream: true,
        format: 'json',
        jsonShape: 'native',
      }),
    /`json` output requires `stream=false`\./,
  )
})

void test('rejects stream-json output in buffered mode', () => {
  assert.throws(
    () =>
      resolveDeepSeekOutputMode({
        stream: false,
        format: 'stream-json',
        jsonShape: 'native',
      }),
    /`stream-json` output requires `stream=true`\./,
  )
})

void test('rejects json output without jsonShape', () => {
  assert.throws(
    () =>
      resolveDeepSeekOutputMode({
        stream: false,
        format: 'json',
      }),
    /JSON output requires `jsonShape` to be one of native\|openai-responses\|openai-chat-completions\./,
  )
})

void test('rejects stream-json output without jsonShape', () => {
  assert.throws(
    () =>
      resolveDeepSeekOutputMode({
        stream: true,
        format: 'stream-json',
      }),
    /JSON output requires `jsonShape` to be one of native\|openai-responses\|openai-chat-completions\./,
  )
})

void test('rejects text output when a json shape is also provided', () => {
  assert.throws(
    () =>
      resolveDeepSeekOutputMode({
        stream: false,
        format: 'text',
        jsonShape: 'native',
      }),
    /`jsonShape` can only be used with `json` or `stream-json` output\./,
  )
})

void test('recognizes the supported json shape names', () => {
  assert.equal(isDeepSeekOutputJsonShape('native'), true)
  assert.equal(isDeepSeekOutputJsonShape('openai-responses'), true)
  assert.equal(isDeepSeekOutputJsonShape('openai-chat-completions'), true)
  assert.equal(isDeepSeekOutputJsonShape('yaml'), false)
})
