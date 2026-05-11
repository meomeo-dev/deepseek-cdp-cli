import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildDeepSeekReleaseCompatibilityRecord } from '../../domain/regression/deepSeekReleaseFingerprint.js'
import { describeKnownDeepSeekApiSurface } from '../../infrastructure/deepseek/deepSeekApiCatalog.js'
import { auditDeepSeekChatModes } from './auditDeepSeekChatModes.js'
import {
  extractDeepSeekReadyEventModelType,
} from '../../infrastructure/deepseek/deepSeekChatModeSignal.js'
import {
  describeDeepSeekEndpointAuditRegistry,
  getDeepSeekEndpointAuditRecord,
} from '../../infrastructure/deepseek/deepSeekEndpointAuditRegistry.js'
import {
  isRecord,
  parseJsonIfPossible,
  readOptionalString,
  splitSseMessages,
} from '../../infrastructure/deepseek/deepSeekGenerationParserPrimitives.js'
import { logDeepSeekRuntimeFailure } from '../../shared/errors/runtimeFailure.js'
import { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeSignalLayer,
  DeepSeekChatModeSignalObservation,
} from '../../types/deepseek-chat-mode.types.js'
import type { DeepSeekChatModeAuditReport } from '../../types/deepseek-mode-audit.types.js'
import type {
  AuditDeepSeekEndpointDriftInput,
  DeepSeekEndpointDriftAuditCheck,
  DeepSeekEndpointDriftAuditCheckStatus,
  DeepSeekEndpointDriftAuditReport,
  DeepSeekEndpointDriftEvidenceSource,
  DeepSeekEndpointDriftFixtureStatus,
  DeepSeekEndpointDriftModeSignalChain,
  DeepSeekEndpointDriftRateLimitBaseline,
  DeepSeekEndpointDriftRegistryAudit,
} from '../../types/deepseek-endpoint-drift-audit.types.js'
import { resolveIsolatedManagedChromeOptions } from '../services/browserRuntimeIsolation.js'

const DEFAULT_RATE_LIMIT_FIXTURE_FILE =
  'test/fixtures/deepseek-generation-stream/completion.search.rate-limit.real.fixture.json'
const MODE_AUDIT_BACKED_ENDPOINTS = new Set([
  '/api/v0/chat/completion',
  '/api/v0/chat/history_messages',
])
const SOURCE_CHAIN_LAYERS = [
  'request-payload',
  'generation-ready-sse',
  'history-messages-raw',
] satisfies DeepSeekChatModeSignalLayer[]
const DELIVERY_CHAIN_LAYERS = [
  'canonical-generation-context',
  'history-messages-mapped-session',
  'stored-session',
  'export-document',
] satisfies DeepSeekChatModeSignalLayer[]

export async function auditDeepSeekEndpointDrift(
  input: AuditDeepSeekEndpointDriftInput,
  logger = new RuntimeLogger({ level: 'info', scope: 'endpoint-drift-audit' }),
): Promise<DeepSeekEndpointDriftAuditReport> {
  try {
    const isolatedModeAuditChrome = await resolveIsolatedManagedChromeOptions({
      chrome: input,
      purpose: 'audit',
    })
    const modeAudit = await auditDeepSeekChatModes(
      {
        ...isolatedModeAuditChrome,
        url: input.url,
        waitUntil: input.waitUntil,
        instantPrompt: input.instantPrompt,
        expertPrompt: input.expertPrompt,
        outputFile: undefined,
      },
      logger.child('mode-audit'),
    )

    const registry = await inspectDeepSeekEndpointAuditRegistry()
    const modeSignalChains = buildDeepSeekEndpointModeSignalChains(modeAudit)
    const searchRateLimitBaseline = await readDeepSeekEndpointRateLimitBaselineFixture(undefined)
    const checks = buildDeepSeekEndpointDriftChecks({
      registry,
      modeSignalChains,
      searchRateLimitBaseline,
    })
    const notes = buildEndpointDriftAuditNotes(registry, searchRateLimitBaseline)

    const report: DeepSeekEndpointDriftAuditReport = {
      scenario: 'endpoint-drift-audit',
      capturedAt: new Date().toISOString(),
      requestedUrl: input.url,
      releaseFingerprints: [...modeAudit.releaseFingerprints],
      compatibility: buildDeepSeekReleaseCompatibilityRecord({
        artifactKind: 'audit',
        releaseFingerprints: modeAudit.releaseFingerprints,
        failureCount: countCheckStatus(checks, 'fail'),
        warningCount: countCheckStatus(checks, 'warn'),
      }),
      modeAudit,
      registry,
      modeSignalChains,
      searchRateLimitBaseline,
      checks,
      notes,
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
      message: 'DeepSeek endpoint drift audit failed',
      error,
      context: {
        url: input.url,
        cloneChromeProfile: input.cloneChromeProfile,
        waitUntil: input.waitUntil,
        outputFile: input.outputFile ?? null,
      },
    })
    throw error
  }
}

