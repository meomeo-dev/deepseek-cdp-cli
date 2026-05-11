export interface DeepSeekTranscriptRecovery {
  source: 'history_messages'
  status: 'recovered' | 'failed'
  requestUrl: string | null
  responseStatus: number | null
  recoveredAt: string
  attempts: number
  branchCount: number
  messageCount: number
  settled: boolean
  errorMessage?: string | undefined
}
