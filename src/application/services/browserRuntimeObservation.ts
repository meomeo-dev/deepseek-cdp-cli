import { createHash } from 'node:crypto'
import type {
  BrowserRuntimeManager,
  BrowserRuntimeRecord,
} from '../../domain/browser/browserRuntimeManager.js'
import { coerceBrowserRuntimeResolution } from '../../domain/browser/browserRuntimeResolver.js'
import { observeLocalBrowserRuntimeEndpoint } from '../../domain/browser/browserRuntimeEndpointProbe.js'
import type {
  BrowserRuntimeCdpUrlSource,
  BrowserRuntimeEndpointObservation,
  BrowserRuntimeObservation,
  BrowserRuntimeObservationInput,
  BrowserRuntimeObservedRuntimeRecord,
  BrowserRuntimeRequestIntent,
} from '../../types/browser-runtime-auto-management.types.js'

export interface BrowserRuntimeObservationDependencies {
  getRuntimeRecord?: ((runtimeId: string) => Promise<BrowserRuntimeObservedRuntimeRecord | null>) | undefined
  listRuntimeRecords?: (() => Promise<BrowserRuntimeObservedRuntimeRecord[]>) | undefined
  observeEndpoint?:
    | ((cdpUrl: string) => Promise<BrowserRuntimeEndpointObservation>)
    | undefined
}

export function createBrowserRuntimeObservationDependencies(
  manager: Pick<BrowserRuntimeManager, 'getRuntimeRecord' | 'listRuntimeRecords'>,
): BrowserRuntimeObservationDependencies {
  return {
    getRuntimeRecord: async runtimeId => {
      const record = await manager.getRuntimeRecord(runtimeId)
      return record ? mapBrowserRuntimeRecord(record) : null
    },
    listRuntimeRecords: async () => {
      const records = await manager.listRuntimeRecords()
      return records.map(mapBrowserRuntimeRecord)
    },
  }
}

export function normalizeBrowserRuntimeRequestIntent(
  input: BrowserRuntimeObservationInput,
): BrowserRuntimeRequestIntent {
  const resolution = coerceBrowserRuntimeResolution(
    input.chrome,
    input.entrypoint ?? input.chrome.browserRuntime?.entrypoint ?? 'unspecified',
  )
  const explicitBrowserId =
    resolution.source === 'explicit-browser-id'
      ? (normalizeOptionalString(input.chrome.browserId) ?? null)
      : null
  const explicitBrowserMode =
    resolution.source === 'explicit-browser-mode' ? resolution.requestedMode : null
  const defaultCdpUrlInUse = normalizeUrl(input.chrome.cdpUrl) === normalizeUrl(input.defaultCdpUrl)
  const cdpUrlSource = resolveCdpUrlSource({
    explicitSource: input.cdpUrlSource,
    explicitCdpUrl: input.chrome.explicitCdpUrl === true,
    defaultCdpUrlInUse,
  })
  const explicitCdpUrl = cdpUrlSource === 'explicit'
  const explicitCustomCdpUrl = explicitCdpUrl && defaultCdpUrlInUse === false
  const managedRequirementReason = resolveManagedRequirementReason({
    browserId: explicitBrowserId,
    browserMode: explicitBrowserMode,
    deepSeekAuthProfile: input.chrome.deepSeekAuthProfile === true,
    cloneChromeProfile: input.chrome.cloneChromeProfile,
    headless: input.chrome.headless,
    proxyServer: normalizeOptionalString(input.chrome.proxyServer) ?? null,
  })
  const managedRequired = managedRequirementReason !== null
  const attachCompatible =
    !managedRequired &&
    resolution.mode === 'attach' &&
    input.chrome.headless === false &&
    normalizeOptionalString(input.chrome.proxyServer) === undefined
  const autoManagementEligible =
    resolution.entrypoint === 'cli' &&
    explicitBrowserId === null &&
    explicitBrowserMode === null &&
    explicitCdpUrl === false

  return {
    entrypoint: resolution.entrypoint,
    browserIdSource: explicitBrowserId ? 'explicit' : 'implicit',
    browserModeSource: explicitBrowserMode ? 'explicit' : 'implicit',
    cdpUrlSource,
    explicitCdpUrl,
    explicitBrowserId,
    explicitBrowserMode,
    explicitCustomCdpUrl,
    defaultCdpUrlInUse,
    autoManagementEligible,
    managedRequired,
    attachCompatible,
    managedRequirementReason,
    requestedEndpointMutable: autoManagementEligible && explicitCdpUrl === false,
    requestFamily: autoManagementEligible
      ? managedRequired
        ? 'fully-implicit-managed-required'
        : 'fully-implicit-attach-compatible'
      : 'explicit-intent',
  }
}

