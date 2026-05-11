import type { ChildProcess } from 'node:child_process'

export interface TerminateChildProcessOptions {
  sigtermTimeoutMs?: number | undefined
}

export async function terminateChildProcess(
  child: ChildProcess,
  options: TerminateChildProcessOptions = {},
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  signalChildProcess(child, 'SIGTERM')

  const exitedAfterSigterm = await waitForChildProcessExit(
    child,
    options.sigtermTimeoutMs ?? 2_000,
  )
  if (exitedAfterSigterm) {
    return
  }

  signalChildProcess(child, 'SIGKILL')
  await waitForChildProcessExit(child, options.sigtermTimeoutMs ?? 2_000)
}

export async function waitForChildProcessExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true
  }

  return new Promise<boolean>(resolve => {
    let settled = false
    const finish = (didExit: boolean) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.off('exit', handleExit)
      child.off('close', handleExit)
      child.off('error', handleError)
      resolve(didExit)
    }
    const handleExit = () => {
      finish(true)
    }
    const handleError = () => {
      finish(true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)

    child.once('exit', handleExit)
    child.once('close', handleExit)
    child.once('error', handleError)

    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true)
    }
  })
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal)
  } catch (error) {
    if (!isProcessNotFoundError(error)) {
      throw error
    }
  }
}

function isProcessNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ESRCH',
  )
}
