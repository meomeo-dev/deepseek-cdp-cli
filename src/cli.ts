#!/usr/bin/env node

import { createProgram } from './interfaces/cli/program.js'
import { runBrowserRuntimeProcessCleanup } from './domain/browser/browserRuntimeProcessCleanup.js'
import { formatDeepSeekConsoleError } from './shared/errors/deepSeekFileUploadError.js'

const program = createProgram()
const removeSignalHandlers = installRuntimeCleanupSignalHandlers()

void program.parseAsync(process.argv)
  .catch(error => {
    process.stderr.write(`${formatDeepSeekConsoleError(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    removeSignalHandlers()
  })

function installRuntimeCleanupSignalHandlers(): () => void {
  const cleanup = createOnceAsync(async () => {
    try {
      await runBrowserRuntimeProcessCleanup()
    } catch (error) {
      process.stderr.write(`${formatDeepSeekConsoleError(error)}\n`)
    }
  })
  const handleSignal = (signal: NodeJS.Signals) => {
    void cleanup().finally(() => {
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  return () => {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
  }
}

function createOnceAsync<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null

  return async () => {
    if (!pending) {
      pending = run()
    }

    return pending
  }
}
