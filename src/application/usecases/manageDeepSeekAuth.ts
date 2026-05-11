import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { allocateLocalPort } from '../../shared/runtime/allocateLocalPort.js'
import {
  resolveDeepSeekAuthProfilePaths,
} from '../../shared/runtime/deepSeekAuthProfile.js'
import type { DEEPSEEK_AUTH_PROFILE_DIRECTORY } from '../../shared/runtime/deepSeekAuthProfile.js'
import { terminateChildProcess } from '../../shared/runtime/terminateChildProcess.js'
import {
  buildManagedChromeLaunchArgs,
  resolveDefaultChromeExecutablePath,
} from '../../domain/browser/managedChrome.js'
import { waitForDeepSeekHomeEntry } from '../../infrastructure/deepseek/deepSeekHomeEntry.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { WaitUntil } from '../../types/managed-chrome.types.js'

export interface DeepSeekAuthLoginInput {
  url: string
  waitUntil: WaitUntil
  timeoutMs: number
  chromeExecutablePath?: string | undefined
  force?: boolean | undefined
}

export interface DeepSeekAuthLoginResult {
  status: 'ready'
  authDir: string
  chromeUserDataDir: string
  chromeProfileDirectory: typeof DEEPSEEK_AUTH_PROFILE_DIRECTORY
  stateFile: string
  finalUrl: string
  localStorageEntryCount: number
  loggedInAt: string
}

export interface DeepSeekAuthLogoutResult {
  status: 'cleared'
  authDir: string
  chromeUserDataDir: string
  stateFile: string
  removed: boolean
}

const AUTH_LOGIN_POLL_TIMEOUT_MS = 5_000
const AUTH_LOGIN_STABLE_WINDOW_MS = 500
const AUTH_CHROME_EXIT_TIMEOUT_MS = 2_000