export async function inspectDeepSeekEndpointAuditRegistry(): Promise<DeepSeekEndpointDriftRegistryAudit> {
  const catalog = describeKnownDeepSeekApiSurface()
  const catalogEndpoints = new Set([
    ...catalog.generationEndpoints,
    ...catalog.sessionEndpoints,
    ...catalog.fileEndpoints,
  ])
  const registryRecords = describeDeepSeekEndpointAuditRegistry().sort((left, right) =>
    left.endpoint.localeCompare(right.endpoint),
  )
  const registryEndpoints = new Set(registryRecords.map(record => record.endpoint))

  const endpoints = await Promise.all(
    registryRecords.map(async record => {
      const missingFixturePaths = await findMissingFixturePaths(record.fixturePaths)
      const fixtureStatus: DeepSeekEndpointDriftFixtureStatus =
        missingFixturePaths.length === 0 ? 'present' : 'missing'
      const currentEvidenceSource: DeepSeekEndpointDriftEvidenceSource =
        record.evidenceStatus === 'pending_internal_audit'
          ? 'pending-internal-audit'
          : MODE_AUDIT_BACKED_ENDPOINTS.has(record.endpoint)
            ? 'current-mode-audit'
            : 'registry-fixture-baseline'
      return {
        endpoint: record.endpoint,
        category: record.category,
        evidenceStatus: record.evidenceStatus,
        currentEvidenceSource,
        fixtureStatus,
        fixturePaths: [...record.fixturePaths],
        missingFixturePaths,
        consumedBy: { ...record.consumedBy },
        consumerSurfaces: [...record.consumerSurfaces],
        unconfirmedFields: [...record.unconfirmedFields],
        notes: [...record.notes],
      }
    }),
  )

  const summary = {
    totalEndpoints: endpoints.length,
    catalogEndpointCount: catalogEndpoints.size,
    catalogCoverageStatus:
      endpoints.length === catalogEndpoints.size &&
      [...catalogEndpoints].every(endpoint => registryEndpoints.has(endpoint))
        ? 'covered'
        : 'mismatch',
    missingRegistryEndpoints: [...catalogEndpoints].filter(endpoint => !registryEndpoints.has(endpoint)).sort(),
    uncataloguedRegistryEndpoints: [...registryEndpoints].filter(endpoint => !catalogEndpoints.has(endpoint)).sort(),
    confirmedEndpoints: endpoints.filter(entry => entry.evidenceStatus === 'confirmed').length,
    pendingInternalAuditEndpoints: endpoints.filter(
      entry => entry.evidenceStatus === 'pending_internal_audit',
    ).length,
    parserConsumedEndpoints: endpoints
      .filter(entry => entry.consumedBy.parser)
      .map(entry => entry.endpoint),
    adapterConsumedEndpoints: endpoints
      .filter(entry => entry.consumedBy.adapter)
      .map(entry => entry.endpoint),
    exporterConsumedEndpoints: endpoints
      .filter(entry => entry.consumedBy.exporter)
      .map(entry => entry.endpoint),
    currentModeAuditBackedEndpoints: endpoints
      .filter(entry => entry.currentEvidenceSource === 'current-mode-audit')
      .map(entry => entry.endpoint),
    registryFixtureBaselineEndpoints: endpoints
      .filter(entry => entry.currentEvidenceSource === 'registry-fixture-baseline')
      .map(entry => entry.endpoint),
  } satisfies DeepSeekEndpointDriftRegistryAudit['summary']

  return {
    summary,
    endpoints,
  }
}

export function buildDeepSeekEndpointModeSignalChains(
  modeAudit: DeepSeekChatModeAuditReport,
): DeepSeekEndpointDriftModeSignalChain[] {
  return modeAudit.scenarios.map(scenario => {
    const signalMap = new Map(
      scenario.authoritySignals.map(signal => [signal.layer, signal] as const),
    )
    const orderedLayers = [...SOURCE_CHAIN_LAYERS, ...DELIVERY_CHAIN_LAYERS]
    const layers = orderedLayers.map(layer => {
      const signal = signalMap.get(layer) ?? buildMissingSignalObservation(layer)
      return buildModeSignalLayerAudit(layer, scenario.requestedMode, signal)
    })

    return {
      requestedMode: scenario.requestedMode,
      authoritySignals: scenario.authoritySignals.map(signal => ({ ...signal })),
      layers,
      sourceChainStatus: layers
        .filter(layer => isSourceChainLayer(layer.layer))
        .every(layer => layer.status === 'pass')
        ? 'pass'
        : 'fail',
      deliveryChainStatus: layers
        .filter(layer => isDeliveryChainLayer(layer.layer))
        .every(layer => layer.status === 'pass')
        ? 'pass'
        : 'fail',
    }
  })
}

