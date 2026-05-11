import { join, resolve } from 'node:path'

export const DEFAULT_DEEPSEEK_RUNTIME_DIR = '.deepseek-cdp-cli/runtime'
export const DEFAULT_DEEPSEEK_BROWSER_RUNTIME_ROOT_NAME = 'browser-runtimes'

export function resolveDeepSeekRuntimeDir(
  runtimeDir = DEFAULT_DEEPSEEK_RUNTIME_DIR,
  cwd = process.cwd(),
): string {
  return resolve(cwd, runtimeDir)
}

export function buildDeepSeekGenerationBudgetStateFilePath(
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(resolveDeepSeekRuntimeDir(runtimeDir, cwd), 'deepseek-generation-budget.json')
}

export function buildDeepSeekSearchRateLimitCooldownStateFilePath(
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(resolveDeepSeekRuntimeDir(runtimeDir, cwd), 'deepseek-search-rate-limit-cooldown.json')
}

export function resolveDeepSeekSearchAttemptLeaseRootDir(
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(resolveDeepSeekRuntimeDir(runtimeDir, cwd), 'deepseek-search-attempts')
}

export function buildDeepSeekSearchAttemptLeaseFilePath(
  leaseId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(resolveDeepSeekSearchAttemptLeaseRootDir(runtimeDir, cwd), `${sanitizePathSegment(leaseId)}.json`)
}

export function buildManagedChromeLockFilePath(
  cdpUrl: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  const parsedUrl = new URL(cdpUrl)
  const host = sanitizePathSegment(parsedUrl.hostname || 'localhost')
  const port = sanitizePathSegment(parsedUrl.port || 'unknown')
  return join(resolveDeepSeekRuntimeDir(runtimeDir, cwd), `managed-chrome-${host}-${port}.lock.json`)
}

export function resolveDeepSeekBrowserRuntimeRootDir(
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(
    resolveDeepSeekRuntimeDir(runtimeDir, cwd),
    DEFAULT_DEEPSEEK_BROWSER_RUNTIME_ROOT_NAME,
  )
}

export function buildBrowserRuntimeRegistryFilePath(
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(resolveDeepSeekBrowserRuntimeRootDir(runtimeDir, cwd), 'registry.json')
}

export function buildBrowserRuntimeDirectoryPath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(resolveDeepSeekBrowserRuntimeRootDir(runtimeDir, cwd), 'runtimes', runtimeId)
}

export function buildBrowserRuntimeDescriptorFilePath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(buildBrowserRuntimeDirectoryPath(runtimeId, runtimeDir, cwd), 'descriptor.json')
}

export function buildBrowserRuntimeLeaseFilePath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(buildBrowserRuntimeDirectoryPath(runtimeId, runtimeDir, cwd), 'lease.json')
}

export function buildBrowserRuntimeIdleWatchFilePath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(buildBrowserRuntimeDirectoryPath(runtimeId, runtimeDir, cwd), 'idle-watch.json')
}

export function buildBrowserRuntimeProfileDirectoryPath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(buildBrowserRuntimeDirectoryPath(runtimeId, runtimeDir, cwd), 'profile')
}

export function buildBrowserRuntimeArtifactsDirectoryPath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(buildBrowserRuntimeDirectoryPath(runtimeId, runtimeDir, cwd), 'artifacts')
}

export function buildPreservedBrowserRuntimeProfileDirectoryPath(
  runtimeId: string,
  runtimeDir?: string,
  cwd?: string,
): string {
  return join(
    resolveDeepSeekBrowserRuntimeRootDir(runtimeDir, cwd),
    'preserved-profiles',
    runtimeId,
    'profile',
  )
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
