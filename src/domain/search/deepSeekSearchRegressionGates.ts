import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type {
  DeepSeekSearchRateLimitRegressionInput,
  DeepSeekSearchRegressionCheck,
  DeepSeekSearchRegressionFailureClass,
  DeepSeekSearchRegressionReport,
  DeepSeekSearchRegressionSuiteReport,
  DeepSeekSearchSuccessRegressionInput,
  DeepSeekSearchUiRetryProbeMatrixEntry,
  DeepSeekSearchUiRetryRegressionInput,
} from '../../types/deepseek-search-regression.types.js'
import { resolveDeepSeekReplyRateLimitMetadata } from './deepSeekSearchRateLimitOutput.js'

export function evaluateDeepSeekSearchSuccessRegression(
  input: DeepSeekSearchSuccessRegressionInput,
): DeepSeekSearchRegressionReport {
  const searchSignals = collectReplySearchSignals(input.result)
  const branchSignals = collectExportBranchSignals(input.branchExportDocument)
  const sessionSignals = collectSessionExportSignals(input.sessionExportDocument)
  const streamKinds = input.cliStreamJsonOutput
    .map(item => readStringProperty(item, 'kind'))
    .filter(Boolean)
  const rpcStreamKinds = input.rpcStreamFrames
    .map(frame => readStringProperty(readRpcOutputData(frame.output), 'kind'))
    .filter(Boolean)

  const checks: DeepSeekSearchRegressionCheck[] = [
    createCheck({
      id: 'search-triggered',
      passed: searchSignals.searchRequested && searchSignals.searchDetected,
      failureClass: 'search_not_triggered',
      passMessage: 'Search-enabled reply produced confirmed search/citation signals.',
      failMessage:
        'Search was enabled but the reply result did not expose confirmed search/citation signals.',
      evidence: {
        searchRequested: searchSignals.searchRequested,
        searchCount: searchSignals.searchCount,
        citationCount: searchSignals.citationCount,
      },
    }),
    createCheck({
      id: 'cli-text',
      passed: input.cliTextOutput.trim().length > 0,
      failureClass: 'surface_output_drift',
      passMessage: 'CLI text output remained non-empty for the search reply.',
      failMessage: 'CLI text output was blank for the search reply.',
      evidence: {
        length: input.cliTextOutput.trim().length,
      },
    }),
    createCheck({
      id: 'interactive-text',
      passed:
        input.interactiveTextOutput.trim().length > 0 &&
        input.interactiveTextOutput.trim() === input.cliTextOutput.trim(),
      failureClass: 'surface_output_drift',
      passMessage:
        'Interactive text output matched the shared CLI renderer for the search reply.',
      failMessage:
        'Interactive text output drifted from the shared CLI renderer for the search reply.',
      evidence: {
        cliLength: input.cliTextOutput.trim().length,
        interactiveLength: input.interactiveTextOutput.trim().length,
      },
    }),
    createCheck({
      id: 'cli-json',
      passed: hasSearchSignalsInUnknownDocument(input.cliJsonOutput),
      failureClass: 'surface_output_drift',
      passMessage: 'CLI buffered JSON output preserved search/citation evidence.',
      failMessage: 'CLI buffered JSON output no longer exposed search/citation evidence.',
      evidence: {
        searchCount: countNestedSearches(input.cliJsonOutput),
        citationCount: countNestedCitations(input.cliJsonOutput),
      },
    }),
    createCheck({
      id: 'cli-stream-json',
      passed:
        streamKinds.includes('search.patch') ||
        hasSearchSignalsInUnknownDocument(input.cliStreamJsonOutput.at(-1)),
      failureClass: 'surface_output_drift',
      passMessage: 'CLI stream-json output preserved search.patch or finalized search evidence.',
      failMessage:
        'CLI stream-json output no longer exposed search.patch or finalized search evidence.',
      evidence: {
        streamKinds,
      },
    }),
    createCheck({
      id: 'rpc-streaming',
      passed:
        (rpcStreamKinds.includes('search.patch') ||
          hasSearchSignalsInUnknownDocument(
            readRpcOutputData(input.rpcStreamingResult.finalOutput),
          )) &&
        readStringProperty(input.rpcStreamingResult.summary, 'sessionId') !== null,
      failureClass: 'surface_output_drift',
      passMessage: 'RPC streaming path preserved search evidence and final summary metadata.',
      failMessage:
        'RPC streaming path drifted: missing search evidence in frames/final output or summary metadata.',
      evidence: {
        rpcStreamKinds,
        sessionId: readStringProperty(input.rpcStreamingResult.summary, 'sessionId'),
      },
    }),
    createCheck({
      id: 'branch-export',
      passed: branchSignals.hasSearchEvidence && branchSignals.citationCount > 0,
      failureClass: 'citation_export_drift',
      passMessage: 'Branch export preserved citations and derived search evidence.',
      failMessage: 'Branch export drifted: citations/searchEvidence are missing.',
      evidence: branchSignals,
    }),
    createCheck({
      id: 'session-export',
      passed: sessionSignals.branchWithSearchEvidenceCount > 0,
      failureClass: 'citation_export_drift',
      passMessage: 'Full-session export preserved at least one search-enabled branch.',
      failMessage: 'Full-session export no longer preserved any search-enabled branch evidence.',
      evidence: sessionSignals,
    }),
  ]

  return finalizeReport('search-success', checks)
}

