import { createHash } from 'node:crypto'
import { matchDeepSeekSessionRoute } from '../../infrastructure/deepseek/deepSeekApiCatalog.js'
import type { DeepSeekEndpointAuditRecord } from '../../types/deepseek-endpoint-audit.types.js'
import type {
  DeepSeekOutputQuirkDescriptor,
  DeepSeekReleaseApiEndpointSignature,
  DeepSeekReleaseApiFingerprint,
  DeepSeekReleaseArtifactKind,
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFamilyRouteShellProjection,
  DeepSeekReleaseFingerprint,
  DeepSeekReleaseOutputFingerprint,
  DeepSeekReleaseRouteShellProjection,
  DeepSeekReleaseUiEntryDocumentProjection,
  DeepSeekReleaseUiFingerprint,
  DeepSeekReleaseUiContentObservations,
  DeepSeekReleaseUiModeSurfaceProjection,
} from '../../types/deepseek-release-fingerprint.types.js'

export const DEEPSEEK_OUTPUT_QUIRK_CATALOG: DeepSeekOutputQuirkDescriptor[] = [
  {
    id: 'canonical-generation-shared-between-stream-and-buffered',
    status: 'confirmed',
    summary:
      'Canonical generation events remain the shared source for streaming and buffered delivery.',
    sourceSpecs: ['specs/deepseek/deepseek-output-modes.spec.yml'],
  },
  {
    id: 'openai-responses-text-main-path-compatible',
    status: 'confirmed',
    summary:
      'The OpenAI Responses adapter stays scoped to the text conversation main path.',
    sourceSpecs: ['specs/openai-api/openai_openapi.yml'],
  },
  {
    id: 'openai-chat-completions-text-main-path-compatible',
    status: 'confirmed',
    summary:
      'The OpenAI Chat Completions adapter stays scoped to the text conversation main path.',
    sourceSpecs: ['specs/openai-api/openai_openapi.yml'],
  },
  {
    id: 'response-references-ordinal-mapping-when-structured-present',
    status: 'confirmed',
    summary:
      'Inline [reference:n] tokens are only promoted when structured RESPONSE.references evidence exists.',
    sourceSpecs: ['specs/deepseek/deepseek-reply.spec.yml'],
  },
  {
    id: 'suspected-generated-citation-kept-separate',
    status: 'confirmed',
    summary:
      'Citation-like tokens without structured references remain labeled as suspected generated citations.',
    sourceSpecs: ['specs/deepseek/deepseek-reply.spec.yml'],
  },
  {
    id: 'message-searches-preferred-over-citation-fallback',
    status: 'confirmed',
    summary:
      'Stored session, recovery, and export prefer native message.searches over citation-only fallbacks.',
    sourceSpecs: ['specs/deepseek/deepseek-reply-delivery.spec.yml'],
  },
  {
    id: 'search-rate-limit-contract-rate_limit_exceeded',
    status: 'confirmed',
    summary:
      'Search-path rate limits surface as rate_limit_exceeded with retryable cooldown metadata.',
    sourceSpecs: [
      'specs/deepseek/deepseek-search-rate-limit-audit.spec.yml',
      'specs/deepseek/deepseek-search-rate-limit-output.spec.yml',
    ],
  },
  {
    id: 'api-cooldown-replay-supported-without-ui-assumptions',
    status: 'confirmed',
    summary:
      'Automatic retry uses controlled browser-flow replay after cooldown, not synthetic HTTP retry.',
    sourceSpecs: ['specs/deepseek/deepseek-search-rate-limit-retry.spec.yml'],
  },
  {
    id: 'ui-retry-boundary-search-confirmed-general-pending',
    status: 'boundary',
    summary:
      'Search-path UI retry is separated from unresolved general rate-limit or failure retry surfaces.',
    sourceSpecs: [
      'specs/deepseek/deepseek-search-ui-retry-boundary.spec.yml',
      'specs/deepseek/deepseek-search-ui-retry-control.spec.yml',
    ],
  },
]

