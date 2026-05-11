import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildDeepSeekReleaseBoundaryReport } from '../../domain/regression/deepSeekReleaseAdapterBoundaries.js'
import { buildDeepSeekReleaseDiffReport } from '../../domain/regression/deepSeekReleaseDiff.js'
import { buildDeepSeekReleaseRevalidationReport } from '../../domain/regression/deepSeekReleaseRevalidation.js'
import { buildDeepSeekReleaseTriageReport } from '../../domain/regression/deepSeekReleaseTriage.js'
import { resolveDeepSeekReleaseTriageEvidenceRoot } from '../../shared/deepSeekReleaseEvidencePaths.js'
import type { DeepSeekReleaseRevalidationReport } from '../../types/deepseek-release-revalidation.types.js'
import { selectDeepSeekReleaseArtifacts } from './selectDeepSeekReleaseArtifacts.js'

export async function describeDeepSeekReleaseRevalidation(input: {
  artifactsDir: string
  currentArtifactFiles?: string[] | undefined
  baselineArtifactFiles?: string[] | undefined
  artifactRootDir?: string | undefined
  repairNotes?: string[] | undefined
  docsUpdated?: boolean | undefined
  outputFile?: string | undefined
  cwd?: string | undefined
}): Promise<DeepSeekReleaseRevalidationReport> {
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
  const report = buildDeepSeekReleaseRevalidationReport({
    diffReport,
    boundaryReport,
    triageReport,
    repairNotes: input.repairNotes,
    docsUpdated: input.docsUpdated,
  })

  if (input.outputFile) {
    const outputFile = resolve(cwd, input.outputFile)
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}
