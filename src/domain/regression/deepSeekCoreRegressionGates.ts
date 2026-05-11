import type {
  DeepSeekCoreRegressionCheck,
  DeepSeekCoreRegressionFailureClass,
  DeepSeekCoreRegressionInput,
  DeepSeekCoreRegressionReport,
} from '../../types/deepseek-core-regression.types.js'

export function evaluateDeepSeekCoreRegression(
  input: DeepSeekCoreRegressionInput,
): DeepSeekCoreRegressionReport {
  const checks: DeepSeekCoreRegressionCheck[] = [
    createCheck({
      id: 'attach-plan',
      passed:
        input.attachPlan.mode === 'existing' &&
        input.attachPlan.browserRuntimeMode === 'attach' &&
        input.attachPlan.executionDisposition === 'attach-existing-cdp',
      failureClass: 'browser_runtime_drift',
      passMessage: 'Attach plan still resolves to attach-existing-cdp.',
      failMessage: 'Attach plan drifted away from attach-existing-cdp.',
      evidence: {
        mode: input.attachPlan.mode,
        browserRuntimeMode: input.attachPlan.browserRuntimeMode,
        executionDisposition: input.attachPlan.executionDisposition,
      },
    }),
    createCheck({
      id: 'ephemeral-plan',
      passed:
        input.ephemeralPlan.mode === 'managed' &&
        input.ephemeralPlan.cloneChromeProfile === true &&
        input.ephemeralPlan.browserRuntimeMode === 'ephemeral',
      failureClass: 'browser_runtime_drift',
      passMessage: 'Ephemeral plan still resolves to a managed single-run browser.',
      failMessage: 'Ephemeral plan no longer resolves to managed/ephemeral.',
      evidence: {
        mode: input.ephemeralPlan.mode,
        cloneChromeProfile: input.ephemeralPlan.cloneChromeProfile,
        browserRuntimeMode: input.ephemeralPlan.browserRuntimeMode,
      },
    }),
    createCheck({
      id: 'warm-plan',
      passed:
        input.warmPlan.mode === 'runtime' &&
        input.warmPlan.browserId !== null &&
        input.warmPlan.browserRuntimeMode === 'warm' &&
        input.warmPlan.executionDisposition === 'reuse-existing-runtime',
      failureClass: 'browser_runtime_drift',
      passMessage: 'Warm runtime reuse plan still resolves through browserId.',
      failMessage: 'Warm runtime reuse plan drifted away from browserId reuse.',
      evidence: {
        mode: input.warmPlan.mode,
        browserId: input.warmPlan.browserId,
        browserRuntimeMode: input.warmPlan.browserRuntimeMode,
        executionDisposition: input.warmPlan.executionDisposition,
      },
    }),
    createCheck({
      id: 'warm-runtime-start',
      passed:
        (input.warmRuntimeStart.action === 'started' ||
          input.warmRuntimeStart.action === 'reused') &&
        input.warmRuntimeStart.browserId !== null &&
        input.warmRuntimeStart.mode === 'warm' &&
        input.warmRuntimeStart.owner === 'managed',
      failureClass: 'browser_runtime_drift',
      passMessage: 'Warm browser runtime started or reused as a managed warm runtime.',
      failMessage: 'Warm browser runtime start no longer yields a managed warm runtime.',
      evidence: {
        action: input.warmRuntimeStart.action,
        browserId: input.warmRuntimeStart.browserId,
        mode: input.warmRuntimeStart.mode,
        owner: input.warmRuntimeStart.owner,
        purpose: input.warmRuntimeStart.purpose,
      },
    }),
    createCheck({
      id: 'attach-home',
      passed:
        input.attachHome.composerInputFound &&
        input.attachHome.sendButtonFound &&
        input.attachHome.routeKind !== null &&
        input.attachHome.routeKind !== 'unknown' &&
        input.attachHome.finalUrl !== null,
      failureClass: 'home_entry_drift',
      passMessage: 'Attach-mode inspect-home still resolves a stable composer snapshot.',
      failMessage: 'Attach-mode inspect-home no longer resolves a stable composer snapshot.',
      evidence: {
        routeKind: input.attachHome.routeKind,
        composerInputFound: input.attachHome.composerInputFound,
        sendButtonFound: input.attachHome.sendButtonFound,
        finalUrl: input.attachHome.finalUrl,
      },
    }),
    createCheck({
      id: 'ephemeral-home',
      passed:
        input.ephemeralHome.composerInputFound &&
        input.ephemeralHome.sendButtonFound &&
        input.ephemeralHome.routeKind !== null &&
        input.ephemeralHome.routeKind !== 'unknown' &&
        input.ephemeralHome.finalUrl !== null,
      failureClass: 'home_entry_drift',
      passMessage: 'Ephemeral inspect-home still resolves a stable composer snapshot.',
      failMessage: 'Ephemeral inspect-home no longer resolves a stable composer snapshot.',
      evidence: {
        routeKind: input.ephemeralHome.routeKind,
        composerInputFound: input.ephemeralHome.composerInputFound,
        sendButtonFound: input.ephemeralHome.sendButtonFound,
        finalUrl: input.ephemeralHome.finalUrl,
      },
    }),
    createCheck({
      id: 'session-created',
      passed:
        input.sessionCreation.sessionId !== null &&
        input.sessionCreation.finalUrl !== null &&
        input.sessionCreation.routeSessionId === input.sessionCreation.sessionId &&
        input.sessionCreation.assistantTextLength > 0,
      failureClass: 'route_authority_drift',
      passMessage: 'First message still materializes a session whose final route matches the authoritative session id.',
      failMessage:
        'First message no longer yields a stable authoritative session id / final route pairing.',
      evidence: {
        sessionId: input.sessionCreation.sessionId,
        finalUrl: input.sessionCreation.finalUrl,
        routeSessionId: input.sessionCreation.routeSessionId,
        sessionCreateId: input.sessionCreation.sessionCreateId,
        assistantTextLength: input.sessionCreation.assistantTextLength,
      },
    }),
    createCheck({
      id: 'session-restore',
      passed:
        input.sessionCreation.sessionId !== null &&
        input.sessionRestore.authoritativeSessionId === input.sessionCreation.sessionId &&
        input.sessionRestore.routeVerified === true &&
        (input.sessionRestore.contextSource === 'history_messages' ||
          input.sessionRestore.contextSource === 'stored-session') &&
        input.sessionRestore.branchCount > 0,
      failureClass: 'session_restore_drift',
      passMessage: 'Session restore still verifies the authoritative session route and context source.',
      failMessage: 'Session restore drifted: authoritative route/context evidence is incomplete.',
      evidence: {
        createdSessionId: input.sessionCreation.sessionId,
        restoredSessionId: input.sessionRestore.authoritativeSessionId,
        routeVerified: input.sessionRestore.routeVerified,
        contextSource: input.sessionRestore.contextSource,
        branchCount: input.sessionRestore.branchCount,
      },
    }),
    createCheck({
      id: 'cli-openai-responses-stream',
      passed:
        input.cliOpenAiResponsesStream.chunkCount > 0 &&
        input.cliOpenAiResponsesStream.typeCount > 0 &&
        (input.cliOpenAiResponsesStream.responseCreated ||
          input.cliOpenAiResponsesStream.responseCompleted) &&
        input.cliOpenAiResponsesStream.nativeKindCount === 0,
      failureClass: 'openai_shape_drift',
      passMessage:
        'CLI stream-json output still emits OpenAI responses-style events rather than native canonical events.',
      failMessage:
        'CLI stream-json output drifted away from OpenAI responses event semantics.',
      evidence: {
        chunkCount: input.cliOpenAiResponsesStream.chunkCount,
        typeCount: input.cliOpenAiResponsesStream.typeCount,
        responseCreated: input.cliOpenAiResponsesStream.responseCreated,
        responseCompleted: input.cliOpenAiResponsesStream.responseCompleted,
        nativeKindCount: input.cliOpenAiResponsesStream.nativeKindCount,
      },
    }),
    createCheck({
      id: 'interactive-entrypoint',
      passed:
        input.sessionCreation.sessionId !== null &&
        input.interactive.sessionId === input.sessionCreation.sessionId &&
        input.interactive.finalUrl === input.sessionCreation.finalUrl &&
        input.interactive.assistantTextLength > 0,
      failureClass: 'entrypoint_drift',
      passMessage: 'Interactive reply-session still runs through the real shell entrypoint and returns session-bound output.',
      failMessage:
        'Interactive reply-session drifted: session binding or buffered output is missing.',
      evidence: {
        createdSessionId: input.sessionCreation.sessionId,
        interactiveSessionId: input.interactive.sessionId,
        interactiveFinalUrl: input.interactive.finalUrl,
        assistantTextLength: input.interactive.assistantTextLength,
      },
    }),
    createCheck({
      id: 'rpc-entrypoint',
      passed:
        input.rpc.jsonrpc === '2.0' &&
        input.rpc.outputFormat === 'json' &&
        input.rpc.outputJsonShape === 'openai-chat-completions' &&
        input.rpc.objectType === 'chat.completion' &&
        input.rpc.sessionId === input.sessionCreation.sessionId &&
        input.rpc.assistantTextLength > 0,
      failureClass: 'output_mode_drift',
      passMessage:
        'RPC buffered reply still emits an OpenAI chat.completion payload with summary metadata.',
      failMessage:
        'RPC buffered reply drifted: OpenAI chat.completion payload or summary metadata is missing.',
      evidence: {
        jsonrpc: input.rpc.jsonrpc,
        outputFormat: input.rpc.outputFormat,
        outputJsonShape: input.rpc.outputJsonShape,
        objectType: input.rpc.objectType,
        sessionId: input.rpc.sessionId,
        assistantTextLength: input.rpc.assistantTextLength,
      },
    }),
    createCheck({
      id: 'warm-runtime-status',
      passed:
        input.warmRuntimeStatus.browserId === input.warmRuntimeStart.browserId &&
        input.warmRuntimeStatus.mode === 'warm' &&
        input.warmRuntimeStatus.owner === 'managed' &&
        input.warmRuntimeStatus.lastUsedAt !== null &&
        (input.warmRuntimeStatus.state === 'idle' ||
          input.warmRuntimeStatus.state === 'busy' ||
          input.warmRuntimeStatus.state === 'ready'),
      failureClass: 'browser_runtime_drift',
      passMessage:
        'Warm runtime remained registered and reusable after the CLI/interactive/RPC regression commands.',
      failMessage:
        'Warm runtime no longer remained registered/reusable after the regression commands.',
      evidence: {
        startedBrowserId: input.warmRuntimeStart.browserId,
        statusBrowserId: input.warmRuntimeStatus.browserId,
        state: input.warmRuntimeStatus.state,
        mode: input.warmRuntimeStatus.mode,
        owner: input.warmRuntimeStatus.owner,
        lastUsedAt: input.warmRuntimeStatus.lastUsedAt,
      },
    }),
  ]

  return {
    scenario: 'release-core',
    ok: checks.every(check => check.status === 'pass'),
    checks,
  }
}

function createCheck(input: {
  id: string
  passed: boolean
  failureClass: Exclude<DeepSeekCoreRegressionFailureClass, 'ok'>
  passMessage: string
  failMessage: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekCoreRegressionCheck {
  return {
    id: input.id,
    status: input.passed ? 'pass' : 'fail',
    failureClass: input.passed ? 'ok' : input.failureClass,
    message: input.passed ? input.passMessage : input.failMessage,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  }
}
