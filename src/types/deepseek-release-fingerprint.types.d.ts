import type { DeepSeekRouteKind } from './deepseek-controls.types.js'
import type { DeepSeekChatMode } from './deepseek-chat-mode.types.js'
import type { DeepSeekEndpointEvidenceStatus } from './deepseek-endpoint-audit.types.js'

export type DeepSeekReleaseArtifactKind =
  | 'gate'
  | 'release-gate'
  | 'probe'
  | 'audit'

export type DeepSeekReleaseCompatibilityStatus =
  | 'known-good'
  | 'known-bad'
  | 'pending'

export type DeepSeekReleaseCompatibilityEvidenceKind =
  | 'single-fingerprint-regression-pass'
  | 'single-fingerprint-regression-fail'
  | 'multi-fingerprint-observed'
  | 'probe-default-pending'
  | 'audit-default-pending'
  | 'no-fingerprint-observed'

export type DeepSeekOutputQuirkStatus = 'confirmed' | 'boundary'

export interface DeepSeekReleaseUiEntryDocumentProjection {
  title: string | null
  htmlClassTokens: string[]
  bodyClassTokens: string[]
  rootIds: string[]
  metaNames: string[]
  scriptTagCount: number
  externalScriptCount: number
  inlineScriptCount: number
  linkTagCount: number
  stylesheetCount: number
  modulePreloadCount: number
  dataTestIdCount: number
  ariaLabelCount: number
  containsNextData: boolean
  containsViteClient: boolean
}

export interface DeepSeekReleaseRouteShellProjection {
  normalizedRoute: string
  routeKind: DeepSeekRouteKind
  pageTitle: string | null
  bodyClassTokens: string[]
  rootIds: string[]
  hasHeader: boolean
  hasSidebar: boolean
  hasComposerInput: boolean
  hasVirtualMessageList: boolean
  visibleButtonBucket: string
  messageItemBucket: string
  modalBucket: string
}

export interface DeepSeekReleaseFamilyRouteShellProjection {
  normalizedRoute: string
  routeKind: DeepSeekRouteKind
  bodyClassTokens: string[]
  rootIds: string[]
  hasHeader: boolean
  hasSidebar: boolean
  hasComposerInput: boolean
}

export interface DeepSeekReleaseUiModeSurfaceProjection {
  heading: string | null
  modeSelectorVisible: boolean
  availableModes: DeepSeekChatMode[]
  activeMode: DeepSeekChatMode | null
}

export interface DeepSeekReleaseUiContentObservations {
  pageTitle: string | null
  hasVirtualMessageList: boolean
  visibleButtonBucket: string
  messageItemBucket: string
  modalBucket: string
  messageActionSignatures: string[]
}

export interface DeepSeekReleaseUiFingerprint {
  fingerprint: string
  releaseFamilyFingerprint: string
  contentFingerprint: string
  capturedAtUrl: string
  normalizedRoute: string
  routeKind: DeepSeekRouteKind
  entryDocumentUrl: string | null
  entryDocumentStatus: number | null
  entryDocumentFingerprint: string
  entryDocumentProjection: DeepSeekReleaseUiEntryDocumentProjection
  releaseFamilyAssetFingerprint: string
  releaseFamilyAssetPaths: string[]
  entryLinkedAssetFingerprint: string
  entryLinkedAssetPaths: string[]
  staticAssetFingerprint: string
  staticAssetPaths: string[]
  releaseFamilyRouteShellFingerprint: string
  releaseFamilyRouteShellProjection: DeepSeekReleaseFamilyRouteShellProjection
  routeShellFingerprint: string
  routeShellProjection: DeepSeekReleaseRouteShellProjection
  modeSurfaceFingerprint: string
  modeSurfaceProjection: DeepSeekReleaseUiModeSurfaceProjection
  composerFingerprint: string
  composerSignature: Record<string, string>
  contentObservationFingerprint: string
  contentObservations: DeepSeekReleaseUiContentObservations
  messageActionFingerprint: string | null
  messageActionSignatures: string[]
}

export interface DeepSeekReleaseApiEndpointSignature {
  endpoint: string
  category: string
  evidenceStatus: DeepSeekEndpointEvidenceStatus
  confirmedOn: string | null
  consumedBy: {
    parser: boolean
    adapter: boolean
    exporter: boolean
  }
  signature: string
}

export interface DeepSeekReleaseApiFingerprint {
  fingerprint: string
  endpointAuditRegistryFingerprint: string
  confirmedEndpointCount: number
  pendingEndpointCount: number
  endpointSignatures: DeepSeekReleaseApiEndpointSignature[]
}

export interface DeepSeekOutputQuirkDescriptor {
  id: string
  status: DeepSeekOutputQuirkStatus
  summary: string
  sourceSpecs: string[]
}

export interface DeepSeekReleaseOutputFingerprint {
  fingerprint: string
  outputQuirkFingerprint: string
  quirks: DeepSeekOutputQuirkDescriptor[]
}

export interface DeepSeekReleaseFingerprint {
  compositeFingerprint: string
  releaseWindowFingerprint: string
  releaseFamilyFingerprint: string
  contentFingerprint: string
  capturedAt: string
  uiFingerprint: DeepSeekReleaseUiFingerprint
  apiFingerprint: DeepSeekReleaseApiFingerprint
  outputFingerprint: DeepSeekReleaseOutputFingerprint
}

export interface DeepSeekReleaseCompatibilityRecord {
  artifactKind: DeepSeekReleaseArtifactKind
  status: DeepSeekReleaseCompatibilityStatus
  evidenceKind: DeepSeekReleaseCompatibilityEvidenceKind
  generatedAt: string
  fingerprintCount: number
  compositeFingerprints: string[]
  primaryFingerprint: string | null
  releaseWindowFingerprints: string[]
  primaryReleaseWindowFingerprint: string | null
  releaseFamilyFingerprints: string[]
  primaryReleaseFamilyFingerprint: string | null
  rawCompositeFingerprintCount: number
  rawCompositeFingerprints: string[]
  primaryRawFingerprint: string | null
  failureCount: number
  warningCount: number
  notes: string[]
}
