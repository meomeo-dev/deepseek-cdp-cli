import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDeepSeekSearchVerificationScript,
  findDeepSeekSearchPromptSampleById,
  listDeepSeekSearchPromptSamples,
  matchesDeepSeekSearchOpeningPrefix,
  renderDeepSeekSearchVerificationScript,
  validateDeepSeekSearchPromptSource,
} from '../src/domain/search/deepSeekSearchPromptTemplate.js'

void test('search prompt sample pool is unique and structurally complete', () => {
  const samples = listDeepSeekSearchPromptSamples()
  const ids = new Set(samples.map(sample => sample.id))

  assert.equal(samples.length, 3)
  assert.equal(ids.size, samples.length)

  for (const sample of samples) {
    const validation = validateDeepSeekSearchPromptSource(sample)
    assert.equal(validation.valid, true, `${sample.id}: ${validation.issues.join(', ')}`)
    assert.ok(sample.tags.length > 0)
    assert.ok(sample.rationale.length > 0)
    assert.ok(sample.dimensions.length >= 2)
  }
})

void test('renders a verification script with explicit preconditions, prompt shape, and opening-prefix expectation', () => {
  const sample = findDeepSeekSearchPromptSampleById('browser-automation-stack-2026q2')
  assert.ok(sample)

  const script = buildDeepSeekSearchVerificationScript(sample)
  const rendered = renderDeepSeekSearchVerificationScript(script)

  assert.equal(script.preconditions.composerMode.deepThink, 'on')
  assert.equal(script.preconditions.composerMode.search, 'on')
  assert.equal(script.expectedOpeningPrefix, '让我先搜索资料...')
  assert.equal(script.promptShape.hasTaskSection, true)
  assert.match(script.prompt, /深度研究一下, 从互联网中收集所需的多个维度信息:/)
  assert.match(script.prompt, /1\./)
  assert.match(script.prompt, /2\./)
  assert.match(script.prompt, /任务:/)
  assert.match(script.prompt, /回复开头为“让我先搜索资料\.\.\.”/)
  assert.match(rendered, /DeepThink=on/)
  assert.match(rendered, /Search=on/)
  assert.match(rendered, /让我先搜索资料\.\.\./)
  assert.match(rendered, /编号维度数:/)
})

void test('opening-prefix matcher tolerates leading whitespace but rejects prefix drift', () => {
  assert.equal(matchesDeepSeekSearchOpeningPrefix('\n  让我先搜索资料...先看近一年的公开来源。'), true)
  assert.equal(matchesDeepSeekSearchOpeningPrefix('让我先整理一下思路，再开始回答。'), false)
  assert.equal(matchesDeepSeekSearchOpeningPrefix(''), false)
  assert.equal(matchesDeepSeekSearchOpeningPrefix(undefined), false)
})
