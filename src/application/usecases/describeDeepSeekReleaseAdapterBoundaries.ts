import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildDeepSeekReleaseBoundaryReport } from '../../domain/regression/deepSeekReleaseAdapterBoundaries.js'
import { buildDeepSeekReleaseDiffReport } from '../../domain/regression/deepSeekReleaseDiff.js'
import type { DeepSeekReleaseBoundaryReport } from '../../types/deepseek-release-boundary.types.js'
import { selectDeepSeekReleaseArtifacts } from './selectDeepSeekReleaseArtifacts.js'

export async function describeDeepSeekReleaseAdapterBoundaries(input: {
  artifactsDir: string
  currentArtifactFiles?: string[] | undefined
  baselineArtifactFiles?: string[] | undefined
  outputFile?: string | undefined
  cwd?: string | undefined
}): Promise<DeepSeekReleaseBoundaryReport> {
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
  const report = buildDeepSeekReleaseBoundaryReport({
    diffReport,
  })

  if (input.outputFile) {
    const outputFile = resolve(cwd, input.outputFile)
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  return report
}