export interface BuildDeepSeekReleaseFingerprintInput {
  capturedAt?: string | undefined
  ui: {
    capturedAtUrl: string
    routeKind: DeepSeekReleaseUiFingerprint['routeKind']
    entryDocumentUrl: string | null
    entryDocumentStatus: number | null
    entryDocumentHtml: string
    staticAssetPaths: string[]
    routeShellProjection: DeepSeekReleaseRouteShellProjection
    modeSurfaceProjection?: DeepSeekReleaseUiModeSurfaceProjection | undefined
    composerSignature: Record<string, string>
    messageActionSignatures?: string[] | null | undefined
  }
  apiFingerprint: DeepSeekReleaseApiFingerprint
  outputFingerprint?: DeepSeekReleaseOutputFingerprint | undefined
}

export function buildDeepSeekReleaseFingerprint(
  input: BuildDeepSeekReleaseFingerprintInput,
): DeepSeekReleaseFingerprint {
  const entryDocumentProjection = projectDeepSeekEntryDocumentHtml(input.ui.entryDocumentHtml)
  const entryLinkedAssetPaths = extractEntryDocumentAssetPaths(input.ui.entryDocumentHtml)
  const staticAssetPaths = [...new Set(input.ui.staticAssetPaths)].sort()
  const messageActionSignatures = [
    ...new Set(input.ui.messageActionSignatures?.filter(Boolean) ?? []),
  ].sort()
  const composerSignature = orderStringRecord(input.ui.composerSignature)
  const routeShellProjection = normalizeRouteShellProjection(input.ui.routeShellProjection)
  const releaseFamilyRouteShellProjection = normalizeReleaseFamilyRouteShellProjection(
    input.ui.routeShellProjection,
  )
  const modeSurfaceProjection = normalizeModeSurfaceProjection(input.ui.modeSurfaceProjection)
  const contentObservations = normalizeContentObservations({
    routeShellProjection,
    messageActionSignatures,
  })
  const releaseFamilyAssetPaths = [...new Set(entryLinkedAssetPaths)].sort()
  const releaseFamilyAssetFingerprint = hashStableValue(releaseFamilyAssetPaths)
  const releaseFamilyUiFingerprint = hashStableValue({
    entryDocumentProjection,
    releaseFamilyAssetPaths,
    releaseFamilyRouteShellProjection,
    modeSurfaceProjection,
    composerSignature,
  })
  const contentObservationFingerprint = hashStableValue(contentObservations)
  const contentFingerprint = hashStableValue({
    entryDocumentProjection,
    staticAssetPaths,
    routeShellProjection,
    modeSurfaceProjection,
    composerSignature,
    messageActionSignatures,
  })

  const uiFingerprint: DeepSeekReleaseUiFingerprint = {
    fingerprint: contentFingerprint,
    releaseFamilyFingerprint: releaseFamilyUiFingerprint,
    contentFingerprint,
    capturedAtUrl: input.ui.capturedAtUrl,
    normalizedRoute: routeShellProjection.normalizedRoute,
    routeKind: input.ui.routeKind,
    entryDocumentUrl: input.ui.entryDocumentUrl,
    entryDocumentStatus: input.ui.entryDocumentStatus,
    entryDocumentFingerprint: hashStableValue(entryDocumentProjection),
    entryDocumentProjection,
    releaseFamilyAssetFingerprint,
    releaseFamilyAssetPaths,
    entryLinkedAssetFingerprint: hashStableValue(entryLinkedAssetPaths),
    entryLinkedAssetPaths,
    staticAssetFingerprint: hashStableValue(staticAssetPaths),
    staticAssetPaths,
    releaseFamilyRouteShellFingerprint: hashStableValue(releaseFamilyRouteShellProjection),
    releaseFamilyRouteShellProjection,
    routeShellFingerprint: hashStableValue(routeShellProjection),
    routeShellProjection,
    modeSurfaceFingerprint: hashStableValue(modeSurfaceProjection),
    modeSurfaceProjection,
    composerFingerprint: hashStableValue(composerSignature),
    composerSignature,
    contentObservationFingerprint,
    contentObservations,
    messageActionFingerprint:
      messageActionSignatures.length > 0 ? hashStableValue(messageActionSignatures) : null,
    messageActionSignatures,
  }

  const outputFingerprint =
    input.outputFingerprint ?? createDeepSeekReleaseOutputFingerprint()
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  const releaseWindowFingerprint = hashStableValue({
    entryDocumentFingerprint: uiFingerprint.entryDocumentFingerprint,
    releaseWindowAssetFingerprint: uiFingerprint.releaseFamilyAssetFingerprint,
    api: input.apiFingerprint.fingerprint,
    output: outputFingerprint.fingerprint,
  })
  const releaseFamilyFingerprint = hashStableValue({
    ui: uiFingerprint.releaseFamilyFingerprint,
    api: input.apiFingerprint.fingerprint,
    output: outputFingerprint.fingerprint,
  })

  return {
    compositeFingerprint: hashStableValue({
      ui: uiFingerprint.contentFingerprint,
      api: input.apiFingerprint.fingerprint,
      output: outputFingerprint.fingerprint,
    }),
    releaseWindowFingerprint,
    releaseFamilyFingerprint,
    contentFingerprint: hashStableValue({
      ui: uiFingerprint.contentFingerprint,
      api: input.apiFingerprint.fingerprint,
      output: outputFingerprint.fingerprint,
    }),
    capturedAt,
    uiFingerprint,
    apiFingerprint: input.apiFingerprint,
    outputFingerprint,
  }
}

