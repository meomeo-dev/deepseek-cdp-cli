import type { ManagedChromeOptions, WaitUntil } from './managed-chrome.types.js'
import type {
  DeepSeekEndpointAuditCategory,
  DeepSeekEndpointAuditConsumption,
  DeepSeekEndpointEvidenceStatus,
} from './deepseek-endpoint-audit.types.js'
import type {
  DeepSeekReleaseCompatibilityRecord,
  DeepSeekReleaseFingerprint,
} from './deepseek-release-fingerprint.types.js'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeSignalLayer,
  DeepSeekChatModeSignalObservation,
} from './deepseek-chat-mode.types.js'
import type { DeepSeekChatModeAuditReport } from './deepseek-mode-audit.types.js'

export interface AuditDeepSeekEndpointDriftInput extends ManagedChromeOptions {
  url: string
  waitUntil: WaitUntil
  instantPrompt?: string | undefined
  expertPrompt?: string | undefined
  outputFile?: string | undefined
}

export type DeepSeekEndpointDriftEvidenceSource =
  | 'current-mode-audit'
  | 'registry-fixture-baseline'
  | 'pending-internal-audit'

export type DeepSeekEndpointDriftFixtureStatus = 'present' | 'missing'

export interface DeepSeekEndpointDriftRegistryEntry {
  endpoint: string
  category: DeepSeekEndpointAuditCategory
  evidenceStatus: DeepSeekEndpointEvidenceStatus
  currentEvidenceSource: DeepSeekEndpointDriftEvidenceSource
  fixtureStatus: DeepSeekEndpointDriftFixtureStatus
  fixturePaths: string[]
  missingFixturePaths: string[]
  consumedBy: DeepSeekEndpointAuditConsumption
  consumerSurfaces: string[]
  unconfirmedFields: string[]
  notes: string[]
}

export interface DeepSeekEndpointDriftRegistrySummary {
  totalEndpoints: number
  catalogEndpointCount: number
  catalogCoverageStatus: 'covered' | 'mismatch'
  missingRegistryEndpoints: string[]
  uncataloguedRegistryEndpoints: string[]
  confirmedEndpoints: number
  pendingInternalAuditEndpoints: number
  parserConsumedEndpoints: string[]
  adapterConsumedEndpoints: string[]
  exporterConsumedEndpoints: string[]
  currentModeAuditBackedEndpoints: string[]
  registryFixtureBaselineEndpoints: string[]
}

export interface DeepSeekEndpointDriftRegistryAudit {
  summary: DeepSeekEndpointDriftRegistrySummary
  endpoints: DeepSeekEndpointDriftRegistryEntry[]
}

export interface DeepSeekEndpointDriftModeSignalLayerAudit {
  layer: DeepSeekChatModeSignalLayer
  observed: boolean
  rawModelType: string | null
  resolvedMode: DeepSeekChatMode | 'unknown'
  expectedMode: DeepSeekChatMode
  status: 'pass' | 'fail'
  note: string
}

export interface DeepSeekEndpointDriftModeSignalChain {
  requestedMode: DeepSeekChatMode
  authoritySignals: DeepSeekChatModeSignalObservation[]
  layers: DeepSeekEndpointDriftModeSignalLayerAudit[]
  sourceChainStatus: 'pass' | 'fail'
  deliveryChainStatus: 'pass' | 'fail'
}

export interface DeepSeekEndpointDriftRateLimitBaseline {
  source: 'fixture'
  endpoint: '/api/v0/chat/completion'
  fixtureFile: string
  readyModelType: string | null
  hintFinishReason: string | null
  closeClickBehavior: string | null
  currentWindowStatus: 'observation-pending'
  notes: string[]
}

export type DeepSeekEndpointDriftAuditArea =
  | 'endpoint-registry'
  | 'mode-signal-path'
  | 'rate-limit-baseline'
  | 'boundary-split'

export type DeepSeekEndpointDriftAuditCheckStatus = 'pass' | 'warn' | 'fail'

export interface DeepSeekEndpointDriftAuditCheck {
  id: string
  area: DeepSeekEndpointDriftAuditArea
  status: DeepSeekEndpointDriftAuditCheckStatus
  summary: string
  notes: string[]
}

export interface DeepSeekEndpointDriftAuditReport {
  scenario: 'endpoint-drift-audit'
  capturedAt: string
  requestedUrl: string
  releaseFingerprints: DeepSeekReleaseFingerprint[]
  compatibility: DeepSeekReleaseCompatibilityRecord
  modeAudit: DeepSeekChatModeAuditReport
  registry: DeepSeekEndpointDriftRegistryAudit
  modeSignalChains: DeepSeekEndpointDriftModeSignalChain[]
  searchRateLimitBaseline: DeepSeekEndpointDriftRateLimitBaseline
  checks: DeepSeekEndpointDriftAuditCheck[]
  notes: string[]
}
