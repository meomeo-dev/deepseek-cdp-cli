import type {
  DeepSeekBrowserRuntimeReleaseRegressionCheck,
  DeepSeekBrowserRuntimeReleaseRegressionFailureClass,
  DeepSeekBrowserRuntimeReleaseRegressionInput,
  DeepSeekBrowserRuntimeReleaseRegressionReport,
} from '../../types/deepseek-browser-runtime-release-regression.types.js'

export function evaluateDeepSeekBrowserRuntimeReleaseRegression(
  input: DeepSeekBrowserRuntimeReleaseRegressionInput,
): DeepSeekBrowserRuntimeReleaseRegressionReport {
  const checks: DeepSeekBrowserRuntimeReleaseRegressionCheck[] = [
    createCheck({
      id: 'managed-runtime-start-list-status',
      passed:
        (input.primaryRuntimeStart.action === 'started' ||
          input.primaryRuntimeStart.action === 'reused') &&
        input.primaryRuntimeStart.mode === 'warm' &&
        input.primaryRuntimeStart.owner === 'managed' &&
        input.primaryRuntimeStart.purpose === 'primary' &&
        input.primaryRuntimeListed &&
        input.primaryRuntimeStatus.browserId === input.primaryRuntimeStart.browserId &&
        input.primaryRuntimeStatus.mode === 'warm' &&
        input.primaryRuntimeStatus.owner === 'managed' &&
        input.primaryRuntimeStatus.busy === false &&
        input.primaryRuntimeStatus.availableActions.includes('stop') &&
        input.primaryRuntimeStatus.availableActions.includes('restart'),
      failureClass: 'runtime_registry_drift',
      passMessage:
        'Managed warm runtime still exposes stable start/list/status evidence through the browser command family.',
      failMessage:
        'Managed warm runtime no longer yields stable start/list/status evidence through the browser command family.',
      evidence: {
        start: input.primaryRuntimeStart,
        listed: input.primaryRuntimeListed,
        status: input.primaryRuntimeStatus,
      },
    }),
    createCheck({
      id: 'browser-id-reuse',
      passed:
        input.browserIdReuse.reusedBrowserId !== null &&
        input.browserIdReuse.reusedBrowserId === input.primaryRuntimeStart.browserId &&
        input.browserIdReuse.runtimeObservedBusy &&
        input.browserIdReuse.releasedToIdle,
      failureClass: 'browser_id_reuse_drift',
      passMessage:
        '`--browser-id` still routes a real command through the existing warm runtime lease instead of silently bypassing runtime reuse.',
      failMessage:
        '`--browser-id` no longer proves real warm runtime reuse through command-side lease activity.',
      evidence: input.browserIdReuse,
    }),
    createCheck({
      id: 'busy-runtime-guard',
      passed:
        input.busyGuard.commandExited &&
        input.busyGuard.runtimeObservedBusy &&
        input.busyGuard.stopRejected &&
        input.busyGuard.restartRejected &&
        includesForceHint(input.busyGuard.stopError) &&
        includesForceHint(input.busyGuard.restartError) &&
        input.busyGuard.releasedToIdle,
      failureClass: 'busy_guard_drift',
      passMessage:
        'Busy runtimes still fail closed for stop/restart unless force semantics are explicitly used.',
      failMessage:
        'Busy runtime guard drifted: stop/restart no longer fail closed with actionable force guidance.',
      evidence: input.busyGuard,
    }),
    createCheck({
      id: 'managed-runtime-restart-stop',
      passed:
        input.primaryRuntimeRestart.action === 'restarted' &&
        input.primaryRuntimeRestart.browserId === input.primaryRuntimeStart.browserId &&
        input.primaryRuntimeRestart.mode === 'warm' &&
        input.primaryRuntimeRestart.owner === 'managed' &&
        input.primaryRuntimeStop.action === 'stopped' &&
        input.primaryRuntimeStop.browserId === input.primaryRuntimeStart.browserId &&
        input.primaryRuntimeStop.owner === 'managed' &&
        input.primaryRuntimeStop.forced === false &&
        input.primaryRuntimeStop.statusMissingAfterStop,
      failureClass: 'restart_stop_drift',
      passMessage:
        'Managed warm runtime still restarts in place and later stops cleanly through the browser command family.',
      failMessage:
        'Managed warm runtime no longer restarts/stops with the expected in-place lifecycle semantics.',
      evidence: {
        restart: input.primaryRuntimeRestart,
        stop: input.primaryRuntimeStop,
      },
    }),
    createCheck({
      id: 'idle-watchdog-auto-cleanup',
      passed:
        input.idleWatchdog.browserId !== null &&
        input.idleWatchdog.startObserved &&
        input.idleWatchdog.statusObservedBeforeExpiry &&
        input.idleWatchdog.cleanedByWatchdog,
      failureClass: 'idle_watchdog_drift',
      passMessage:
        'Short-TTL warm runtimes still self-expire through the idle watchdog instead of requiring manual cleanup.',
      failMessage:
        'Idle watchdog drifted: short-TTL warm runtimes no longer self-expire as expected.',
      evidence: input.idleWatchdog,
    }),
    createCheck({
      id: 'attach-stop-fail-closed',
      passed:
        input.attachRuntime.browserId !== null &&
        input.attachRuntime.registered &&
        input.attachRuntime.owner === 'external' &&
        input.attachRuntime.stopRejected &&
        includesAttachOwnershipHint(input.attachRuntime.stopError) &&
        input.attachRuntime.externalStillReachableAfterStop,
      failureClass: 'attach_guard_drift',
      passMessage:
        'Attach/external runtimes still reject browser stop and leave the external browser alive.',
      failMessage:
        'Attach/external runtime guard drifted: browser stop no longer fail-closes without killing the external browser.',
      evidence: input.attachRuntime,
    }),
    createCheck({
      id: 'cleanup-stale-forgets-attach-metadata',
      passed:
        input.attachRuntime.browserId !== null &&
        input.attachRuntime.cleanupForgotten &&
        input.attachRuntime.cleanupForgottenRuntimeIds.includes(input.attachRuntime.browserId) &&
        input.attachRuntime.statusMissingAfterCleanup,
      failureClass: 'cleanup_stale_drift',
      passMessage:
        '`browser cleanup-stale` still forgets dead attach metadata without pretending it owns the external browser lifecycle.',
      failMessage:
        '`browser cleanup-stale` no longer forgets dead attach metadata in a stable, explicit way.',
      evidence: input.attachRuntime,
    }),
    createCheck({
      id: 'cdp-url-conflict-guidance',
      passed:
        input.cdpUrlConflict.rejected &&
        input.cdpUrlConflict.actionable &&
        input.cdpUrlConflict.error !== null &&
        !/timed out/i.test(input.cdpUrlConflict.error),
      failureClass: 'cdp_conflict_drift',
      passMessage:
        'Fixed CDP URL conflicts still fail quickly with actionable managed-configuration guidance instead of a generic timeout.',
      failMessage:
        'Fixed CDP URL conflict handling drifted: the command no longer returns an actionable managed-configuration error.',
      evidence: input.cdpUrlConflict,
    }),
    createCheck({
      id: 'parallel-multi-runtime',
      passed:
        input.parallelRuntimes.distinctRuntimeCount >= 2 &&
        input.parallelRuntimes.concurrentBusyCount >= 2 &&
        input.parallelRuntimes.releasedCleanly,
      failureClass: 'parallel_runtime_drift',
      passMessage:
        'The current release window still proves parallel multi-runtime usage instead of falling back to a single-runtime pseudo-pool.',
      failMessage:
        'Parallel runtime behavior drifted: the current release window no longer proves distinct runtimes can be busy concurrently and cleanly release.',
      evidence: input.parallelRuntimes,
    }),
  ]

  return {
    scenario: 'release-browser-runtime-governance',
    ok: checks.every(check => check.status === 'pass'),
    checks,
  }
}

function createCheck(input: {
  id: string
  passed: boolean
  failureClass: Exclude<DeepSeekBrowserRuntimeReleaseRegressionFailureClass, 'ok'>
  passMessage: string
  failMessage: string
  evidence?: unknown
}): DeepSeekBrowserRuntimeReleaseRegressionCheck {
  return {
    id: input.id,
    status: input.passed ? 'pass' : 'fail',
    failureClass: input.passed ? 'ok' : input.failureClass,
    message: input.passed ? input.passMessage : input.failMessage,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  }
}

function includesForceHint(message: string | null): boolean {
  return typeof message === 'string' && /force=true|--force/i.test(message)
}

function includesAttachOwnershipHint(message: string | null): boolean {
  return typeof message === 'string' && /attach\/external|attach\/external|external/i.test(message)
}