export async function readDeepSeekEndpointRateLimitBaselineFixture(
  fixtureFile: string | undefined,
): Promise<DeepSeekEndpointDriftRateLimitBaseline> {
  const targetFile = fixtureFile?.trim() || DEFAULT_RATE_LIMIT_FIXTURE_FILE
  const rawFixture = await readFile(resolve(process.cwd(), targetFile), 'utf8')
  const fixture = JSON.parse(rawFixture) as {
    endpoint: string
    response?: { bodyText?: string | null }
  }
  const bodyText = fixture.response?.bodyText ?? ''
  let hintFinishReason: string | null = null
  let closeClickBehavior: string | null = null

  for (const message of splitSseMessages(bodyText)) {
    const payload = parseJsonIfPossible(message.dataText)
    if (!isRecord(payload)) {
      continue
    }

    if (message.event === 'hint') {
      hintFinishReason = readOptionalString(payload, 'finish_reason')
    }
    if (message.event === 'close') {
      closeClickBehavior = readOptionalString(payload, 'click_behavior')
    }
  }

  return {
    source: 'fixture',
    endpoint: '/api/v0/chat/completion',
    fixtureFile: targetFile,
    readyModelType: extractDeepSeekReadyEventModelType(bodyText),
    hintFinishReason,
    closeClickBehavior,
    currentWindowStatus: 'observation-pending',
    notes: [
      'This remains a fixture-backed rate-limit endpoint baseline so B66A can keep rate_limit_observation_pending as warn without forcing a fresh reproduction.',
      'The audit treats rate-limit hint/close evidence as API drift baseline only; output/retry UX interpretation remains split into release regression and output drift work.',
    ],
  }
}