export function evaluateDeepSeekSearchRateLimitRegression(
  input: DeepSeekSearchRateLimitRegressionInput,
): DeepSeekSearchRegressionReport {
  const rateLimit = resolveDeepSeekReplyRateLimitMetadata(input.result)
  const streamKinds = input.cliStreamJsonOutput
    .map(item => readStringProperty(item, 'kind'))
    .filter(Boolean)
  const rpcStreamKinds = input.rpcStreamFrames
    .map(frame => readStringProperty(readRpcOutputData(frame.output), 'kind'))
    .filter(Boolean)

  const checks: DeepSeekSearchRegressionCheck[] = [
    createCheck({
      id: 'rate-limit-metadata',
      passed:
        rateLimit?.code === 'rate_limit_exceeded' &&
        rateLimit.scope === 'search' &&
        rateLimit.retryable === true,
      failureClass: 'rate_limited',
      passMessage: 'Search rate-limit metadata remained available on the reply result.',
      failMessage: 'Search rate-limit metadata is missing or no longer normalized as expected.',
      evidence: toEvidenceRecord(rateLimit),
    }),
    createCheck({
      id: 'cli-text',
      passed:
        /rate limit/i.test(input.cliTextOutput) &&
        /rate_limit_exceeded/.test(input.cliTextOutput),
      failureClass: 'surface_output_drift',
      passMessage: 'CLI text output rendered an explicit search rate-limit notice.',
      failMessage: 'CLI text output stopped rendering the search rate-limit notice.',
      evidence: {
        preview: input.cliTextOutput.slice(0, 160),
      },
    }),
    createCheck({
      id: 'interactive-text',
      passed:
        /rate limit/i.test(input.interactiveTextOutput) &&
        /rate_limit_exceeded/.test(input.interactiveTextOutput),
      failureClass: 'surface_output_drift',
      passMessage: 'Interactive text output rendered an explicit search rate-limit notice.',
      failMessage: 'Interactive text output stopped rendering the search rate-limit notice.',
      evidence: {
        preview: input.interactiveTextOutput.slice(0, 160),
      },
    }),
    createCheck({
      id: 'cli-json',
      passed:
        readStringProperty(input.cliJsonOutput, 'rateLimit.code') === 'rate_limit_exceeded' ||
        readStringProperty(input.cliJsonOutput, 'error.code') === 'rate_limit_exceeded',
      failureClass: 'surface_output_drift',
      passMessage: 'CLI buffered JSON output preserved the rate-limit code.',
      failMessage: 'CLI buffered JSON output lost the rate-limit code.',
      evidence: {
        rateLimitCode: readStringProperty(input.cliJsonOutput, 'rateLimit.code'),
        errorCode: readStringProperty(input.cliJsonOutput, 'error.code'),
      },
    }),
    createCheck({
      id: 'cli-stream-json',
      passed: streamKinds.includes('reply.rate_limit'),
      failureClass: 'surface_output_drift',
      passMessage: 'CLI stream-json output preserved the terminal rate-limit metadata frame.',
      failMessage: 'CLI stream-json output lost the terminal rate-limit metadata frame.',
      evidence: {
        streamKinds,
      },
    }),
    createCheck({
      id: 'rpc-buffered',
      passed:
        readStringProperty(input.rpcBufferedResult.summary, 'rateLimit.code') ===
        'rate_limit_exceeded',
      failureClass: 'surface_output_drift',
      passMessage: 'RPC buffered summary preserved the search rate-limit metadata.',
      failMessage: 'RPC buffered summary lost the search rate-limit metadata.',
      evidence: {
        rateLimitCode: readStringProperty(input.rpcBufferedResult.summary, 'rateLimit.code'),
      },
    }),
    createCheck({
      id: 'rpc-streaming',
      passed:
        rpcStreamKinds.includes('reply.rate_limit') &&
        readStringProperty(input.rpcStreamingResult.summary, 'rateLimit.code') ===
          'rate_limit_exceeded',
      failureClass: 'surface_output_drift',
      passMessage: 'RPC streaming preserved both the rate-limit frame and summary metadata.',
      failMessage: 'RPC streaming lost the rate-limit frame or summary metadata.',
      evidence: {
        rpcStreamKinds,
        rateLimitCode: readStringProperty(input.rpcStreamingResult.summary, 'rateLimit.code'),
      },
    }),
    createCheck({
      id: 'retry-boundary',
      passed:
        input.result.retry?.boundary.strategy === 'api-cooldown-replay' &&
        readStringProperty(input.result.retry, 'boundary.uiRetryControlStatus') !== null,
      failureClass: 'surface_output_drift',
      passMessage: 'Retry report preserved the API cooldown replay delivery boundary.',
      failMessage: 'Retry report drifted or lost the delivery boundary metadata.',
      evidence: toEvidenceRecord(input.result.retry?.boundary),
    }),
  ]

  return finalizeReport('search-rate-limit', checks)
}

