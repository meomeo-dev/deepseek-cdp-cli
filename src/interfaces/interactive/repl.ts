import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { discoverDeepSeekControls } from '../../application/usecases/discoverDeepSeekControls.js'
import { inspectDeepSeekHomeEntry } from '../../application/usecases/inspectDeepSeekHomeEntry.js'
import { inspectDeepSeekSession } from '../../application/usecases/inspectDeepSeekSession.js'
import { listDeepSeekSessionBranches } from '../../application/usecases/listDeepSeekSessionBranches.js'
import {
  cleanupStaleBrowserRuntimes,
  getBrowserRuntimeStatus,
  listBrowserRuntimes,
  restartBrowserRuntime,
  startBrowserRuntime,
  stopBrowserRuntime,
} from '../../application/usecases/manageBrowserRuntime.js'
import { describeManagedChromeSessionPlan } from '../../application/usecases/describeManagedChromeSessionPlan.js'
import { executeDeepSeekEditMessage } from '../../application/services/executeDeepSeekEditMessage.js'
import { executeDeepSeekContinueMessage } from '../../application/services/executeDeepSeekContinueMessage.js'
import { executeDeepSeekRegenerateMessage } from '../../application/services/executeDeepSeekRegenerateMessage.js'
import { executeDeepSeekReply } from '../../application/services/executeDeepSeekReply.js'
import { resolveBrowserRuntimeOptions } from '../../domain/browser/browserRuntimeResolver.js'
import { normalizeDeepSeekComposerModeRequest } from '../../infrastructure/deepseek/deepSeekComposerMode.js'
import { describeKnownDeepSeekApiSurface } from '../../infrastructure/deepseek/deepSeekApiCatalog.js'
import { formatDeepSeekConsoleError } from '../../shared/errors/deepSeekFileUploadError.js'
import {
  applyDeepSeekInteractiveOutputModeCommand,
  createDeepSeekInteractiveOutputModeState,
  serializeDeepSeekInteractiveOutputModeState,
} from './deepSeekInteractiveOutputMode.js'
import {
  applyDeepSeekInteractiveRetryModeCommand,
  createDeepSeekInteractiveRetryModeState,
  serializeDeepSeekInteractiveRetryModeState,
} from './deepSeekInteractiveRetryMode.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  DeepSeekComposerChatModeTargetState,
  DeepSeekComposerModeInput,
  DeepSeekComposerModeRequest,
  DeepSeekComposerToggleTargetState,
} from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'
import type {
  DeepSeekReplyExecutionResult,
  DeepSeekReplyLiveEvent,
  DeepSeekReplyRetryProgressInput,
  DeepSeekReplyRetryOptionInput,
} from '../../types/deepseek-reply-output.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { BrowserRuntimePurpose } from '../../types/browser-runtime.types.js'
import type { BrowserRuntimeStartCommandInput } from '../../types/browser-runtime-management.types.js'
import type { DeepSeekInteractiveOutputModeInput } from './deepSeekInteractiveOutputMode.js'
import {
  createDeepSeekInteractiveOutputWriter,
  createDeepSeekInteractiveRealtimeOutputController,
  writeDeepSeekInteractiveReplyOutput,
} from './deepSeekInteractiveReplyOutput.js'
import {
  bindStartedInteractiveBrowserRuntime,
  clearInteractiveBrowserRuntimeBinding,
  createInteractiveBrowserRuntimeBinding,
  deriveInteractiveShellBaseManagedChromeOptions,
  resolveInteractiveShellManagedChromeOptions,
  shouldPinStartedInteractiveBrowserRuntime,
} from './interactiveBrowserRuntimeBinding.js'
import { buildInteractiveShellHelpText } from './interactiveHelpText.js'
import { DEFAULT_CLI_TIMEOUT_MS } from '../cli/cliDefaults.js'

const DEFAULT_MANAGED_CHROME_OPTIONS: ManagedChromeOptions = {
  cdpUrl: 'http://127.0.0.1:9222',
  timeoutMs: DEFAULT_CLI_TIMEOUT_MS,
  cloneChromeProfile: false,
  headless: false,
  keepTempChromeProfile: false,
}

