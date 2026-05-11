import {
  areManagedLaunchConfigsEquivalent,
  resolveManagedLaunchConfigFromChromeOptions,
} from '../../domain/browser/browserRuntimeManagedConfig.js'
import type {
  BrowserRuntimeAutoManagementAction,
  BrowserRuntimeAutoManagementDecision,
  BrowserRuntimeAutoManagementDecisionInput,
  BrowserRuntimeAutoManagementRejectedAction,
  BrowserRuntimeAutoManagementRejectedReason,
  BrowserRuntimeObservation,
  BrowserRuntimeRequestFamily,
} from '../../types/browser-runtime-auto-management.types.js'

const REQUEST_FAMILY_CANDIDATE_ACTIONS = {
  'explicit-intent': ['execute-explicit-intent', 'fail-closed'],
  'fully-implicit-managed-required': [
    'reuse-registered-runtime',
    'launch-managed-on-requested-endpoint',
    'allocate-isolated-managed-runtime',
    'fail-closed',
  ],
  'fully-implicit-attach-compatible': [
    'reuse-registered-runtime',
    'attach-existing-devtools-endpoint',
    'fail-closed',
  ],
} satisfies Record<BrowserRuntimeRequestFamily, readonly BrowserRuntimeAutoManagementAction[]>

export function listBrowserRuntimeCandidateActions(
  requestFamily: BrowserRuntimeRequestFamily,
): BrowserRuntimeAutoManagementAction[] {
  return [...REQUEST_FAMILY_CANDIDATE_ACTIONS[requestFamily]]
}

export function decideBrowserRuntimeAction(
  input: BrowserRuntimeAutoManagementDecisionInput,
): BrowserRuntimeAutoManagementDecision {
  const observation = input.observation
  const candidateActions = listBrowserRuntimeCandidateActions(observation.requestFamily)
  const rejectedActions: BrowserRuntimeAutoManagementRejectedAction[] = []

  for (const action of candidateActions) {
    if (action === 'fail-closed') {
      return buildDecision({
        input,
        candidateActions,
        rejectedActions,
        chosenAction: 'fail-closed',
        reason: buildFailClosedReason(observation),
      })
    }

    const attemptRejection = rejectAlreadyAttempted(input, action)
    if (attemptRejection) {
      rejectedActions.push(attemptRejection)
      continue
    }

    const rejection = evaluateAction(input, action)
    if (rejection) {
      rejectedActions.push(rejection)
      continue
    }

    return buildDecision({
      input,
      candidateActions,
      rejectedActions,
      chosenAction: action,
      reason: buildChosenActionReason(observation, action),
    })
  }

  return buildDecision({
    input,
    candidateActions,
    rejectedActions,
    chosenAction: 'fail-closed',
    reason: buildFailClosedReason(observation),
  })
}

function evaluateAction(
  input: BrowserRuntimeAutoManagementDecisionInput,
  action: Exclude<BrowserRuntimeAutoManagementAction, 'fail-closed'>,
): BrowserRuntimeAutoManagementRejectedAction | null {
  switch (action) {
    case 'execute-explicit-intent':
      return evaluateExplicitIntent(input.observation)
    case 'reuse-registered-runtime':
      return evaluateReusableRegisteredRuntime(input)
    case 'launch-managed-on-requested-endpoint':
      return evaluateManagedLaunchOnRequestedEndpoint(input)
    case 'attach-existing-devtools-endpoint':
      return evaluateExistingDevtoolsAttach(input.observation)
    case 'allocate-isolated-managed-runtime':
      return evaluateIsolatedManagedAllocation(input)
  }

  return assertUnreachable(action)
}

function evaluateExplicitIntent(
  observation: BrowserRuntimeObservation,
): BrowserRuntimeAutoManagementRejectedAction | null {
  if (observation.requestFamily === 'explicit-intent') {
    return null
  }

  return createRejectedAction({
    action: 'execute-explicit-intent',
    reason: 'explicit-intent-only',
    detail: 'Only explicit browser runtime requests may execute the explicit-intent action.',
  })
}

