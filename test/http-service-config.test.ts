import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEEPSEEK_HTTP_API_KEY_ENV,
  expandHttpSurfaceSelection,
  isLoopbackHost,
  resolveServeHttpOptions,
} from '../src/interfaces/http/httpServiceConfig.js'

void test('serve HTTP config defaults to rpc-only loopback bind', () => {
  const resolved = resolveServeHttpOptions({
    transport: 'http',
    port: 8787,
  })

  assert.equal(resolved.host, '127.0.0.1')
  assert.equal(resolved.httpSurface, 'rpc')
  assert.deepEqual(resolved.surfaces, ['rpc'])
  assert.equal(resolved.httpApiKey, undefined)
})

void test('serve HTTP config accepts env-backed api key for openai surface', () => {
  const resolved = resolveServeHttpOptions({
    transport: 'http',
    port: 8787,
    httpSurface: 'openai',
    env: {
      [DEEPSEEK_HTTP_API_KEY_ENV]: 'env-key',
    },
  })

  assert.equal(resolved.httpApiKey, 'env-key')
  assert.deepEqual(resolved.surfaces, ['openai'])
})

void test('serve HTTP config rejects openai surfaces without an api key', () => {
  assert.throws(
    () =>
      resolveServeHttpOptions({
        transport: 'http',
        port: 8787,
        httpSurface: 'both',
      }),
    /openai.*require/i,
  )
})

void test('serve HTTP config rejects non-loopback bind without an api key', () => {
  assert.throws(
    () =>
      resolveServeHttpOptions({
        transport: 'http',
        port: 8787,
        host: '0.0.0.0',
      }),
    /non-loopback/i,
  )
})

void test('serve stdio rejects explicit HTTP-only options', () => {
  assert.throws(
    () =>
      resolveServeHttpOptions({
        transport: 'stdio',
        port: 8787,
        host: '127.0.0.1',
        hostExplicit: true,
      }),
    /only apply to `serve --transport http`/i,
  )
})

void test('http surface expansion and loopback detection stay explicit', () => {
  assert.deepEqual(expandHttpSurfaceSelection('rpc'), ['rpc'])
  assert.deepEqual(expandHttpSurfaceSelection('openai'), ['openai'])
  assert.deepEqual(expandHttpSurfaceSelection('both'), ['rpc', 'openai'])
  assert.equal(isLoopbackHost('127.0.0.1'), true)
  assert.equal(isLoopbackHost('localhost'), true)
  assert.equal(isLoopbackHost('::1'), true)
  assert.equal(isLoopbackHost('0.0.0.0'), false)
})
