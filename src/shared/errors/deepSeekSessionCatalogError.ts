import type { DeepSeekSessionCatalogResult } from '../../types/deepseek-session-catalog.types.js'

export class DeepSeekSessionCatalogError extends Error {
  readonly code = 'deepseek_session_catalog_all_invalid'
  readonly catalog: DeepSeekSessionCatalogResult

  constructor(catalog: DeepSeekSessionCatalogResult) {
    super(formatDeepSeekSessionCatalogErrorMessage(catalog))
    this.name = 'DeepSeekSessionCatalogError'
    this.catalog = cloneDeepSeekSessionCatalogResult(catalog)
  }
}

export function createDeepSeekSessionCatalogAllInvalidError(
  catalog: DeepSeekSessionCatalogResult,
): DeepSeekSessionCatalogError {
  return new DeepSeekSessionCatalogError(catalog)
}

export function isDeepSeekSessionCatalogError(
  error: unknown,
): error is DeepSeekSessionCatalogError {
  return error instanceof DeepSeekSessionCatalogError
}

function formatDeepSeekSessionCatalogErrorMessage(
  catalog: DeepSeekSessionCatalogResult,
): string {
  const header =
    `DeepSeek session catalog failed closed: scanned ${catalog.scannedFileCount} candidate file(s) under ${catalog.sessionStoreDir}, but none could be loaded as a valid stored session.`
  const warningLines = catalog.warnings.map(warning =>
    `- ${warning.sessionFile ?? 'unknown'} [${warning.code}]: ${warning.message}`,
  )

  return warningLines.length > 0
    ? [header, ...warningLines].join('\n')
    : header
}

function cloneDeepSeekSessionCatalogResult(
  catalog: DeepSeekSessionCatalogResult,
): DeepSeekSessionCatalogResult {
  return {
    ...catalog,
    warnings: catalog.warnings.map(warning => ({ ...warning })),
    sessions: catalog.sessions.map(session => ({ ...session })),
  }
}
