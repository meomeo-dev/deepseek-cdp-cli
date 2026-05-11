import type {
  BrowserRuntimeDescriptor,
  BrowserRuntimeEntrypoint,
  BrowserRuntimeLease,
  BrowserRuntimeMode,
} from './browser-runtime.types.js'
import type { ManagedChromeOptions } from './managed-chrome.types.js'
import type { BrowserRuntimeManagedLaunchConfig, BrowserRuntimePurpose } from './browser-runtime.types.js'

export type BrowserRuntimeOptionInputSource = 'explicit' | 'implicit'

export type BrowserRuntimeCdpUrlSource = 'shared-default' | 'explicit'

export type BrowserRuntimeRequestFamily =
  | 'explicit-intent'
  | 'fully-implicit-managed-required'
  | 'fully-implicit-attach-compatible'

export type BrowserRuntimeManagedRequirementReason =
  | 'browser-id'
  | 'explicit-browser-mode'
  | 'deepseek-auth-profile'
  | 'clone-chrome-profile'
  | 'headless'
  | 'proxy-server'
  | null

export type BrowserRuntimeOwnershipConfidence =
  | 'registered-managed'
  | 'external-devtools'
  | 'unknown'

export type BrowserRuntimeObservedEndpointKind =
  | 'registered-managed-runtime'
  | 'chrome-devtools-active'
  | 'non-cdp-port-occupied'
  | 'available'

export interface BrowserRuntimeObservedRuntimeRecord {
  descriptor: BrowserRuntimeDescriptor
  lease: BrowserRuntimeLease | null
}

export interface BrowserRuntimeRequestIntent {
  entrypoint: BrowserRuntimeEntrypoint
  browserIdSource: BrowserRuntimeOptionInputSource
  browserModeSource: BrowserRuntimeOptionInputSource
  cdpUrlSource: BrowserRuntimeCdpUrlSource
  explicitCdpUrl: boolean
  explicitBrowserId: string | null
  explicitBrowserMode: BrowserRuntimeMode | null
  explicitCustomCdpUrl: boolean
  defaultCdpUrlInUse: boolean
  autoManagementEligible: boolean
  managedRequired: boolean
  attachCompatible: boolean
  managedRequirementReason: BrowserRuntimeManagedRequirementReason
  requestedEndpointMutable: boolean
  requestFamily: BrowserRuntimeRequestFamily
}

export interface BrowserRuntimeObservationInput {
  chrome: ManagedChromeOptions
  defaultCdpUrl: string
  entrypoint?: BrowserRuntimeEntrypoint | undefined
  cdpUrlSource?: BrowserRuntimeCdpUrlSource | undefined
}

export interface BrowserRuntimeEndpointObservation {
  devtoolsEndpointDetected: boolean
  nonCdpPortOccupied: boolean
  endpointKind: Exclude<BrowserRuntimeObservedEndpointKind, 'registered-managed-runtime'>
}

export interface BrowserRuntimeObservation extends BrowserRuntimeRequestIntent {
  requestedPurpose: BrowserRuntimePurpose
  requestedCdpUrl: string
  registeredRuntimeMatch: BrowserRuntimeObservedRuntimeRecord | null
  devtoolsEndpointDetected: boolean
  nonCdpPortOccupied: boolean
  managedOnlyConstraintsDetected: boolean
  ownershipConfidence: BrowserRuntimeOwnershipConfidence
  observedEndpointKind: BrowserRuntimeObservedEndpointKind
  stateFingerprint: string
}

export type BrowserRuntimeAutoManagementAction =
  | 'execute-explicit-intent'
  | 'reuse-registered-runtime'
  | 'launch-managed-on-requested-endpoint'
  | 'attach-existing-devtools-endpoint'
  | 'allocate-isolated-managed-runtime'
  | 'fail-closed'

export type BrowserRuntimeAutoManagementRejectedReason =
  | 'action-already-attempted'
  | 'explicit-intent-only'
  | 'no-registered-runtime-match'
  | 'registered-runtime-not-managed'
  | 'registered-runtime-not-warm'
  | 'registered-runtime-state-not-reusable'
  | 'registered-runtime-purpose-mismatch'
  | 'registered-runtime-busy'
  | 'registered-runtime-missing-managed-config'
  | 'registered-runtime-different-managed-config'
  | 'requested-managed-config-unresolved'
  | 'requested-endpoint-not-available'
  | 'requested-endpoint-not-mutable'
  | 'attach-disallowed-for-request-family'
  | 'devtools-endpoint-not-detected'
  | 'endpoint-owned-by-registered-managed-runtime'
  | 'endpoint-occupied-by-non-cdp-process'

export interface BrowserRuntimeAutoManagementRejectedAction {
  action: BrowserRuntimeAutoManagementAction
  reason: BrowserRuntimeAutoManagementRejectedReason
  detail: string
}

export interface BrowserRuntimeAutoManagementAttempt {
  action: BrowserRuntimeAutoManagementAction
  stateFingerprint: string
}

export interface BrowserRuntimeAutoManagementDecisionInput {
  chrome: ManagedChromeOptions
  observation: BrowserRuntimeObservation
  attempts?: readonly BrowserRuntimeAutoManagementAttempt[] | undefined
}

export interface BrowserRuntimeAutoManagementRequestedPolicyTrace {
  requestKind: BrowserRuntimeRequestFamily
  browserIdSource: BrowserRuntimeOptionInputSource
  browserModeSource: BrowserRuntimeOptionInputSource
  cdpUrlSource: BrowserRuntimeCdpUrlSource
  cloneProfileRequested: boolean
  managedRequired: boolean
  requestedPurpose: BrowserRuntimePurpose
}

export interface BrowserRuntimeAutoManagementObservedStateTrace {
  explicitBrowserId: string | null
  explicitBrowserMode: BrowserRuntimeMode | null
  explicitCustomCdpUrl: boolean
  defaultCdpUrlInUse: boolean
  autoManagementEligible: boolean
  attachCompatible: boolean
  managedRequirementReason: BrowserRuntimeManagedRequirementReason
  requestedEndpointMutable: boolean
  devtoolsEndpointDetected: boolean
  nonCdpPortOccupied: boolean
  managedOnlyConstraintsDetected: boolean
}

export interface BrowserRuntimeAutoManagementDecision {
  requestedPolicy: BrowserRuntimeAutoManagementRequestedPolicyTrace
  requestedCdpUrl: string
  stateFingerprint: string
  observedEndpointKind: BrowserRuntimeObservedEndpointKind
  observedState: BrowserRuntimeAutoManagementObservedStateTrace
  ownershipConfidence: BrowserRuntimeOwnershipConfidence
  registeredRuntimeMatch: BrowserRuntimeObservedRuntimeRecord | null
  candidateActions: BrowserRuntimeAutoManagementAction[]
  chosenAction: BrowserRuntimeAutoManagementAction
  rejectedActions: BrowserRuntimeAutoManagementRejectedAction[]
  reason: string
}

export interface BrowserRuntimeReusableManagedMatch {
  runtimeId: string
  purpose: BrowserRuntimePurpose
  managedConfig: BrowserRuntimeManagedLaunchConfig
}