export async function loginDeepSeekAuthProfile(
  input: DeepSeekAuthLoginInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'auth-login' }),
): Promise<DeepSeekAuthLoginResult> {
  const paths = resolveDeepSeekAuthProfilePaths()
  if (!paths) {
    throw new Error(
      'Could not resolve a local DeepSeek auth profile directory. Set HOME or DEEPSEEK_CDP_AUTH_DIR.',
    )
  }

  const chromeExecutablePath =
    normalizeOptionalString(input.chromeExecutablePath) ?? resolveDefaultChromeExecutablePath()
  if (!chromeExecutablePath) {
    throw new Error('Could not resolve Chrome executable. Pass --chrome-executable-path.')
  }

  if (input.force) {
    await rm(paths.authDir, { recursive: true, force: true })
  }
  await mkdir(paths.chromeUserDataDir, { recursive: true })

  const port = await allocateLocalPort()
  const browserUrl = `http://127.0.0.1:${port}`
  const child = spawn(chromeExecutablePath, [
    ...replaceInitialUrl(buildManagedChromeLaunchArgs({
      port,
      userDataDir: paths.chromeUserDataDir,
      headless: false,
    }), input.url),
  ], {
    stdio: 'ignore',
  })

  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | null = null
  try {
    logger.info('Opened DeepSeek auth login browser', {
      authDir: paths.authDir,
      chromeUserDataDir: paths.chromeUserDataDir,
      chromeProfileDirectory: paths.chromeProfileDirectory,
      url: input.url,
    })
    logger.info('Complete DeepSeek login in the opened Chrome window; this command will continue once the composer is ready.')

    await waitForBrowserUrl(browserUrl, input.timeoutMs, child)
    browser = await puppeteer.connect({
      browserURL: browserUrl,
      defaultViewport: null,
      protocolTimeout: input.timeoutMs,
    })
    const page = await resolveLoginPage(browser, input.url, input.waitUntil, input.timeoutMs)
    const verified = await waitForDeepSeekAuthReady(page, {
      url: input.url,
      timeoutMs: input.timeoutMs,
    })
    const loggedInAt = new Date().toISOString()
    await writeAuthState(paths.stateFile, {
      version: 1,
      status: 'ready',
      loggedInAt,
      chromeUserDataDir: paths.chromeUserDataDir,
      chromeProfileDirectory: paths.chromeProfileDirectory,
      finalUrl: verified.finalUrl,
      localStorageEntryCount: verified.localStorageEntryCount,
    })

    logger.info('DeepSeek auth profile is ready', {
      chromeUserDataDir: paths.chromeUserDataDir,
      chromeProfileDirectory: paths.chromeProfileDirectory,
      finalUrl: verified.finalUrl,
      localStorageEntryCount: verified.localStorageEntryCount,
    })

    return {
      status: 'ready',
      authDir: paths.authDir,
      chromeUserDataDir: paths.chromeUserDataDir,
      chromeProfileDirectory: paths.chromeProfileDirectory,
      stateFile: paths.stateFile,
      finalUrl: verified.finalUrl,
      localStorageEntryCount: verified.localStorageEntryCount,
      loggedInAt,
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    await terminateChildProcess(child, {
      sigtermTimeoutMs: AUTH_CHROME_EXIT_TIMEOUT_MS,
    })
  }
}

export async function logoutDeepSeekAuthProfile(): Promise<DeepSeekAuthLogoutResult> {
  const paths = resolveDeepSeekAuthProfilePaths()
  if (!paths) {
    throw new Error(
      'Could not resolve a local DeepSeek auth profile directory. Set HOME or DEEPSEEK_CDP_AUTH_DIR.',
    )
  }

  const removed = await pathExists(paths.authDir)
  await rm(paths.authDir, { recursive: true, force: true })
  return {
    status: 'cleared',
    authDir: paths.authDir,
    chromeUserDataDir: paths.chromeUserDataDir,
    stateFile: paths.stateFile,
    removed,
  }
}

async function resolveLoginPage(
  browser: Awaited<ReturnType<typeof puppeteer.connect>>,
  url: string,
  waitUntil: WaitUntil,
  timeoutMs: number,
) {
  const pages = await browser.pages()
  const page = pages[0] ?? await browser.newPage()
  await page.goto(url, {
    waitUntil,
    timeout: timeoutMs,
  })
  return page
}

async function waitForDeepSeekAuthReady(
  page: Page,
  input: {
    url: string
    timeoutMs: number
  },
): Promise<{
  finalUrl: string
  localStorageEntryCount: number
}> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    try {
      const homeEntry = await waitForDeepSeekHomeEntry(page, {
        requestedUrl: input.url,
        timeoutMs: Math.min(AUTH_LOGIN_POLL_TIMEOUT_MS, remainingMs),
        stableWindowMs: AUTH_LOGIN_STABLE_WINDOW_MS,
      })
      const localStorageEntryCount = await page.evaluate(() => window.localStorage.length)
      if (localStorageEntryCount > 0) {
        return {
          finalUrl: homeEntry.finalUrl,
          localStorageEntryCount,
        }
      }
      lastError = new Error('DeepSeek composer is ready, but localStorage is empty.')
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Timed out waiting for DeepSeek auth login to become reusable. ${
      lastError instanceof Error ? lastError.message : ''
    }`.trim(),
  )
}

async function writeAuthState(filePath: string, state: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function replaceInitialUrl(args: string[], url: string): string[] {
  return args.map((arg, index) => index === args.length - 1 ? url : arg)
}

async function waitForBrowserUrl(
  browserUrl: string,
  timeoutMs: number,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chrome exited before auth login could start at ${browserUrl}.`)
    }

    try {
      const response = await fetch(`${browserUrl}/json/version`)
      if (response.ok) {
        return
      }
      lastError = new Error(`Chrome CDP responded with ${response.status}.`)
    } catch (error) {
      lastError = error
    }

    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(
    `Timed out waiting for auth Chrome CDP at ${browserUrl}. ${
      lastError instanceof Error ? lastError.message : ''
    }`.trim(),
  )
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
