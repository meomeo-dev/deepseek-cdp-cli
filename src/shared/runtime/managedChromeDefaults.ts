import { join } from 'node:path'

export function resolveDefaultChromeExecutablePath(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }

  if (platform === 'win32') {
    const programFiles = env['PROGRAMFILES'] ?? 'C:\\Program Files'
    return `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`
  }

  if (platform === 'linux') {
    return 'google-chrome'
  }

  return undefined
}

export function resolveDefaultChromeUserDataDir(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const home = env['HOME']

  if (platform === 'darwin') {
    return home ? join(home, 'Library', 'Application Support', 'Google', 'Chrome') : undefined
  }

  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA']
    return localAppData ? join(localAppData, 'Google', 'Chrome', 'User Data') : undefined
  }

  if (platform === 'linux') {
    return home ? join(home, '.config', 'google-chrome') : undefined
  }

  return undefined
}