export interface InteractiveShellOptions {
  managedChromeOptions?: ManagedChromeOptions | undefined
  composerMode?: DeepSeekComposerModeInput | undefined
  outputMode?: DeepSeekInteractiveOutputModeInput | undefined
  retryMode?: DeepSeekReplyRetryOptionInput | undefined
  sessionStoreDir?: string | undefined
  url?: string | undefined
  waitUntil?: WaitUntil | undefined
  logger?: RuntimeLogger | undefined
}

export async function runInteractiveShell(options: InteractiveShellOptions = {}): Promise<void> {
  const initialManagedChromeOptions = options.managedChromeOptions?.browserRuntime
    ? options.managedChromeOptions
    : resolveBrowserRuntimeOptions(
        options.managedChromeOptions ?? DEFAULT_MANAGED_CHROME_OPTIONS,
        { entrypoint: 'interactive' },
      )
  const baseManagedChromeOptions =
    deriveInteractiveShellBaseManagedChromeOptions(initialManagedChromeOptions)
  let browserRuntimeBinding =
    createInteractiveBrowserRuntimeBinding(initialManagedChromeOptions)
  let managedChromeOptions = resolveInteractiveShellManagedChromeOptions(
    baseManagedChromeOptions,
    browserRuntimeBinding,
  )
  const logger = options.logger ?? new RuntimeLogger({ level: 'info', scope: 'interactive' })
  let composerMode = normalizeDeepSeekComposerModeRequest(options.composerMode)
  let outputMode = createDeepSeekInteractiveOutputModeState(options.outputMode)
  let retryMode = createDeepSeekInteractiveRetryModeState(options.retryMode)
  let queuedFiles: string[] = []
  const sessionStoreDir = options.sessionStoreDir ?? '.deepseek-cdp-cli/sessions'
  const url = options.url ?? 'https://chat.deepseek.com/'
  const waitUntil = options.waitUntil ?? 'domcontentloaded'

  const shell = readline.createInterface({
    input: stdin,
    output: stdout,
  })

  stdout.write('deepseek interactive shell. Type `help` for grouped commands.\n')

  try {
    while (true) {
      let line: string
      try {
        line = (await shell.question('deepseek> ')).trim()
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ERR_USE_AFTER_CLOSE'
        ) {
          break
        }
        throw error
      }

      if (!line) {
        continue
      }

      if (line === 'exit' || line === 'quit') {
        break
      }

      try {
        if (line === 'help') {
          stdout.write(buildInteractiveShellHelpText())
          continue
        }

        if (line === 'mode') {
          stdout.write(`${JSON.stringify(composerMode, null, 2)}\n`)
          continue
        }

        if (line === 'output') {
          stdout.write(`${serializeDeepSeekInteractiveOutputModeState(outputMode)}\n`)
          continue
        }

        if (line === 'files') {
          stdout.write(`${JSON.stringify(queuedFiles, null, 2)}\n`)
          continue
        }

        if (line === 'retry') {
          stdout.write(`${serializeDeepSeekInteractiveRetryModeState(retryMode)}\n`)
          continue
        }

        if (line.startsWith('mode ')) {
          const [target, nextState] = line.slice('mode '.length).trim().split(/\s+/, 2)
          if (target === 'reset') {
            composerMode = normalizeDeepSeekComposerModeRequest()
            stdout.write(`${JSON.stringify(composerMode, null, 2)}\n`)
            continue
          }

          if (target === 'chat') {
            if (!isComposerChatModeTargetState(nextState)) {
              stdout.write(
                'Usage: mode chat <instant|expert|vision|unchanged> | mode [deepthink|search|all] <on|off|unchanged> | mode reset\n',
              )
              continue
            }

            composerMode = {
              ...composerMode,
              chatMode: nextState,
            }
            stdout.write(`${JSON.stringify(composerMode, null, 2)}\n`)
            continue
          }

          if (!isComposerModeTarget(target) || !isComposerToggleState(nextState)) {
            stdout.write(
              'Usage: mode chat <instant|expert|vision|unchanged> | mode [deepthink|search|all] <on|off|unchanged> | mode reset\n',
            )
            continue
          }

          composerMode = applyComposerModeSelection(composerMode, target, nextState)
          stdout.write(`${JSON.stringify(composerMode, null, 2)}\n`)
          continue
        }

        if (line.startsWith('output ')) {
          outputMode = applyDeepSeekInteractiveOutputModeCommand(
            outputMode,
            line.slice('output '.length).trim(),
          )
          stdout.write(`${serializeDeepSeekInteractiveOutputModeState(outputMode)}\n`)
          continue
        }

        if (line.startsWith('retry ')) {
          retryMode = applyDeepSeekInteractiveRetryModeCommand(
            retryMode,
            line.slice('retry '.length).trim(),
          )
          stdout.write(`${serializeDeepSeekInteractiveRetryModeState(retryMode)}\n`)
          continue
        }

        if (line === 'files clear') {
          queuedFiles = []
          stdout.write(`${JSON.stringify(queuedFiles, null, 2)}\n`)
          continue
        }

        if (line.startsWith('files add ')) {
          const nextPath = line.slice('files add '.length).trim()
          if (!nextPath) {
            stdout.write('Usage: files add <path>\n')
            continue
          }

          queuedFiles = queueInteractiveFilePath(queuedFiles, nextPath)
          stdout.write(`${JSON.stringify(queuedFiles, null, 2)}\n`)
          continue
        }

        if (line.startsWith('files remove ')) {
          const nextPath = line.slice('files remove '.length).trim()
          if (!nextPath) {
            stdout.write('Usage: files remove <path>\n')
            continue
          }

          queuedFiles = queuedFiles.filter(path => path !== nextPath)
          stdout.write(`${JSON.stringify(queuedFiles, null, 2)}\n`)
          continue
        }

        if (line === 'endpoints') {
          stdout.write(`${JSON.stringify(describeKnownDeepSeekApiSurface(), null, 2)}\n`)
          continue
        }

        if (line === 'plan') {
          stdout.write(
            `${JSON.stringify(describeManagedChromeSessionPlan(managedChromeOptions), null, 2)}\n`,
          )
          continue
        }

        if (line === 'browser list') {
          stdout.write(
            `${JSON.stringify(await listBrowserRuntimes({}, logger.child('browser-list')), null, 2)}\n`,
          )
          continue
        }

        if (line === 'browser cleanup-stale') {
          stdout.write(
            `${JSON.stringify(
              await cleanupStaleBrowserRuntimes({}, logger.child('browser-cleanup-stale')),
              null,
              2,
            )}\n`,
          )
          continue
        }

        if (line.startsWith('browser start')) {
          const purpose = parseInteractiveBrowserStartPurpose(line)
          if (purpose === null) {
            stdout.write('Usage: browser start [primary|probe|regression|audit]\n')
            continue
          }

          const started = await startBrowserRuntime(
            {
              ...buildInteractiveBrowserRuntimeStartInput(baseManagedChromeOptions, purpose),
              entrypoint: 'interactive',
            },
            logger.child('browser-start'),
          )
          browserRuntimeBinding = bindStartedInteractiveBrowserRuntime(
            browserRuntimeBinding,
            {
              browserId: started.runtime.browserId,
              purpose: started.runtime.purpose,
            },
          )
          managedChromeOptions = resolveInteractiveShellManagedChromeOptions(
            baseManagedChromeOptions,
            browserRuntimeBinding,
          )
          stdout.write(
            `${JSON.stringify(started, null, 2)}\n`,
          )
          if (
            browserRuntimeBinding?.browserId === started.runtime.browserId &&
            shouldPinStartedInteractiveBrowserRuntime(started.runtime.purpose)
          ) {
            stdout.write(
              `Interactive shell now uses browser runtime ${started.runtime.browserId} for subsequent commands.\n`,
            )
          }
          continue
        }

        if (line.startsWith('browser status ')) {
          const browserId = line.slice('browser status '.length).trim()
          if (!browserId) {
            stdout.write('Usage: browser status <browserId>\n')
            continue
          }

          stdout.write(
            `${JSON.stringify(
              await getBrowserRuntimeStatus(
                {
                  browserId,
                },
                logger.child('browser-status'),
              ),
              null,
              2,
            )}\n`,
          )
          continue
        }

        if (line.startsWith('browser stop ')) {
          const parsed = parseInteractiveBrowserIdCommand(line, 'browser stop')
          if (!parsed) {
            stdout.write('Usage: browser stop <browserId> [force]\n')
            continue
          }

          const stopped = await stopBrowserRuntime(
            parsed,
            logger.child('browser-stop'),
          )
          const previousBinding = browserRuntimeBinding
          browserRuntimeBinding = clearInteractiveBrowserRuntimeBinding(
            browserRuntimeBinding,
            parsed.browserId,
          )
          managedChromeOptions = resolveInteractiveShellManagedChromeOptions(
            baseManagedChromeOptions,
            browserRuntimeBinding,
          )
          stdout.write(
            `${JSON.stringify(stopped, null, 2)}\n`,
          )
          if (
            previousBinding?.browserId === parsed.browserId &&
            browserRuntimeBinding === null
          ) {
            stdout.write('Interactive shell cleared the active browser runtime binding.\n')
          }
          continue
        }

        if (line.startsWith('browser restart ')) {
          const parsed = parseInteractiveBrowserIdCommand(line, 'browser restart')
          if (!parsed) {
            stdout.write('Usage: browser restart <browserId> [force]\n')
            continue
          }

          const restarted = await restartBrowserRuntime(
            parsed,
            logger.child('browser-restart'),
          )
          if (browserRuntimeBinding?.browserId === parsed.browserId) {
            browserRuntimeBinding = {
              browserId: restarted.runtime.browserId,
              purpose: restarted.runtime.purpose,
            }
            managedChromeOptions = resolveInteractiveShellManagedChromeOptions(
              baseManagedChromeOptions,
              browserRuntimeBinding,
            )
          }
          stdout.write(
            `${JSON.stringify(restarted, null, 2)}\n`,
          )
          if (browserRuntimeBinding?.browserId === restarted.runtime.browserId) {
            stdout.write(
              `Interactive shell continues to use browser runtime ${restarted.runtime.browserId}.\n`,
            )
          }
          continue
        }

        if (line === 'inspect-controls') {
          const snapshot = await discoverDeepSeekControls(
            {
              ...managedChromeOptions,
              url,
              waitUntil,
              stabilize: true,
              composerMode,
            },
            logger.child('inspect-controls'),
          )
          stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
          continue
        }

        if (line.startsWith('inspect-session ')) {
          const sessionId = line.slice('inspect-session '.length).trim()
          if (!sessionId) {
            stdout.write('Usage: inspect-session <sessionId>\n')
            continue
          }
          const result = await inspectDeepSeekSession(
            {
              ...managedChromeOptions,
              sessionId,
              sessionStoreDir,
              waitUntil,
            },
            logger.child('inspect-session'),
          )
          stdout.write(`${JSON.stringify(result, null, 2)}\n`)
          continue
        }

        if (line.startsWith('reply-session ')) {
          const payload = line.slice('reply-session '.length).trim()
          const firstSpace = payload.indexOf(' ')
          if (firstSpace <= 0) {
            stdout.write('Usage: reply-session <sessionId> <text>\n')
            continue
          }
          const sessionId = payload.slice(0, firstSpace).trim()
          const prompt = payload.slice(firstSpace + 1).trim()
          if (!sessionId || !prompt) {
            stdout.write('Usage: reply-session <sessionId> <text>\n')
            continue
          }
          const outputRuntime = createInteractiveReplyOutputRuntime(outputMode.resolved)
          try {
            const delivery = await executeDeepSeekReply(
              {
                reply: {
                  ...managedChromeOptions,
                  prompt,
                  ...(queuedFiles.length > 0 ? { files: [...queuedFiles] } : {}),
                  sessionId,
                  sessionStoreDir,
                  waitUntil,
                  composerMode,
                },
                output: outputMode.requested,
                retry: retryMode.requested,
                ...buildInteractiveReplyProgressOption(outputRuntime),
                ...buildInteractiveReplyLiveOption(outputRuntime),
              },
              logger.child('reply-session'),
            )
            queuedFiles = []
            writeInteractiveReplyExecutionResult(outputRuntime, delivery)
          } finally {
            outputRuntime.writer.flushPendingLine()
          }
          continue
        }

        if (line.startsWith('edit-message ')) {
          const payload = line.slice('edit-message '.length).trim()
          const firstSpace = payload.indexOf(' ')
          const secondSpace = firstSpace < 0 ? -1 : payload.indexOf(' ', firstSpace + 1)
          if (firstSpace <= 0 || secondSpace <= firstSpace + 1) {
            stdout.write('Usage: edit-message <sessionId> <messageId> <text>\n')
            continue
          }

          const sessionId = payload.slice(0, firstSpace).trim()
          const messageId = payload.slice(firstSpace + 1, secondSpace).trim()
          const prompt = payload.slice(secondSpace + 1).trim()
          if (!sessionId || !messageId || !prompt) {
            stdout.write('Usage: edit-message <sessionId> <messageId> <text>\n')
            continue
          }

          const outputRuntime = createInteractiveReplyOutputRuntime(outputMode.resolved)
          try {
            const delivery = await executeDeepSeekEditMessage(
              {
                edit: {
                  ...managedChromeOptions,
                  prompt,
                  sessionId,
                  sessionStoreDir,
                  messageId,
                  waitUntil,
                  composerMode,
                },
                output: outputMode.requested,
                ...buildInteractiveReplyLiveOption(outputRuntime),
              },
              logger.child('edit-message'),
            )
            writeInteractiveReplyExecutionResult(outputRuntime, delivery)
          } finally {
            outputRuntime.writer.flushPendingLine()
          }
          continue
        }

        if (line.startsWith('continue-message ')) {
          const payload = line.slice('continue-message '.length).trim()
          const segments = payload.split(/\s+/).filter(Boolean)
          if (segments.length < 2 || segments.length > 4) {
            stdout.write(
              'Usage: continue-message <sessionId> <messageId> [branchId] [activeBranchId]\n',
            )
            continue
          }
          const sessionId = segments[0] ?? ''
          const messageId = segments[1] ?? ''
          const branchId = segments[2]
          const activeBranchId = segments[3]

          const outputRuntime = createInteractiveReplyOutputRuntime(outputMode.resolved)
          try {
            const delivery = await executeDeepSeekContinueMessage(
              {
                continue: {
                  ...managedChromeOptions,
                  sessionId,
                  sessionStoreDir,
                  messageId,
                  ...(branchId ? { branchId } : {}),
                  ...(activeBranchId ? { activeBranchId } : {}),
                  waitUntil,
                },
                output: outputMode.requested,
                ...buildInteractiveReplyLiveOption(outputRuntime),
              },
              logger.child('continue-message'),
            )
            writeInteractiveReplyExecutionResult(outputRuntime, delivery)
          } finally {
            outputRuntime.writer.flushPendingLine()
          }
          continue
        }

        if (line.startsWith('reply ')) {
          const prompt = line.slice('reply '.length).trim()
          if (!prompt) {
            stdout.write('Usage: reply <text>\n')
            continue
          }
          const outputRuntime = createInteractiveReplyOutputRuntime(outputMode.resolved)
          try {
            const delivery = await executeDeepSeekReply(
              {
                reply: {
                  ...managedChromeOptions,
                  prompt,
                  ...(queuedFiles.length > 0 ? { files: [...queuedFiles] } : {}),
                  url,
                  sessionStoreDir,
                  waitUntil,
                  composerMode,
                },
                output: outputMode.requested,
                retry: retryMode.requested,
                ...buildInteractiveReplyProgressOption(outputRuntime),
                ...buildInteractiveReplyLiveOption(outputRuntime),
              },
              logger.child('reply'),
            )
            queuedFiles = []
            writeInteractiveReplyExecutionResult(outputRuntime, delivery)
          } finally {
            outputRuntime.writer.flushPendingLine()
          }
          continue
        }

        if (line.startsWith('regenerate-message ')) {
          const payload = line.slice('regenerate-message '.length).trim()
          const firstSpace = payload.indexOf(' ')
          if (firstSpace <= 0) {
            stdout.write('Usage: regenerate-message <sessionId> <messageId>\n')
            continue
          }

          const sessionId = payload.slice(0, firstSpace).trim()
          const messageId = payload.slice(firstSpace + 1).trim()
          if (!sessionId || !messageId) {
            stdout.write('Usage: regenerate-message <sessionId> <messageId>\n')
            continue
          }

          const outputRuntime = createInteractiveReplyOutputRuntime(outputMode.resolved)
          try {
            const delivery = await executeDeepSeekRegenerateMessage(
              {
                regenerate: {
                  ...managedChromeOptions,
                  sessionId,
                  sessionStoreDir,
                  messageId,
                  waitUntil,
                  composerMode,
                },
                output: outputMode.requested,
                ...buildInteractiveReplyLiveOption(outputRuntime),
              },
              logger.child('regenerate-message'),
            )
            writeInteractiveReplyExecutionResult(outputRuntime, delivery)
          } finally {
            outputRuntime.writer.flushPendingLine()
          }
          continue
        }

        if (line.startsWith('list-branches ')) {
          const sessionId = line.slice('list-branches '.length).trim()
          if (!sessionId) {
            stdout.write('Usage: list-branches <sessionId>\n')
            continue
          }
          const result = await listDeepSeekSessionBranches({
            sessionId,
            sessionStoreDir,
          })
          stdout.write(`${JSON.stringify(result, null, 2)}\n`)
          continue
        }

        if (line.startsWith('send-first-message ')) {
          const prompt = line.slice('send-first-message '.length).trim()
          if (!prompt) {
            stdout.write('Usage: send-first-message <text>\n')
            continue
          }
          const outputRuntime = createInteractiveReplyOutputRuntime(outputMode.resolved)
          try {
            const delivery = await executeDeepSeekReply(
              {
                reply: {
                  ...managedChromeOptions,
                  url,
                  prompt,
                  ...(queuedFiles.length > 0 ? { files: [...queuedFiles] } : {}),
                  sessionStoreDir,
                  waitUntil,
                  composerMode,
                },
                output: outputMode.requested,
                retry: retryMode.requested,
                ...buildInteractiveReplyProgressOption(outputRuntime),
                ...buildInteractiveReplyLiveOption(outputRuntime),
              },
              logger.child('send-first-message'),
            )
            queuedFiles = []
            writeInteractiveReplyExecutionResult(outputRuntime, delivery)
          } finally {
            outputRuntime.writer.flushPendingLine()
          }
          continue
        }

        if (line === 'inspect-home') {
          const result = await inspectDeepSeekHomeEntry(
            {
              ...managedChromeOptions,
              url,
              waitUntil,
            },
            logger.child('inspect-home'),
          )
          stdout.write(`${JSON.stringify(result, null, 2)}\n`)
          continue
        }

        stdout.write(`Unknown command: ${line}\n`)
      } catch (error) {
        stdout.write(`Error: ${formatDeepSeekConsoleError(error)}\n`)
      }
    }
  } finally {
    shell.close()
  }
}

