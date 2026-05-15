import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { discoverDeepSeekControls } from '../../application/usecases/discoverDeepSeekControls.js'
import {
  buildDeleteDeepSeekSessionActionLabel,
  buildDeleteDeepSeekSessionConfirmationText,
  deleteDeepSeekSession,
  DEEPSEEK_DELETE_SESSION_ALLOW_OPTION,
} from '../../application/usecases/deleteDeepSeekSession.js'
import { describeDeepSeekReleaseAdapterBoundaries } from '../../application/usecases/describeDeepSeekReleaseAdapterBoundaries.js'
import { describeDeepSeekReleaseChangeLedger } from '../../application/usecases/describeDeepSeekReleaseChangeLedger.js'
import { describeDeepSeekReleaseHandoffMatrix } from '../../application/usecases/describeDeepSeekReleaseHandoffMatrix.js'
import { describeDeepSeekReleaseAudit } from '../../application/usecases/describeDeepSeekReleaseAudit.js'
import { describeDeepSeekReleaseRevalidation } from '../../application/usecases/describeDeepSeekReleaseRevalidation.js'
import { diffDeepSeekReleaseArtifacts } from '../../application/usecases/diffDeepSeekReleaseArtifacts.js'
import { auditDeepSeekChatModes } from '../../application/usecases/auditDeepSeekChatModes.js'
import { auditDeepSeekEndpointDrift } from '../../application/usecases/auditDeepSeekEndpointDrift.js'
import { auditDeepSeekOutputDrift } from '../../application/usecases/auditDeepSeekOutputDrift.js'
import { auditDeepSeekSelectorDrift } from '../../application/usecases/auditDeepSeekSelectorDrift.js'
import { exportConversation } from '../../application/usecases/exportConversation.js'
import { inspectDeepSeekHomeEntry } from '../../application/usecases/inspectDeepSeekHomeEntry.js'
import { inspectDeepSeekSession } from '../../application/usecases/inspectDeepSeekSession.js'
import { listDeepSeekSessions } from '../../application/usecases/listDeepSeekSessions.js'
import { listDeepSeekSessionBranches } from '../../application/usecases/listDeepSeekSessionBranches.js'
import { syncDeepSeekSession } from '../../application/usecases/syncDeepSeekSession.js'
import {
  cleanupStaleBrowserRuntimes,
  getBrowserRuntimeStatus,
  listBrowserRuntimes,
  restartBrowserRuntime,
  startBrowserRuntime,
  stopBrowserRuntime,
} from '../../application/usecases/manageBrowserRuntime.js'
import {
  loginDeepSeekAuthProfile,
  logoutDeepSeekAuthProfile,
} from '../../application/usecases/manageDeepSeekAuth.js'
import { describeManagedChromeSessionPlan } from '../../application/usecases/describeManagedChromeSessionPlan.js'
import { prepareDeepSeekContinueTarget } from '../../application/usecases/prepareDeepSeekContinueTarget.js'
import { triageDeepSeekReleaseArtifacts } from '../../application/usecases/triageDeepSeekReleaseArtifacts.js'
import { executeDeepSeekReply } from '../../application/services/executeDeepSeekReply.js'
import { executeDeepSeekEditMessage } from '../../application/services/executeDeepSeekEditMessage.js'
import { executeDeepSeekContinueMessage } from '../../application/services/executeDeepSeekContinueMessage.js'
import { executeDeepSeekRegenerateMessage } from '../../application/services/executeDeepSeekRegenerateMessage.js'
import { describeKnownDeepSeekApiSurface } from '../../infrastructure/deepseek/deepSeekApiCatalog.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'
import {
  DEEPSEEK_IDLE_WATCH_CWD_ENV,
  DEEPSEEK_IDLE_WATCH_RUNTIME_DIR_ENV,
  runBrowserRuntimeIdleWatchdog,
} from '../../domain/browser/browserRuntimeIdleWatchdog.js'
import { resolveBrowserRuntimeOptions } from '../../domain/browser/browserRuntimeResolver.js'
import {
  createDeepSeekCliRealtimeOutputController,
  resolveDeepSeekCliOutputMode,
  writeDeepSeekCliOutput,
} from './deepSeekCliOutput.js'
import {
  formatDeepSeekSessionSyncText,
  formatDeepSeekSessionSyncWarningsText,
} from './deepSeekSessionSyncCli.js'
import {
  applyCliCommandSummaries,
  attachAuthHelp,
  attachBrowserHelp,
  attachBrowserStartHelp,
  attachCliRootHelp,
  attachContinueMessageHelp,
  attachDeleteSessionHelp,
  attachEndpointDriftAuditHelp,
  attachEditMessageHelp,
  attachExportSessionHelp,
  attachInteractiveHelp,
  attachListBranchesHelp,
  attachListSessionsHelp,
  attachModeAuditHelp,
  attachOutputDriftAuditHelp,
  attachPlanHelp,
  attachPrepareContinueHelp,
  attachRegenerateMessageHelp,
  attachReleaseAuditHelp,
  attachReleaseHandoffMatrixHelp,
  attachReleaseRevalidateHelp,
  attachReplyHelp,
  attachSendFirstMessageHelp,
  attachSelectorDriftAuditHelp,
  attachServeHelp,
  attachSyncSessionHelp,
} from './cliHelpText.js'
import { runInteractiveShell } from '../interactive/repl.js'
import { serveJsonRpc } from '../rpc/jsonRpcServer.js'
import { RuntimeLogger, resolveLogLevel } from '../../shared/logging/runtimeLogger.js'
import { ensureCliDestructiveActionConfirmed } from '../../shared/runtime/destructiveActionGuard.js'
import { createDeepSeekReplyRetryNoticeHandler } from '../../shared/runtime/deepSeekReplyRetryNotice.js'
import { resolveDeepSeekAuthChromeUserDataDirIfReady } from '../../shared/runtime/deepSeekAuthProfile.js'
import {
  DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
  DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR,
} from '../../shared/deepSeekReleaseEvidencePaths.js'
import { resolveServeHttpOptions } from '../http/httpServiceConfig.js'
import {
  DEFAULT_OPENAI_HTTP_CDP_URL,
  DEFAULT_OPENAI_HTTP_SESSION_STORE_DIR,
  DEFAULT_OPENAI_HTTP_TARGET_URL,
  DEFAULT_OPENAI_HTTP_TIMEOUT_MS,
  DEFAULT_OPENAI_HTTP_WAIT_UNTIL,
} from '../http/openaiHttpExecutionEnvironment.js'
import { DEFAULT_CLI_TIMEOUT_MS } from './cliDefaults.js'
import type { OpenAIHttpRouteOptions } from '../http/openaiHttpRoutes.js'
import type {
  DeepSeekComposerChatModeTargetState,
  DeepSeekComposerModeRequest,
  DeepSeekComposerToggleTargetState,
} from '../../types/deepseek-composer-mode.types.js'
import type {
  BrowserRuntimeEntrypoint,
  BrowserRuntimePurpose,
} from '../../types/browser-runtime.types.js'
import type { ManagedChromeOptions, WaitUntil } from '../../types/managed-chrome.types.js'
import type { BrowserRuntimeStartCommandInput } from '../../types/browser-runtime-management.types.js'
import type {
  DeepSeekSessionCatalogResult,
  DeepSeekSessionCatalogWarning,
} from '../../types/deepseek-session-catalog.types.js'
import type { DeepSeekResolvedOutputMode } from '../../types/deepseek-output-modes.types.js'
import type { OpenAIHttpExecutionEnvironment } from '../../types/openai-http-service.types.js'

const DEFAULT_CDP_URL = DEFAULT_OPENAI_HTTP_CDP_URL
const CLI_MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CLI_GITHUB_URL = 'https://github.com/meomeo-dev/deepseek-cdp-cli'
const DEFAULT_UNCHANGED_COMPOSER_MODE_OPTIONS = {
  chatMode: 'unchanged',
  deepThink: 'unchanged',
  search: 'unchanged',
} as const
const DEFAULT_REPLY_COMPOSER_MODE_OPTIONS = {
  chatMode: 'expert',
  deepThink: 'on',
  search: 'on',
} as const

function resolveBundledProjectFile(relativePath: string): string {
  let currentDir = CLI_MODULE_DIR
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(currentDir, relativePath)
    if (existsSync(candidate)) {
      return candidate
    }
    const parentDir = resolve(currentDir, '..')
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }

  throw new Error(`Unable to locate bundled project file: ${relativePath}`)
}

interface CliPackageMetadata {
  name: string
  version: string
  license: string
}

function readCliPackageMetadata(): CliPackageMetadata {
  const raw = JSON.parse(
    readFileSync(resolveBundledProjectFile('package.json'), 'utf8'),
  ) as {
    name?: unknown
    version?: unknown
    license?: unknown
  }

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'deepseek-cdp-cli',
    version: typeof raw.version === 'string' && raw.version.trim() ? raw.version : 'unknown',
    license: typeof raw.license === 'string' && raw.license.trim() ? raw.license : 'UNSPECIFIED',
  }
}

function buildCliVersionInfo(metadata = readCliPackageMetadata()) {
  return {
    name: metadata.name,
    version: metadata.version,
    github: CLI_GITHUB_URL,
    license: metadata.license,
  }
}

function formatCliVersionInfoText(info = buildCliVersionInfo()): string {
  return [
    `Name: ${info.name}`,
    `Version: ${info.version}`,
    `GitHub: ${info.github}`,
    `License: ${info.license}`,
  ].join('\n')
}