export function buildDeepSeekReleaseApiFingerprint(
  registry: Record<string, DeepSeekEndpointAuditRecord>,
): DeepSeekReleaseApiFingerprint {
  const endpointSignatures: DeepSeekReleaseApiEndpointSignature[] = Object.values(registry)
    .map(record => {
      const projection = {
        endpoint: record.endpoint,
        category: record.category,
        evidenceStatus: record.evidenceStatus,
        confirmedOn: record.confirmedOn,
        consumedBy: {
          parser: record.consumedBy.parser,
          adapter: record.consumedBy.adapter,
          exporter: record.consumedBy.exporter,
        },
        fixtureCount: record.fixturePaths.length,
        sampleSourceCount: record.sampleSources.length,
        consumerSurfaces: [...record.consumerSurfaces].sort(),
        unconfirmedFields: [...record.unconfirmedFields].sort(),
      }
      return {
        endpoint: record.endpoint,
        category: record.category,
        evidenceStatus: record.evidenceStatus,
        confirmedOn: record.confirmedOn,
        consumedBy: projection.consumedBy,
        signature: hashStableValue(projection),
      }
    })
    .sort((left, right) => left.endpoint.localeCompare(right.endpoint))

  return {
    fingerprint: hashStableValue(
      endpointSignatures.map(signature => ({
        endpoint: signature.endpoint,
        signature: signature.signature,
      })),
    ),
    endpointAuditRegistryFingerprint: hashStableValue(
      endpointSignatures.map(signature => ({
        endpoint: signature.endpoint,
        signature: signature.signature,
      })),
    ),
    confirmedEndpointCount: endpointSignatures.filter(
      signature => signature.evidenceStatus === 'confirmed',
    ).length,
    pendingEndpointCount: endpointSignatures.filter(
      signature => signature.evidenceStatus === 'pending_internal_audit',
    ).length,
    endpointSignatures,
  }
}

