#!/usr/bin/env node

import { CommanderError } from 'commander'
import { createProgram } from './interfaces/cli/program.js'
import { runBrowserRuntimeProcessCleanup } from './domain/browser/browserRuntimeProcessCleanup.js'
import { formatDeepSeekConsoleError } from './shared/errors/deepSeekFileUploadError.js'
import {
  routeCliArgumentsToReply,
} from './interfaces/cli/cliArgumentRouting.js'

const program = createProgram()
const knownCommands = program.commands.map(command => command.name())
const routedArguments = routeCliArgumentsToReply(
  process.argv.slice(2),
  knownCommands,
)
const selectedCommand = routedArguments.find(argument =>
  knownCommands.includes(argument))
const removeSignalHandlers = installRuntimeCleanupSignalHandlers({
  handleSigint: selectedCommand !== 'preferences',
})

void program.parseAsync(routedArguments, { from: 'user' })
  .catch(error => {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode
      return
    }
    process.stderr.write(`${formatDeepSeekConsoleError(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    removeSignalHandlers()
  })

function installRuntimeCleanupSignalHandlers(input: {
  handleSigint: boolean
}): () => void {
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

  if (input.handleSigint) {
    process.on('SIGINT', handleSignal)
  }
  process.on('SIGTERM', handleSignal)

  return () => {
    if (input.handleSigint) {
      process.off('SIGINT', handleSignal)
    }
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