function collectStringOption(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

function addManagedChromeOptions(command: Command): Command {
  return command
    .option('--browser-id <id>', 'Reuse an existing managed warm browser runtime by browserId')
    .option(
      '--cdp-url <url>',
      'Requested local Chrome CDP endpoint; an explicit custom value pins the endpoint and disables silent auto-reroute',
      DEFAULT_CDP_URL,
    )
    .option(
      '--timeout <ms>',
      'Timeout for CDP connect, navigation, and waits',
      String(DEFAULT_CLI_TIMEOUT_MS),
    )
    .option(
      '--browser-mode <mode>',
      'Explicit browser lifecycle mode: attach, ephemeral, or warm; explicit mode pins intent and conflicts fail closed',
    )
    .option(
      '--clone-chrome-profile',
      'Request managed Chrome ownership. The default clone contract keeps Local State plus DeepSeek-scoped cookie/localStorage state and stays fail-closed instead of broadening to a wider profile copy.',
    )
    .option('--headless', 'Managed Chrome only: launch the cloned-profile browser in headless mode')
    .option('--proxy <server>', 'Managed Chrome only: proxy server for the cloned-profile browser')
    .option(
      '--chrome-user-data-dir <dir>',
      'Source Chrome user-data-dir root for the default DeepSeek site-filtered clone contract',
    )
    .option(
      '--chrome-profile-directory <name>',
      'Optional source Chrome profile directory override, for example Default or "Profile 4"',
    )
    .option('--chrome-executable-path <path>', 'Chrome executable to launch')
    .option('--keep-temp-chrome-profile', 'Keep the cloned temp Chrome profile after command exits')
}

const SERVE_OPENAI_OPTION_NAMES = [
  'openaiCdpUrl',
  'openaiTimeout',
  'openaiBrowserId',
  'openaiBrowserMode',
  'openaiCloneChromeProfile',
  'openaiHeadless',
  'openaiProxy',
  'openaiChromeUserDataDir',
  'openaiChromeProfileDirectory',
  'openaiChromeExecutablePath',
  'openaiKeepTempChromeProfile',
  'openaiUrl',
  'openaiWaitUntil',
  'openaiSessionStoreDir',
] as const

function addServeOpenAIExecutionOptions(command: Command): Command {
  return command
    .option(
      '--openai-cdp-url <url>',
      'OpenAI HTTP only: requested default CDP endpoint for the process-wide chat/responses execution environment',
      DEFAULT_OPENAI_HTTP_CDP_URL,
    )
    .option(
      '--openai-timeout <ms>',
      'OpenAI HTTP only: default timeout for browser connect, navigation, and waits',
      String(DEFAULT_OPENAI_HTTP_TIMEOUT_MS),
    )
    .option(
      '--openai-browser-id <id>',
      'OpenAI HTTP only: reuse an existing managed warm browser runtime by browserId',
    )
    .option(
      '--openai-browser-mode <mode>',
      'OpenAI HTTP only: explicit process-wide browser lifecycle mode (attach, ephemeral, or warm)',
    )
    .option(
      '--openai-clone-chrome-profile',
      'OpenAI HTTP only: use a managed process-wide browser execution environment with the default DeepSeek site-filtered clone contract.',
    )
    .option(
      '--openai-headless',
      'OpenAI HTTP only: launch the cloned-profile browser in headless mode',
    )
    .option(
      '--openai-proxy <server>',
      'OpenAI HTTP only: proxy server for the cloned-profile browser',
    )
    .option(
      '--openai-chrome-user-data-dir <dir>',
      'OpenAI HTTP only: source Chrome user-data-dir root for the default DeepSeek site-filtered clone contract',
    )
    .option(
      '--openai-chrome-profile-directory <name>',
      'OpenAI HTTP only: optional source Chrome profile directory override, for example Default or "Profile 4"',
    )
    .option(
      '--openai-chrome-executable-path <path>',
      'OpenAI HTTP only: Chrome executable to launch',
    )
    .option(
      '--openai-keep-temp-chrome-profile',
      'OpenAI HTTP only: keep the cloned temp Chrome profile after request execution',
    )
    .option(
      '--openai-url <url>',
      'OpenAI HTTP only: default DeepSeek entry URL for compatible requests',
      DEFAULT_OPENAI_HTTP_TARGET_URL,
    )
    .option(
      '--openai-wait-until <event>',
      'OpenAI HTTP only: default navigation lifecycle event',
      DEFAULT_OPENAI_HTTP_WAIT_UNTIL,
    )
    .option(
      '--openai-session-store-dir <dir>',
      'OpenAI HTTP only: directory used to persist session files created by compatible requests',
      DEFAULT_OPENAI_HTTP_SESSION_STORE_DIR,
    )
}

function addBrowserRuntimeStartOptions(command: Command): Command {
  return command
    .option('--cdp-url <url>', 'CDP endpoint to reserve for the managed warm browser runtime', DEFAULT_CDP_URL)
    .option(
      '--timeout <ms>',
      'Timeout for Chrome launch readiness checks',
      String(DEFAULT_CLI_TIMEOUT_MS),
    )
    .option('--headless', 'Launch the managed warm runtime in headless mode')
    .option('--proxy <server>', 'Proxy server for the managed warm runtime')
    .option(
      '--chrome-user-data-dir <dir>',
      'Source Chrome user-data-dir root for the default DeepSeek site-filtered clone contract',
    )
    .option(
      '--chrome-profile-directory <name>',
      'Optional source Chrome profile directory override, for example Default or "Profile 4"',
    )
    .option('--chrome-executable-path <path>', 'Chrome executable to launch')
    .option('--keep-temp-chrome-profile', 'Preserve the managed runtime profile after stop/cleanup')
    .option(
      '--browser-purpose <purpose>',
      'Runtime purpose: primary, probe, regression, or audit',
      'primary',
    )
    .option(
      '--idle-ttl-ms <ms>',
      'Idle TTL in milliseconds before a warm runtime becomes stale',
    )
}

function addComposerModeOptions(
  command: Command,
  defaults: typeof DEFAULT_UNCHANGED_COMPOSER_MODE_OPTIONS | typeof DEFAULT_REPLY_COMPOSER_MODE_OPTIONS =
    DEFAULT_UNCHANGED_COMPOSER_MODE_OPTIONS,
): Command {
  return command
    .option(
      '--chat-mode <mode>',
      'Target DeepSeek chat mode: instant, expert, vision, or unchanged',
      defaults.chatMode,
    )
    .option(
      '--deep-think <state>',
      'Target DeepThink state: on, off, or unchanged',
      defaults.deepThink,
    )
    .option(
      '--search <state>',
      'Target Search state: on, off, or unchanged',
      defaults.search,
    )
}

function addFileUploadOptions(command: Command): Command {
  return command.option(
    '--file <path>',
    'Attach a local file before sending. Repeat to attach multiple files. Expert + file is temporarily disabled.',
    collectStringOption,
    [],
  )
}

function addOutputModeOptions(command: Command): Command {
  return command
    .option('--stream', 'Return streaming output for text or stream-json modes')
    .option('--format <format>', 'Output format: text, json, or stream-json (default: text)')
    .option(
      '--json-shape <shape>',
      'JSON shape: native, openai-responses, or openai-chat-completions',
    )
}

function addRateLimitRetryOptions(command: Command): Command {
  return command
    .option(
      '--retry-on-rate-limit',
      'Automatically retry the real browser send flow when DeepSeek returns an API rate-limit error',
    )
    .option(
      '--max-retries <count>',
      'Maximum number of automatic retries after the initial attempt',
      '0',
    )
    .option(
      '--retry-cooldown-ms <ms>',
      'Override the automatic retry cooldown in milliseconds; defaults to the rate-limit metadata recommendation when available',
    )
}

function addDestructiveDeleteSessionOptions(command: Command): Command {
  return command
    .option(
      '--allow-destructive-delete-session',
      'Acknowledge that this command will delete one DeepSeek chat session for the logged-in account',
    )
    .option(
      '--confirm-text <text>',
      'Exact confirmation text required for non-interactive execution; the expected text is derived from the authoritative session id',
    )
    .option(
      '--audit-output <file>',
      'Optional path used to save the captured delete request/response fixture as JSON',
    )
}

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function getActionCommand(args: unknown[]): Command {
  const candidate = args.at(-1)
  if (!(candidate instanceof Command)) {
    throw new Error('Commander action did not expose a Command instance.')
  }
  return candidate
}

function getCommandOptions(command: Command): Record<string, unknown> {
  return command.optsWithGlobals()
}

function wasOptionProvided(command: Command, name: string): boolean {
  const source = command.getOptionValueSource(name)
  return source !== undefined && source !== 'default'
}

function readStringOption(options: Record<string, unknown>, key: string): string {
  const value = options[key]
  if (typeof value !== 'string') {
    throw new Error(`Missing string option: ${key}`)
  }
  return value
}

function readOptionalStringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readBooleanOption(options: Record<string, unknown>, key: string): boolean {
  return options[key] === true
}

function readOptionalIntegerOption(
  options: Record<string, unknown>,
  key: string,
  label: string,
): number | undefined {
  const value = readOptionalStringOption(options, key)
  return value ? parseInteger(value, label) : undefined
}

function readStringArrayOption(options: Record<string, unknown>, key: string): string[] | undefined {
  const value = options[key]
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
  return normalized.length > 0 ? normalized : undefined
}

function readExportConversationFormatOption(
  options: Record<string, unknown>,
  key: 'format',
): 'text' | 'markdown' | 'json' {
  const value = options[key]
  if (value === 'text' || value === 'markdown' || value === 'json') {
    return value
  }

  throw new Error(`Invalid ${key} option: ${String(value)}. Expected text, markdown, or json.`)
}

function readTextOrJsonFormatOption(
  options: Record<string, unknown>,
  key: 'format',
): 'text' | 'json' {
  const value = options[key]
  if (value === 'text' || value === 'json') {
    return value
  }

  throw new Error(`Invalid ${key} option: ${String(value)}. Expected text or json.`)
}

function readComposerChatModeOption(
  options: Record<string, unknown>,
  key: 'chatMode',
): DeepSeekComposerChatModeTargetState {
  const value = options[key]
  if (
    value === 'instant' ||
    value === 'expert' ||
    value === 'vision' ||
    value === 'unchanged'
  ) {
    return value
  }

  throw new Error(
    `Invalid ${key} option: ${String(value)}. Expected instant, expert, vision, or unchanged.`,
  )
}

function readComposerModeOption(
  options: Record<string, unknown>,
  key: 'deepThink' | 'search',
): DeepSeekComposerToggleTargetState {
  const value = options[key]
  if (value === 'on' || value === 'off' || value === 'unchanged') {
    return value
  }

  throw new Error(`Invalid ${key} option: ${String(value)}. Expected on, off, or unchanged.`)
}

function readComposerModeOptions(options: Record<string, unknown>): DeepSeekComposerModeRequest {
  return {
    chatMode: readComposerChatModeOption(options, 'chatMode'),
    deepThink: readComposerModeOption(options, 'deepThink'),
    search: readComposerModeOption(options, 'search'),
  }
}

function readExistingSessionComposerModeOptions(
  command: Command,
  options: Record<string, unknown>,
): DeepSeekComposerModeRequest {
  const requestedMode = readComposerModeOptions(options)
  if (wasOptionProvided(command, 'chatMode')) {
    return requestedMode
  }

  return {
    ...requestedMode,
    chatMode: 'unchanged',
  }
}

function readDeepSeekCliOutputMode(options: Record<string, unknown>) {
  return resolveDeepSeekCliOutputMode({
    stream: readBooleanOption(options, 'stream'),
    format: readOptionalStringOption(options, 'format'),
    jsonShape: readOptionalStringOption(options, 'jsonShape'),
  })
}

function readDeepSeekReplyRetryOptions(options: Record<string, unknown>) {
  const maxRetries = parseInteger(readStringOption(options, 'maxRetries'), 'max-retries')
  const retryCooldownMs = readOptionalStringOption(options, 'retryCooldownMs')
  if (maxRetries < 0) {
    throw new Error('`--max-retries` must be >= 0.')
  }
  if (retryCooldownMs && parseInteger(retryCooldownMs, 'retry-cooldown-ms') < 0) {
    throw new Error('`--retry-cooldown-ms` must be >= 0.')
  }

  if (!readBooleanOption(options, 'retryOnRateLimit') && (maxRetries > 0 || retryCooldownMs)) {
    throw new Error(
      '`--max-retries` and `--retry-cooldown-ms` require `--retry-on-rate-limit`.',
    )
  }

  return {
    onRateLimit: readBooleanOption(options, 'retryOnRateLimit'),
    maxRetries,
    ...(retryCooldownMs ? { cooldownMs: parseInteger(retryCooldownMs, 'retry-cooldown-ms') } : {}),
    countdown: true,
  }
}

function readBrowserPurposeOption(options: Record<string, unknown>, key = 'browserPurpose'): BrowserRuntimePurpose {
  const value = options[key]
  if (
    value === 'primary' ||
    value === 'probe' ||
    value === 'regression' ||
    value === 'audit'
  ) {
    return value
  }

  throw new Error(
    `Invalid ${key} option: ${String(value)}. Expected primary, probe, regression, or audit.`,
  )
}

function readSessionLocatorOptions(options: Record<string, unknown>): {
  sessionFile?: string | undefined
  sessionId?: string | undefined
  sessionStoreDir?: string | undefined
} {
  const sessionFile = readOptionalStringOption(options, 'sessionFile')
  const sessionId = readOptionalStringOption(options, 'sessionId')

  if (!sessionFile && !sessionId) {
    throw new Error('Either --session-file or --session-id is required.')
  }

  return {
    sessionFile,
    sessionId,
    sessionStoreDir: readOptionalStringOption(options, 'sessionStoreDir'),
  }
}

function buildManagedChromeOptions(
  options: Record<string, unknown>,
  entrypoint: BrowserRuntimeEntrypoint = 'cli',
  command?: Command,
): ManagedChromeOptions {
  const browserMode = readOptionalStringOption(options, 'browserMode')
  if (
    browserMode !== undefined &&
    browserMode !== 'attach' &&
    browserMode !== 'ephemeral' &&
    browserMode !== 'warm'
  ) {
    throw new Error(
      `Invalid browser mode: ${browserMode}. Expected one of attach, ephemeral, or warm.`,
    )
  }
  const explicitChromeUserDataDir = readOptionalStringOption(options, 'chromeUserDataDir')
  const authChromeUserDataDir = resolveImplicitAuthChromeUserDataDir(options)
  return resolveBrowserRuntimeOptions({
    cdpUrl: readStringOption(options, 'cdpUrl'),
    explicitCdpUrl: command ? wasOptionProvided(command, 'cdpUrl') : undefined,
    timeoutMs: parseInteger(readStringOption(options, 'timeout'), 'timeout'),
    deepSeekAuthProfile: Boolean(authChromeUserDataDir),
    cloneChromeProfile: readBooleanOption(options, 'cloneChromeProfile') || Boolean(authChromeUserDataDir),
    headless: readBooleanOption(options, 'headless'),
    proxyServer: readOptionalStringOption(options, 'proxy'),
    chromeExecutablePath: readOptionalStringOption(options, 'chromeExecutablePath'),
    chromeUserDataDir: explicitChromeUserDataDir ?? authChromeUserDataDir,
    chromeProfileDirectory: readOptionalStringOption(options, 'chromeProfileDirectory'),
    keepTempChromeProfile: readBooleanOption(options, 'keepTempChromeProfile'),
    browserId: readOptionalStringOption(options, 'browserId'),
    ...(browserMode ? { browserMode } : {}),
  }, { entrypoint })
}

function resolveImplicitAuthChromeUserDataDir(
  options: Record<string, unknown>,
): string | undefined {
  if (
    readBooleanOption(options, 'cloneChromeProfile') ||
    readOptionalStringOption(options, 'browserId') ||
    readOptionalStringOption(options, 'browserMode') ||
    readOptionalStringOption(options, 'chromeUserDataDir') ||
    readOptionalStringOption(options, 'chromeProfileDirectory')
  ) {
    return undefined
  }

  return resolveDeepSeekAuthChromeUserDataDirIfReady()
}

function buildServeOpenAIExecutionEnvironment(
  options: Record<string, unknown>,
): OpenAIHttpExecutionEnvironment {
  const browserMode = readOptionalStringOption(options, 'openaiBrowserMode')
  if (
    browserMode !== undefined &&
    browserMode !== 'attach' &&
    browserMode !== 'ephemeral' &&
    browserMode !== 'warm'
  ) {
    throw new Error(
      `Invalid OpenAI browser mode: ${browserMode}. Expected one of attach, ephemeral, or warm.`,
    )
  }
  return {
    managedChromeOptions: resolveBrowserRuntimeOptions(
      {
        cdpUrl: readStringOption(options, 'openaiCdpUrl'),
        timeoutMs: parseInteger(readStringOption(options, 'openaiTimeout'), 'openai-timeout'),
        cloneChromeProfile: readBooleanOption(options, 'openaiCloneChromeProfile'),
        headless: readBooleanOption(options, 'openaiHeadless'),
        proxyServer: readOptionalStringOption(options, 'openaiProxy'),
        chromeExecutablePath: readOptionalStringOption(options, 'openaiChromeExecutablePath'),
        chromeUserDataDir: readOptionalStringOption(options, 'openaiChromeUserDataDir'),
        chromeProfileDirectory: readOptionalStringOption(options, 'openaiChromeProfileDirectory'),
        keepTempChromeProfile: readBooleanOption(options, 'openaiKeepTempChromeProfile'),
        browserId: readOptionalStringOption(options, 'openaiBrowserId'),
        ...(browserMode ? { browserMode } : {}),
      },
      { entrypoint: 'rpc' },
    ),
    waitUntil: readStringOption(options, 'openaiWaitUntil') as WaitUntil,
    url: readStringOption(options, 'openaiUrl'),
    sessionStoreDir: readStringOption(options, 'openaiSessionStoreDir'),
  }
}

function buildServeOpenAIRouteOptions(
  command: Command,
  options: Record<string, unknown>,
  surfaces: readonly ('rpc' | 'openai')[],
): OpenAIHttpRouteOptions | undefined {
  const openaiEnabled = surfaces.includes('openai')
  const hasExplicitOpenAIOptions = SERVE_OPENAI_OPTION_NAMES.some(name =>
    wasOptionProvided(command, name),
  )

  if (!openaiEnabled) {
    if (hasExplicitOpenAIOptions) {
      throw new Error(
        '`--openai-*` options require `serve --transport http --http-surface openai|both`.',
      )
    }
    return undefined
  }

  return {
    environment: buildServeOpenAIExecutionEnvironment(options),
  }
}

function buildSelectorDriftAuditChromeOptions(
  options: Record<string, unknown>,
  entrypoint: BrowserRuntimeEntrypoint = 'cli',
  command?: Command,
): ManagedChromeOptions {
  return buildDedicatedAuditChromeOptions('selector-drift-audit', options, entrypoint, command)
}

function buildEndpointDriftAuditChromeOptions(
  options: Record<string, unknown>,
  entrypoint: BrowserRuntimeEntrypoint = 'cli',
  command?: Command,
): ManagedChromeOptions {
  return buildDedicatedAuditChromeOptions('endpoint-drift-audit', options, entrypoint, command)
}

function buildOutputDriftAuditChromeOptions(
  options: Record<string, unknown>,
  entrypoint: BrowserRuntimeEntrypoint = 'cli',
  command?: Command,
): ManagedChromeOptions {
  return buildDedicatedAuditChromeOptions('output-drift-audit', options, entrypoint, command)
}

function buildDedicatedAuditChromeOptions(
  commandName: string,
  options: Record<string, unknown>,
  entrypoint: BrowserRuntimeEntrypoint = 'cli',
  command?: Command,
): ManagedChromeOptions {
  const requestedMode = readOptionalStringOption(options, 'browserMode')
  if (requestedMode === 'attach') {
    throw new Error(
      `\`${commandName}\` requires an isolated managed runtime. Remove \`--browser-mode attach\` or reuse an audit \`--browser-id\`.`,
    )
  }

  const browserId = readOptionalStringOption(options, 'browserId')
  const explicitChromeUserDataDir = readOptionalStringOption(options, 'chromeUserDataDir')
  const authChromeUserDataDir = resolveImplicitAuthChromeUserDataDir(options)
  const forceManagedIsolation =
    !browserId &&
    requestedMode === undefined &&
    !readBooleanOption(options, 'cloneChromeProfile') &&
    !authChromeUserDataDir

  return resolveBrowserRuntimeOptions(
    {
      cdpUrl: readStringOption(options, 'cdpUrl'),
      explicitCdpUrl: command ? wasOptionProvided(command, 'cdpUrl') : undefined,
      timeoutMs: parseInteger(readStringOption(options, 'timeout'), 'timeout'),
      deepSeekAuthProfile: authChromeUserDataDir ? true : undefined,
      cloneChromeProfile:
        forceManagedIsolation ||
        readBooleanOption(options, 'cloneChromeProfile') ||
        Boolean(authChromeUserDataDir),
      headless: readBooleanOption(options, 'headless'),
      proxyServer: readOptionalStringOption(options, 'proxy'),
      chromeExecutablePath: readOptionalStringOption(options, 'chromeExecutablePath'),
      chromeUserDataDir: explicitChromeUserDataDir ?? authChromeUserDataDir,
      chromeProfileDirectory: readOptionalStringOption(options, 'chromeProfileDirectory'),
      keepTempChromeProfile: readBooleanOption(options, 'keepTempChromeProfile'),
      browserId,
      ...(requestedMode ? { browserMode: requestedMode as 'ephemeral' | 'warm' } : {}),
    },
    { entrypoint },
  )
}

function buildBrowserRuntimeStartInput(
  options: Record<string, unknown>,
): BrowserRuntimeStartCommandInput {
  const idleTtlMs = readOptionalIntegerOption(options, 'idleTtlMs', 'idle-ttl-ms')
  if (idleTtlMs !== undefined && idleTtlMs <= 0) {
    throw new Error('`--idle-ttl-ms` must be > 0.')
  }

  return {
    cdpUrl: readStringOption(options, 'cdpUrl'),
    timeoutMs: parseInteger(readStringOption(options, 'timeout'), 'timeout'),
    headless: readBooleanOption(options, 'headless'),
    proxyServer: readOptionalStringOption(options, 'proxy'),
    chromeExecutablePath: readOptionalStringOption(options, 'chromeExecutablePath'),
    chromeUserDataDir: readOptionalStringOption(options, 'chromeUserDataDir'),
    chromeProfileDirectory: readOptionalStringOption(options, 'chromeProfileDirectory'),
    keepTempChromeProfile: readBooleanOption(options, 'keepTempChromeProfile'),
    browserPurpose: readBrowserPurposeOption(options),
    ...(idleTtlMs !== undefined ? { idleTtlMs } : {}),
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printDeepSeekSessionCatalogText(result: DeepSeekSessionCatalogResult): void {
  process.stdout.write(`${formatDeepSeekSessionCatalogText(result)}\n`)
}

function formatDeepSeekSessionCatalogText(result: DeepSeekSessionCatalogResult): string {
  const lines: string[] = []

  if (result.returnedSessionCount === 0) {
    lines.push(
      result.query
        ? `No stored sessions matched query "${result.query}" under ${result.sessionStoreDir}.`
        : `No stored sessions found under ${result.sessionStoreDir}.`,
    )
    lines.push(`scannedFileCount: ${result.scannedFileCount}`)
    lines.push(`validSessionCount: ${result.validSessionCount}`)
    lines.push(`matchedSessionCount: ${result.matchedSessionCount}`)
    lines.push(`returnedSessionCount: ${result.returnedSessionCount}`)
    return lines.join('\n')
  }

  lines.push(
    result.truncated
      ? `Showing ${result.returnedSessionCount} of ${result.matchedSessionCount} matched stored session(s) under ${result.sessionStoreDir}.`
      : `Showing ${result.returnedSessionCount} stored session(s) under ${result.sessionStoreDir}.`,
  )
  if (result.query) {
    lines.push(`query: ${result.query}`)
  }
  if (result.limit !== null) {
    lines.push(`limit: ${result.limit}`)
  }

  result.sessions.forEach(session => {
    lines.push('')
    lines.push(`sessionId: ${session.sessionId}`)
    lines.push(`title: ${session.title}`)
    lines.push(`persistedAt: ${session.persistedAt}`)
    lines.push(`createdAt: ${session.createdAt}`)
    lines.push(`userPromptPreview: ${session.userPromptPreview ?? '(none)'}`)
    lines.push(`sessionFile: ${session.sessionFile}`)
    lines.push(`finalUrl: ${session.finalUrl ?? '(none)'}`)
    lines.push(`branchCount: ${session.branchCount}`)
    lines.push(`messageCount: ${session.messageCount}`)
    lines.push(`metadataSource: ${session.metadataSource}`)
    lines.push(
      `hasOpenAIHistoryBootstrap: ${session.hasOpenAIHistoryBootstrap ? 'yes' : 'no'}`,
    )
  })

  return lines.join('\n')
}

function writeDeepSeekSessionCatalogWarningsToStderr(
  warnings: readonly DeepSeekSessionCatalogWarning[],
): void {
  if (warnings.length === 0) {
    return
  }

  const lines = [
    `list-sessions warnings (${warnings.length}):`,
    ...warnings.map(warning => {
      const sessionFile = warning.sessionFile ? ` ${warning.sessionFile}` : ''
      return `warning [${warning.code}]${sessionFile}: ${collapseCliText(warning.message)}`
    }),
  ]
  process.stderr.write(`${lines.join('\n')}\n`)
}

function collapseCliText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function buildLogger(options: Record<string, unknown>, scope: string): RuntimeLogger {
  return new RuntimeLogger({
    level: resolveLogLevel(Boolean(options.verbose), Boolean(options.quiet)),
    scope,
  })
}

function shouldIncludeQuietSessionHandleFooter(
  options: Record<string, unknown>,
  outputMode: DeepSeekResolvedOutputMode,
): boolean {
  return readBooleanOption(options, 'quiet') && outputMode.outputFamily === 'text'
}

export function createProgram(): Command {
  const program = new Command()
  const versionInfo = buildCliVersionInfo()
  program
    .name('deepseek')
    .description('Operate DeepSeek through a local Chrome CDP browser session.')
    .version(
      formatCliVersionInfoText(versionInfo),
      '-V, --version',
      'Print package version, GitHub URL, and license',
    )
    .option('--verbose', 'Enable debug logs')
    .option('--quiet', 'Silence runtime logs')

  const planCommand = addManagedChromeOptions(
    program
      .command('plan')
      .description('Preview browser runtime resolution and auto-management policy')
      .action((...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        printJson(
          describeManagedChromeSessionPlan(
            buildManagedChromeOptions(mergedOptions, 'cli', command),
          ),
        )
      }),
  )
  attachPlanHelp(planCommand)

  const auth = attachAuthHelp(program
    .command('auth')
    .description('Manage the local DeepSeek dedicated auth profile'))

  auth
    .command('login')
    .description('Open a dedicated Chrome profile and wait until DeepSeek login is reusable')
    .option('--url <url>', 'DeepSeek login/home URL', 'https://chat.deepseek.com/')
    .option(
      '--wait-until <event>',
      'Navigation lifecycle event',
      'domcontentloaded',
    )
    .option(
      '--timeout <ms>',
      'Timeout for Chrome launch and user login detection',
      String(DEFAULT_CLI_TIMEOUT_MS),
    )
    .option('--chrome-executable-path <path>', 'Chrome executable to launch')
    .option('--force', 'Remove the existing dedicated auth profile before opening login')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const logger = buildLogger(options, 'auth-login')
      printJson(await loginDeepSeekAuthProfile(
        {
          url: readStringOption(options, 'url'),
          waitUntil: readStringOption(options, 'waitUntil') as WaitUntil,
          timeoutMs: parseInteger(readStringOption(options, 'timeout'), 'timeout'),
          chromeExecutablePath: readOptionalStringOption(options, 'chromeExecutablePath'),
          force: readBooleanOption(options, 'force'),
        },
        logger,
      ))
    })

  auth
    .command('logout')
    .description('Remove the local DeepSeek dedicated auth profile')
    .action(async () => {
      printJson(await logoutDeepSeekAuthProfile())
    })

  const browser = attachBrowserHelp(program
    .command('browser')
    .description('Manage persisted browser runtimes'))

  const browserStartCommand = addBrowserRuntimeStartOptions(
    browser
      .command('start')
      .description('Start or reuse a managed warm browser runtime')
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        const logger = buildLogger(options, 'browser-start')
        printJson(await startBrowserRuntime(buildBrowserRuntimeStartInput(options), logger))
      }),
  )
  attachBrowserStartHelp(browserStartCommand)

  browser
    .command('list')
    .description('List known browser runtimes from the local runtime registry')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const logger = buildLogger(options, 'browser-list')
      printJson(await listBrowserRuntimes({}, logger))
    })

  browser
    .command('status')
    .description('Show one browser runtime by browserId')
    .requiredOption('--browser-id <id>', 'Browser runtime id')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const logger = buildLogger(options, 'browser-status')
      printJson(
        await getBrowserRuntimeStatus(
          {
            browserId: readStringOption(options, 'browserId'),
          },
          logger,
        ),
      )
    })

  browser
    .command('stop')
    .description('Stop one managed browser runtime; busy runtimes require --force')
    .requiredOption('--browser-id <id>', 'Browser runtime id')
    .option('--force', 'Force stop even if the runtime currently holds a lease')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const logger = buildLogger(options, 'browser-stop')
      printJson(
        await stopBrowserRuntime(
          {
            browserId: readStringOption(options, 'browserId'),
            force: readBooleanOption(options, 'force'),
          },
          logger,
        ),
      )
    })

  browser
    .command('restart')
    .description('Restart one managed warm browser runtime; busy runtimes require --force')
    .requiredOption('--browser-id <id>', 'Browser runtime id')
    .option('--force', 'Force restart even if the runtime currently holds a lease')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const logger = buildLogger(options, 'browser-restart')
      printJson(
        await restartBrowserRuntime(
          {
            browserId: readStringOption(options, 'browserId'),
            force: readBooleanOption(options, 'force'),
          },
          logger,
        ),
      )
    })

  browser
    .command('cleanup-stale')
    .description('Reconcile the runtime registry and clean stale managed browser runtimes')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const logger = buildLogger(options, 'browser-cleanup-stale')
      printJson(await cleanupStaleBrowserRuntimes({}, logger))
    })

  browser.addCommand(
    new Command('idle-watch')
      .requiredOption('--browser-id <id>', 'Internal watchdog target browser runtime id')
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        await runBrowserRuntimeIdleWatchdog({
          runtimeId: readStringOption(options, 'browserId'),
          cwd: process.env[DEEPSEEK_IDLE_WATCH_CWD_ENV],
          runtimeDir: process.env[DEEPSEEK_IDLE_WATCH_RUNTIME_DIR_ENV],
        })
      }),
    { hidden: true },
  )

  const deleteSessionCommand = addDestructiveDeleteSessionOptions(addManagedChromeOptions(
    program
      .command('delete-session')
      .description('Delete one DeepSeek session for the logged-in account after explicit target resolution and destructive confirmation')
      .option('--session-id <id>', 'Authoritative DeepSeek session id to delete')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve the stored session file by session id',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const locator = readSessionLocatorOptions(mergedOptions)
        const sessionSource = await resolveDeepSeekSessionSource(locator)
        const actionLabel = buildDeleteDeepSeekSessionActionLabel(
          sessionSource.authoritativeSessionId,
        )
        const confirmationText = buildDeleteDeepSeekSessionConfirmationText(
          sessionSource.authoritativeSessionId,
        )

        await ensureCliDestructiveActionConfirmed({
          actionLabel,
          allowOptionName: DEEPSEEK_DELETE_SESSION_ALLOW_OPTION,
          allowOptionEnabled: readBooleanOption(mergedOptions, 'allowDestructiveDeleteSession'),
          confirmationText,
          providedConfirmationText: readOptionalStringOption(mergedOptions, 'confirmText'),
        })

        const logger = buildLogger(mergedOptions, 'delete-session')
        const result = await deleteDeepSeekSession(
          {
            ...buildManagedChromeOptions(mergedOptions, 'cli', command),
            sessionId: sessionSource.authoritativeSessionId,
            sessionFile: sessionSource.sessionFile,
            sessionStoreDir: locator.sessionStoreDir,
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            auditOutputFile: readOptionalStringOption(mergedOptions, 'auditOutput'),
          },
          logger,
        )
        printJson(result)
      }),
  ))
  attachDeleteSessionHelp(deleteSessionCommand)

  program
    .command('endpoints')
    .description('Print the known DeepSeek route and API catalog')
    .action(() => {
      printJson(describeKnownDeepSeekApiSurface())
    })

  program
    .command('release-diff')
    .description('Compare current DeepSeek release artifacts against the latest known-good baseline and emit layered UI/API/output/runtime drift plus a capability matrix')
    .option(
      '--artifacts-dir <dir>',
      'Managed DeepSeek release evidence directory scanned first for comparable artifacts; legacy artifacts/ only backfills missing scenarios during migration',
      DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
    )
    .option(
      '--current-artifact <file>',
      'Explicit current artifact file. Repeat to override one or more scenarios instead of auto-selecting the latest artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--baseline-artifact <file>',
      'Explicit known-good artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--output <file>',
      'Optional JSON output file path for the layered release diff report',
    )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const report = await diffDeepSeekReleaseArtifacts({
        artifactsDir: readStringOption(options, 'artifactsDir'),
        currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
        baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
        outputFile: readOptionalStringOption(options, 'output'),
      })
      printJson(report)
    })

  program
    .command('release-triage')
    .description('Turn the current DeepSeek release diff into a structured upgrade SOP with disposition, blocking list, and next commands')
    .option(
      '--artifacts-dir <dir>',
      'Managed DeepSeek release evidence directory scanned first for comparable artifacts; legacy artifacts/ only backfills missing scenarios during migration',
      DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
    )
    .option(
      '--current-artifact <file>',
      'Explicit current artifact file. Repeat to override one or more scenarios instead of auto-selecting the latest artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--baseline-artifact <file>',
      'Explicit known-good artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--artifact-root-dir <dir>',
      'Managed DeepSeek release triage/report directory used in emitted SOP commands for fresh probes and regressions',
      DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR,
    )
    .option(
      '--output <file>',
      'Optional JSON output file path for the release triage report',
    )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const report = await triageDeepSeekReleaseArtifacts({
        artifactsDir: readStringOption(options, 'artifactsDir'),
        currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
        baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
        artifactRootDir: readOptionalStringOption(options, 'artifactRootDir'),
        outputFile: readOptionalStringOption(options, 'output'),
      })
      printJson(report)
    })

  program
    .command('release-boundaries')
    .description('Describe the decoupled UI adapter, API contract, output adapter, and integration compatibility boundaries for the selected DeepSeek release artifacts')
    .option(
      '--artifacts-dir <dir>',
      'Managed DeepSeek release evidence directory scanned first for comparable artifacts; legacy artifacts/ only backfills missing scenarios during migration',
      DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
    )
    .option(
      '--current-artifact <file>',
      'Explicit current artifact file. Repeat to override one or more scenarios instead of auto-selecting the latest artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--baseline-artifact <file>',
      'Explicit known-good artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--output <file>',
      'Optional JSON output file path for the release boundary report',
    )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const report = await describeDeepSeekReleaseAdapterBoundaries({
        artifactsDir: readStringOption(options, 'artifactsDir'),
        currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
        baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
        outputFile: readOptionalStringOption(options, 'output'),
      })
      printJson(report)
    })

  attachReleaseRevalidateHelp(
    program
      .command('release-revalidate')
      .description('Describe the formal DeepSeek post-adaptation revalidation contract, including Wave 21/Wave 22 entry readiness, repair items, residual boundaries, and unrevalidated items')
      .option(
        '--artifacts-dir <dir>',
        'Managed DeepSeek release evidence directory scanned first for comparable artifacts; legacy artifacts/ only backfills missing scenarios during migration',
        DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
      )
      .option(
        '--current-artifact <file>',
        'Explicit current artifact file. Repeat to override one or more scenarios instead of auto-selecting the latest artifact.',
        collectStringOption,
        [],
      )
      .option(
        '--baseline-artifact <file>',
        'Explicit known-good artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
        collectStringOption,
        [],
      )
      .option(
        '--artifact-root-dir <dir>',
        'Managed DeepSeek release triage/report directory used in emitted revalidation commands for fresh probes and regressions',
        DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR,
      )
      .option(
        '--repair-note <text>',
        'Optional manual repair note to include in the revalidation report. Repeat to capture multiple concrete fixes.',
        collectStringOption,
        [],
      )
      .option(
        '--docs-updated',
        'Mark README / plan / SOP / spec updates as completed in the release revalidation report',
      )
      .option(
        '--output <file>',
        'Optional JSON output file path for the release revalidation report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        const report = await describeDeepSeekReleaseRevalidation({
          artifactsDir: readStringOption(options, 'artifactsDir'),
          currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
          baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
          artifactRootDir: readOptionalStringOption(options, 'artifactRootDir'),
          repairNotes: readStringArrayOption(options, 'repairNote'),
          docsUpdated: readBooleanOption(options, 'docsUpdated'),
          outputFile: readOptionalStringOption(options, 'output'),
        })
        printJson(report)
      }),
  )

  program
    .command('release-change-ledger')
    .description('Build a DeepSeek release change ledger and unresolved matrix, combining release diagnosis reports with optional real-browser observation seeds')
    .option(
      '--artifacts-dir <dir>',
      'Managed DeepSeek release evidence directory scanned first for comparable artifacts; legacy artifacts/ only backfills missing scenarios during migration',
      DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
    )
    .option(
      '--current-artifact <file>',
      'Explicit current artifact file. Repeat to override one or more scenarios instead of auto-selecting the latest artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--baseline-artifact <file>',
      'Explicit known-good artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
      collectStringOption,
      [],
    )
    .option(
      '--artifact-root-dir <dir>',
      'Managed DeepSeek release triage/report directory used in the nested revalidation/triage reports',
      DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR,
    )
    .option(
      '--observation-file <file>',
      'Structured JSON observation seed to merge into the change ledger. Repeat to add multiple real-browser/codebase observation files.',
      collectStringOption,
      [],
    )
    .option(
      '--output <file>',
      'Optional JSON output file path for the release change ledger report',
    )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const report = await describeDeepSeekReleaseChangeLedger({
        artifactsDir: readStringOption(options, 'artifactsDir'),
        currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
        baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
        artifactRootDir: readOptionalStringOption(options, 'artifactRootDir'),
        observationFiles: readStringArrayOption(options, 'observationFile'),
        outputFile: readOptionalStringOption(options, 'output'),
      })
      printJson(report)
    })

  attachReleaseHandoffMatrixHelp(
    program
      .command('release-handoff-matrix')
      .description('Build a mode-aware Wave 21/Wave 22 handoff matrix, including historical gate invalidation boundaries and per-mode rerun coverage')
      .option(
        '--artifacts-dir <dir>',
        'Managed DeepSeek release evidence directory scanned first for comparable artifacts; legacy artifacts/ only backfills missing scenarios during migration',
        DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
      )
      .option(
        '--current-artifact <file>',
        'Explicit current artifact file. Repeat to override one or more scenarios instead of auto-selecting the latest artifact.',
        collectStringOption,
        [],
      )
      .option(
        '--baseline-artifact <file>',
        'Explicit known-good artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
        collectStringOption,
        [],
      )
      .option(
        '--artifact-root-dir <dir>',
        'Managed DeepSeek release triage/report directory used in emitted handoff commands for future gates and audits',
        DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR,
      )
      .option(
        '--output <file>',
        'Optional JSON output file path for the mode-aware release handoff matrix report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        const report = await describeDeepSeekReleaseHandoffMatrix({
          artifactsDir: readStringOption(options, 'artifactsDir'),
          currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
          baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
          artifactRootDir: readOptionalStringOption(options, 'artifactRootDir'),
          outputFile: readOptionalStringOption(options, 'output'),
        })
        printJson(report)
      }),
  )

  attachReleaseAuditHelp(
    program
      .command('release-audit')
      .description('Build the final DeepSeek release audit report, combining current proof inventory, current audit evidence, artifact freshness, unresolved boundaries, and publish-gate status')
      .option(
        '--artifacts-dir <dir>',
        'Managed DeepSeek release evidence directory scanned first for comparable and supplemental audit artifacts; legacy artifacts/ only backfills missing scenarios during migration',
        DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR,
      )
      .option(
        '--current-artifact <file>',
        'Explicit current comparable artifact file. Repeat to override one or more comparable scenarios instead of auto-selecting the latest artifact.',
        collectStringOption,
        [],
      )
      .option(
        '--baseline-artifact <file>',
        'Explicit known-good comparable artifact file. Repeat to override per-scenario baseline selection instead of auto-selecting the latest known-good artifact.',
        collectStringOption,
        [],
      )
      .option(
        '--artifact-root-dir <dir>',
        'Managed DeepSeek release triage/report directory used in the nested handoff/revalidation reports',
        DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR,
      )
      .option(
        '--repair-note <text>',
        'Optional repair note forwarded into the nested release revalidation report. Repeat to capture multiple concrete fixes.',
        collectStringOption,
        [],
      )
      .option(
        '--output <file>',
        'Optional JSON output file path for the final release audit report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        const report = await describeDeepSeekReleaseAudit({
          artifactsDir: readStringOption(options, 'artifactsDir'),
          currentArtifactFiles: readStringArrayOption(options, 'currentArtifact'),
          baselineArtifactFiles: readStringArrayOption(options, 'baselineArtifact'),
          artifactRootDir: readOptionalStringOption(options, 'artifactRootDir'),
          repairNotes: readStringArrayOption(options, 'repairNote'),
          docsUpdated: true,
          outputFile: readOptionalStringOption(options, 'output'),
        })
        printJson(report)
      }),
  )

  addManagedChromeOptions(
    program
      .command('inspect-home')
      .description('Open DeepSeek home and wait for the initial composer input to become ready')
      .option('--url <url>', 'DeepSeek home URL to inspect', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'inspect-home')
        const snapshot = await inspectDeepSeekHomeEntry(
          {
            ...buildManagedChromeOptions(mergedOptions, 'cli', command),
            url: readStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
          },
          logger,
        )
        printJson(snapshot)
      }),
  )

  const replyCommand = addRateLimitRetryOptions(addOutputModeOptions(addFileUploadOptions(addComposerModeOptions(addManagedChromeOptions(
    program
      .command('reply')
      .description('Reply in DeepSeek, starting a new session or continuing an existing one')
      .requiredOption('--message <text>', 'Prompt to send')
      .option('--session-id <id>', 'Existing authoritative DeepSeek session id to continue')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve or persist stored session files',
      )
      .option('--url <url>', 'DeepSeek home URL to start from when opening a new session', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'reply')
        const resolvedOutputMode = readDeepSeekCliOutputMode(mergedOptions)
        const includeSessionHandleFooter = shouldIncludeQuietSessionHandleFooter(
          mergedOptions,
          resolvedOutputMode,
        )
        const liveOutput = createDeepSeekCliRealtimeOutputController({
          outputMode: resolvedOutputMode,
          includeSessionHandleFooter,
        })
        const delivery = await executeDeepSeekReply(
          {
            reply: {
              ...buildManagedChromeOptions(mergedOptions, 'cli', command),
              prompt: readStringOption(mergedOptions, 'message'),
              files: readStringArrayOption(mergedOptions, 'file'),
              sessionId: readOptionalStringOption(mergedOptions, 'sessionId'),
              sessionFile: readOptionalStringOption(mergedOptions, 'sessionFile'),
              sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
              url: readOptionalStringOption(mergedOptions, 'url'),
              waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
              composerMode:
                readOptionalStringOption(mergedOptions, 'sessionId') ||
                readOptionalStringOption(mergedOptions, 'sessionFile')
                  ? readExistingSessionComposerModeOptions(command, mergedOptions)
                  : readComposerModeOptions(mergedOptions),
            },
            output: {
              stream: readBooleanOption(mergedOptions, 'stream'),
              format: readOptionalStringOption(mergedOptions, 'format'),
              jsonShape: readOptionalStringOption(mergedOptions, 'jsonShape'),
            },
            retry: readDeepSeekReplyRetryOptions(mergedOptions),
            progress: {
              onEvent: createDeepSeekReplyRetryNoticeHandler({
                write: chunk => process.stderr.write(chunk),
                isTTY: process.stderr.isTTY === true,
              }),
            },
            ...(liveOutput.enabled
              ? {
                  live: {
                    onEvent: event => liveOutput.onEvent(event),
                  },
                }
              : {}),
          },
          logger,
        )
        if (liveOutput.enabled) {
          liveOutput.writeFinalResult(delivery.result)
          return
        }

        writeDeepSeekCliOutput({
          result: delivery.result,
          outputMode: delivery.outputMode,
          includeSessionHandleFooter,
        })
      }),
    ),
    DEFAULT_REPLY_COMPOSER_MODE_OPTIONS,
  ))))
  attachReplyHelp(replyCommand)

  const continueMessageCommand = addOutputModeOptions(addManagedChromeOptions(
    program
      .command('continue-message')
      .description('Continue a stopped DeepSeek assistant message when resumable preflight allows it')
      .requiredOption('--message-id <id>', 'Target assistant message id to continue')
      .option('--branch-id <id>', 'Target branch id when the message id exists in multiple branches')
      .option('--active-branch-id <id>', 'Authoritative active branch id used to disambiguate the target')
      .option('--session-id <id>', 'Authoritative DeepSeek session id to continue')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve or persist stored session files',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'continue-message')
        const resolvedOutputMode = readDeepSeekCliOutputMode(mergedOptions)
        const includeSessionHandleFooter = shouldIncludeQuietSessionHandleFooter(
          mergedOptions,
          resolvedOutputMode,
        )
        const liveOutput = createDeepSeekCliRealtimeOutputController({
          outputMode: resolvedOutputMode,
          includeSessionHandleFooter,
        })
        readSessionLocatorOptions(mergedOptions)
        const delivery = await executeDeepSeekContinueMessage(
          {
            continue: {
              ...buildManagedChromeOptions(mergedOptions, 'cli', command),
              messageId: readStringOption(mergedOptions, 'messageId'),
              branchId: readOptionalStringOption(mergedOptions, 'branchId'),
              activeBranchId: readOptionalStringOption(mergedOptions, 'activeBranchId'),
              sessionId: readOptionalStringOption(mergedOptions, 'sessionId'),
              sessionFile: readOptionalStringOption(mergedOptions, 'sessionFile'),
              sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
              waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            },
            output: {
              stream: readBooleanOption(mergedOptions, 'stream'),
              format: readOptionalStringOption(mergedOptions, 'format'),
              jsonShape: readOptionalStringOption(mergedOptions, 'jsonShape'),
            },
            ...(liveOutput.enabled
              ? {
                  live: {
                    onEvent: event => liveOutput.onEvent(event),
                  },
                }
              : {}),
          },
          logger,
        )
        if (liveOutput.enabled) {
          liveOutput.writeFinalResult(delivery.result)
          return
        }

        writeDeepSeekCliOutput({
          result: delivery.result,
          outputMode: delivery.outputMode,
          includeSessionHandleFooter,
        })
      }),
  ))
  attachContinueMessageHelp(continueMessageCommand)

  const prepareContinueTargetCommand = addComposerModeOptions(addManagedChromeOptions(
    program
      .command('prepare-continue-target')
      .description('Send a prompt, stop generation early, and verify whether the resulting assistant message is resumable')
      .requiredOption('--message <text>', 'Prompt used to create the resumable continue target')
      .option('--session-id <id>', 'Existing authoritative DeepSeek session id to use instead of creating a new session')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve or persist stored session files',
      )
      .option('--url <url>', 'DeepSeek home URL to start from when creating a new session', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option(
        '--stop-after-ms <ms>',
        'Delay after generation starts and the stop button appears before clicking stop',
        '500',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'prepare-continue-target')
        if (
          readOptionalStringOption(mergedOptions, 'sessionId') ||
          readOptionalStringOption(mergedOptions, 'sessionFile')
        ) {
          readSessionLocatorOptions(mergedOptions)
        }

        const result = await prepareDeepSeekContinueTarget(
          {
            ...buildManagedChromeOptions(mergedOptions, 'cli', command),
            prompt: readStringOption(mergedOptions, 'message'),
            sessionId: readOptionalStringOption(mergedOptions, 'sessionId'),
            sessionFile: readOptionalStringOption(mergedOptions, 'sessionFile'),
            sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
            url: readOptionalStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            stopAfterMs: parseInteger(readStringOption(mergedOptions, 'stopAfterMs'), 'stop-after-ms'),
            composerMode: readComposerModeOptions(mergedOptions),
          },
          logger,
        )
        printJson(result)
      }),
    ),
    DEFAULT_REPLY_COMPOSER_MODE_OPTIONS,
  )
  attachPrepareContinueHelp(prepareContinueTargetCommand)

  const editMessageCommand = addOutputModeOptions(addComposerModeOptions(addManagedChromeOptions(
    program
      .command('edit-message')
      .description('Edit a stored DeepSeek user message and materialize the resulting branch')
      .requiredOption('--message <text>', 'Replacement prompt to submit')
      .requiredOption('--message-id <id>', 'Target user message id to edit')
      .option('--branch-id <id>', 'Target branch id when the message id exists in multiple branches')
      .option('--active-branch-id <id>', 'Authoritative active branch id used to disambiguate the target')
      .option('--session-id <id>', 'Authoritative DeepSeek session id to edit')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve or persist stored session files',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'edit-message')
        const resolvedOutputMode = readDeepSeekCliOutputMode(mergedOptions)
        const includeSessionHandleFooter = shouldIncludeQuietSessionHandleFooter(
          mergedOptions,
          resolvedOutputMode,
        )
        const liveOutput = createDeepSeekCliRealtimeOutputController({
          outputMode: resolvedOutputMode,
          includeSessionHandleFooter,
        })
        readSessionLocatorOptions(mergedOptions)
        const delivery = await executeDeepSeekEditMessage(
          {
            edit: {
              ...buildManagedChromeOptions(mergedOptions, 'cli', command),
              prompt: readStringOption(mergedOptions, 'message'),
              messageId: readStringOption(mergedOptions, 'messageId'),
              branchId: readOptionalStringOption(mergedOptions, 'branchId'),
              activeBranchId: readOptionalStringOption(mergedOptions, 'activeBranchId'),
              sessionId: readOptionalStringOption(mergedOptions, 'sessionId'),
              sessionFile: readOptionalStringOption(mergedOptions, 'sessionFile'),
              sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
              waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
              composerMode: readComposerModeOptions(mergedOptions),
            },
            output: {
              stream: readBooleanOption(mergedOptions, 'stream'),
              format: readOptionalStringOption(mergedOptions, 'format'),
              jsonShape: readOptionalStringOption(mergedOptions, 'jsonShape'),
            },
            ...(liveOutput.enabled
              ? {
                  live: {
                    onEvent: event => liveOutput.onEvent(event),
                  },
                }
              : {}),
          },
          logger,
        )
        if (liveOutput.enabled) {
          liveOutput.writeFinalResult(delivery.result)
          return
        }

        writeDeepSeekCliOutput({
          result: delivery.result,
          outputMode: delivery.outputMode,
          includeSessionHandleFooter,
        })
      }),
    ),
    DEFAULT_REPLY_COMPOSER_MODE_OPTIONS,
  ))
  attachEditMessageHelp(editMessageCommand)

  const regenerateMessageCommand = addOutputModeOptions(addComposerModeOptions(addManagedChromeOptions(
    program
      .command('regenerate-message')
      .description('Regenerate a stored DeepSeek assistant message and materialize the resulting branch')
      .requiredOption('--message-id <id>', 'Target assistant message id to regenerate')
      .option('--branch-id <id>', 'Target branch id when the message id exists in multiple branches')
      .option('--active-branch-id <id>', 'Authoritative active branch id used to disambiguate the target')
      .option('--session-id <id>', 'Authoritative DeepSeek session id to regenerate')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve or persist stored session files',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'regenerate-message')
        const resolvedOutputMode = readDeepSeekCliOutputMode(mergedOptions)
        const includeSessionHandleFooter = shouldIncludeQuietSessionHandleFooter(
          mergedOptions,
          resolvedOutputMode,
        )
        const liveOutput = createDeepSeekCliRealtimeOutputController({
          outputMode: resolvedOutputMode,
          includeSessionHandleFooter,
        })
        readSessionLocatorOptions(mergedOptions)
        const delivery = await executeDeepSeekRegenerateMessage(
          {
            regenerate: {
              ...buildManagedChromeOptions(mergedOptions, 'cli', command),
              messageId: readStringOption(mergedOptions, 'messageId'),
              branchId: readOptionalStringOption(mergedOptions, 'branchId'),
              activeBranchId: readOptionalStringOption(mergedOptions, 'activeBranchId'),
              sessionId: readOptionalStringOption(mergedOptions, 'sessionId'),
              sessionFile: readOptionalStringOption(mergedOptions, 'sessionFile'),
              sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
              waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
              composerMode: readComposerModeOptions(mergedOptions),
            },
            output: {
              stream: readBooleanOption(mergedOptions, 'stream'),
              format: readOptionalStringOption(mergedOptions, 'format'),
              jsonShape: readOptionalStringOption(mergedOptions, 'jsonShape'),
            },
            ...(liveOutput.enabled
              ? {
                  live: {
                    onEvent: event => liveOutput.onEvent(event),
                  },
                }
              : {}),
          },
          logger,
        )
        if (liveOutput.enabled) {
          liveOutput.writeFinalResult(delivery.result)
          return
        }

        writeDeepSeekCliOutput({
          result: delivery.result,
          outputMode: delivery.outputMode,
          includeSessionHandleFooter,
        })
      }),
    ),
    DEFAULT_REPLY_COMPOSER_MODE_OPTIONS,
  ))
  attachRegenerateMessageHelp(regenerateMessageCommand)

  addManagedChromeOptions(
    program
      .command('inspect-session')
      .description('Open a stored DeepSeek session by authoritative sessionId and recover its context')
      .requiredOption('--session-id <id>', 'Authoritative DeepSeek session id to restore')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve the stored session file by session id',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'inspect-session')
        const result = await inspectDeepSeekSession(
          {
            ...buildManagedChromeOptions(mergedOptions, 'cli', command),
            sessionId: readStringOption(mergedOptions, 'sessionId'),
            sessionFile: readOptionalStringOption(mergedOptions, 'sessionFile'),
            sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
          },
          logger,
        )
        printJson(result)
      }),
  )

  const sendFirstMessageCommand = addRateLimitRetryOptions(addOutputModeOptions(addFileUploadOptions(addComposerModeOptions(addManagedChromeOptions(
    program
      .command('send-first-message')
      .description('Send the first DeepSeek message from home and wait for the session URL jump')
      .requiredOption('--message <text>', 'Prompt to send')
      .option('--url <url>', 'DeepSeek home URL to start from', 'https://chat.deepseek.com/')
      .option(
        '--session-store-dir <dir>',
        'Directory used to persist the created session record',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'send-first-message')
        const resolvedOutputMode = readDeepSeekCliOutputMode(mergedOptions)
        const includeSessionHandleFooter = shouldIncludeQuietSessionHandleFooter(
          mergedOptions,
          resolvedOutputMode,
        )
        const liveOutput = createDeepSeekCliRealtimeOutputController({
          outputMode: resolvedOutputMode,
          includeSessionHandleFooter,
        })
        const delivery = await executeDeepSeekReply(
          {
            reply: {
              ...buildManagedChromeOptions(mergedOptions, 'cli', command),
              url: readStringOption(mergedOptions, 'url'),
              prompt: readStringOption(mergedOptions, 'message'),
              files: readStringArrayOption(mergedOptions, 'file'),
              sessionStoreDir: readOptionalStringOption(mergedOptions, 'sessionStoreDir'),
              waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
              composerMode: readComposerModeOptions(mergedOptions),
            },
            output: {
              stream: readBooleanOption(mergedOptions, 'stream'),
              format: readOptionalStringOption(mergedOptions, 'format'),
              jsonShape: readOptionalStringOption(mergedOptions, 'jsonShape'),
            },
            retry: readDeepSeekReplyRetryOptions(mergedOptions),
            progress: {
              onEvent: createDeepSeekReplyRetryNoticeHandler({
                write: chunk => process.stderr.write(chunk),
                isTTY: process.stderr.isTTY === true,
              }),
            },
            ...(liveOutput.enabled
              ? {
                  live: {
                    onEvent: event => liveOutput.onEvent(event),
                  },
                }
              : {}),
          },
          logger,
        )
        if (liveOutput.enabled) {
          liveOutput.writeFinalResult(delivery.result)
          return
        }

        writeDeepSeekCliOutput({
          result: delivery.result,
          outputMode: delivery.outputMode,
          includeSessionHandleFooter,
        })
      }),
    ),
    DEFAULT_REPLY_COMPOSER_MODE_OPTIONS,
  ))))
  attachSendFirstMessageHelp(sendFirstMessageCommand)

  addComposerModeOptions(addManagedChromeOptions(
    program
      .command('inspect-controls')
      .description('Open DeepSeek in a CDP browser session and inspect composer controls')
      .option('--url <url>', 'DeepSeek URL to inspect', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option('--no-stabilize', 'Skip waiting for a stable UI snapshot')
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'inspect-controls')
        const snapshot = await discoverDeepSeekControls(
          {
            ...buildManagedChromeOptions(mergedOptions, 'cli', command),
            url: readStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            stabilize: !('stabilize' in mergedOptions) || mergedOptions['stabilize'] !== false,
            composerMode: readComposerModeOptions(mergedOptions),
          },
          logger,
        )
        printJson(snapshot)
      }),
  ))

  const modeAuditCommand = addManagedChromeOptions(
    program
      .command('mode-audit')
      .description('Audit DeepSeek Instant/Expert/Vision mode entry, authority signals, and per-mode composer capability surfaces')
      .option('--url <url>', 'DeepSeek home URL to audit', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option(
        '--instant-prompt <text>',
        'Prompt used for the Instant audit scenario',
      )
      .option(
        '--expert-prompt <text>',
        'Prompt used for the Expert audit scenario',
      )
      .option(
        '--vision-prompt <text>',
        'Prompt used for the Vision image audit scenario',
      )
      .option(
        '--vision-file <file>',
        'Image file used for the Vision audit scenario (defaults to a temporary PNG probe)',
      )
      .option(
        '--output <file>',
        'Optional JSON output file path for the mode audit report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'mode-audit')
        const report = await auditDeepSeekChatModes(
          {
            ...buildManagedChromeOptions(mergedOptions, 'cli', command),
            url: readStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            instantPrompt: readOptionalStringOption(mergedOptions, 'instantPrompt'),
            expertPrompt: readOptionalStringOption(mergedOptions, 'expertPrompt'),
            visionPrompt: readOptionalStringOption(mergedOptions, 'visionPrompt'),
            visionFile: readOptionalStringOption(mergedOptions, 'visionFile'),
            outputFile: readOptionalStringOption(mergedOptions, 'output'),
          },
          logger,
        )
        printJson(report)
      }),
  )
  attachModeAuditHelp(modeAuditCommand)

  const selectorDriftAuditCommand = addManagedChromeOptions(
    program
      .command('selector-drift-audit')
      .description('Audit DeepSeek mode-aware selector families, session actions, delete path, and retained search retry baseline')
      .option('--url <url>', 'DeepSeek home URL to audit', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option(
        '--instant-prompt <text>',
        'Prompt used for the Instant selector audit seed session',
      )
      .option(
        '--expert-prompt <text>',
        'Prompt used for the Expert selector audit seed session',
      )
      .option(
        '--vision-prompt <text>',
        'Prompt used for the Vision selector audit seed session',
      )
      .option(
        '--vision-file <file>',
        'Image file used for the Vision selector audit seed session',
      )
      .option(
        '--search-retry-fixture <file>',
        'Optional fixture file used as the retained search retry selector baseline',
      )
      .option(
        '--output <file>',
        'Optional JSON output file path for the selector drift audit report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'selector-drift-audit')
        const report = await auditDeepSeekSelectorDrift(
          {
            ...buildSelectorDriftAuditChromeOptions(mergedOptions, 'cli', command),
            url: readStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            instantPrompt: readOptionalStringOption(mergedOptions, 'instantPrompt'),
            expertPrompt: readOptionalStringOption(mergedOptions, 'expertPrompt'),
            visionPrompt: readOptionalStringOption(mergedOptions, 'visionPrompt'),
            visionFile: readOptionalStringOption(mergedOptions, 'visionFile'),
            searchRetryFixtureFile: readOptionalStringOption(mergedOptions, 'searchRetryFixture'),
            outputFile: readOptionalStringOption(mergedOptions, 'output'),
          },
          logger,
        )
        printJson(report)
      }),
  )
  attachSelectorDriftAuditHelp(selectorDriftAuditCommand)

  const endpointDriftAuditCommand = addManagedChromeOptions(
    program
      .command('endpoint-drift-audit')
      .description('Audit DeepSeek endpoint registry evidence, current mode signal delivery, and retained rate-limit hint/close baseline')
      .option('--url <url>', 'DeepSeek home URL used for the current live mode audit seed', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option(
        '--instant-prompt <text>',
        'Prompt used for the Instant endpoint audit seed session',
      )
      .option(
        '--expert-prompt <text>',
        'Prompt used for the Expert endpoint audit seed session',
      )
      .option(
        '--output <file>',
        'Optional JSON output file path for the endpoint drift audit report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'endpoint-drift-audit')
        const report = await auditDeepSeekEndpointDrift(
          {
            ...buildEndpointDriftAuditChromeOptions(mergedOptions, 'cli', command),
            url: readStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            instantPrompt: readOptionalStringOption(mergedOptions, 'instantPrompt'),
            expertPrompt: readOptionalStringOption(mergedOptions, 'expertPrompt'),
            outputFile: readOptionalStringOption(mergedOptions, 'output'),
          },
          logger,
        )
        printJson(report)
      }),
  )
  attachEndpointDriftAuditHelp(endpointDriftAuditCommand)

  const outputDriftAuditCommand = addManagedChromeOptions(
    program
      .command('output-drift-audit')
      .description('Audit DeepSeek mode-aware reply/export output contracts, citation rendering, and text-markdown-json drift')
      .option('--url <url>', 'DeepSeek home URL used for the current live output smoke', 'https://chat.deepseek.com/')
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option(
        '--instant-prompt <text>',
        'Prompt used for the Instant current-live output smoke scenario',
      )
      .option(
        '--expert-prompt <text>',
        'Prompt used for the Expert current-live output smoke scenario',
      )
    .option(
      '--attachment-file <file>',
      'Reserved for future Expert attachment revalidation; currently skipped while DeepSeek hides Expert attachments',
    )
      .option(
        '--output <file>',
        'Optional JSON output file path for the output drift audit report',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const mergedOptions = getCommandOptions(command)
        const logger = buildLogger(mergedOptions, 'output-drift-audit')
        const report = await auditDeepSeekOutputDrift(
          {
            ...buildOutputDriftAuditChromeOptions(mergedOptions, 'cli', command),
            url: readStringOption(mergedOptions, 'url'),
            waitUntil: readStringOption(mergedOptions, 'waitUntil') as WaitUntil,
            instantPrompt: readOptionalStringOption(mergedOptions, 'instantPrompt'),
            expertPrompt: readOptionalStringOption(mergedOptions, 'expertPrompt'),
            attachmentFile: readOptionalStringOption(mergedOptions, 'attachmentFile'),
            outputFile: readOptionalStringOption(mergedOptions, 'output'),
          },
          logger,
        )
        printJson(report)
      }),
  )
  attachOutputDriftAuditHelp(outputDriftAuditCommand)

  const listSessionsCommand = program
    .command('list-sessions')
    .description('List locally stored DeepSeek sessions so you can recover a sessionId for reply, inspect-session, list-branches, or export-session')
    .option(
      '--session-store-dir <dir>',
      'Directory used to discover locally stored session files',
    )
    .option(
      '--query <text>',
      'Case-insensitive substring filter across sessionId, title, and userPromptPreview',
    )
    .option('--limit <n>', 'Maximum number of matched sessions to return')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const format = readTextOrJsonFormatOption(options, 'format')
      const result = await listDeepSeekSessions({
        sessionStoreDir: readOptionalStringOption(options, 'sessionStoreDir'),
        query: readOptionalStringOption(options, 'query'),
        limit: readOptionalIntegerOption(options, 'limit', 'limit'),
      })

      if (format === 'json') {
        printJson(result)
        return
      }

      printDeepSeekSessionCatalogText(result)
      writeDeepSeekSessionCatalogWarningsToStderr(result.warnings)
    })
  attachListSessionsHelp(listSessionsCommand)

  const syncSessionCommand = addManagedChromeOptions(
    program
      .command('sync-session')
      .description('Reconcile the browser-discovered DeepSeek session catalog into the local store, or explicitly sync one known stored session')
      .option('--session-file <file>', 'Stored session file path; overrides session-store-dir lookup')
      .option(
        '--session-id <id>',
        'Authoritative DeepSeek session id; resolves through session-store-dir',
      )
      .option(
        '--session-store-dir <dir>',
        'Directory used to resolve stored session files by session id',
      )
      .option(
        '--wait-until <event>',
        'Navigation lifecycle event',
        'domcontentloaded',
      )
      .option('--format <format>', 'Output format: text or json', 'text')
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        const format = readTextOrJsonFormatOption(options, 'format')
        const result = await syncDeepSeekSession(
          {
            ...buildManagedChromeOptions(options, 'cli', command),
            sessionId: readOptionalStringOption(options, 'sessionId'),
            sessionFile: readOptionalStringOption(options, 'sessionFile'),
            sessionStoreDir: readOptionalStringOption(options, 'sessionStoreDir'),
            waitUntil: readStringOption(options, 'waitUntil') as WaitUntil,
          },
          buildLogger(options, 'sync-session'),
        )

        if (format === 'json') {
          printJson(result)
          return
        }

        process.stdout.write(`${formatDeepSeekSessionSyncText(result)}\n`)
        const warningsText = formatDeepSeekSessionSyncWarningsText(result)
        if (warningsText) {
          process.stderr.write(`${warningsText}\n`)
        }
      }),
  )
  attachSyncSessionHelp(syncSessionCommand)

  const listBranchesCommand = program
    .command('list-branches')
    .description('List the known branch catalog for a stored DeepSeek session')
    .option('--session-file <file>', 'Path to a stored session JSON file')
    .option('--session-id <id>', 'Authoritative DeepSeek session id; resolves through session-store-dir')
    .option(
      '--session-store-dir <dir>',
      'Directory used to resolve stored session files by session id',
    )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const result = await listDeepSeekSessionBranches(readSessionLocatorOptions(options))
      printJson(result)
    })
  attachListBranchesHelp(listBranchesCommand)

  const exportSessionCommand = program
    .command('export-session')
    .description('Export a stored DeepSeek session to transcript-first text, markdown, or json; omit --branch-id to export all branches')
    .option('--session-file <file>', 'Path to a stored session JSON file')
    .option('--session-id <id>', 'Authoritative DeepSeek session id; resolves through session-store-dir')
    .option(
      '--session-store-dir <dir>',
      'Directory used to resolve stored session files by session id',
    )
    .option('--branch-id <branchId>', 'Optional branch id to export; when omitted, exports the complete session')
    .requiredOption('--output <file>', 'Output file path')
    .option(
      '--format <format>',
      'text, markdown, or json (text is transcript-first human-readable; markdown keeps document/audit sections)',
      'markdown',
    )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const result = await exportConversation({
        ...readSessionLocatorOptions(options),
        branchId: readOptionalStringOption(options, 'branchId'),
        outputFile: readStringOption(options, 'output'),
        format: readExportConversationFormatOption(options, 'format'),
      })
      printJson(result)
    })
  attachExportSessionHelp(exportSessionCommand)

  const interactiveCommand = addRateLimitRetryOptions(addOutputModeOptions(addComposerModeOptions(addManagedChromeOptions(
    program
      .command('interactive')
      .description('Open the interactive shell')
      .option('--url <url>', 'DeepSeek home URL for interactive commands', 'https://chat.deepseek.com/')
      .option(
        '--session-store-dir <dir>',
        'Directory used to persist and resolve stored session files in interactive mode',
        '.deepseek-cdp-cli/sessions',
      )
      .option(
        '--wait-until <event>',
        'Default navigation lifecycle event for interactive commands',
        'domcontentloaded',
      )
      .action(async (...args: unknown[]) => {
        const command = getActionCommand(args)
        const options = getCommandOptions(command)
        readDeepSeekCliOutputMode(options)
        await runInteractiveShell({
          managedChromeOptions: buildManagedChromeOptions(options, 'interactive', command),
          composerMode: readComposerModeOptions(options),
          outputMode: {
            stream: readBooleanOption(options, 'stream'),
            format: readOptionalStringOption(options, 'format'),
            jsonShape: readOptionalStringOption(options, 'jsonShape'),
          },
          retryMode: readDeepSeekReplyRetryOptions(options),
          url: readStringOption(options, 'url'),
          sessionStoreDir: readStringOption(options, 'sessionStoreDir'),
          waitUntil: readStringOption(options, 'waitUntil') as WaitUntil,
          logger: buildLogger(options, 'interactive'),
        })
      }),
  ))))
  attachInteractiveHelp(interactiveCommand)

  const serveCommand = addServeOpenAIExecutionOptions(
    program
      .command('serve')
      .description('Run the JSON-RPC service or the local OpenAI-compatible HTTP surface')
      .option('--transport <transport>', 'stdio or http', 'stdio')
      .option('--port <port>', 'HTTP port when using http transport', '8787')
      .option('--host <host>', 'HTTP bind host when using http transport', '127.0.0.1')
      .option('--http-surface <surface>', 'HTTP surface: rpc, openai, or both', 'rpc')
      .option(
        '--http-api-key <key>',
        'Wrapper auth key for HTTP routes; clients must send Authorization: Bearer <key>',
      ),
  )
    .action(async (...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      const resolved = resolveServeHttpOptions({
        transport: readStringOption(options, 'transport') === 'http' ? 'http' : 'stdio',
        port: parseInteger(readStringOption(options, 'port'), 'port'),
        host: readOptionalStringOption(options, 'host'),
        httpSurface: readOptionalStringOption(options, 'httpSurface'),
        httpApiKey: readOptionalStringOption(options, 'httpApiKey'),
        env: process.env,
        hostExplicit: wasOptionProvided(command, 'host'),
        httpSurfaceExplicit: wasOptionProvided(command, 'httpSurface'),
        httpApiKeyExplicit: wasOptionProvided(command, 'httpApiKey'),
      })
      const openaiRoutes = buildServeOpenAIRouteOptions(command, options, resolved.surfaces)
      await serveJsonRpc({
        transport: resolved.transport,
        port: resolved.port,
        host: resolved.host,
        httpSurfaces: resolved.surfaces,
        httpApiKey: resolved.httpApiKey,
        openaiRoutes,
      })
    })
  attachServeHelp(serveCommand)

  program
    .command('version')
    .description('Print package version, GitHub URL, and license')
    .option('--json', 'Print version metadata as JSON')
    .action((...args: unknown[]) => {
      const command = getActionCommand(args)
      const options = getCommandOptions(command)
      if (readBooleanOption(options, 'json')) {
        printJson(versionInfo)
        return
      }
      process.stdout.write(`${formatCliVersionInfoText(versionInfo)}\n`)
    })

  program
    .command('skillbook')
    .description('Print the packaged SKILL.md guide verbatim')
    .action(async () => {
      const content = await readFile(resolveBundledProjectFile('SKILL.md'), 'utf8')
      process.stdout.write(content)
    })

  program
    .command('show-plan')
    .description('Print the task plan markdown')
    .action(async () => {
      const content = await readFile(
        resolveBundledProjectFile('tasks/TSK-V10_deepseek_chat_cdp_cli_bootstrap_PLAN.md'),
        'utf8',
      )
      process.stdout.write(content)
    })

  applyCliCommandSummaries(program)
  attachCliRootHelp(program)

  return program
}
