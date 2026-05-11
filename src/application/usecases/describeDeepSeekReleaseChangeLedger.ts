import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildDeepSeekReleaseBoundaryReport } from '../../domain/regression/deepSeekReleaseAdapterBoundaries.js'
import { buildDeepSeekReleaseChangeLedgerReport } from '../../domain/regression/deepSeekReleaseChangeLedger.js'
import { buildDeepSeekReleaseDiffReport } from '../../domain/regression/deepSeekReleaseDiff.js'
import { buildDeepSeekReleaseRevalidationReport } from '../../domain/regression/deepSeekReleaseRevalidation.js'
import { buildDeepSeekReleaseTriageReport } from '../../domain/regression/deepSeekReleaseTriage.js'
import { resolveDeepSeekReleaseTriageEvidenceRoot } from '../../shared/deepSeekReleaseEvidencePaths.js'
import type {
  DeepSeekReleaseObservationEntry,
  DeepSeekReleaseChangeLedgerReport,
  DeepSeekReleaseObservationSeed,
  DeepSeekReleaseObservationUnresolvedItem,
} from '../../types/deepseek-release-change-ledger.types.js'
import { selectDeepSeekReleaseArtifacts } from './selectDeepSeekReleaseArtifacts.js'

export async function describeDeepSeekReleaseChangeLedger(input: {
  artifactsDir: string
  currentArtifactFiles?: string[] | undefined
  baselineArtifactFiles?: string[] | undefined
  artifactRootDir?: string | undefined
  observationFiles?: string[] | undefined
  outputFile?: string | undefined
  cwd?: string | undefined
}): Promise<DeepSeekReleaseChangeLedgerReport> {
  const cwd = input.cwd ?? process.cwd()
  const selection = await selectDeepSeekReleaseArtifacts({
    artifactsDir: input.artifactsDir,
    currentArtifactFiles: input.currentArtifactFiles,
    baselineArtifactFiles: input.baselineArtifactFiles,
    cwd,
  })

  const diffReport = buildDeepSeekReleaseDiffReport({
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
  })
  const boundaryReport = buildDeepSeekReleaseBoundaryReport({
    diffReport,
  })
  const recommendedArtifactRoot = resolveDeepSeekReleaseTriageEvidenceRoot(
    input.artifactRootDir,
    {
      cwd,
      preferManagedDefault: false,
    },
  )
  const triageReport = buildDeepSeekReleaseTriageReport({
    diffReport,
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
    recommendedArtifactRootDir: recommendedArtifactRoot.path,
    recommendedArtifactRoot,
  })
  const revalidationReport = buildDeepSeekReleaseRevalidationReport({
    diffReport,
    boundaryReport,
    triageReport,
  })
  const observationSeeds = await loadObservationSeeds(input.observationFiles, cwd)
  const report = buildDeepSeekReleaseChangeLedgerReport({
    diffReport,
    boundaryReport,
    triageReport,
    revalidationReport,
    observationSeeds,
  })

  if (input.outputFile) {
    const outputFile = resolve(cwd, input.outputFile)
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}

async function loadObservationSeeds(
  files: string[] | undefined,
  cwd: string,
): Promise<DeepSeekReleaseObservationSeed[]> {
  const seeds: DeepSeekReleaseObservationSeed[] = []
  for (const file of files ?? []) {
    const resolved = resolve(cwd, file)
    const parsed = JSON.parse(await readFile(resolved, 'utf8')) as unknown
    seeds.push(parseObservationSeed(parsed, file))
  }
  return seeds
}

function parseObservationSeed(
  input: unknown,
  sourceFile: string,
): DeepSeekReleaseObservationSeed {
  if (!isPlainObject(input)) {
    throw new Error(`Observation file must contain a JSON object: ${sourceFile}`)
  }
  if (typeof input['capturedAt'] !== 'string') {
    throw new Error(`Observation file is missing capturedAt: ${sourceFile}`)
  }
  if (
    input['source'] !== 'manual-browser-observation' &&
    input['source'] !== 'manual-codebase-observation' &&
    input['source'] !== 'manual-hybrid-observation'
  ) {
    throw new Error(`Observation file has unsupported source: ${sourceFile}`)
  }
  if (!Array.isArray(input['entries'])) {
    throw new Error(`Observation file is missing entries[]: ${sourceFile}`)
  }

  return {
    capturedAt: readRequiredString(input['capturedAt'], sourceFile, 'capturedAt'),
    source: readObservationSource(input['source'], sourceFile),
    releaseContext: readReleaseContext(input['releaseContext'], sourceFile),
    entries: readObservationEntries(input['entries'], sourceFile),
    unresolvedMatrix: readObservationUnresolvedMatrix(
      input['unresolvedMatrix'],
      sourceFile,
    ),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
  }
  return value
}

function readOptionalStringArray(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
  }
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
    }
    result.push(item)
  }
  return result
}

function readObservationSource(
  value: unknown,
  sourceFile: string,
): DeepSeekReleaseObservationSeed['source'] {
  if (
    value === 'manual-browser-observation' ||
    value === 'manual-codebase-observation' ||
    value === 'manual-hybrid-observation'
  ) {
    return value
  }
  throw new Error(`Observation file has unsupported source: ${sourceFile}`)
}