export function buildDeepSeekEndpointDriftChecks(input: {
  registry: DeepSeekEndpointDriftRegistryAudit
  modeSignalChains: DeepSeekEndpointDriftModeSignalChain[]
  searchRateLimitBaseline: DeepSeekEndpointDriftRateLimitBaseline
}): DeepSeekEndpointDriftAuditCheck[] {
  const confirmedMissingFixtures = input.registry.endpoints.filter(
    entry => entry.evidenceStatus === 'confirmed' && entry.fixtureStatus === 'missing',
  )
  const deleteAll = getDeepSeekEndpointAuditRecord('/api/v0/chat_session/delete_all')
  const sourceFailures = input.modeSignalChains.filter(chain => chain.sourceChainStatus === 'fail')
  const deliveryFailures = input.modeSignalChains.filter(
    chain => chain.deliveryChainStatus === 'fail',
  )
  const nonDefaultModelTypeUnresolvedEndpoints = input.registry.endpoints.filter(entry =>
    entry.unconfirmedFields.some(field => field.toLowerCase().includes('model_type')),
  )
  const exporterCoverageEndpoints = input.registry.endpoints.filter(entry => entry.consumedBy.exporter)

  return [
    {
      id: 'catalogued-endpoints-covered-by-registry',
      area: 'endpoint-registry',
      status: input.registry.summary.catalogCoverageStatus === 'covered' ? 'pass' : 'fail',
      summary:
        input.registry.summary.catalogCoverageStatus === 'covered'
          ? 'Every catalogued DeepSeek endpoint maps to the current endpoint audit registry.'
          : 'The endpoint audit registry no longer covers the full DeepSeek API catalog.',
      notes:
        input.registry.summary.catalogCoverageStatus === 'covered'
          ? [
              `Catalog count=${input.registry.summary.catalogEndpointCount}; registry count=${input.registry.summary.totalEndpoints}.`,
            ]
          : [
              `Missing registry endpoints: ${input.registry.summary.missingRegistryEndpoints.join(', ') || 'none'}.`,
              `Uncatalogued registry endpoints: ${input.registry.summary.uncataloguedRegistryEndpoints.join(', ') || 'none'}.`,
            ],
    },
    {
      id: 'confirmed-endpoint-fixtures-present',
      area: 'endpoint-registry',
      status: confirmedMissingFixtures.length === 0 ? 'pass' : 'fail',
      summary:
        confirmedMissingFixtures.length === 0
          ? 'Every confirmed endpoint still has checked-in fixture evidence.'
          : 'One or more confirmed endpoints have lost checked-in fixture evidence.',
      notes:
        confirmedMissingFixtures.length === 0
          ? [
              `${input.registry.summary.confirmedEndpoints} confirmed endpoints remain fixture-backed; ${input.registry.summary.pendingInternalAuditEndpoints} endpoint(s) stay blocked as internal audit only.`,
            ]
          : confirmedMissingFixtures.flatMap(entry =>
              entry.missingFixturePaths.map(path => `${entry.endpoint} missing fixture: ${path}`),
            ),
    },
    {
      id: 'delete-all-stays-pending-internal-audit',
      area: 'endpoint-registry',
      status:
        deleteAll?.evidenceStatus === 'pending_internal_audit' &&
        deleteAll.consumerSurfaces.includes('catalog-only')
          ? 'pass'
          : 'fail',
      summary:
        deleteAll?.evidenceStatus === 'pending_internal_audit'
          ? 'chat_session/delete_all remains pending internal audit and stays outside productized command surfaces.'
          : 'chat_session/delete_all no longer carries the required pending internal audit boundary.',
      notes: deleteAll
        ? [...deleteAll.notes, ...deleteAll.unconfirmedFields]
        : ['The delete_all registry record is missing entirely.'],
    },
    {
      id: 'authoritative-model-type-signal-chain',
      area: 'mode-signal-path',
      status: sourceFailures.length === 0 ? 'pass' : 'fail',
      summary:
        sourceFailures.length === 0
          ? 'Current live mode audit still confirms request payload, ready SSE, and history_messages as the authoritative model_type signal path.'
          : 'One or more current mode scenarios dropped request/ready/history model_type authority signals.',
      notes:
        sourceFailures.length === 0
          ? input.modeSignalChains.map(
              chain =>
                `${chain.requestedMode}: source chain preserved across ${SOURCE_CHAIN_LAYERS.join(', ')}.`,
            )
          : sourceFailures.flatMap(chain =>
              chain.layers
                .filter(layer => isSourceChainLayer(layer.layer) && layer.status === 'fail')
                .map(layer => `${chain.requestedMode}: ${layer.layer} lost expected mode evidence.`),
            ),
    },
    {
      id: 'mode-fact-delivery-surfaces-current',
      area: 'mode-signal-path',
      status: deliveryFailures.length === 0 ? 'pass' : 'fail',
      summary:
        deliveryFailures.length === 0
          ? 'Canonical generation, mapped session, stored session, and export document still persist mode fact delivery.'
          : 'One or more downstream delivery surfaces dropped persisted mode fact evidence.',
      notes:
        deliveryFailures.length === 0
          ? input.modeSignalChains.map(
              chain =>
                `${chain.requestedMode}: delivery chain preserved across ${DELIVERY_CHAIN_LAYERS.join(', ')}.`,
            )
          : deliveryFailures.flatMap(chain =>
              chain.layers
                .filter(layer => isDeliveryChainLayer(layer.layer) && layer.status === 'fail')
                .map(layer => `${chain.requestedMode}: ${layer.layer} no longer preserves the expected mode fact.`),
            ),
    },
    {
      id: 'search-rate-limit-hint-close-baseline',
      area: 'rate-limit-baseline',
      status:
        input.searchRateLimitBaseline.hintFinishReason === 'rate_limit_reached' &&
        input.searchRateLimitBaseline.closeClickBehavior === 'retry'
          ? 'warn'
          : 'fail',
      summary:
        input.searchRateLimitBaseline.hintFinishReason === 'rate_limit_reached' &&
        input.searchRateLimitBaseline.closeClickBehavior === 'retry'
          ? 'Search rate-limit hint/close evidence remains fixture-backed and observation-pending for the current release window.'
          : 'The retained search rate-limit fixture no longer proves the expected hint.finish_reason or close.click_behavior boundary.',
      notes: [
        `ready.model_type=${input.searchRateLimitBaseline.readyModelType ?? 'null'}`,
        `hint.finish_reason=${input.searchRateLimitBaseline.hintFinishReason ?? 'null'}`,
        `close.click_behavior=${input.searchRateLimitBaseline.closeClickBehavior ?? 'null'}`,
        ...input.searchRateLimitBaseline.notes,
      ],
    },
    {
      id: 'non-default-model-type-unresolved-remains-explicit',
      area: 'mode-signal-path',
      status: nonDefaultModelTypeUnresolvedEndpoints.length > 0 ? 'pass' : 'fail',
      summary:
        nonDefaultModelTypeUnresolvedEndpoints.length > 0
          ? 'The endpoint registry still records non-default model_type semantics as unresolved instead of silently guessing them.'
          : 'Non-default model_type unresolved notes disappeared from the endpoint registry.',
      notes:
        nonDefaultModelTypeUnresolvedEndpoints.length > 0
          ? nonDefaultModelTypeUnresolvedEndpoints.map(entry => `${entry.endpoint}: ${entry.unconfirmedFields.join('; ')}`)
          : ['No endpoint registry entry retains a non-default model_type unresolved note.'],
    },
    {
      id: 'api-drift-vs-output-drift-boundary',
      area: 'boundary-split',
      status: exporterCoverageEndpoints.length > 0 ? 'pass' : 'fail',
      summary:
        exporterCoverageEndpoints.length > 0
          ? 'Endpoint drift stays split from output drift: exporter consumers are catalogued here, but rendering revalidation remains a separate Wave 22 audit.'
          : 'No exporter-consuming endpoints remain catalogued, so API drift can no longer be cleanly separated from output/render drift.',
      notes:
        exporterCoverageEndpoints.length > 0
          ? [
              `Exporter-consuming endpoints: ${exporterCoverageEndpoints.map(entry => entry.endpoint).join(', ')}.`,
              'Use B70A for reply/export-session text|markdown|json, citations, search results, and inline-reference rendering drift.',
            ]
          : ['Expected exporter-backed endpoints such as history_messages or fetch_files are missing.'],
    },
  ]
}