function isComposerModeTarget(value: string | undefined): value is 'deepthink' | 'search' | 'all' {
  return value === 'deepthink' || value === 'search' || value === 'all'
}

function isComposerChatModeTargetState(
  value: string | undefined,
): value is DeepSeekComposerChatModeTargetState {
  return (
    value === 'instant' ||
    value === 'expert' ||
    value === 'vision' ||
    value === 'unchanged'
  )
}

function isComposerToggleState(
  value: string | undefined,
): value is DeepSeekComposerToggleTargetState {
  return value === 'on' || value === 'off' || value === 'unchanged'
}

function applyComposerModeSelection(
  current: DeepSeekComposerModeRequest,
  target: 'deepthink' | 'search' | 'all',
  nextState: DeepSeekComposerToggleTargetState,
): DeepSeekComposerModeRequest {
  if (target === 'all') {
    return {
      ...current,
      deepThink: nextState,
      search: nextState,
    }
  }

  return {
    ...current,
    ...(target === 'deepthink' ? { deepThink: nextState } : { search: nextState }),
  }
}

function queueInteractiveFilePath(current: string[], nextPath: string): string[] {
  if (current.includes(nextPath)) {
    return current
  }

  return [...current, nextPath]
}

function createInteractiveReplyOutputRuntime(outputMode: DeepSeekResolvedOutputMode) {
  const writer = createDeepSeekInteractiveOutputWriter({
    write: chunk => stdout.write(chunk),
    isTTY: stdout.isTTY === true,
  })
  const liveOutput = createDeepSeekInteractiveRealtimeOutputController({
    outputMode,
    outputWriter: writer,
  })

  return {
    writer,
    liveOutput,
  }
}

