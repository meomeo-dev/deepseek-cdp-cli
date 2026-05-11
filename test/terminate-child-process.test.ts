import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { ChildProcess } from 'node:child_process'
import { terminateChildProcess } from '../src/shared/runtime/terminateChildProcess.js'

class FakeChildProcess extends EventEmitter {
  public pid: number | undefined
  public exitCode: number | null = null
  public signalCode: NodeJS.Signals | null = null
  public readonly signals: NodeJS.Signals[] = []
  public onKill: ((signal: NodeJS.Signals) => void) | null = null

  public constructor(pid = 43210) {
    super()
    this.pid = pid
  }

  public kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal)
    this.onKill?.(signal)
    return true
  }
}

void test('terminateChildProcess stops after SIGTERM when the child exits promptly', async () => {
  const child = new FakeChildProcess()
  child.onKill = signal => {
    if (signal === 'SIGTERM') {
      child.signalCode = 'SIGTERM'
      queueMicrotask(() => child.emit('exit'))
    }
  }

  await terminateChildProcess(child as unknown as ChildProcess, {
    sigtermTimeoutMs: 10,
  })

  assert.deepEqual(child.signals, ['SIGTERM'])
})

void test('terminateChildProcess escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const child = new FakeChildProcess()
  child.onKill = signal => {
    if (signal === 'SIGKILL') {
      child.signalCode = 'SIGKILL'
      queueMicrotask(() => child.emit('exit'))
    }
  }

  await terminateChildProcess(child as unknown as ChildProcess, {
    sigtermTimeoutMs: 1,
  })

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
})
