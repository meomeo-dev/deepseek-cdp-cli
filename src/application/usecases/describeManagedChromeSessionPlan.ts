import { listBrowserRuntimeCandidateActions } from '../services/browserRuntimeAutoManagement.js'
import { normalizeBrowserRuntimeRequestIntent } from '../services/browserRuntimeObservation.js'
import { planManagedChromeExecution } from '../../domain/browser/managedChrome.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'
import type {
  BrowserRuntimeRequestIntent,
} from '../../types/browser-runtime-auto-management.types.js'

const DEFAULT_MANAGED_CHROME_CDP_URL = 'http://127.0.0.1:9222'

export function describeManagedChromeSessionPlan(options: ManagedChromeOptions) {
  const executionPlan = planManagedChromeExecution(options)
  const requestIntent = normalizeBrowserRuntimeRequestIntent({
    chrome: options,
    defaultCdpUrl: DEFAULT_MANAGED_CHROME_CDP_URL,
  })

  return {
    ...sanitizeExecutionPlan(executionPlan),
    requestedCdpUrl: options.cdpUrl,
    requestIntent,
    policyPreview: {
      autoManagementEligible: requestIntent.autoManagementEligible,
      requestFamily: requestIntent.requestFamily,
      actionGraph: listBrowserRuntimeCandidateActions(requestIntent.requestFamily),
      summary: buildPolicyPreviewSummary(requestIntent),
      notes: buildPolicyPreviewNotes(requestIntent),
    },
  }
}

function sanitizeExecutionPlan(
  plan: ReturnType<typeof planManagedChromeExecution>,
): ReturnType<typeof planManagedChromeExecution> | Omit<
  Extract<ReturnType<typeof planManagedChromeExecution>, { mode: 'managed' }>,
  'chromeProfileCopyScope'
> {
  if (plan.mode !== 'managed') {
    return plan
  }

  const visiblePlan: Record<string, unknown> = { ...plan }
  delete visiblePlan.chromeProfileCopyScope
  if (plan.deepSeekAuthProfile === true) {
    delete visiblePlan.cloneChromeProfile
  }
  return visiblePlan as ReturnType<typeof planManagedChromeExecution>
}

function buildPolicyPreviewSummary(intent: BrowserRuntimeRequestIntent): string {
  if (intent.requestFamily === 'fully-implicit-managed-required') {
    return (
      'Fully implicit one-shot CLI managed-required request with managed-only constraints. ' +
      'The runtime stays inside the managed family: reuse a compatible managed runtime, ' +
      'launch managed Chrome on the requested endpoint if it is safe, or allocate an isolated ' +
      'local CDP port. External attach is not allowed.'
    )
  }

  if (intent.requestFamily === 'fully-implicit-attach-compatible') {
    return (
      'Fully implicit one-shot CLI attach-compatible request on the shared default endpoint. ' +
      'The runtime may reuse a registered managed runtime first or attach an active DevTools ' +
      'endpoint when it is safe. It does not silently allocate a different managed browser.'
    )
  }

  if (intent.explicitBrowserId) {
    return (
      'Explicit browserId pins runtime reuse. The command will only target that registered warm ' +
      'runtime and will fail closed instead of silently attaching or allocating somewhere else.'
    )
  }

  if (intent.explicitBrowserMode) {
    return (
      `Explicit browserMode=${intent.explicitBrowserMode} pins lifecycle intent. ` +
      'The command executes that lifecycle directly and conflicts fail closed instead of being rerouted.'
    )
  }

  if (intent.explicitCdpUrl) {
    return (
      'An explicit cdp-url pins the requested endpoint, even when it equals the shared default port. ' +
      'The command will not silently switch to another endpoint.'
    )
  }

  return (
    'This request is not eligible for one-shot CLI auto-management rerouting. ' +
    'The command executes the pinned runtime intent directly and keeps conflicts fail closed.'
  )
}

function buildPolicyPreviewNotes(intent: BrowserRuntimeRequestIntent): string[] {
  if (intent.requestFamily === 'fully-implicit-managed-required') {
    return [
      'Typical triggers: dedicated auth profile, --clone-chrome-profile, headless managed launch, or proxy-backed managed execution.',
      'This is why one-shot --clone-chrome-profile does not auto-attach to an existing user Chrome on 9222.',
      'If the requested shared/default endpoint is unsafe for managed launch and the cdp-url was not explicitly pinned, the request may auto-isolate to another local port.',
    ]
  }

  if (intent.requestFamily === 'fully-implicit-attach-compatible') {
    return [
      'Auto attach is only legal for fully implicit one-shot CLI requests that keep the shared default endpoint and do not introduce managed-only constraints.',
      'A registered managed runtime on the same endpoint is still preferred over raw external DevTools attach.',
      'This family never performs silent managed auto-allocation on another port.',
    ]
  }

  return [
    'Strong user intent boundaries are: explicit browserId, explicit browserMode, and explicit cdp-url.',
    'Pinned requests keep ownership boundaries conservative and fail closed on endpoint or lifecycle conflicts.',
    'Use the fully implicit shared-default request shape only when you want the CLI to choose among the bounded auto-management actions.',
  ]
}
