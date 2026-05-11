import type { ChromeProfileCopyScope } from '../../types/browser-runtime.types.js'

// Internal-only compatibility helpers for persisted runtimes that predate the
// single-default site-filtered clone contract.
export const DEFAULT_CHROME_PROFILE_COPY_SCOPE: ChromeProfileCopyScope = 'default'
export const REDUCED_MANIFEST_EXPERIMENTAL_COPY_SCOPE: ChromeProfileCopyScope =
  'reduced-manifest-experimental'

export const CHROME_PROFILE_COPY_SCOPE_VALUES = [
  DEFAULT_CHROME_PROFILE_COPY_SCOPE,
  REDUCED_MANIFEST_EXPERIMENTAL_COPY_SCOPE,
] as const satisfies readonly ChromeProfileCopyScope[]

export const REDUCED_MANIFEST_EXPERIMENTAL_ENTRIES = [
  'Local State',
  'Default/Preferences',
  'Default/Cookies',
  'Default/Login Data',
  'Default/Web Data',
  'Default/Local Storage',
  'Default/IndexedDB',
  'Default/Service Worker',
  'Default/Sessions',
] as const

export function resolveChromeProfileCopyScope(
  value: ChromeProfileCopyScope | null | undefined,
): ChromeProfileCopyScope {
  return value ?? DEFAULT_CHROME_PROFILE_COPY_SCOPE
}

export function isChromeProfileCopyScope(value: string): value is ChromeProfileCopyScope {
  return CHROME_PROFILE_COPY_SCOPE_VALUES.includes(value as ChromeProfileCopyScope)
}
