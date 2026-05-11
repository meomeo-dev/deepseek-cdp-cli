import type { SyncDeepSeekSessionResult } from '../../application/usecases/syncDeepSeekSession.js'

export function formatDeepSeekSessionSyncText(result: SyncDeepSeekSessionResult): string {
  if (result.mode === 'catalog') {
    return [
      'Reconciled the DeepSeek session catalog from the browser-backed online catalog.',
      `sessionStoreDir: ${result.sessionStoreDir}`,
      `requestedUrl: ${result.requestedUrl}`,
      'syncScope: catalog-only',
      `discoveredCount: ${result.discoveredCount}`,
      `importedCount: ${result.importedCount}`,
      `refreshedCount: ${result.refreshedCount}`,
      `unchangedCount: ${result.unchangedCount}`,
      `skippedCount: ${result.skippedCount}`,
      `warningCount: ${result.warnings.length}`,
      `hasMore: ${result.hasMore}`,
      `partial: ${result.partial}`,
    ].join('\n')
  }

  return [
    `Synced stored session ${result.authoritativeSessionId}.`,
    `sessionFile: ${result.sessionFile}`,
    `finalUrl: ${result.finalUrl}`,
    `contextSource: ${result.contextSource}`,
    `historyRecoveryOutcome: ${result.historyRecoveryOutcome}`,
    `branchCount: ${formatCountDelta(result.branchCountBefore, result.branchCountAfter)}`,
    `messageCount: ${formatCountDelta(result.messageCountBefore, result.messageCountAfter)}`,
  ].join('\n')
}

export function formatDeepSeekSessionSyncWarningsText(
  result: SyncDeepSeekSessionResult,
): string | null {
  if (result.mode !== 'catalog' || result.warnings.length === 0) {
    return null
  }

  return [
    `sync-session warnings (${result.warnings.length}):`,
    ...result.warnings.map(warning => {
      const sessionId = warning.sessionId ? ` sessionId=${warning.sessionId}` : ''
      const sessionFile = warning.sessionFile ? ` sessionFile=${warning.sessionFile}` : ''
      return `warning [${warning.code}]${sessionId}${sessionFile}: ${collapseCliText(warning.message)}`
    }),
  ].join('\n')
}

function formatCountDelta(before: number, after: number): string {
  const delta = after - before
  const deltaPrefix = delta > 0 ? '+' : ''
  return `${before} -> ${after} (${deltaPrefix}${delta})`
}

function collapseCliText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}
