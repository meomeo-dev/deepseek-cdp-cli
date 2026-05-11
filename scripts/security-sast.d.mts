export function scanTextForSast(
  relativePath: string,
  content: string,
  config: {
    ignoredPaths: string[]
    allowedFindings: Array<{
      ruleId: string
      path: string
    }>
  },
): Array<{
  ruleId: string
}>
