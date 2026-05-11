import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildDeepSeekReleaseDiffReport } from '../../domain/regression/deepSeekReleaseDiff.js'
import { buildDeepSeekReleaseTriageReport } from '../../domain/regression/deepSeekReleaseTriage.js'
import { resolveDeepSeekReleaseTriageEvidenceRoot } from '../../shared/deepSeekReleaseEvidencePaths.js'
import type { DeepSeekReleaseTriageReport } from '../../types/deepseek-release-triage.types.js'
import { selectDeepSeekReleaseArtifacts } from './selectDeepSeekReleaseArtifacts.js'

export async function triageDeepSeekReleaseArtifacts(input: {
  artifactsDir: string
  currentArtifactFiles?: string[] | undefined
  baselineArtifactFiles?: string[] | undefined
  artifactRootDir?: string | undefined
  outputFile?: string | undefined
  cwd?: string | undefined
}): Promise<DeepSeekReleaseTriageReport> {
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
  const recommendedArtifactRoot = resolveDeepSeekReleaseTriageEvidenceRoot(
    input.artifactRootDir,
    {
      cwd,
      preferManagedDefault: false,
    },
  )
  const recommendedArtifactRootDir = recommendedArtifactRoot.path

  const report = buildDeepSeekReleaseTriageReport({
    diffReport,
    currentArtifacts: selection.currentArtifacts,
    baselineArtifacts: selection.baselineArtifacts,
    recommendedArtifactRootDir,
    recommendedArtifactRoot,
  })

  if (input.outputFile) {
    const outputFile = resolve(cwd, input.outputFile)
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}