export function evaluateDeepSeekSearchUiRetryRegression(
  input: DeepSeekSearchUiRetryRegressionInput,
): DeepSeekSearchRegressionReport {
  const searchRateLimitEntry = findProbeMatrixEntry(input.probeReport.matrix, 'search-rate-limit')
  const generalRateLimitEntry = findProbeMatrixEntry(input.probeReport.matrix, 'general-rate-limit')
  const generationFailedEntry = findProbeMatrixEntry(input.probeReport.matrix, 'generation-failed')
  const clickedAttempt = input.probeReport.attempts.find(
    attempt => attempt.retryUiAction?.clicked === true,
  ) ?? null

  const checks: DeepSeekSearchRegressionCheck[] = [
    createCheck({
      id: 'search-rate-limit-observed',
      passed:
        searchRateLimitEntry?.status === 'observed' &&
        input.probeReport.summary.rateLimitCount > 0,
      failureClass: 'rate_limited',
      passMessage: 'Parallel search probe reproduced real search rate-limit samples.',
      failMessage: 'Search rate-limit probe no longer reproduced any real rate-limit samples.',
      evidence: {
        matrixStatus: searchRateLimitEntry?.status ?? null,
        rateLimitCount: input.probeReport.summary.rateLimitCount,
      },
    }),
    createCheck({
      id: 'ui-retry-observed',
      passed: input.probeReport.summary.uiRetryObservedCount > 0,
      failureClass: 'ui_retry_drift',
      passMessage: 'UI retry control was still observed on real rate-limited search replies.',
      failMessage: 'UI retry control was no longer observed on real rate-limited search replies.',
      evidence: {
        uiRetryObservedCount: input.probeReport.summary.uiRetryObservedCount,
      },
    }),
    createCheck({
      id: 'ui-retry-clicked',
      passed:
        input.probeReport.summary.uiRetryClickedCount > 0 &&
        clickedAttempt?.retryUiAction?.targetSource === 'message-action-match' &&
        clickedAttempt.retryUiAction.targetMessageId ===
          clickedAttempt.resolvedUiTargetMessageId,
      failureClass: 'ui_retry_drift',
      passMessage:
        'UI retry control was clicked via the observed message-action target, not by guessing the canonical id.',
      failMessage:
        'UI retry click flow drifted or no longer resolves the observed message-action target.',
      evidence: clickedAttempt
        ? {
            targetMessageId: clickedAttempt.targetMessageId,
            resolvedUiTargetMessageId: clickedAttempt.resolvedUiTargetMessageId,
            targetSource: clickedAttempt.retryUiAction?.targetSource ?? null,
          }
        : undefined,
    }),
    createWarnCheck({
      id: 'general-rate-limit',
      condition: generalRateLimitEntry?.status === 'unresolved',
      failureClass: 'ui_retry_unresolved',
      message:
        'General non-search rate-limit UI retry behavior is still unresolved and should not be conflated with the confirmed search-path retry control.',
      evidence: toEvidenceRecord(generalRateLimitEntry),
    }),
    createWarnCheck({
      id: 'generation-failed',
      condition: generationFailedEntry?.status === 'unresolved',
      failureClass: 'ui_retry_unresolved',
      message:
        'Generic generation-failed retry UI behavior is still unresolved and remains outside the confirmed B58E search-path findings.',
      evidence: toEvidenceRecord(generationFailedEntry),
    }),
  ]

  return finalizeReport('search-ui-retry', checks)
}

export function buildDeepSeekSearchRegressionSuiteReport(
  reports: DeepSeekSearchRegressionReport[],
): DeepSeekSearchRegressionSuiteReport {
  return {
    generatedAt: new Date().toISOString(),
    ok: reports.every(report => report.ok),
    reports,
  }
}