function evaluateReusableRegisteredRuntime(
  input: BrowserRuntimeAutoManagementDecisionInput,
): BrowserRuntimeAutoManagementRejectedAction | null {
  const observation = input.observation
  const record = observation.registeredRuntimeMatch
  if (!record) {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'no-registered-runtime-match',
      detail: `No registered managed runtime matched ${observation.requestedCdpUrl}.`,
    })
  }

  if (record.descriptor.ownership !== 'managed') {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-not-managed',
      detail: `Registered runtime ${record.descriptor.runtimeId} is not managed-owned.`,
    })
  }

  if (record.descriptor.mode !== 'warm') {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-not-warm',
      detail: `Registered runtime ${record.descriptor.runtimeId} is ${record.descriptor.mode}, not warm.`,
    })
  }

  if (record.descriptor.purpose !== observation.requestedPurpose) {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-purpose-mismatch',
      detail:
        `Registered runtime ${record.descriptor.runtimeId} serves ${record.descriptor.purpose}, ` +
        `not ${observation.requestedPurpose}.`,
    })
  }

  if (record.lease || record.descriptor.state === 'busy') {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-busy',
      detail: `Registered runtime ${record.descriptor.runtimeId} is already leased or busy.`,
    })
  }

  if (!['idle', 'ready'].includes(record.descriptor.state)) {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-state-not-reusable',
      detail:
        `Registered runtime ${record.descriptor.runtimeId} is in state ` +
        `${record.descriptor.state} and cannot be reused conservatively.`,
    })
  }

  if (!observation.managedRequired) {
    return null
  }

  const requestedConfig = resolveManagedLaunchConfigFromChromeOptions(input.chrome)
  if (!requestedConfig) {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'requested-managed-config-unresolved',
      detail:
        'Managed runtime reuse requires a resolved Chrome executable and user-data-dir for this request.',
    })
  }

  if (!record.descriptor.managedConfig) {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-missing-managed-config',
      detail:
        `Registered runtime ${record.descriptor.runtimeId} has no stored managed launch config ` +
        'and cannot be matched safely.',
    })
  }

  if (
    !areManagedLaunchConfigsEquivalent(record.descriptor.managedConfig, requestedConfig)
  ) {
    return createRejectedAction({
      action: 'reuse-registered-runtime',
      reason: 'registered-runtime-different-managed-config',
      detail:
        `Registered runtime ${record.descriptor.runtimeId} uses a different managed launch config ` +
        'than the current request.',
    })
  }

  return null
}

function evaluateManagedLaunchOnRequestedEndpoint(
  input: BrowserRuntimeAutoManagementDecisionInput,
): BrowserRuntimeAutoManagementRejectedAction | null {
  const observation = input.observation
  if (observation.requestFamily !== 'fully-implicit-managed-required') {
    return createRejectedAction({
      action: 'launch-managed-on-requested-endpoint',
      reason: 'explicit-intent-only',
      detail: 'Requested-endpoint managed launch is only available to fully implicit managed requests.',
    })
  }

  if (!observation.requestedEndpointMutable) {
    return createRejectedAction({
      action: 'launch-managed-on-requested-endpoint',
      reason: 'requested-endpoint-not-mutable',
      detail:
        `Requested endpoint ${observation.requestedCdpUrl} is pinned by explicit user intent ` +
        'and cannot be rewritten or reinterpreted automatically.',
    })
  }

  if (!resolveManagedLaunchConfigFromChromeOptions(input.chrome)) {
    return createRejectedAction({
      action: 'launch-managed-on-requested-endpoint',
      reason: 'requested-managed-config-unresolved',
      detail:
        'Managed launch requires a resolved Chrome executable and user-data-dir for this request.',
    })
  }

  if (observation.observedEndpointKind !== 'available') {
    return createRejectedAction({
      action: 'launch-managed-on-requested-endpoint',
      reason: 'requested-endpoint-not-available',
      detail: describeUnavailableRequestedEndpoint(observation),
    })
  }

  return null
}

