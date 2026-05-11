import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { DeepSeekSearchRateLimitCoordinator } from '../src/application/services/deepSeekSearchRateLimitCoordinator.js'

void test('search retry coordination waits for running peers to settle before replay', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepseek-search-coordinator-'))
  const coordinator = new DeepSeekSearchRateLimitCoordinator({
    cwd,
    isProcessAlive: () => true,
  })

  const runningLease = await coordinator.openLease()
  const waitingLease = await coordinator.openLease()

  let resolved = false
  const waitForReplay = waitingLease
    .waitForRetryTurn({
      attemptNumber: 1,
      nextAttemptNumber: 2,
      cooldownMs: 0,
    })
    .then(() => {
      resolved = true
    })

  await delay(50)
  assert.equal(resolved, false)

  await runningLease.close()
  await waitForReplay
  assert.equal(resolved, true)

  await waitingLease.close()
})

void test('search retry coordination serializes multiple cooled-down waiters after peers drain', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'deepseek-search-coordinator-'))
  const coordinator = new DeepSeekSearchRateLimitCoordinator({
    cwd,
    isProcessAlive: () => true,
  })

  const runningLease = await coordinator.openLease()
  const olderWaitingLease = await coordinator.openLease()
  await delay(10)
  const newerWaitingLease = await coordinator.openLease()

  let olderResolved = false
  let newerResolved = false

  const olderReplay = olderWaitingLease
    .waitForRetryTurn({
      attemptNumber: 1,
      nextAttemptNumber: 2,
      cooldownMs: 0,
    })
    .then(() => {
      olderResolved = true
    })
  const newerReplay = newerWaitingLease
    .waitForRetryTurn({
      attemptNumber: 1,
      nextAttemptNumber: 2,
      cooldownMs: 0,
    })
    .then(() => {
      newerResolved = true
    })

  await delay(50)
  await runningLease.close()
  await olderReplay
  assert.equal(olderResolved, true)
  assert.equal(newerResolved, false)

  await olderWaitingLease.close()
  await newerReplay
  assert.equal(newerResolved, true)

  await newerWaitingLease.close()
})
