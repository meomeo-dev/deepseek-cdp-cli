import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { buildDeepSeekReleaseCompatibilityRecord } from '../../domain/regression/deepSeekReleaseFingerprint.js'
import {
  createHallucinatedCitationOutputDriftFixtureReplyResult,
  createSearchEnabledOutputDriftFixtureReplyResult,
} from '../../domain/regression/deepSeekOutputDriftFixtures.js'
import {
  exportSessionBranchToJson,
  exportSessionBranchToMarkdown,
  exportSessionToJson,
  exportSessionToMarkdown,
} from '../../domain/session/sessionExport.js'
import { buildDeepSeekSessionExportSnapshot } from '../../domain/session/sessionExportSnapshot.js'
import { exportSessionBranchToText, exportSessionToText } from '../../domain/session/sessionTextExport.js'
import { buildDeepSeekCliOutputChunks, resolveDeepSeekCliOutputMode } from '../../interfaces/cli/deepSeekCliOutput.js'
import { captureDeepSeekReleaseFingerprint } from '../services/captureDeepSeekReleaseFingerprint.js'
import { resolveIsolatedManagedChromeOptions } from '../services/browserRuntimeIsolation.js'
import { deleteDeepSeekSession } from './deleteDeepSeekSession.js'
import { replyDeepSeekMessage } from './replyDeepSeekMessage.js'
import { mapHistoryMessagesEnvelopeToSession, isDeepSeekSession } from '../../infrastructure/deepseek/historyMessagesMapper.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { DeepSeekResolvedSessionSource } from '../../types/deepseek-branch-catalog.types.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type {
  DeepSeekSessionBranchExportDocument,
  DeepSeekSessionExportDocument,
} from '../../types/deepseek-export.types.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'
import type { DeepSeekReplyResult } from '../../types/deepseek-reply.types.js'
import type { DeepSeekStoredSession } from '../../types/deepseek-session.types.js'
import type {
  AuditDeepSeekOutputDriftInput,
  DeepSeekOutputDriftAuditCheck,
  DeepSeekOutputDriftAuditCheckStatus,
  DeepSeekOutputDriftAuditReport,
  DeepSeekOutputDriftCleanupEntry,
  DeepSeekOutputDriftExportSurfaces,
  DeepSeekOutputDriftFixtureBaselines,
  DeepSeekOutputDriftFixtureExportBaseline,
  DeepSeekOutputDriftFixtureReplyBaseline,
  DeepSeekOutputDriftLiveScenario,
  DeepSeekOutputDriftReplySurfaces,
} from '../../types/deepseek-output-drift-audit.types.js'

const DEFAULT_LIVE_PROMPTS: Record<DeepSeekChatMode, string> = {
  instant: 'Reply with exactly: instant output drift audit ok.',
  expert: 'Reply with exactly: expert output drift audit ok.',
  vision: 'Reply with exactly: vision output drift audit ok.',
}
const DEFAULT_ATTACHMENT_FILE = 'README.md'
const SEARCH_HISTORY_FIXTURE_FILE =
  'test/fixtures/deepseek-history-messages/history-messages.search.real.fixture.json'
const ATTACHMENT_EXPORT_FIXTURE_FILE = 'test/fixtures/sample-session.json'
const LINEAGE_EXPORT_FIXTURE_FILE = 'test/fixtures/sample-history-messages.json'

