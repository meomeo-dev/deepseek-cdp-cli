import type {
  BrowserRuntimeEntrypoint,
  BrowserRuntimeExecutionDisposition,
  BrowserRuntimeMode,
  BrowserRuntimeOptionInput,
  BrowserRuntimeOwnership,
  BrowserRuntimePurpose,
  BrowserRuntimeResolution,
  BrowserRuntimeResolverContext,
} from '../../types/browser-runtime.types.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'

export function resolveBrowserRuntimeOptions(
  input: BrowserRuntimeOptionInput,
  context: BrowserRuntimeResolverContext,
): ManagedChromeOptions {
  const browserId = normalizeOptionalString(input.browserId)
  const proxyServer = normalizeOptionalString(input.proxyServer)
  const requestedMode = input.browserMode ?? null
  const warmPersistentRuntimeAllowed = isWarmPersistentRuntimeAllowed(context)

  if (browserId) {
    return {
      ...input,
      browserId,
      proxyServer,
      browserMode: 'warm',
      browserPurpose: input.browserPurpose ?? 'primary',
      browserRuntime: buildBrowserRuntimeResolution({
        browserId,
        requestedMode,
        mode: 'warm',
        purpose: input.browserPurpose ?? 'primary',
        entrypoint: context.entrypoint,
        persistentRuntimeReady: true,
      }),
    }
  }

  if (requestedMode === 'warm' && !warmPersistentRuntimeAllowed) {
    throw new Error(
      "`browserMode=warm` is only available for interactive / RPC warm reuse or explicit browser runtime management flows.",
    )
  }

  if (requestedMode === 'attach' && input.cloneChromeProfile) {
    throw new Error(
      '`browserMode=attach` conflicts with `cloneChromeProfile=true`. Remove `--clone-chrome-profile` or choose `ephemeral`.',
    )
  }

  const mode =
    requestedMode ??
    resolveImplicitBrowserMode(input.cloneChromeProfile, context, warmPersistentRuntimeAllowed)
  if (mode === 'attach' && input.headless) {
    throw new Error('`headless` requires a managed browser mode (`ephemeral` or `warm`).')
  }
  if (mode === 'attach' && proxyServer) {
    throw new Error('`proxyServer` requires a managed browser mode (`ephemeral` or `warm`).')
  }

  const purpose = input.browserPurpose ?? 'primary'
  return {
    ...input,
    proxyServer,
    browserMode: mode,
    browserPurpose: purpose,
    cloneChromeProfile: mode !== 'attach',
    browserRuntime: buildBrowserRuntimeResolution({
      requestedMode,
      mode,
      purpose,
      entrypoint: context.entrypoint,
      persistentRuntimeReady: mode === 'warm' ? warmPersistentRuntimeAllowed : false,
    }),
  }
}

export function coerceBrowserRuntimeResolution(
  input: Pick<
    ManagedChromeOptions,
    | 'browserId'
    | 'browserMode'
    | 'browserPurpose'
    | 'cloneChromeProfile'
    | 'browserRuntime'
    | 'deepSeekAuthProfile'
  >,
  entrypoint: BrowserRuntimeEntrypoint = 'unspecified',
): BrowserRuntimeResolution {
  if (input.browserRuntime) {
    return input.browserRuntime
  }

  const browserId = normalizeOptionalString(input.browserId)
  if (browserId) {
    return buildBrowserRuntimeResolution({
      browserId,
      requestedMode: input.browserMode ?? null,
      mode: 'warm',
      purpose: input.browserPurpose ?? 'primary',
      entrypoint,
      persistentRuntimeReady: true,
    })
  }

  const mode =
    input.browserMode ??
    (input.cloneChromeProfile || input.deepSeekAuthProfile ? 'ephemeral' : 'attach')
  return buildBrowserRuntimeResolution({
    browserId,
    requestedMode: input.browserMode ?? null,
    mode,
    purpose: input.browserPurpose ?? 'primary',
    entrypoint,
    persistentRuntimeReady: false,
  })
}

function buildBrowserRuntimeResolution(input: {
  browserId?: string | undefined
  requestedMode: BrowserRuntimeMode | null
  mode: BrowserRuntimeMode
  purpose: BrowserRuntimePurpose
  entrypoint: BrowserRuntimeEntrypoint
  persistentRuntimeReady: boolean
}): BrowserRuntimeResolution {
  const ownership: BrowserRuntimeOwnership =
    input.mode === 'attach' ? 'external' : 'managed'
  const executionDisposition: BrowserRuntimeExecutionDisposition =
    input.browserId
      ? 'reuse-existing-runtime'
      : input.mode === 'attach'
      ? 'attach-existing-cdp'
      : input.mode === 'warm'
        ? 'managed-persistent-runtime'
        : 'managed-single-run'

  return {
    entrypoint: input.entrypoint,
    ...(input.browserId ? { browserId: input.browserId } : {}),
    requestedMode: input.requestedMode,
    mode: input.mode,
    ownership,
    purpose: input.purpose,
    source: input.browserId
      ? 'explicit-browser-id'
      : input.requestedMode === null
        ? 'legacy-clone-flag'
        : 'explicit-browser-mode',
    executionDisposition,
    persistentRuntimeReady: input.mode === 'warm' ? input.persistentRuntimeReady : false,
    notes:
      input.browserId
        ? [
            'browserId takes precedence over cloneChromeProfile/browserMode and reuses an existing registered warm runtime.',
          ]
        : [],
  }
}

function resolveImplicitBrowserMode(
  cloneChromeProfile: boolean,
  context: BrowserRuntimeResolverContext,
  warmPersistentRuntimeAllowed: boolean,
): BrowserRuntimeMode {
  if (!cloneChromeProfile) {
    return 'attach'
  }

  if (
    warmPersistentRuntimeAllowed &&
    (context.entrypoint === 'interactive' || context.entrypoint === 'rpc')
  ) {
    return 'warm'
  }

  return 'ephemeral'
}

function isWarmPersistentRuntimeAllowed(
  context: BrowserRuntimeResolverContext,
): boolean {
  return (
    context.allowWarmPersistentRuntime === true ||
    context.entrypoint === 'interactive' ||
    context.entrypoint === 'rpc'
  )
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