function buildEndpointDriftAuditNotes(
  registry: DeepSeekEndpointDriftRegistryAudit,
  rateLimitBaseline: DeepSeekEndpointDriftRateLimitBaseline,
): string[] {
  const notes = [
    'This audit is API-focused: endpoint registry coverage, fixture evidence, and authoritative model_type signal delivery live here; text/json/export/citation rendering drift remains delegated to B70A.',
    'Current live evidence is intentionally limited to the mode-audit signal path so Wave 22 can validate current request/ready/history/stored/export mode facts without replaying every mutation/file endpoint on each run.',
  ]

  if (registry.summary.pendingInternalAuditEndpoints > 0) {
    notes.push(
      `${registry.summary.pendingInternalAuditEndpoints} endpoint(s) still remain pending internal audit; delete_all stays explicitly blocked from productization.`,
    )
  }
  if (rateLimitBaseline.currentWindowStatus === 'observation-pending') {
    notes.push(
      'Search rate-limit hint-close remains observation-pending for the current release window; the retained fixture baseline is intentional and should not trigger risky rate-limit forcing.',
    )
  }

  return notes
}

async function findMissingFixturePaths(fixturePaths: string[]): Promise<string[]> {
  const missing: string[] = []
  for (const fixturePath of fixturePaths) {
    try {
      await access(resolve(process.cwd(), fixturePath))
    } catch {
      missing.push(fixturePath)
    }
  }
  return missing
}

function buildModeSignalLayerAudit(
  layer: DeepSeekChatModeSignalLayer,
  expectedMode: DeepSeekChatMode,
  signal: DeepSeekChatModeSignalObservation,
): DeepSeekEndpointDriftModeSignalChain['layers'][number] {
  return {
    layer,
    observed: signal.observed,
    rawModelType: signal.rawModelType,
    resolvedMode: signal.resolvedMode ?? 'unknown',
    expectedMode,
    status:
      signal.observed === true && signal.resolvedMode === expectedMode ? 'pass' : 'fail',
    note: signal.note,
  }
}

function buildMissingSignalObservation(
  layer: DeepSeekChatModeSignalLayer,
): DeepSeekChatModeSignalObservation {
  return {
    layer,
    observed: false,
    rawModelType: null,
    resolvedMode: null,
    note: `Mode audit did not emit ${layer}.`,
  }
}

function isSourceChainLayer(
  layer: DeepSeekChatModeSignalLayer,
): layer is (typeof SOURCE_CHAIN_LAYERS)[number] {
  return SOURCE_CHAIN_LAYERS.includes(layer as (typeof SOURCE_CHAIN_LAYERS)[number])
}

function isDeliveryChainLayer(
  layer: DeepSeekChatModeSignalLayer,
): layer is (typeof DELIVERY_CHAIN_LAYERS)[number] {
  return DELIVERY_CHAIN_LAYERS.includes(layer as (typeof DELIVERY_CHAIN_LAYERS)[number])
}

function countCheckStatus(
  checks: DeepSeekEndpointDriftAuditCheck[],
  status: DeepSeekEndpointDriftAuditCheckStatus,
): number {
  return checks.filter(check => check.status === status).length
}
