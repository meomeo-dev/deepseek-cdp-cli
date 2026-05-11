import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const DEEPSEEK_AUTH_DIR_ENV = 'DEEPSEEK_CDP_AUTH_DIR'
export const DEEPSEEK_AUTH_PROFILE_DIRECTORY = 'Default'
export const DEEPSEEK_AUTH_STATE_FILE_NAME = 'auth-state.json'
export const DEEPSEEK_AUTH_CHROME_USER_DATA_DIR_NAME = 'chrome-profile'

export interface DeepSeekAuthProfilePaths {
  authDir: string
  chromeUserDataDir: string
  chromeProfileDirectory: typeof DEEPSEEK_AUTH_PROFILE_DIRECTORY
  stateFile: string
}

export function resolveDeepSeekAuthProfilePaths(
  env: NodeJS.ProcessEnv = process.env,
): DeepSeekAuthProfilePaths | null {
  const configuredRoot = normalizeOptionalString(env[DEEPSEEK_AUTH_DIR_ENV])
  const homeRoot = normalizeOptionalString(env['HOME'] ?? env['USERPROFILE'])
  const authDir = configuredRoot ?? (homeRoot ? join(homeRoot, '.deepseek-cdp-cli', 'auth') : null)
  if (!authDir) {
    return null
  }

  const chromeUserDataDir = join(authDir, DEEPSEEK_AUTH_CHROME_USER_DATA_DIR_NAME)
  return {
    authDir,
    chromeUserDataDir,
    chromeProfileDirectory: DEEPSEEK_AUTH_PROFILE_DIRECTORY,
    stateFile: join(authDir, DEEPSEEK_AUTH_STATE_FILE_NAME),
  }
}

export function hasUsableDeepSeekAuthProfile(
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): boolean {
  const paths = resolveDeepSeekAuthProfilePaths(env)
  if (!paths) {
    return false
  }

  return (
    pathExists(paths.stateFile) &&
    pathExists(paths.chromeUserDataDir) &&
    pathExists(join(paths.chromeUserDataDir, DEEPSEEK_AUTH_PROFILE_DIRECTORY))
  )
}

export function resolveDeepSeekAuthChromeUserDataDirIfReady(
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined {
  const paths = resolveDeepSeekAuthProfilePaths(env)
  if (!paths || !hasUsableDeepSeekAuthProfile(env, pathExists)) {
    return undefined
  }

  return paths.chromeUserDataDir
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