export function createDeepSeekReleaseOutputFingerprint(
  quirks: readonly DeepSeekOutputQuirkDescriptor[] = DEEPSEEK_OUTPUT_QUIRK_CATALOG,
): DeepSeekReleaseOutputFingerprint {
  const normalizedQuirks = [...quirks]
    .map(quirk => ({
      id: quirk.id,
      status: quirk.status,
      summary: quirk.summary,
      sourceSpecs: [...quirk.sourceSpecs].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const fingerprint = hashStableValue(normalizedQuirks)
  return {
    fingerprint,
    outputQuirkFingerprint: fingerprint,
    quirks: normalizedQuirks,
  }
}

export function dedupeDeepSeekReleaseFingerprints(
  fingerprints: readonly DeepSeekReleaseFingerprint[],
): DeepSeekReleaseFingerprint[] {
  const unique = new Map<string, DeepSeekReleaseFingerprint>()

  for (const fingerprint of fingerprints) {
    if (!unique.has(fingerprint.compositeFingerprint)) {
      unique.set(fingerprint.compositeFingerprint, fingerprint)
    }
  }

  return [...unique.values()].sort((left, right) =>
    left.compositeFingerprint.localeCompare(right.compositeFingerprint),
  )
}

export function buildDeepSeekReleaseCompatibilityRecord(input: {
  artifactKind: DeepSeekReleaseArtifactKind
  generatedAt?: string | undefined
  releaseFingerprints: readonly DeepSeekReleaseFingerprint[]
  failureCount?: number | undefined
  warningCount?: number | undefined
}): DeepSeekReleaseCompatibilityRecord {
  const uniqueFingerprints = dedupeDeepSeekReleaseFingerprints(input.releaseFingerprints)
  const rawCompositeFingerprintCount = uniqueFingerprints.length
  const releaseWindowFingerprints = [
    ...new Set(
      uniqueFingerprints.map(resolveDeepSeekReleaseWindowFingerprint),
    ),
  ].sort()
  const compositeFingerprints = [
    ...new Set(
      uniqueFingerprints.map(resolveDeepSeekReleaseCompatibilityFingerprint),
    ),
  ].sort()
  const releaseWindowFingerprintCount = releaseWindowFingerprints.length
  const fingerprintCount = compositeFingerprints.length
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const failureCount = normalizeCount(input.failureCount)
  const warningCount = normalizeCount(input.warningCount)
  const collapsedRawFingerprints = rawCompositeFingerprintCount > fingerprintCount

  if (fingerprintCount === 0) {
    return {
      artifactKind: input.artifactKind,
      status: 'pending',
      evidenceKind: 'no-fingerprint-observed',
      generatedAt,
      fingerprintCount,
      compositeFingerprints,
      primaryFingerprint: null,
      releaseWindowFingerprints,
      primaryReleaseWindowFingerprint: null,
      releaseFamilyFingerprints: compositeFingerprints,
      primaryReleaseFamilyFingerprint: null,
      rawCompositeFingerprintCount,
      rawCompositeFingerprints: [],
      primaryRawFingerprint: null,
      failureCount,
      warningCount,
      notes: ['No DeepSeek release fingerprint was captured for this artifact.'],
    }
  }

  if (fingerprintCount > 1) {
    return {
      artifactKind: input.artifactKind,
      status: 'pending',
      evidenceKind: 'multi-fingerprint-observed',
      generatedAt,
      fingerprintCount,
      compositeFingerprints,
      primaryFingerprint: null,
      releaseWindowFingerprints,
      primaryReleaseWindowFingerprint:
        releaseWindowFingerprintCount === 1 ? releaseWindowFingerprints[0] ?? null : null,
      releaseFamilyFingerprints: compositeFingerprints,
      primaryReleaseFamilyFingerprint: null,
      rawCompositeFingerprintCount,
      rawCompositeFingerprints: uniqueFingerprints.map(fingerprint => fingerprint.compositeFingerprint),
      primaryRawFingerprint: null,
      failureCount,
      warningCount,
      notes: [
        'Multiple DeepSeek release fingerprints were observed inside one artifact window.',
        'Compatibility must stay pending until the drift window is re-run against a single fingerprint.',
        ...(collapsedRawFingerprints
          ? [
              'Raw UI snapshots varied across routes or transcript content, but they did not collapse to a single release-family fingerprint.',
            ]
          : []),
      ],
    }
  }

  const primaryFingerprint = compositeFingerprints[0] ?? null
  const primaryReleaseWindowFingerprint = releaseWindowFingerprints[0] ?? null
  const rawCompositeFingerprints = uniqueFingerprints.map(fingerprint => fingerprint.compositeFingerprint)
  const primaryRawFingerprint = rawCompositeFingerprints[0] ?? null
  if (input.artifactKind === 'probe') {
    return {
      artifactKind: input.artifactKind,
      status: 'pending',
      evidenceKind: 'probe-default-pending',
      generatedAt,
      fingerprintCount,
      compositeFingerprints,
      primaryFingerprint,
      releaseWindowFingerprints,
      primaryReleaseWindowFingerprint,
      releaseFamilyFingerprints: compositeFingerprints,
      primaryReleaseFamilyFingerprint: primaryFingerprint,
      rawCompositeFingerprintCount,
      rawCompositeFingerprints,
      primaryRawFingerprint,
      failureCount,
      warningCount,
      notes: [
        'Probe artifacts remain pending by design and do not promote compatibility on their own.',
        ...(collapsedRawFingerprints
          ? [
              'Multiple raw UI snapshots collapsed into one release-family fingerprint; compatibility stays pending only because this artifact is a probe.',
            ]
          : []),
      ],
    }
  }

  if (input.artifactKind === 'audit') {
    return {
      artifactKind: input.artifactKind,
      status: 'pending',
      evidenceKind: 'audit-default-pending',
      generatedAt,
      fingerprintCount,
      compositeFingerprints,
      primaryFingerprint,
      releaseWindowFingerprints,
      primaryReleaseWindowFingerprint,
      releaseFamilyFingerprints: compositeFingerprints,
      primaryReleaseFamilyFingerprint: primaryFingerprint,
      rawCompositeFingerprintCount,
      rawCompositeFingerprints,
      primaryRawFingerprint,
      failureCount,
      warningCount,
      notes: [
        'Audit artifacts remain pending by design and do not promote compatibility on their own.',
        ...(collapsedRawFingerprints
          ? [
              'Multiple raw UI snapshots collapsed into one release-family fingerprint; compatibility stays pending only because this artifact is an audit.',
            ]
          : []),
      ],
    }
  }

  if (failureCount > 0) {
    return {
      artifactKind: input.artifactKind,
      status: 'known-bad',
      evidenceKind: 'single-fingerprint-regression-fail',
      generatedAt,
      fingerprintCount,
      compositeFingerprints,
      primaryFingerprint,
      releaseWindowFingerprints,
      primaryReleaseWindowFingerprint,
      releaseFamilyFingerprints: compositeFingerprints,
      primaryReleaseFamilyFingerprint: primaryFingerprint,
      rawCompositeFingerprintCount,
      rawCompositeFingerprints,
      primaryRawFingerprint,
      failureCount,
      warningCount,
      notes: [
        'A single DeepSeek fingerprint was observed and at least one regression check failed.',
        ...(collapsedRawFingerprints
          ? [
              'Multiple raw UI snapshots collapsed into one release-family fingerprint for compatibility purposes.',
            ]
          : []),
      ],
    }
  }

  return {
    artifactKind: input.artifactKind,
    status: 'known-good',
    evidenceKind: 'single-fingerprint-regression-pass',
    generatedAt,
    fingerprintCount,
    compositeFingerprints,
    primaryFingerprint,
    releaseWindowFingerprints,
    primaryReleaseWindowFingerprint,
    releaseFamilyFingerprints: compositeFingerprints,
    primaryReleaseFamilyFingerprint: primaryFingerprint,
    rawCompositeFingerprintCount,
    rawCompositeFingerprints,
    primaryRawFingerprint,
    failureCount,
    warningCount,
    notes: [
      warningCount > 0
        ? 'A single DeepSeek fingerprint was observed; warnings remain recorded but no regression check failed.'
        : 'A single DeepSeek fingerprint was observed and all regression checks passed.',
      ...(collapsedRawFingerprints
        ? [
            'Multiple raw UI snapshots collapsed into one release-family fingerprint for compatibility purposes.',
          ]
        : []),
    ],
  }
}

function resolveDeepSeekReleaseCompatibilityFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): string {
  return resolveDeepSeekReleaseFamilyFingerprint(fingerprint)
}

export function resolveDeepSeekReleaseFamilyFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): string {
  return (
    fingerprint.releaseFamilyFingerprint ||
    hashStableValue({
      entryDocumentFingerprint: fingerprint.uiFingerprint.entryDocumentFingerprint,
      releaseFamilyAssetFingerprint:
        fingerprint.uiFingerprint.releaseFamilyAssetFingerprint ||
        fingerprint.uiFingerprint.entryLinkedAssetFingerprint ||
        fingerprint.uiFingerprint.staticAssetFingerprint,
      releaseFamilyRouteShellFingerprint:
        fingerprint.uiFingerprint.releaseFamilyRouteShellFingerprint ??
        hashStableValue(
          normalizeReleaseFamilyRouteShellProjection(fingerprint.uiFingerprint.routeShellProjection),
        ),
      modeSurfaceFingerprint: fingerprint.uiFingerprint.modeSurfaceFingerprint,
      composerFingerprint: fingerprint.uiFingerprint.composerFingerprint,
      apiFingerprint: fingerprint.apiFingerprint.fingerprint,
      outputFingerprint: fingerprint.outputFingerprint.fingerprint,
    })
  )
}

export function resolveDeepSeekReleaseWindowFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): string {
  return (
    fingerprint.releaseWindowFingerprint ||
    hashStableValue({
      entryDocumentFingerprint: fingerprint.uiFingerprint.entryDocumentFingerprint,
      releaseWindowAssetFingerprint:
        fingerprint.uiFingerprint.releaseFamilyAssetFingerprint ||
        fingerprint.uiFingerprint.entryLinkedAssetFingerprint ||
        fingerprint.uiFingerprint.staticAssetFingerprint,
      apiFingerprint: fingerprint.apiFingerprint.fingerprint,
      outputFingerprint: fingerprint.outputFingerprint.fingerprint,
    })
  )
}