function buildInteractiveReplyLiveOption(
  runtime: ReturnType<typeof createInteractiveReplyOutputRuntime>,
): {
  live?: {
    onEvent: (event: DeepSeekReplyLiveEvent) => void
  }
} {
  if (!runtime.liveOutput.enabled) {
    return {}
  }

  return {
    live: {
      onEvent: event => runtime.liveOutput.onEvent(event),
    },
  }
}

function buildInteractiveReplyProgressOption(
  runtime: ReturnType<typeof createInteractiveReplyOutputRuntime>,
): {
  progress?: DeepSeekReplyRetryProgressInput
} {
  if (runtime.liveOutput.enabled) {
    return {}
  }

  return {
    progress: {
      onEvent: runtime.writer.createRetryNoticeHandler(),
    },
  }
}

function writeInteractiveReplyExecutionResult(
  runtime: ReturnType<typeof createInteractiveReplyOutputRuntime>,
  delivery: DeepSeekReplyExecutionResult,
): void {
  if (runtime.liveOutput.enabled) {
    runtime.liveOutput.writeFinalResult(delivery.result)
    return
  }

  writeInteractiveReplyResult(
    delivery.result,
    delivery.outputMode,
    runtime.writer.writeReplyChunk,
  )
}

function writeInteractiveReplyResult(
  result: DeepSeekReplyResult,
  outputMode: DeepSeekResolvedOutputMode,
  write: ((chunk: string) => void) = chunk => stdout.write(chunk),
): void {
  writeDeepSeekInteractiveReplyOutput({
    result,
    outputMode,
    write,
  })
}