function evaluateExistingDevtoolsAttach(
  observation: BrowserRuntimeObservation,
): BrowserRuntimeAutoManagementRejectedAction | null {
  if (observation.requestFamily !== 'fully-implicit-attach-compatible') {
    return createRejectedAction({
      action: 'attach-existing-devtools-endpoint',
      reason: 'attach-disallowed-for-request-family',
      detail:
        `Request family ${observation.requestFamily} is not allowed to downgrade into external attach.`,
    })
  }

  if (observation.registeredRuntimeMatch) {
    return createRejectedAction({
      action: 'attach-existing-devtools-endpoint',
      reason: 'endpoint-owned-by-registered-managed-runtime',
      detail:
        `Requested endpoint ${observation.requestedCdpUrl} is already tracked as managed runtime ` +
        `${observation.registeredRuntimeMatch.descriptor.runtimeId}.`,
    })
  }

  if (observation.nonCdpPortOccupied) {
    return createRejectedAction({
      action: 'attach-existing-devtools-endpoint',
      reason: 'endpoint-occupied-by-non-cdp-process',
      detail:
        `Requested endpoint ${observation.requestedCdpUrl} is occupied by a non-CDP process ` +
        'and cannot be attached.',
    })
  }

  if (!observation.devtoolsEndpointDetected) {
    return createRejectedAction({
      action: 'attach-existing-devtools-endpoint',
      reason: 'devtools-endpoint-not-detected',
      detail: `No Chrome DevTools endpoint was detected at ${observation.requestedCdpUrl}.`,
    })
  }

  return null
}

function evaluateIsolatedManagedAllocation(
  input: BrowserRuntimeAutoManagementDecisionInput,
): BrowserRuntimeAutoManagementRejectedAction | null {
  const observation = input.observation
  if (observation.requestFamily !== 'fully-implicit-managed-required') {
    return createRejectedAction({
      action: 'allocate-isolated-managed-runtime',
      reason: 'attach-disallowed-for-request-family',
      detail:
        `Request family ${observation.requestFamily} is not allowed to auto-allocate a managed runtime.`,
    })
  }

  if (!observation.requestedEndpointMutable) {
    return createRejectedAction({
      action: 'allocate-isolated-managed-runtime',
      reason: 'requested-endpoint-not-mutable',
      detail:
        `Requested endpoint ${observation.requestedCdpUrl} is pinned by explicit user intent ` +
        'and cannot be replaced with an isolated endpoint automatically.',
    })
  }

  if (!resolveManagedLaunchConfigFromChromeOptions(input.chrome)) {
    return createRejectedAction({
      action: 'allocate-isolated-managed-runtime',
      reason: 'requested-managed-config-unresolved',
      detail:
        'Isolated managed allocation requires a resolved Chrome executable and user-data-dir.',
    })
  }

  return null
}

function rejectAlreadyAttempted(
  input: BrowserRuntimeAutoManagementDecisionInput,
  action: Exclude<BrowserRuntimeAutoManagementAction, 'fail-closed'>,
): BrowserRuntimeAutoManagementRejectedAction | null {
  const alreadyAttempted =
    input.attempts?.some(
      attempt =>
        attempt.action === action &&
        attempt.stateFingerprint === input.observation.stateFingerprint,
    ) ?? false
  if (!alreadyAttempted) {
    return null
  }

  return createRejectedAction({
    action,
    reason: 'action-already-attempted',
    detail:
      `Action ${action} already failed for observed state ` +
      `${input.observation.stateFingerprint}; the decision graph will not retry it.`,
  })
}

