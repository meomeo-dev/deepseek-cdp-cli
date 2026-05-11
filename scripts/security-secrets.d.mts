export function scanTextForSecrets(
  relativePath: string,
  content: string,
  config: {
    ignoredPaths: string[]
    allowedMatches: Array<{
      ruleId: string
      path: string
      matchContains?: string | undefined
    }>
  },
): Array<{
  ruleId: string
}>