export async function observeBrowserRuntime(
  input: BrowserRuntimeObservationInput,
  dependencies: BrowserRuntimeObservationDependencies = {},
): Promise<BrowserRuntimeObservation> {
  const intent = normalizeBrowserRuntimeRequestIntent(input)
  const registeredRuntimeMatch = await resolveRegisteredRuntimeMatch(
    intent,
    input,
    dependencies,
  )
  const endpointObservation = await (dependencies.observeEndpoint ?? observeLocalBrowserRuntimeEndpoint)(
    input.chrome.cdpUrl,
  )
  const managedOnlyConstraintsDetected =
    input.chrome.deepSeekAuthProfile === true ||
    input.chrome.cloneChromeProfile ||
    input.chrome.headless ||
    normalizeOptionalString(input.chrome.proxyServer) !== undefined
  const ownershipConfidence = resolveOwnershipConfidence({
    registeredRuntimeMatch,
    endpointObservation,
  })
  const observedEndpointKind =
    registeredRuntimeMatch !== null ? 'registered-managed-runtime' : endpointObservation.endpointKind

  return {
    ...intent,
    requestedPurpose: input.chrome.browserRuntime?.purpose ?? input.chrome.browserPurpose ?? 'primary',
    requestedCdpUrl: input.chrome.cdpUrl,
    registeredRuntimeMatch,
    devtoolsEndpointDetected: endpointObservation.devtoolsEndpointDetected,
    nonCdpPortOccupied: endpointObservation.nonCdpPortOccupied,
    managedOnlyConstraintsDetected,
    ownershipConfidence,
    observedEndpointKind,
    stateFingerprint: buildObservationStateFingerprint({
      intent,
      registeredRuntimeMatch,
      endpointObservation,
      ownershipConfidence,
    }),
  }
}

async function resolveRegisteredRuntimeMatch(
  intent: BrowserRuntimeRequestIntent,
  input: BrowserRuntimeObservationInput,
  dependencies: BrowserRuntimeObservationDependencies,
): Promise<BrowserRuntimeObservedRuntimeRecord | null> {
  if (intent.explicitBrowserId) {
    return (await dependencies.getRuntimeRecord?.(intent.explicitBrowserId)) ?? null
  }

  const records = (await dependencies.listRuntimeRecords?.()) ?? []
  return (
    records.find(
      record =>
        record.descriptor.ownership === 'managed' &&
        normalizeUrl(record.descriptor.cdpUrl) === normalizeUrl(input.chrome.cdpUrl),
    ) ?? null
  )
}

function resolveManagedRequirementReason(input: {
  browserId: string | null
  browserMode: BrowserRuntimeObservationInput['chrome']['browserMode'] | null
  deepSeekAuthProfile: boolean
  cloneChromeProfile: boolean
  headless: boolean
  proxyServer: string | null
}): BrowserRuntimeRequestIntent['managedRequirementReason'] {
  if (input.browserId) {
    return 'browser-id'
  }
  if (input.browserMode === 'ephemeral' || input.browserMode === 'warm') {
    return 'explicit-browser-mode'
  }
  if (input.deepSeekAuthProfile) {
    return 'deepseek-auth-profile'
  }
  if (input.cloneChromeProfile) {
    return 'clone-chrome-profile'
  }
  if (input.headless) {
    return 'headless'
  }
  if (input.proxyServer) {
    return 'proxy-server'
  }
  return null
}

function resolveCdpUrlSource(input: {
  explicitSource: BrowserRuntimeCdpUrlSource | undefined
  explicitCdpUrl: boolean
  defaultCdpUrlInUse: boolean
}): BrowserRuntimeCdpUrlSource {
  if (input.explicitSource) {
    return input.explicitSource
  }

  if (input.explicitCdpUrl) {
    return 'explicit'
  }

  return input.defaultCdpUrlInUse ? 'shared-default' : 'explicit'
}

function resolveOwnershipConfidence(input: {
  registeredRuntimeMatch: BrowserRuntimeObservedRuntimeRecord | null
  endpointObservation: BrowserRuntimeEndpointObservation
}): BrowserRuntimeObservation['ownershipConfidence'] {
  if (input.registeredRuntimeMatch !== null) {
    return 'registered-managed'
  }
  if (input.endpointObservation.devtoolsEndpointDetected) {
    return 'external-devtools'
  }
  return 'unknown'
}

function buildObservationStateFingerprint(input: {
  intent: BrowserRuntimeRequestIntent
  registeredRuntimeMatch: BrowserRuntimeObservedRuntimeRecord | null
  endpointObservation: BrowserRuntimeEndpointObservation
  ownershipConfidence: BrowserRuntimeObservation['ownershipConfidence']
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        requestFamily: input.intent.requestFamily,
        explicitBrowserId: input.intent.explicitBrowserId,
        explicitBrowserMode: input.intent.explicitBrowserMode,
        cdpUrlSource: input.intent.cdpUrlSource,
        managedRequired: input.intent.managedRequired,
        attachCompatible: input.intent.attachCompatible,
        registeredRuntimeId: input.registeredRuntimeMatch?.descriptor.runtimeId ?? null,
        registeredRuntimeState: input.registeredRuntimeMatch?.descriptor.state ?? null,
        registeredRuntimeLeaseId: input.registeredRuntimeMatch?.lease?.leaseId ?? null,
        endpointKind: input.endpointObservation.endpointKind,
        ownershipConfidence: input.ownershipConfidence,
      }),
    )
    .digest('hex')
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

export function mapBrowserRuntimeRecord(
  record: BrowserRuntimeRecord,
): BrowserRuntimeObservedRuntimeRecord {
  return {
    descriptor: record.descriptor,
    lease: record.lease,
  }
}