function buildDecision(input: {
  input: BrowserRuntimeAutoManagementDecisionInput
  candidateActions: BrowserRuntimeAutoManagementAction[]
  rejectedActions: BrowserRuntimeAutoManagementRejectedAction[]
  chosenAction: BrowserRuntimeAutoManagementAction
  reason: string
}): BrowserRuntimeAutoManagementDecision {
  const observation = input.input.observation
  return {
    requestedPolicy: {
      requestKind: observation.requestFamily,
      browserIdSource: observation.browserIdSource,
      browserModeSource: observation.browserModeSource,
      cdpUrlSource: observation.cdpUrlSource,
      cloneProfileRequested: input.input.chrome.cloneChromeProfile,
      managedRequired: observation.managedRequired,
      requestedPurpose: observation.requestedPurpose,
    },
    requestedCdpUrl: observation.requestedCdpUrl,
    stateFingerprint: observation.stateFingerprint,
    observedEndpointKind: observation.observedEndpointKind,
    observedState: {
      explicitBrowserId: observation.explicitBrowserId,
      explicitBrowserMode: observation.explicitBrowserMode,
      explicitCustomCdpUrl: observation.explicitCustomCdpUrl,
      defaultCdpUrlInUse: observation.defaultCdpUrlInUse,
      autoManagementEligible: observation.autoManagementEligible,
      attachCompatible: observation.attachCompatible,
      managedRequirementReason: observation.managedRequirementReason,
      requestedEndpointMutable: observation.requestedEndpointMutable,
      devtoolsEndpointDetected: observation.devtoolsEndpointDetected,
      nonCdpPortOccupied: observation.nonCdpPortOccupied,
      managedOnlyConstraintsDetected: observation.managedOnlyConstraintsDetected,
    },
    ownershipConfidence: observation.ownershipConfidence,
    registeredRuntimeMatch: observation.registeredRuntimeMatch,
    candidateActions: input.candidateActions,
    chosenAction: input.chosenAction,
    rejectedActions: input.rejectedActions,
    reason: input.reason,
  }
}

function buildChosenActionReason(
  observation: BrowserRuntimeObservation,
  action: Exclude<BrowserRuntimeAutoManagementAction, 'fail-closed'>,
): string {
  switch (action) {
    case 'execute-explicit-intent':
      return 'Explicit browser runtime intent is pinned, so auto-management executes it without rerouting.'
    case 'reuse-registered-runtime':
      return (
        `A compatible registered managed runtime already covers ${observation.requestedCdpUrl}, ` +
        'so reuse takes precedence.'
      )
    case 'launch-managed-on-requested-endpoint':
      return (
        `Managed runtime is required and ${observation.requestedCdpUrl} is available, ` +
        'so launch on the requested endpoint.'
      )
    case 'attach-existing-devtools-endpoint':
      return (
        `No registered managed runtime matched, but a DevTools endpoint is live on ` +
        `${observation.requestedCdpUrl}, so attach.`
      )
    case 'allocate-isolated-managed-runtime':
      return (
        `Managed runtime is required but ${observation.requestedCdpUrl} is not safe to claim, ` +
        'so allocate an isolated managed runtime.'
      )
  }

  return assertUnreachable(action)
}

function buildFailClosedReason(observation: BrowserRuntimeObservation): string {
  switch (observation.requestFamily) {
    case 'explicit-intent':
      return (
        'Explicit browser runtime intent cannot be retried or rerouted safely for the current ' +
        'observed state, so the request fails closed.'
      )
    case 'fully-implicit-managed-required':
      return (
        'No legal managed-runtime action remained for the current observed state, so the request ' +
        'fails closed instead of attaching externally or looping.'
      )
    case 'fully-implicit-attach-compatible':
      return (
        'No legal attach-compatible action remained for the current observed state, so the request ' +
        'fails closed instead of silently allocating a managed runtime.'
      )
  }

  return assertUnreachable(observation.requestFamily)
}

function describeUnavailableRequestedEndpoint(observation: BrowserRuntimeObservation): string {
  switch (observation.observedEndpointKind) {
    case 'registered-managed-runtime':
      return (
        `Requested endpoint ${observation.requestedCdpUrl} is already owned by registered runtime ` +
        `${observation.registeredRuntimeMatch?.descriptor.runtimeId ?? 'unknown'}.`
      )
    case 'chrome-devtools-active':
      return (
        `Requested endpoint ${observation.requestedCdpUrl} already exposes a Chrome DevTools ` +
        'endpoint.'
      )
    case 'non-cdp-port-occupied':
      return `Requested endpoint ${observation.requestedCdpUrl} is occupied by a non-CDP process.`
    case 'available':
      return `Requested endpoint ${observation.requestedCdpUrl} is not safe to claim.`
  }
}

function createRejectedAction(input: {
  action: BrowserRuntimeAutoManagementAction
  reason: BrowserRuntimeAutoManagementRejectedReason
  detail: string
}): BrowserRuntimeAutoManagementRejectedAction {
  return {
    action: input.action,
    reason: input.reason,
    detail: input.detail,
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unexpected browser runtime auto-management state: ${String(value)}`)
}