function buildInteractiveBrowserRuntimeStartInput(
  managedChromeOptions: ManagedChromeOptions,
  purpose: BrowserRuntimePurpose,
): BrowserRuntimeStartCommandInput {
  return {
    cdpUrl: managedChromeOptions.cdpUrl,
    timeoutMs: managedChromeOptions.timeoutMs,
    headless: managedChromeOptions.headless,
    proxyServer: managedChromeOptions.proxyServer,
    chromeExecutablePath: managedChromeOptions.chromeExecutablePath,
    chromeUserDataDir: managedChromeOptions.chromeUserDataDir,
    chromeProfileDirectory: managedChromeOptions.chromeProfileDirectory,
    keepTempChromeProfile: managedChromeOptions.keepTempChromeProfile,
    browserPurpose: purpose,
  }
}

function parseInteractiveBrowserStartPurpose(
  line: string,
): BrowserRuntimePurpose | null {
  const segments = line.split(/\s+/).filter(Boolean)
  if (segments.length === 2) {
    return 'primary'
  }

  if (segments.length !== 3) {
    return null
  }

  return isBrowserRuntimePurpose(segments[2]) ? segments[2] : null
}

function parseInteractiveBrowserIdCommand(
  line: string,
  prefix: 'browser stop' | 'browser restart',
): { browserId: string; force: boolean } | null {
  const payload = line.slice(prefix.length).trim()
  const segments = payload.split(/\s+/).filter(Boolean)
  if (segments.length < 1 || segments.length > 2) {
    return null
  }
  if (segments.length === 2 && segments[1] !== 'force') {
    return null
  }

  return {
    browserId: segments[0] ?? '',
    force: segments[1] === 'force',
  }
}

function isBrowserRuntimePurpose(value: string | undefined): value is BrowserRuntimePurpose {
  return value === 'primary' || value === 'probe' || value === 'regression' || value === 'audit'
}