function readReleaseContext(
  value: unknown,
  sourceFile: string,
): DeepSeekReleaseObservationSeed['releaseContext'] {
  if (value === undefined) {
    return undefined
  }
  if (!isPlainObject(value)) {
    throw new Error(`Observation file has invalid releaseContext: ${sourceFile}`)
  }

  const url = value['url']
  const note = value['note']
  if (url !== undefined && typeof url !== 'string') {
    throw new Error(`Observation file has invalid releaseContext.url: ${sourceFile}`)
  }
  if (note !== undefined && typeof note !== 'string') {
    throw new Error(`Observation file has invalid releaseContext.note: ${sourceFile}`)
  }

  if (url === undefined && note === undefined) {
    return undefined
  }

  return {
    url,
    note,
  }
}

function readObservationEntries(
  value: unknown,
  sourceFile: string,
): DeepSeekReleaseObservationEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`Observation file is missing entries[]: ${sourceFile}`)
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`Observation entry must be an object: ${sourceFile}#entries[${index}]`)
    }

    return {
      id: readRequiredString(entry['id'], sourceFile, `entries[${index}].id`),
      status: readObservationStatus(entry['status'], sourceFile, `entries[${index}].status`),
      surface: readObservationSurface(
        entry['surface'],
        sourceFile,
        `entries[${index}].surface`,
      ),
      scope: readObservationScope(entry['scope'], sourceFile, `entries[${index}].scope`),
      title: readRequiredString(entry['title'], sourceFile, `entries[${index}].title`),
      detail: readRequiredString(entry['detail'], sourceFile, `entries[${index}].detail`),
      confidence: readObservationConfidence(
        entry['confidence'],
        sourceFile,
        `entries[${index}].confidence`,
      ),
      evidencePaths: readOptionalStringArray(
        entry['evidencePaths'],
        sourceFile,
        `entries[${index}].evidencePaths`,
      ),
      followUpTaskIds: readOptionalStringArray(
        entry['followUpTaskIds'],
        sourceFile,
        `entries[${index}].followUpTaskIds`,
      ),
    }
  })
}

function readObservationUnresolvedMatrix(
  value: unknown,
  sourceFile: string,
): DeepSeekReleaseObservationUnresolvedItem[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new Error(`Observation file has invalid unresolvedMatrix: ${sourceFile}`)
  }

  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new Error(
        `Observation unresolved item must be an object: ${sourceFile}#unresolvedMatrix[${index}]`,
      )
    }

    return {
      id: readRequiredString(item['id'], sourceFile, `unresolvedMatrix[${index}].id`),
      question: readRequiredString(
        item['question'],
        sourceFile,
        `unresolvedMatrix[${index}].question`,
      ),
      surfaces: readObservationSurfaceArray(
        item['surfaces'],
        sourceFile,
        `unresolvedMatrix[${index}].surfaces`,
      ),
      relatedEntryIds: readOptionalStringArray(
        item['relatedEntryIds'],
        sourceFile,
        `unresolvedMatrix[${index}].relatedEntryIds`,
      ),
      detail: readRequiredString(
        item['detail'],
        sourceFile,
        `unresolvedMatrix[${index}].detail`,
      ),
      followUpTaskIds: readOptionalStringArray(
        item['followUpTaskIds'],
        sourceFile,
        `unresolvedMatrix[${index}].followUpTaskIds`,
      ),
    }
  })
}

function readObservationStatus(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): DeepSeekReleaseObservationEntry['status'] {
  if (
    value === 'confirmed' ||
    value === 'removed' ||
    value === 'changed' ||
    value === 'unresolved'
  ) {
    return value
  }
  throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
}

function readObservationSurface(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): DeepSeekReleaseObservationEntry['surface'] {
  if (
    value === 'home' ||
    value === 'composer' ||
    value === 'session' ||
    value === 'message-action' ||
    value === 'search' ||
    value === 'file' ||
    value === 'mode' ||
    value === 'api' ||
    value === 'output' ||
    value === 'runtime' ||
    value === 'other'
  ) {
    return value
  }
  throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
}

function readObservationSurfaceArray(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): DeepSeekReleaseObservationUnresolvedItem['surfaces'] {
  if (!Array.isArray(value)) {
    throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
  }
  return value.map((item, index) =>
    readObservationSurface(item, sourceFile, `${fieldName}[${index}]`),
  )
}

function readObservationScope(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): DeepSeekReleaseObservationEntry['scope'] {
  if (
    value === 'home' ||
    value === 'composer' ||
    value === 'session' ||
    value === 'message-action' ||
    value === 'release-window' ||
    value === 'other'
  ) {
    return value
  }
  throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
}

function readObservationConfidence(
  value: unknown,
  sourceFile: string,
  fieldName: string,
): DeepSeekReleaseObservationEntry['confidence'] {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value
  }
  throw new Error(`Observation file has invalid ${fieldName}: ${sourceFile}`)
}