function finalizeReport(
  scenario: DeepSeekSearchRegressionReport['scenario'],
  checks: DeepSeekSearchRegressionCheck[],
): DeepSeekSearchRegressionReport {
  return {
    scenario,
    ok: checks.every(check => check.status !== 'fail'),
    checks,
  }
}

function createCheck(input: {
  id: string
  passed: boolean
  failureClass: Exclude<DeepSeekSearchRegressionFailureClass, 'ok'>
  passMessage: string
  failMessage: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekSearchRegressionCheck {
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
    DeepSeekSearchRegressionFailureClass,
    'ui_retry_unresolved'
  >
  message: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekSearchRegressionCheck {
  return {
    id: input.id,
    status: input.condition ? 'warn' : 'pass',
    failureClass: input.condition ? input.failureClass : 'ok',
    message: input.condition ? input.message : 'No unresolved warning for this gate.',
    evidence: input.evidence,
  }
}

function collectReplySearchSignals(result: DeepSeekReplyResult): {
  searchRequested: boolean
  searchDetected: boolean
  searchCount: number
  citationCount: number
} {
  const searchRequested =
    result.requestedComposerMode.search === 'on' || result.composerMode.search === 'on'
  const parsedRuns =
    result.output.mode === 'stream' ? result.output.canonicalRuns : []
  const finalizedRuns = parsedRuns.length > 0 ? parsedRuns : result.generationRuns
  const searchCount = finalizedRuns.reduce(
    (total, run) => total + (run.finalized.searches?.length ?? 0),
    0,
  )
  const citationCount = finalizedRuns.reduce(
    (total, run) => total + (run.finalized.citations?.length ?? 0),
    0,
  )

  return {
    searchRequested,
    searchDetected: searchCount > 0 || citationCount > 0,
    searchCount,
    citationCount,
  }
}

function collectExportBranchSignals(document: unknown): {
  hasSearchEvidence: boolean
  citationCount: number
  searchEvidenceResultCount: number
} {
  return {
    hasSearchEvidence: readBooleanProperty(document, 'branch.searchEvidence.available') === true,
    citationCount: readArrayProperty(document, 'branch.citations').length,
    searchEvidenceResultCount: readNumberProperty(document, 'branch.searchEvidence.resultCount') ?? 0,
  }
}

function collectSessionExportSignals(document: unknown): {
  branchWithSearchEvidenceCount: number
  branchCount: number
} {
  const branches = readArrayProperty(document, 'branches')
  const branchWithSearchEvidenceCount = branches.filter(
    branch => readBooleanProperty(branch, 'searchEvidence.available') === true,
  ).length
  return {
    branchWithSearchEvidenceCount,
    branchCount: branches.length,
  }
}

function hasSearchSignalsInUnknownDocument(document: unknown): boolean {
  return countNestedSearches(document) > 0 || countNestedCitations(document) > 0
}

function countNestedSearches(document: unknown): number {
  return collectArrayLengths(document, 'searches')
}

function countNestedCitations(document: unknown): number {
  return collectArrayLengths(document, 'citations')
}

function collectArrayLengths(document: unknown, key: string): number {
  let total = 0
  walkUnknown(document, value => {
    if (key in value) {
      const candidate = value[key]
      if (Array.isArray(candidate)) {
        total += candidate.length
      }
    }
  })
  return total
}

function walkUnknown(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkUnknown(item, visit)
    }
    return
  }

  const record = value as Record<string, unknown>
  visit(record)
  for (const child of Object.values(record)) {
    walkUnknown(child, visit)
  }
}

function findProbeMatrixEntry(
  matrix: DeepSeekSearchUiRetryProbeMatrixEntry[],
  condition: DeepSeekSearchUiRetryProbeMatrixEntry['condition'],
): DeepSeekSearchUiRetryProbeMatrixEntry | null {
  return matrix.find(entry => entry.condition === condition) ?? null
}

function readStringProperty(value: unknown, path: string): string | null {
  const candidate = readPath(value, path)
  return typeof candidate === 'string' && candidate.trim() ? candidate : null
}

function readBooleanProperty(value: unknown, path: string): boolean | null {
  const candidate = readPath(value, path)
  return typeof candidate === 'boolean' ? candidate : null
}

function readNumberProperty(value: unknown, path: string): number | null {
  const candidate = readPath(value, path)
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function readArrayProperty(value: unknown, path: string): unknown[] {
  const candidate = readPath(value, path)
  return Array.isArray(candidate) ? candidate : []
}

function readPath(value: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = value
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function readRpcOutputData(output: unknown): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null
  }

  return 'data' in output ? (output as { data?: unknown }).data ?? null : null
}

function toEvidenceRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}
