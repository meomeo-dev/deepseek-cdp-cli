import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RequestBudgetGate } from '../src/shared/rate-limit/requestBudget.js'

void test('records query count separately from output token usage', () => {
  const gate = new RequestBudgetGate({
    maxQueriesPerMinute: 2,
    maxTokensPerMinute: 100,
  })

  const afterQuery = gate.consumeQuery()
  assert.equal(afterQuery.queriesRemaining, 1)
  assert.equal(afterQuery.tokensRemaining, 100)

  const afterTokens = gate.recordOutputTokens(36)
  assert.equal(afterTokens.queriesRemaining, 1)
  assert.equal(afterTokens.tokensRemaining, 64)
})

void test('blocks new queries when token budget is already exhausted', () => {
  const gate = new RequestBudgetGate({
    maxQueriesPerMinute: 2,
    maxTokensPerMinute: 10,
  })

  gate.consumeQuery()
  gate.recordOutputTokens(12)

  assert.throws(() => gate.consumeQuery(), /TPM budget exceeded/)
})

void test('persists budget state across gate instances and rotates after the next window', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-request-budget-'))
  const stateFilePath = join(tempDir, 'budget.json')
  let nowMs = Date.UTC(2026, 3, 5, 3, 0, 0)
  const now = () => nowMs

  try {
    const firstGate = new RequestBudgetGate(
      {
        maxQueriesPerMinute: 3,
        maxTokensPerMinute: 120,
      },
      {
        stateFilePath,
        now,
      },
    )

    firstGate.consumeQuery()
    firstGate.recordOutputTokens(45)

    const secondGate = new RequestBudgetGate(
      {
        maxQueriesPerMinute: 3,
        maxTokensPerMinute: 120,
      },
      {
        stateFilePath,
        now,
      },
    )

    assert.deepEqual(secondGate.snapshot(), {
      queriesRemaining: 2,
      tokensRemaining: 75,
      resetsAt: new Date(nowMs + 60_000).toISOString(),
    })

    nowMs += 61_000

    const thirdGate = new RequestBudgetGate(
      {
        maxQueriesPerMinute: 3,
        maxTokensPerMinute: 120,
      },
      {
        stateFilePath,
        now,
      },
    )

    assert.deepEqual(thirdGate.snapshot(), {
      queriesRemaining: 3,
      tokensRemaining: 120,
      resetsAt: new Date(nowMs + 60_000).toISOString(),
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
