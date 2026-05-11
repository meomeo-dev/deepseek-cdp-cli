import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDeepSeekFactCheckVerificationScript,
  findDeepSeekFactCheckPromptSampleById,
  listDeepSeekFactCheckPromptSamples,
  matchesDeepSeekFactCheckOpeningPrefix,
  renderDeepSeekFactCheckVerificationScript,
  validateDeepSeekFactCheckPromptSource,
} from '../src/domain/search/deepSeekFactCheckPromptTemplate.js'

void test('fact-check prompt sample pool is unique and structurally complete', () => {
  const samples = listDeepSeekFactCheckPromptSamples()
  const ids = new Set(samples.map(sample => sample.id))

  assert.equal(samples.length, 3)
  assert.equal(ids.size, samples.length)

  for (const sample of samples) {
    const validation = validateDeepSeekFactCheckPromptSource(sample)
    assert.equal(validation.valid, true, `${sample.id}: ${validation.issues.join(', ')}`)
    assert.ok(sample.tags.length > 0)
    assert.ok(sample.rationale.length > 0)
    assert.ok(sample.claim.length > 0)
  }
})

void test('renders a fact-check verification script with probabilities, structure, and opening prefix', () => {
  const sample = findDeepSeekFactCheckPromptSampleById('deepseek-model-switching-claim-2026q2')
  assert.ok(sample)

  const script = buildDeepSeekFactCheckVerificationScript(sample)
  const rendered = renderDeepSeekFactCheckVerificationScript(script)

  assert.equal(script.preconditions.composerMode.deepThink, 'on')
  assert.equal(script.preconditions.composerMode.search, 'on')
  assert.equal(script.expectedOpeningPrefix, '让我先核查资料...')
  assert.deepEqual(script.probabilityBuckets, ['事实', '谣言', '无法证伪'])
  assert.match(script.prompt, /请对以下待核查陈述做联网事实核查:/)
  assert.match(script.prompt, /待核查陈述:/)
  assert.match(script.prompt, /任务:/)
  assert.match(script.prompt, /输出结构:/)
  assert.match(script.prompt, /开头固定先输出两行：Verdict \/ Probabilities/)
  assert.match(script.prompt, /Probabilities: 事实 XX% \/ 谣言 YY% \/ 无法证伪 ZZ%/)
  assert.match(script.prompt, /事实 \/ 谣言 \/ 无法证伪/)
  assert.match(script.prompt, /回复开头为“让我先核查资料\.\.\.”/)
  assert.match(rendered, /DeepThink=on/)
  assert.match(rendered, /Search=on/)
  assert.match(rendered, /让我先核查资料\.\.\./)
  assert.match(rendered, /概率桶: 事实 \/ 谣言 \/ 无法证伪/)
  assert.match(rendered, /Verdict 与 Probabilities 两行/)
})

void test('fact-check opening-prefix matcher tolerates leading whitespace but rejects prefix drift', () => {
  assert.equal(matchesDeepSeekFactCheckOpeningPrefix('\n  让我先核查资料...先看官方来源。'), true)
  assert.equal(matchesDeepSeekFactCheckOpeningPrefix('让我先搜索资料...'), false)
  assert.equal(matchesDeepSeekFactCheckOpeningPrefix(''), false)
  assert.equal(matchesDeepSeekFactCheckOpeningPrefix(undefined), false)
})
