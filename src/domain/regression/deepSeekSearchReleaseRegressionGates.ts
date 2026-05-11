import type {
  DeepSeekSearchReleaseRegressionCheck,
  DeepSeekSearchReleaseRegressionFailureClass,
  DeepSeekSearchReleaseRegressionInput,
  DeepSeekSearchReleaseRegressionReport,
} from '../../types/deepseek-search-release-regression.types.js'

export function evaluateDeepSeekSearchReleaseRegression(
  input: DeepSeekSearchReleaseRegressionInput,
): DeepSeekSearchReleaseRegressionReport {
  const unresolvedUiRetryChecks = input.uiRetryRegression.checks.filter(
    check => check.status === 'warn',
  )
  const uiRetryFailures = input.uiRetryRegression.checks.filter(
    check => check.status === 'fail',
  )
  const rateLimitObserved = input.rateLimitSurface.rateLimitObserved
  const autoRetryObserved = input.autoRetry.retryObserved

  const checks: DeepSeekSearchReleaseRegressionCheck[] = [
    createCheck({
      id: 'search-success-gate',
      passed: input.searchSuccessGate.ok,
      failureClass: 'search_success_drift',
      passMessage:
        'Search success release gate still passes across search reply, output surfaces, and export recovery.',
      failMessage:
        'Search success release gate drifted: at least one search surface or export regression failed.',
      evidence: {
        failedChecks: input.searchSuccessGate.checks
          .filter(check => check.status === 'fail')
          .map(check => ({
            id: check.id,
            failureClass: check.failureClass,
          })),
      },
    }),
    createCheck({
      id: 'fact-check-template',
      passed:
        input.factCheckTemplate.requiredDeepThink === 'on' &&
        input.factCheckTemplate.requiredSearch === 'on' &&
        input.factCheckTemplate.promptHasClaimSection &&
        input.factCheckTemplate.promptHasTaskSection &&
        input.factCheckTemplate.promptHasOutputStructureSection &&
        input.factCheckTemplate.promptHasProbabilityBuckets &&
        input.factCheckTemplate.verificationScriptMentionsOpeningPrefix,
      failureClass: 'fact_check_template_drift',
      passMessage:
        'Fact-check prompt template still enforces DeepThink/Search, probability buckets, and opening-prefix verification.',
      failMessage:
        'Fact-check prompt template drifted away from the shared verification contract.',
      evidence: {
        sampleId: input.factCheckTemplate.sampleId,
        expectedOpeningPrefix: input.factCheckTemplate.expectedOpeningPrefix,
        requiredDeepThink: input.factCheckTemplate.requiredDeepThink,
        requiredSearch: input.factCheckTemplate.requiredSearch,
      },
    }),
    createCheck({
      id: 'fact-check-live-output',
      passed:
        input.factCheckExecution.assistantStartsWithExpectedOpeningPrefix &&
        input.factCheckExecution.probabilityBucketLabelCount === 3 &&
        input.factCheckExecution.probabilityPercentMentionCount > 0 &&
        input.factCheckExecution.assistantSearchCount > 0 &&
        input.factCheckExecution.assistantCitationCount > 0,
      failureClass: 'fact_check_output_drift',
      passMessage:
        'Live fact-check reply still opens with the expected prefix and carries probability, search, and citation evidence.',
      failMessage:
        'Live fact-check reply drifted: opening prefix, probability output, or search/citation evidence is missing.',
      evidence: {
        sessionId: input.factCheckExecution.sessionId,
        probabilityBucketLabelCount: input.factCheckExecution.probabilityBucketLabelCount,
        probabilityPercentMentionCount: input.factCheckExecution.probabilityPercentMentionCount,
        assistantSearchCount: input.factCheckExecution.assistantSearchCount,
        assistantCitationCount: input.factCheckExecution.assistantCitationCount,
      },
    }),
    createCheck({
      id: 'fact-check-surfaces-and-export',
      passed:
        input.factCheckExecution.cliTextHasCitations &&
        input.factCheckExecution.cliTextHasSearchResultSet &&
        input.factCheckExecution.cliJsonSearchCount > 0 &&
        input.factCheckExecution.cliJsonCitationCount > 0 &&
        input.factCheckExecution.cliStreamHasSearchPatch &&
        input.factCheckExecution.rpcSearchCount > 0 &&
        input.factCheckExecution.rpcCitationCount > 0 &&
        input.factCheckExecution.branchExportHasSearchEvidence &&
        input.factCheckExecution.branchExportCitationCount > 0 &&
        input.factCheckExecution.sessionExportSearchBranchCount > 0,
      failureClass: 'fact_check_output_drift',
      passMessage:
        'Fact-check reply still exposes searches/citations through text/json/stream-json, RPC summary, and export surfaces.',
      failMessage:
        'Fact-check reply lost searches/citations on one or more output or export surfaces.',
      evidence: {
        cliJsonSearchCount: input.factCheckExecution.cliJsonSearchCount,
        cliJsonCitationCount: input.factCheckExecution.cliJsonCitationCount,
        rpcSearchCount: input.factCheckExecution.rpcSearchCount,
        rpcCitationCount: input.factCheckExecution.rpcCitationCount,
        sessionExportSearchBranchCount:
          input.factCheckExecution.sessionExportSearchBranchCount,
      },
    }),
    ...(rateLimitObserved
      ? [
          createCheck({
            id: 'rate-limit-output',
            passed:
              input.rateLimitSurface.inducedByParallelSearchProbe &&
              input.rateLimitSurface.rateLimitCode === 'rate_limit_exceeded' &&
              input.rateLimitSurface.scope === 'search' &&
              input.rateLimitSurface.retryable === true &&
              input.rateLimitSurface.cliTextHasRateLimitNotice &&
              input.rateLimitSurface.cliJsonRateLimitCode === 'rate_limit_exceeded' &&
              input.rateLimitSurface.cliStreamHasRateLimitFrame,
            failureClass: 'rate_limit_retry_drift',
            passMessage:
              'Search rate-limit output still renders explicit text/json/stream-json evidence under real parallel pressure.',
            failMessage:
              'Search rate-limit output drifted: explicit rate-limit evidence is missing from one or more output surfaces.',
            evidence: {
              rateLimitCode: input.rateLimitSurface.rateLimitCode,
              scope: input.rateLimitSurface.scope,
              uiObservationStatus: input.rateLimitSurface.uiObservationStatus,
            },
          }),
        ]
      : [
          createWarnCheck({
            id: 'rate-limit-output',
            condition: true,
            failureClass: 'rate_limit_observation_pending',
            message:
              'The bounded live regression window did not reproduce a fresh search-path rate-limit sample; existing audited fixtures still cover the delivery contract.',
            evidence: {
              inducedByParallelSearchProbe:
                input.rateLimitSurface.inducedByParallelSearchProbe,
            },
          }),
        ]),
    ...(!rateLimitObserved && !autoRetryObserved
      ? [
          createWarnCheck({
            id: 'auto-retry-cooldown-replay',
            condition: true,
            failureClass: 'rate_limit_observation_pending',
            message:
              'The bounded live regression window did not trigger a real search rate-limit, so API cooldown/replay auto-retry remained pending in this run; fixture and unit gates still cover the retry contract.',
            evidence: {
              totalAttempts: input.autoRetry.totalAttempts,
              retriedAttempts: input.autoRetry.retriedAttempts,
            },
          }),
        ]
      : [
          createCheck({
            id: 'auto-retry-cooldown-replay',
            passed:
              input.autoRetry.inducedByParallelSearchProbe &&
              input.autoRetry.retryObserved &&
              input.autoRetry.totalAttempts >= 2 &&
              input.autoRetry.retriedAttempts > 0 &&
              input.autoRetry.boundaryStrategy === 'api-cooldown-replay' &&
              input.autoRetry.firstAttemptRateLimitCode === 'rate_limit_exceeded' &&
              input.autoRetry.scheduledEventCount > 0 &&
              input.autoRetry.startingEventCount > 0,
            failureClass: 'rate_limit_retry_drift',
            passMessage:
              'API-level cooldown/replay automatic retry still triggers from a real search rate limit and records retry attempts.',
            failMessage:
              'Automatic retry drifted: rate-limited search no longer schedules a controlled cooldown/replay retry.',
            evidence: {
              totalAttempts: input.autoRetry.totalAttempts,
              retriedAttempts: input.autoRetry.retriedAttempts,
              exhausted: input.autoRetry.exhausted,
              boundaryStrategy: input.autoRetry.boundaryStrategy,
              boundaryUiRetryControlStatus:
                input.autoRetry.boundaryUiRetryControlStatus,
              tickEventCount: input.autoRetry.tickEventCount,
            },
          }),
        ]),
    ...(input.uiRetryProbeSummary.rateLimitCount > 0
      ? [
          createCheck({
            id: 'ui-retry-confirmed-path',
            passed: uiRetryFailures.length === 0,
            failureClass: 'ui_retry_boundary_drift',
            passMessage:
              'Confirmed search-path UI retry behavior still remains observed/clickable and separated from the other retry classes.',
            failMessage:
              'UI retry boundary drifted: confirmed search-path retry evidence is missing or regressed.',
            evidence: {
              rateLimitCount: input.uiRetryProbeSummary.rateLimitCount,
              failedChecks: uiRetryFailures.map(check => ({
                id: check.id,
                failureClass: check.failureClass,
              })),
            },
          }),
        ]
      : [
          createWarnCheck({
            id: 'ui-retry-confirmed-path',
            condition: true,
            failureClass: 'rate_limit_observation_pending',
            message:
              'The bounded live regression window did not reproduce a fresh search-path rate-limit sample, so UI retry confirmation remained pending in this run.',
            evidence: {
              rateLimitCount: input.uiRetryProbeSummary.rateLimitCount,
            },
          }),
        ]),
    createWarnCheck({
      id: 'ui-retry-unresolved-boundaries',
      condition: unresolvedUiRetryChecks.length > 0,
      failureClass: 'ui_retry_boundary_unresolved',
      message:
        'General rate-limit or generation-failed retry UI remains unresolved; the release report still keeps it separate from the confirmed search-path retry control.',
      evidence: {
        unresolvedChecks: unresolvedUiRetryChecks.map(check => ({
          id: check.id,
          failureClass: check.failureClass,
        })),
      },
    }),
    createCheck({
      id: 'reference-rendering',
      passed:
        input.referenceRendering.liveTextHasCitations &&
        (input.referenceRendering.liveTextHasExactPage ||
          input.referenceRendering.liveTextHasSearchResultSet) &&
        input.referenceRendering.repeatedTopLevelReferenceOrdinals.length === 0 &&
        input.referenceRendering.suspectedGeneratedCitationSummaryRendered &&
        input.referenceRendering.suspectedGeneratedCitationAvoidedStructuredPromotion,
      failureClass: 'reference_rendering_drift',
      passMessage:
        'Reference rendering still keeps verified sources readable and suspected generated citations explicitly separate.',
      failMessage:
        'Reference rendering drifted: verified source labels or suspected-generated-citation handling regressed.',
      evidence: {
        repeatedTopLevelReferenceOrdinals:
          input.referenceRendering.repeatedTopLevelReferenceOrdinals,
      },
    }),
  ]

  return {
    scenario: 'release-search-and-fact-check',
    ok: checks.every(check => check.status !== 'fail'),
    checks,
  }
}

function createCheck(input: {
  id: string
  passed: boolean
  failureClass: Exclude<DeepSeekSearchReleaseRegressionFailureClass, 'ok'>
  passMessage: string
  failMessage: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekSearchReleaseRegressionCheck {
  return {
    id: input.id,
    status: input.passed ? 'pass' : 'fail',
    failureClass: input.passed ? 'ok' : input.failureClass,
    message: input.passed ? input.passMessage : input.failMessage,
    evidence: input.evidence,
  }
}

function createWarnCheck(input: {
  id: string
  condition: boolean
  failureClass: Extract<
    DeepSeekSearchReleaseRegressionFailureClass,
    'ui_retry_boundary_unresolved' | 'rate_limit_observation_pending'
  >
  message: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekSearchReleaseRegressionCheck {
  return {
    id: input.id,
    status: input.condition ? 'warn' : 'pass',
    failureClass: input.condition ? input.failureClass : 'ok',
    message: input.condition ? input.message : 'No unresolved warning for this gate.',
    evidence: input.evidence,
  }
}
