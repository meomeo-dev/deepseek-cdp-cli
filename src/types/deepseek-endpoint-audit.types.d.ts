export type DeepSeekEndpointAuditCategory = 'chat' | 'chat-session' | 'file'

export type DeepSeekEndpointEvidenceStatus = 'confirmed' | 'pending_internal_audit'

export interface DeepSeekEndpointAuditConsumption {
  parser: boolean
  adapter: boolean
  exporter: boolean
}

export interface DeepSeekEndpointAuditRecord {
  endpoint: string
  category: DeepSeekEndpointAuditCategory
  confirmedOn: string | null
  evidenceStatus: DeepSeekEndpointEvidenceStatus
  sampleSources: string[]
  fixturePaths: string[]
  consumedBy: DeepSeekEndpointAuditConsumption
  consumerSurfaces: string[]
  unconfirmedFields: string[]
  notes: string[]
}