export async function auditDeepSeekOutputDrift(
  input: AuditDeepSeekOutputDriftInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'output-drift-audit' }),
): Promise<DeepSeekOutputDriftAuditReport> {
  const workingDir = await mkdtemp(join(tmpdir(), 'deepseek-output-drift-audit-'))

  try {
    const isolatedChrome = await resolveIsolatedManagedChromeOptions({
      chrome: input,
      purpose: 'audit',
    })
    const releaseFingerprint = await captureDeepSeekReleaseFingerprint(
      {
        ...isolatedChrome,
        targetUrl: input.url,
        waitUntil: input.waitUntil,
      },
      logger.child('release-fingerprint'),
    )
    const attachmentFile = await resolveAuditAttachmentFile(input.attachmentFile)
    const currentLiveScenarios: DeepSeekOutputDriftLiveScenario[] = []
    const cleanup: DeepSeekOutputDriftCleanupEntry[] = []

    for (const requestedMode of ['instant', 'expert'] satisfies DeepSeekChatMode[]) {
      const artifact = await materializeCurrentLiveOutputScenario(
        {
          chrome: isolatedChrome,
          requestedMode,
          prompt:
            requestedMode === 'expert'
              ? input.expertPrompt ?? DEFAULT_LIVE_PROMPTS.expert
              : input.instantPrompt ?? DEFAULT_LIVE_PROMPTS.instant,
          attachmentFile: requestedMode === 'expert' ? attachmentFile : null,
          sessionStoreDir: resolve(workingDir, requestedMode),
          url: input.url,
          waitUntil: input.waitUntil,
          releaseFingerprintComposite: releaseFingerprint.compositeFingerprint,
        },
        logger.child(`live:${requestedMode}`),
      )
      currentLiveScenarios.push(artifact.scenario)
      cleanup.push(artifact.cleanup)
    }

    const fixtureBaselines = await buildDeepSeekOutputDriftFixtureBaselines()
    const checks = buildDeepSeekOutputDriftChecks({
      currentLiveScenarios,
      fixtureBaselines,
    })
    const report: DeepSeekOutputDriftAuditReport = {
      scenario: 'output-drift-audit',
      capturedAt: new Date().toISOString(),
      requestedUrl: input.url,
      releaseFingerprints: [releaseFingerprint],
      compatibility: buildDeepSeekReleaseCompatibilityRecord({
        artifactKind: 'audit',
        releaseFingerprints: [releaseFingerprint],
        failureCount: countCheckStatus(checks, 'fail'),
        warningCount: countCheckStatus(checks, 'warn'),
      }),
      currentLiveScenarios,
      cleanup,
      fixtureBaselines,
      checks,
      notes: [
        'Current live output evidence is intentionally bounded to Instant/Expert smoke runs plus the current attachment-aware Expert contract; Vision image output/export coverage is owned by mode-audit and release-diff until output-drift adds a dedicated image wave.',
        'Search/citation/inline-reference/lineage rendering stays fixture-backed in this audit so we do not force fresh search pressure or mutation permutations on the live site.',
        'If DeepSeek adds new citation or rendering behavior and this audit fails, treat it as an output drift candidate first rather than immediately assuming a local regression.',
        attachmentFile
          ? `Expert live smoke used attachment file ${attachmentFile}.`
          : 'No attachment file was available for the Expert live smoke, so attachment-aware current-window evidence remains warning-level only.',
      ],
    }

    if (input.outputFile) {
      const outputFile = resolve(process.cwd(), input.outputFile)
      await mkdir(dirname(outputFile), { recursive: true })
      await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }

    return report
  } catch (error) {
    logDeepSeekRuntimeFailure({
      logger,
      message: 'DeepSeek output drift audit failed',
      error,
      context: {
        url: input.url,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        outputFile: input.outputFile ?? null,
      },
    })
    throw error
  } finally {
    await rm(workingDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function buildDeepSeekOutputDriftFixtureBaselines(): Promise<DeepSeekOutputDriftFixtureBaselines> {
  const replyBaselines: DeepSeekOutputDriftFixtureReplyBaseline[] = [
    {
      id: 'search-enabled-reply',
      source: 'fixture',
      replySurfaces: captureReplyOutputSurfaces(createSearchEnabledOutputDriftFixtureReplyResult()),
      notes: [
        'Fixture-backed search reply baseline covers citations, response references, and search result set rendering without forcing a new live search.',
      ],
    },
    {
      id: 'suspected-generated-citation-reply',
      source: 'fixture',
      replySurfaces: captureReplyOutputSurfaces(
        createHallucinatedCitationOutputDriftFixtureReplyResult(),
      ),
      notes: [
        'Fixture-backed reply baseline keeps citation-like tokens without RESPONSE.references[] explicit instead of silently upgrading them into verified citations.',
      ],
    },
  ]

  const searchSource = await loadAuditFixtureSessionSource(SEARCH_HISTORY_FIXTURE_FILE)
  const attachmentSource = await loadAuditFixtureSessionSource(ATTACHMENT_EXPORT_FIXTURE_FILE)
  const lineageSource = await loadAuditFixtureSessionSource(LINEAGE_EXPORT_FIXTURE_FILE)
  const hallucinatedSource = buildInlineCitationFixtureSessionSource()

  const exportBaselines: DeepSeekOutputDriftFixtureExportBaseline[] = [
    {
      id: 'search-branch-export',
      source: 'fixture',
      exportSurfaces: captureExportSurfaces(searchSource),
      notes: [
        'Fixture-backed export baseline preserves search evidence, inline reference mapping, and text-vs-markdown rendering boundaries.',
      ],
    },
    {
      id: 'attachment-branch-export',
      source: 'fixture',
      exportSurfaces: captureExportSurfaces(attachmentSource),
      notes: [
        'Fixture-backed export baseline keeps attachment rendering in text/markdown/json explicit and transcript-first.',
      ],
    },
    {
      id: 'lineage-session-export',
      source: 'fixture',
      exportSurfaces: captureExportSurfaces(lineageSource),
      notes: [
        'Fixture-backed full-session export baseline keeps multi-branch lineage and branch index rendering stable.',
      ],
    },
    {
      id: 'suspected-generated-citation-export',
      source: 'fixture',
      exportSurfaces: captureExportSurfaces(hallucinatedSource),
      notes: [
        'Fixture-backed export baseline keeps suspected generated citations explicit in both text and markdown outputs.',
      ],
    },
  ]

  return {
    replyBaselines,
    exportBaselines,
  }
}

export function buildDeepSeekOutputDriftChecks(input: {
  currentLiveScenarios: DeepSeekOutputDriftLiveScenario[]
  fixtureBaselines: DeepSeekOutputDriftFixtureBaselines
}): DeepSeekOutputDriftAuditCheck[] {
  const expertLive = input.currentLiveScenarios.find(scenario => scenario.requestedMode === 'expert') ?? null
  const searchReply = requireReplyBaseline(input.fixtureBaselines, 'search-enabled-reply')
  const hallucinatedReply = requireReplyBaseline(
    input.fixtureBaselines,
    'suspected-generated-citation-reply',
  )
  const searchExport = requireExportBaseline(input.fixtureBaselines, 'search-branch-export')
  const attachmentExport = requireExportBaseline(input.fixtureBaselines, 'attachment-branch-export')
  const lineageExport = requireExportBaseline(input.fixtureBaselines, 'lineage-session-export')
  const hallucinatedExport = requireExportBaseline(
    input.fixtureBaselines,
    'suspected-generated-citation-export',
  )

  const replyTextContractPass =
    input.currentLiveScenarios.length === 2 &&
    input.currentLiveScenarios.every(
      scenario =>
        isPlainReplyText(scenario.replySurfaces.bufferedText) &&
        isTranscriptFirstTextExport(scenario.exportSurfaces.branchText) &&
        isTranscriptFirstTextExport(scenario.exportSurfaces.sessionText),
    )
  const replyJsonShapePass = hasExpectedJsonShapeCoverage(searchReply.replySurfaces)
  const exportTextContractPass =
    isTranscriptFirstTextExport(searchExport.exportSurfaces.branchText) &&
    hasMarkdownAuditSections(searchExport.exportSurfaces.branchMarkdown) &&
    isTranscriptFirstTextExport(attachmentExport.exportSurfaces.branchText) &&
    hasMarkdownHeading(attachmentExport.exportSurfaces.branchMarkdown)
  const citationRenderingPass =
    hasSearchCitationTextRendering(searchReply.replySurfaces.bufferedText) &&
    hasSearchCitationTextRendering(searchExport.exportSurfaces.branchText) &&
    hasMarkdownAuditSections(searchExport.exportSurfaces.branchMarkdown) &&
    hasSearchJsonEvidence(searchExport.exportSurfaces.branchJson)
  const modeFactDeliveryPass =
    input.currentLiveScenarios.length === 2 &&
    input.currentLiveScenarios.every(
      scenario =>
        scenario.modeFact?.resolvedMode === scenario.requestedMode &&
        hasModeFactInTextExport(scenario.exportSurfaces.branchText) &&
        hasModeFactInTextExport(scenario.exportSurfaces.sessionText) &&
        hasModeFactInMarkdownExport(scenario.exportSurfaces.branchMarkdown) &&
        hasModeFactInMarkdownExport(scenario.exportSurfaces.sessionMarkdown) &&
        scenario.exportSurfaces.branchJson.session.modeFact !== null &&
        scenario.exportSurfaces.sessionJson.session.modeFact !== null,
    )
  const attachmentFileName = expertLive?.attachmentFile ? basename(expertLive.attachmentFile) : null
  const expertAttachmentStatus = resolveExpertAttachmentStatus(expertLive, attachmentFileName)
  const lineageRenderingPass =
    hasLineageTextRendering(lineageExport.exportSurfaces.sessionText) &&
    hasLineageMarkdownRendering(lineageExport.exportSurfaces.sessionMarkdown) &&
    hasLineageJsonRendering(lineageExport.exportSurfaces.sessionJson)
  const suspectedGeneratedCitationPass =
    hasSuspectedGeneratedCitationText(hallucinatedReply.replySurfaces.bufferedText) &&
    hasSuspectedGeneratedCitationText(hallucinatedExport.exportSurfaces.branchText) &&
    hasSuspectedGeneratedCitationMarkdown(hallucinatedExport.exportSurfaces.branchMarkdown)

  return [
    {
      id: 'reply-text-contract-transcript-first',
      area: 'reply-text-contract',
      status: replyTextContractPass ? 'pass' : 'fail',
      summary: replyTextContractPass
        ? 'reply text stays plain while export-session text stays transcript-first and distinct from markdown.'
        : 'reply text or export-session text drifted across the plain-text vs transcript-first boundary.',
      notes: input.currentLiveScenarios.map(
        scenario =>
          `${scenario.requestedMode}: replyPlain=${isPlainReplyText(scenario.replySurfaces.bufferedText)} branchText=${isTranscriptFirstTextExport(scenario.exportSurfaces.branchText)} sessionText=${isTranscriptFirstTextExport(scenario.exportSurfaces.sessionText)}`,
      ),
    },
    {
      id: 'json-shape-contract-native-openai',
      area: 'reply-json-shape',
      status: replyJsonShapePass ? 'pass' : 'fail',
      summary: replyJsonShapePass
        ? 'native/openai-responses/openai-chat-completions buffered + streaming shapes still expose the declared compatibility markers.'
        : 'One or more buffered/streaming JSON shapes drifted away from the declared native/OpenAI compatibility contract.',
      notes: summarizeJsonShapeNotes(searchReply.replySurfaces),
    },
    {
      id: 'export-text-vs-markdown-contract',
      area: 'export-text-contract',
      status: exportTextContractPass ? 'pass' : 'fail',
      summary: exportTextContractPass
        ? 'export-session text remains human-readable and markdown keeps audit sections.'
        : 'export-session text regressed toward markdown scaffolding, or markdown lost its audit sections.',
      notes: [
        `search text audit sections present=${containsAuditSectionLabels(searchExport.exportSurfaces.branchText)}`,
        `search markdown audit sections present=${hasMarkdownAuditSections(searchExport.exportSurfaces.branchMarkdown)}`,
        `attachment text headings present=${hasMarkdownHeading(attachmentExport.exportSurfaces.branchText)}`,
      ],
    },
    {
      id: 'search-citation-rendering-and-reference-mapping',
      area: 'citation-rendering',
      status: citationRenderingPass ? 'pass' : 'fail',
      summary: citationRenderingPass
        ? 'Search citations, response references, and text-vs-markdown rendering boundaries remain explicit.'
        : 'Search citation rendering drifted in reply text, export text, markdown audit sections, or structured JSON evidence.',
      notes: [
        `reply text citations=${hasSearchCitationTextRendering(searchReply.replySurfaces.bufferedText)}`,
        `export text citations=${hasSearchCitationTextRendering(searchExport.exportSurfaces.branchText)}`,
        `export markdown sections=${hasMarkdownAuditSections(searchExport.exportSurfaces.branchMarkdown)}`,
        `export json search evidence=${hasSearchJsonEvidence(searchExport.exportSurfaces.branchJson)}`,
      ],
    },
    {
      id: 'mode-fact-delivery-across-export-formats',
      area: 'mode-fact-delivery',
      status: modeFactDeliveryPass ? 'pass' : 'fail',
      summary: modeFactDeliveryPass
        ? 'Current Instant/Expert live exports preserve authoritative mode facts across text, markdown, and json; Vision image modeFact is tracked by mode-audit/release-diff until output-drift adds image live smoke.'
        : 'Current live exports dropped the authoritative mode fact on one or more export surfaces.',
      notes: input.currentLiveScenarios.map(
        scenario =>
          `${scenario.requestedMode}: sessionMode=${scenario.modeFact?.resolvedMode ?? '<missing>'} text=${hasModeFactInTextExport(scenario.exportSurfaces.branchText)} markdown=${hasModeFactInMarkdownExport(scenario.exportSurfaces.branchMarkdown)} json=${scenario.exportSurfaces.branchJson.session.modeFact !== null}`,
      ),
    },
    {
      id: 'expert-attachment-aware-current-contract',
      area: 'attachment-rendering',
      status: expertAttachmentStatus.status,
      summary: expertAttachmentStatus.summary,
      notes: expertAttachmentStatus.notes.concat([
        `fixture attachment text=${attachmentExport.exportSurfaces.branchText.includes('Attachments:')}`,
        `fixture attachment markdown=${attachmentExport.exportSurfaces.branchMarkdown.includes('Branch Attachments')}`,
      ]),
    },
    {
      id: 'lineage-rendering-in-full-session-export',
      area: 'lineage-rendering',
      status: lineageRenderingPass ? 'pass' : 'fail',
      summary: lineageRenderingPass
        ? 'Full-session text/markdown/json exports still render multi-branch lineage explicitly.'
        : 'Full-session export lineage rendering drifted on text, markdown, or json.',
      notes: [
        `text lineage=${hasLineageTextRendering(lineageExport.exportSurfaces.sessionText)}`,
        `markdown lineage=${hasLineageMarkdownRendering(lineageExport.exportSurfaces.sessionMarkdown)}`,
        `json lineage=${hasLineageJsonRendering(lineageExport.exportSurfaces.sessionJson)}`,
      ],
    },
    {
      id: 'suspected-generated-citation-boundary',
      area: 'boundary-split',
      status: suspectedGeneratedCitationPass ? 'pass' : 'fail',
      summary: suspectedGeneratedCitationPass
        ? 'Citation-like tokens without structured DeepSeek backing remain explicit suspected-generated-citation boundaries.'
        : 'Suspected generated citation boundaries drifted and may now be misrepresented as verified citations.',
      notes: [
        `reply text suspected=${hasSuspectedGeneratedCitationText(hallucinatedReply.replySurfaces.bufferedText)}`,
        `export text suspected=${hasSuspectedGeneratedCitationText(hallucinatedExport.exportSurfaces.branchText)}`,
        `export markdown suspected=${hasSuspectedGeneratedCitationMarkdown(hallucinatedExport.exportSurfaces.branchMarkdown)}`,
      ],
    },
    {
      id: 'bounded-live-vs-fixture-backed-output-audit-split',
      area: 'boundary-split',
      status:
        input.currentLiveScenarios.length === 2 &&
        input.fixtureBaselines.replyBaselines.length >= 2 &&
        input.fixtureBaselines.exportBaselines.length >= 4
          ? 'pass'
          : 'fail',
      summary:
        input.currentLiveScenarios.length === 2 &&
        input.fixtureBaselines.replyBaselines.length >= 2 &&
        input.fixtureBaselines.exportBaselines.length >= 4
          ? 'The audit keeps current live mode smoke and fixture-backed rendering baselines explicitly split.'
          : 'The output drift audit lost either its current live mode smoke coverage or its fixture-backed rendering baselines.',
      notes: [
        `currentLiveScenarios=${input.currentLiveScenarios.length}`,
        `fixtureReplyBaselines=${input.fixtureBaselines.replyBaselines.length}`,
        `fixtureExportBaselines=${input.fixtureBaselines.exportBaselines.length}`,
      ],
    },
  ]
}

async function materializeCurrentLiveOutputScenario(
  input: {
    chrome: ManagedChromeOptions
    requestedMode: DeepSeekChatMode
    prompt: string
    attachmentFile: string | null
    sessionStoreDir: string
    url: string
    waitUntil: AuditDeepSeekOutputDriftInput['waitUntil']
    releaseFingerprintComposite: string
  },
  logger: RuntimeLogger,
): Promise<{
  scenario: DeepSeekOutputDriftLiveScenario
  cleanup: DeepSeekOutputDriftCleanupEntry
}> {
  let replyResult: DeepSeekReplyResult | null = null
  let scenario: DeepSeekOutputDriftLiveScenario | null = null
  let failure: unknown = null

  try {
    await mkdir(input.sessionStoreDir, { recursive: true })
    replyResult = await replyDeepSeekMessage(
      {
        ...input.chrome,
        prompt: input.prompt,
        files: input.attachmentFile ? [input.attachmentFile] : undefined,
        sessionStoreDir: input.sessionStoreDir,
        url: input.url,
        waitUntil: input.waitUntil,
        stream: true,
        composerMode: {
          chatMode: input.requestedMode,
          deepThink: 'unchanged',
          search: 'unchanged',
        },
      },
      logger.child('reply'),
    )
    const exportSurfaces = await captureExportSurfacesFromSessionFile(replyResult.sessionFile)
    scenario = {
      requestedMode: input.requestedMode,
      prompt: input.prompt,
      releaseFingerprintComposite: input.releaseFingerprintComposite,
      sessionId: replyResult.sessionId,
      finalUrl: replyResult.finalUrl,
      assistantTextSource: replyResult.assistantTextSource,
      attachmentFile: input.attachmentFile,
      attachmentAttempted: input.attachmentFile !== null,
      acceptedAttachmentPaths: replyResult.fileUpload?.acceptedPaths ?? [],
      attachmentBlockingIssues: replyResult.fileUpload?.blockingIssues ?? false,
      modeFact: replyResult.session.modeFact ?? null,
      replySurfaces: captureReplyOutputSurfaces(replyResult),
      exportSurfaces,
    }
  } catch (error) {
    failure = error
  }

  const cleanup = await cleanupCurrentLiveOutputScenario({
    replyResult,
    chrome: input.chrome,
    waitUntil: input.waitUntil,
    logger: logger.child('cleanup'),
    requestedMode: input.requestedMode,
  })

  if (failure) {
    throw failure instanceof Error ? failure : new Error(describeUnknownError(failure))
  }

  if (!scenario) {
    throw new Error(`Current live ${input.requestedMode} output drift scenario did not materialize.`)
  }

  return {
    scenario,
    cleanup,
  }
}

async function cleanupCurrentLiveOutputScenario(input: {
  replyResult: DeepSeekReplyResult | null
  chrome: ManagedChromeOptions
  waitUntil: AuditDeepSeekOutputDriftInput['waitUntil']
  logger: RuntimeLogger
  requestedMode: DeepSeekChatMode
}): Promise<DeepSeekOutputDriftCleanupEntry> {
  if (!input.replyResult) {
    return {
      requestedMode: input.requestedMode,
      sessionId: '<uncreated>',
      finalUrl: '<uncreated>',
      status: 'skipped',
      errorMessage: null,
    }
  }

  try {
    await deleteDeepSeekSession(
      {
        ...input.chrome,
        sessionId: input.replyResult.sessionId,
        sessionFile: input.replyResult.sessionFile,
        waitUntil: input.waitUntil,
      },
      input.logger,
    )

    return {
      requestedMode: input.requestedMode,
      sessionId: input.replyResult.sessionId,
      finalUrl: input.replyResult.finalUrl,
      status: 'deleted',
      errorMessage: null,
    }
  } catch (error) {
    return {
      requestedMode: input.requestedMode,
      sessionId: input.replyResult.sessionId,
      finalUrl: input.replyResult.finalUrl,
      status: 'delete-failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

function captureReplyOutputSurfaces(result: DeepSeekReplyResult): DeepSeekOutputDriftReplySurfaces {
  return {
    bufferedText: buildDeepSeekCliOutputChunks({
      result,
      outputMode: resolveDeepSeekCliOutputMode({
        format: 'text',
      }),
    }).join(''),
    bufferedJson: {
      native: parseBufferedJsonOutput(result, 'native'),
      openaiResponses: parseBufferedJsonOutput(result, 'openai-responses'),
      openaiChatCompletions: parseBufferedJsonOutput(result, 'openai-chat-completions'),
    },
    streaming: {
      textChunks: buildDeepSeekCliOutputChunks({
        result,
        outputMode: resolveDeepSeekCliOutputMode({
          stream: true,
          format: 'text',
        }),
      }),
      nativeFrames: parseStreamingJsonOutput(result, 'native'),
      openaiResponsesFrames: parseStreamingJsonOutput(result, 'openai-responses'),
      openaiChatCompletionsFrames: parseStreamingJsonOutput(result, 'openai-chat-completions'),
    },
  }
}

async function captureExportSurfacesFromSessionFile(
  sessionFile: string,
): Promise<DeepSeekOutputDriftExportSurfaces> {
  const source = await loadAuditFixtureSessionSource(sessionFile)
  return captureExportSurfaces(source)
}

function captureExportSurfaces(
  source: DeepSeekResolvedSessionSource,
): DeepSeekOutputDriftExportSurfaces {
  const snapshot = buildDeepSeekSessionExportSnapshot({ source })
  const branchSnapshot =
    snapshot.branches.find(branch => branch.branchId === snapshot.catalog.activeBranchId) ??
    snapshot.branches[0]
  if (!branchSnapshot) {
    throw new Error(`Session ${snapshot.session.id} does not expose any exportable branches.`)
  }

  return {
    branchId: branchSnapshot.branchId,
    branchText: exportSessionBranchToText(snapshot, branchSnapshot),
    branchMarkdown: exportSessionBranchToMarkdown(snapshot, branchSnapshot),
    branchJson: JSON.parse(
      exportSessionBranchToJson(snapshot, branchSnapshot),
    ) as DeepSeekSessionBranchExportDocument,
    sessionText: exportSessionToText(snapshot),
    sessionMarkdown: exportSessionToMarkdown(snapshot),
    sessionJson: JSON.parse(exportSessionToJson(snapshot)) as DeepSeekSessionExportDocument,
  }
}

async function loadAuditFixtureSessionSource(
  fixtureFile: string,
): Promise<DeepSeekResolvedSessionSource> {
  const absoluteFile = resolve(process.cwd(), fixtureFile)
  const raw = JSON.parse(await readFile(absoluteFile, 'utf8')) as unknown
  const normalized = normalizeStoredSessionFixture(raw)

  return {
    sessionFile: absoluteFile,
    storedSession: normalized.storedSession,
    session: normalized.storedSession.session,
    authoritativeSessionId: normalized.storedSession.session.id,
    authoritativeAgentId: normalized.storedSession.session.agentId,
    finalUrl: normalized.finalUrl,
  }
}

function buildInlineCitationFixtureSessionSource(): DeepSeekResolvedSessionSource {
  const raw = {
    data: {
      biz_data: {
        chat_session: {
          id: 'session-inline-citation',
          title: 'Inline Citation',
          agent: 'chat',
        },
        chat_messages: [
          {
            message_id: 1,
            role: 'USER',
            inserted_at: 1775446562.036,
            fragments: [
              {
                id: 1,
                type: 'REQUEST',
                content: '给我一个引用例子',
              },
            ],
          },
          {
            message_id: 2,
            parent_id: 1,
            role: 'ASSISTANT',
            inserted_at: 1775446562.037,
            fragments: [
              {
                id: 4,
                type: 'RESPONSE',
                content: '这里有引用[15†L11-L12]',
                references: [],
              },
            ],
          },
        ],
      },
    },
  }
  const session = mapHistoryMessagesEnvelopeToSession(raw)
  const storedSession = wrapLegacyStoredSession(session)
  return {
    sessionFile: 'memory://output-drift-audit/inline-citation.fixture.json',
    storedSession,
    session,
    authoritativeSessionId: session.id,
    authoritativeAgentId: session.agentId,
    finalUrl: null,
  }
}

function normalizeStoredSessionFixture(raw: unknown): {
  storedSession: DeepSeekStoredSession
  finalUrl: string | null
} {
  if (isRecord(raw) && isRecord(raw['response']) && typeof raw['response']['bodyText'] === 'string') {
    return {
      storedSession: wrapLegacyStoredSession(
        mapHistoryMessagesEnvelopeToSession(JSON.parse(raw['response']['bodyText'])),
      ),
      finalUrl: readOptionalString(raw, 'routeUrl'),
    }
  }

  if (isDeepSeekStoredSession(raw)) {
    return {
      storedSession: raw,
      finalUrl: raw.metadata?.finalUrl ?? null,
    }
  }

  if (isDeepSeekSession(raw)) {
    return {
      storedSession: wrapLegacyStoredSession(raw),
      finalUrl: null,
    }
  }

  return {
    storedSession: wrapLegacyStoredSession(mapHistoryMessagesEnvelopeToSession(raw)),
    finalUrl: null,
  }
}

function parseBufferedJsonOutput(
  result: DeepSeekReplyResult,
  jsonShape: 'native' | 'openai-responses' | 'openai-chat-completions',
): unknown {
  const content = buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      format: 'json',
      jsonShape,
    }),
  }).join('')
  return JSON.parse(content)
}

function parseStreamingJsonOutput(
  result: DeepSeekReplyResult,
  jsonShape: 'native' | 'openai-responses' | 'openai-chat-completions',
): unknown[] {
  return buildDeepSeekCliOutputChunks({
    result,
    outputMode: resolveDeepSeekCliOutputMode({
      stream: true,
      format: 'stream-json',
      jsonShape,
    }),
  })
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 0)
    .map(chunk => JSON.parse(chunk) as unknown)
}

async function resolveAuditAttachmentFile(
  requestedAttachmentFile: string | undefined,
): Promise<string | null> {
  const candidate = requestedAttachmentFile?.trim() || DEFAULT_ATTACHMENT_FILE
  const absoluteFile = resolve(process.cwd(), candidate)
  try {
    await access(absoluteFile)
    return absoluteFile
  } catch {
    return null
  }
}

function resolveExpertAttachmentStatus(
  expertLive: DeepSeekOutputDriftLiveScenario | null,
  attachmentFileName: string | null,
): {
  status: DeepSeekOutputDriftAuditCheckStatus
  summary: string
  notes: string[]
} {
  if (!expertLive) {
    return {
      status: 'fail',
      summary: 'The Expert current-live output scenario is missing, so the attachment-aware contract was not revalidated.',
      notes: [],
    }
  }

  if (!expertLive.attachmentAttempted || attachmentFileName === null) {
    return {
      status: 'warn',
      summary:
        'Expert live smoke did not verify the current attachment-aware contract because no attachment file was available.',
      notes: [
        `attachmentAttempted=${expertLive.attachmentAttempted}`,
        `acceptedAttachmentPaths=${expertLive.acceptedAttachmentPaths.length}`,
      ],
    }
  }

  const accepted = expertLive.acceptedAttachmentPaths.some(
    path => basename(path) === attachmentFileName,
  )
  const renderedInText = expertLive.exportSurfaces.branchText.includes(attachmentFileName)
  const renderedInMarkdown = expertLive.exportSurfaces.branchMarkdown.includes(attachmentFileName)
  const renderedInJson = expertLive.exportSurfaces.branchJson.branch.attachments.some(
    attachment => attachment.name === attachmentFileName,
  )

  if (!accepted || !renderedInText || !renderedInMarkdown || !renderedInJson) {
    return {
      status: 'fail',
      summary:
        'Expert live smoke attempted an attachment, but one or more export surfaces dropped the current attachment-aware contract.',
      notes: [
        `accepted=${accepted}`,
        `renderedInText=${renderedInText}`,
        `renderedInMarkdown=${renderedInMarkdown}`,
        `renderedInJson=${renderedInJson}`,
        `blockingIssues=${expertLive.attachmentBlockingIssues}`,
      ],
    }
  }

  return {
    status: 'pass',
    summary:
      'Expert live smoke preserves the current attachment-aware contract across reply persistence and export surfaces.',
    notes: [
      `acceptedAttachmentPaths=${expertLive.acceptedAttachmentPaths.length}`,
      `renderedAttachment=${attachmentFileName}`,
    ],
  }
}

function hasExpectedJsonShapeCoverage(surfaces: DeepSeekOutputDriftReplySurfaces): boolean {
  const native = surfaces.bufferedJson.native as {
    session?: { branches?: Array<{ messages?: Array<{ searches?: Array<{ query?: string | null }> }> }> }
  }
  const openaiResponses = surfaces.bufferedJson.openaiResponses as {
    object?: string
    status?: string
  }
  const openaiChat = surfaces.bufferedJson.openaiChatCompletions as {
    object?: string
    choices?: Array<{ message?: { role?: string } }>
  }
  const nativeKinds = surfaces.streaming.nativeFrames
    .map(frame => readOptionalString(frame, 'kind'))
    .filter((kind): kind is string => typeof kind === 'string')
  const responsesTypes = surfaces.streaming.openaiResponsesFrames
    .map(frame => readOptionalString(frame, 'type'))
    .filter((kind): kind is string => typeof kind === 'string')
  const chatChunks = surfaces.streaming.openaiChatCompletionsFrames as Array<{
    object?: string
    choices?: Array<{ finish_reason?: string | null }>
  }>

  return (
    native.session?.branches?.[0]?.messages?.[1]?.searches?.[0]?.query ===
      'OpenAI Responses API streaming events data structure official documentation' &&
    openaiResponses.object === 'response' &&
    openaiResponses.status === 'completed' &&
    openaiChat.object === 'chat.completion' &&
    openaiChat.choices?.[0]?.message?.role === 'assistant' &&
    nativeKinds.includes('search.patch') &&
    nativeKinds.includes('citation.patch') &&
    responsesTypes.includes('response.created') &&
    responsesTypes.includes('response.completed') &&
    chatChunks[0]?.object === 'chat.completion.chunk' &&
    chatChunks.at(-1)?.choices?.[0]?.finish_reason === 'stop'
  )
}

function summarizeJsonShapeNotes(surfaces: DeepSeekOutputDriftReplySurfaces): string[] {
  const nativeKinds = surfaces.streaming.nativeFrames
    .map(frame => readOptionalString(frame, 'kind'))
    .filter((kind): kind is string => typeof kind === 'string')
  const responsesTypes = surfaces.streaming.openaiResponsesFrames
    .map(frame => readOptionalString(frame, 'type'))
    .filter((kind): kind is string => typeof kind === 'string')
  const chatObjects = surfaces.streaming.openaiChatCompletionsFrames
    .map(frame => readOptionalString(frame, 'object'))
    .filter((kind): kind is string => typeof kind === 'string')

  return [
    `nativeStreamKinds=${nativeKinds.join(', ')}`,
    `openaiResponsesTypes=${responsesTypes.join(', ')}`,
    `openaiChatObjects=${chatObjects.join(', ')}`,
  ]
}

function hasSearchCitationTextRendering(content: string): boolean {
  return (
    content.includes('Citations:') &&
    content.includes('[reference:0] Exact page') &&
    content.includes('[reference:1] Search result set') &&
    content.includes('denotes a search result set, not a single verified webpage')
  )
}

function hasSearchJsonEvidence(document: DeepSeekSessionBranchExportDocument): boolean {
  return (
    document.branch.searchEvidence.available === true &&
    document.branch.searchEvidence.derivedFrom === 'message-searches' &&
    document.branch.messages[1]?.responseReferences?.length === 2
  )
}

function hasLineageTextRendering(content: string): boolean {
  return (
    content.includes('Branch Count: 2') &&
    content.includes('Branch Context: lineage=') &&
    content.includes('Branch: Alt Branch (branch-alt)')
  )
}

function hasLineageMarkdownRendering(content: string): boolean {
  return (
    content.includes('## Branch Index') &&
    content.includes('### Alt Branch (`branch-alt`)') &&
    content.includes('Lineage Kind:')
  )
}

function hasLineageJsonRendering(document: DeepSeekSessionExportDocument): boolean {
  return (
    document.branchIndex.length === 2 &&
    document.branches.some(
      branch =>
        branch.summary.lineageKind !== 'root' ||
        branch.summary.sourceMessageId !== undefined,
    )
  )
}

function hasSuspectedGeneratedCitationText(content: string): boolean {
  return content.includes('Suspected generated citations without structured DeepSeek backing')
}

function hasSuspectedGeneratedCitationMarkdown(content: string): boolean {
  return (
    content.includes('suspected-generated-citation') &&
    content.includes(
      'Citation-like tokens without structured DeepSeek `RESPONSE.references[]` are treated as suspected generated citations.',
    )
  )
}

function isPlainReplyText(content: string): boolean {
  return (
    !hasMarkdownHeading(content) &&
    !content.includes('DeepSeek Session:') &&
    !content.includes('Session Metadata:') &&
    !hasMarkdownLink(content)
  )
}

function isTranscriptFirstTextExport(content: string): boolean {
  return (
    content.startsWith('DeepSeek Session: ') &&
    content.includes('Session ID: ') &&
    !hasMarkdownHeading(content) &&
    !hasMarkdownLink(content) &&
    !containsAuditSectionLabels(content)
  )
}

function hasModeFactInTextExport(content: string): boolean {
  return /Mode:\s+mode=/.test(content)
}

function hasModeFactInMarkdownExport(content: string): boolean {
  return /Mode Fact: .*model_type=/.test(content)
}

function containsAuditSectionLabels(content: string): boolean {
  return (
    content.includes('Inline References Observed') ||
    content.includes('Structured Response References') ||
    content.includes('Search Results / Reference Mapping')
  )
}

function hasMarkdownAuditSections(content: string): boolean {
  return (
    hasMarkdownHeading(content) &&
    content.includes('Inline References Observed') &&
    content.includes('Structured Response References') &&
    content.includes('Search Results / Reference Mapping')
  )
}

function hasMarkdownHeading(content: string): boolean {
  return /^#{1,6}\s/m.test(content)
}

function hasMarkdownLink(content: string): boolean {
  return /\[[^\]]+\]\(https?:\/\//.test(content)
}

function requireReplyBaseline(
  baselines: DeepSeekOutputDriftFixtureBaselines,
  id: string,
): DeepSeekOutputDriftFixtureReplyBaseline {
  const baseline = baselines.replyBaselines.find(entry => entry.id === id)
  if (!baseline) {
    throw new Error(`Missing output drift reply baseline: ${id}`)
  }
  return baseline
}

function requireExportBaseline(
  baselines: DeepSeekOutputDriftFixtureBaselines,
  id: string,
): DeepSeekOutputDriftFixtureExportBaseline {
  const baseline = baselines.exportBaselines.find(entry => entry.id === id)
  if (!baseline) {
    throw new Error(`Missing output drift export baseline: ${id}`)
  }
  return baseline
}

function countCheckStatus(
  checks: DeepSeekOutputDriftAuditCheck[],
  status: DeepSeekOutputDriftAuditCheckStatus,
): number {
  return checks.filter(check => check.status === status).length
}

function wrapLegacyStoredSession(session: DeepSeekStoredSession['session']): DeepSeekStoredSession {
  return {
    kind: 'deepseek-stored-session',
    version: 1,
    session,
    metadata: null,
  }
}

function isDeepSeekStoredSession(value: unknown): value is DeepSeekStoredSession {
  return (
    isRecord(value) &&
    value['kind'] === 'deepseek-stored-session' &&
    value['version'] === 1 &&
    isRecord(value['session'])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readOptionalString(record: unknown, key: string): string | null {
  if (!isRecord(record)) {
    return null
  }
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function describeUnknownError(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown output drift audit failure'
  }
}