export function resolveDeepSeekRawContentFingerprint(
  fingerprint: DeepSeekReleaseFingerprint,
): string {
  return fingerprint.contentFingerprint || fingerprint.compositeFingerprint
}

export function normalizeDeepSeekRouteFingerprint(url: string): string {
  const match = matchDeepSeekSessionRoute(url)
  if (match.routeKind === 'session') {
    return '/a/:agentId/s/:sessionId'
  }
  if (match.routeKind === 'landing') {
    return '/a/:agentId'
  }
  if (match.routeKind === 'home') {
    return '/'
  }

  try {
    const parsed = new URL(url)
    return parsed.pathname.replace(/\/+$/, '') || '/'
  } catch {
    return 'unknown'
  }
}

export function projectDeepSeekEntryDocumentHtml(
  html: string,
): DeepSeekReleaseUiEntryDocumentProjection {
  const normalizedHtml = html.replace(/\s+/g, ' ')
  return {
    title: readFirstCapture(normalizedHtml, /<title[^>]*>(.*?)<\/title>/i),
    htmlClassTokens: readClassTokens(normalizedHtml, 'html'),
    bodyClassTokens: readClassTokens(normalizedHtml, 'body'),
    rootIds: [
      ...new Set(
        Array.from(
          normalizedHtml.matchAll(
            /<(?:div|main|section)[^>]*\sid=(["'])([^"']+)\1/gi,
          ),
        )
          .map(match => match[2]?.trim() ?? '')
          .filter(Boolean),
      ),
    ].sort(),
    metaNames: [
      ...new Set(
        Array.from(
          normalizedHtml.matchAll(
            /<meta[^>]+(?:name|property)=(["'])([^"']+)\1/gi,
          ),
        )
          .map(match => match[2]?.trim() ?? '')
          .filter(Boolean),
      ),
    ].sort(),
    scriptTagCount: countMatches(normalizedHtml, /<script\b/gi),
    externalScriptCount: countMatches(normalizedHtml, /<script\b[^>]+\bsrc=/gi),
    inlineScriptCount:
      countMatches(normalizedHtml, /<script\b/gi) -
      countMatches(normalizedHtml, /<script\b[^>]+\bsrc=/gi),
    linkTagCount: countMatches(normalizedHtml, /<link\b/gi),
    stylesheetCount: countMatches(
      normalizedHtml,
      /<link\b[^>]+\brel=(["'])stylesheet\1/gi,
    ),
    modulePreloadCount: countMatches(
      normalizedHtml,
      /<link\b[^>]+\brel=(["'])modulepreload\1/gi,
    ),
    dataTestIdCount: countMatches(normalizedHtml, /\bdata-testid=/gi),
    ariaLabelCount: countMatches(normalizedHtml, /\baria-label=/gi),
    containsNextData: /__NEXT_DATA__/i.test(normalizedHtml),
    containsViteClient: /\/@vite\/client|vite\/client/i.test(normalizedHtml),
  }
}

function extractEntryDocumentAssetPaths(html: string): string[] {
  const normalizedHtml = html.replace(/\s+/g, ' ')
  const assetPaths = [
    ...Array.from(
      normalizedHtml.matchAll(
        /<(?:script|link)[^>]+(?:src|href)=(["'])([^"']+)\1/gi,
      ),
    )
      .map(match => normalizeEntryAssetUrl(match[2] ?? ''))
      .filter((value): value is string => Boolean(value)),
  ]

  return [...new Set(assetPaths)].sort()
}

function normalizeEntryAssetUrl(value: string): string | null {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value, 'https://chat.deepseek.com/')
    return parsed.pathname.replace(/\/+$/, '') || parsed.pathname || '/'
  } catch {
    return null
  }
}

function normalizeRouteShellProjection(
  projection: DeepSeekReleaseRouteShellProjection,
): DeepSeekReleaseRouteShellProjection {
  return {
    normalizedRoute: projection.normalizedRoute,
    routeKind: projection.routeKind,
    pageTitle: projection.pageTitle,
    bodyClassTokens: [...new Set(projection.bodyClassTokens)].sort(),
    rootIds: [...new Set(projection.rootIds)].sort(),
    hasHeader: projection.hasHeader,
    hasSidebar: projection.hasSidebar,
    hasComposerInput: projection.hasComposerInput,
    hasVirtualMessageList: projection.hasVirtualMessageList,
    visibleButtonBucket: projection.visibleButtonBucket,
    messageItemBucket: projection.messageItemBucket,
    modalBucket: projection.modalBucket,
  }
}

function normalizeReleaseFamilyRouteShellProjection(
  projection: DeepSeekReleaseRouteShellProjection,
): DeepSeekReleaseFamilyRouteShellProjection {
  return {
    normalizedRoute: projection.normalizedRoute,
    routeKind: projection.routeKind,
    bodyClassTokens: [...new Set(projection.bodyClassTokens)].sort(),
    rootIds: [...new Set(projection.rootIds)].sort(),
    hasHeader: projection.hasHeader,
    hasSidebar: projection.hasSidebar,
    hasComposerInput: projection.hasComposerInput,
  }
}

function normalizeModeSurfaceProjection(
  projection: DeepSeekReleaseUiModeSurfaceProjection | undefined,
): DeepSeekReleaseUiModeSurfaceProjection {
  return {
    heading: projection?.heading?.trim() || null,
    modeSelectorVisible: projection?.modeSelectorVisible === true,
    availableModes: [...new Set(projection?.availableModes ?? [])].sort(),
    activeMode: projection?.activeMode ?? null,
  }
}

function normalizeContentObservations(input: {
  routeShellProjection: DeepSeekReleaseRouteShellProjection
  messageActionSignatures: string[]
}): DeepSeekReleaseUiContentObservations {
  return {
    pageTitle: input.routeShellProjection.pageTitle,
    hasVirtualMessageList: input.routeShellProjection.hasVirtualMessageList,
    visibleButtonBucket: input.routeShellProjection.visibleButtonBucket,
    messageItemBucket: input.routeShellProjection.messageItemBucket,
    modalBucket: input.routeShellProjection.modalBucket,
    messageActionSignatures: [...new Set(input.messageActionSignatures)].sort(),
  }
}

function readClassTokens(html: string, tagName: string): string[] {
  const classValue = readFirstCapture(
    html,
    new RegExp(`<${tagName}[^>]*\\bclass=(["'])(.*?)\\1`, 'i'),
  )

  if (!classValue) {
    return []
  }

  return [...new Set(classValue.split(/\s+/).filter(Boolean))].sort()
}

function readFirstCapture(source: string, pattern: RegExp): string | null {
  const match = source.match(pattern)
  const value = match?.[2] ?? match?.[1] ?? null
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized ? normalized : null
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length
}

function hashStableValue(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function orderStringRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function normalizeCount(value: number | undefined): number {
  return Number.isFinite(value) && typeof value === 'number' ? Math.max(0, value) : 0
}
