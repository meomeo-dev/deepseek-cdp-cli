export function summarizeAuditReport(
  report: {
    metadata?: {
      vulnerabilities?: Partial<
        Record<'info' | 'low' | 'moderate' | 'high' | 'critical' | 'total', number>
      >
    }
  },
  minimumSeverity?: string,
): {
  pass: boolean
  blockingCount: number
  counts: Record<string, number>
}
