import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type {
  DeepSeekReleaseArtifactSelectionSource,
  DeepSeekReleaseArtifactSourceProvenance,
  DeepSeekReleaseEvidenceRootDescriptor,
  DeepSeekResolvedReleaseEvidenceRoots,
} from '../types/deepseek-release-evidence.types.js'

export const DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR = 'evidence/deepseek-release'
export const DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR =
  'evidence/deepseek-release-triage'
export const DEFAULT_DEEPSEEK_RELEASE_LEGACY_EVIDENCE_DIR = 'artifacts'
export const DEFAULT_DEEPSEEK_RELEASE_LEGACY_TRIAGE_EVIDENCE_DIR =
  'artifacts/deepseek-release-triage'

export function resolveDeepSeekReleaseEvidenceRoots(
  cwd = process.cwd(),
): DeepSeekResolvedReleaseEvidenceRoots {
  return {
    managedComparableDir: resolve(cwd, DEFAULT_DEEPSEEK_RELEASE_MANAGED_EVIDENCE_DIR),
    managedTriageDir: resolve(cwd, DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR),
    legacyComparableDir: resolve(cwd, DEFAULT_DEEPSEEK_RELEASE_LEGACY_EVIDENCE_DIR),
    legacyTriageDir: resolve(cwd, DEFAULT_DEEPSEEK_RELEASE_LEGACY_TRIAGE_EVIDENCE_DIR),
  }
}

export function resolveDeepSeekReleaseComparableEvidenceRoot(
  rootDir = DEFAULT_DEEPSEEK_RELEASE_LEGACY_EVIDENCE_DIR,
  cwd = process.cwd(),
): DeepSeekReleaseEvidenceRootDescriptor {
  const resolvedRootDir = resolve(cwd, rootDir)
  const roots = resolveDeepSeekReleaseEvidenceRoots(cwd)
  if (sameResolvedPath(resolvedRootDir, roots.managedComparableDir)) {
    return {
      kind: 'managed',
      role: 'comparable',
      path: resolvedRootDir,
    }
  }
  if (sameResolvedPath(resolvedRootDir, roots.legacyComparableDir)) {
    return {
      kind: 'legacy',
      role: 'comparable',
      path: resolvedRootDir,
    }
  }
  return {
    kind: 'custom',
    role: 'comparable',
    path: resolvedRootDir,
  }
}

export function resolveDeepSeekReleaseTriageEvidenceRoot(
  rootDir: string | undefined,
  input: {
    preferManagedDefault?: boolean | undefined
    cwd?: string | undefined
  } = {},
): DeepSeekReleaseEvidenceRootDescriptor {
  const cwd = input.cwd ?? process.cwd()
  const roots = resolveDeepSeekReleaseEvidenceRoots(cwd)
  const resolvedRootDir = resolve(
    cwd,
    rootDir ??
      (input.preferManagedDefault
        ? DEFAULT_DEEPSEEK_RELEASE_MANAGED_TRIAGE_EVIDENCE_DIR
        : DEFAULT_DEEPSEEK_RELEASE_LEGACY_TRIAGE_EVIDENCE_DIR),
  )

  if (sameResolvedPath(resolvedRootDir, roots.managedTriageDir)) {
    return {
      kind: 'managed',
      role: 'triage',
      path: resolvedRootDir,
    }
  }
  if (sameResolvedPath(resolvedRootDir, roots.legacyTriageDir)) {
    return {
      kind: 'legacy',
      role: 'triage',
      path: resolvedRootDir,
    }
  }
  return {
    kind: 'custom',
    role: 'triage',
    path: resolvedRootDir,
  }
}

export function buildDeepSeekReleaseArtifactSourceProvenance(
  selectionSource: DeepSeekReleaseArtifactSelectionSource,
  root: DeepSeekReleaseEvidenceRootDescriptor,
): DeepSeekReleaseArtifactSourceProvenance {
  return {
    selectionSource,
    root,
  }
}

export function resolveDeepSeekReleaseArtifactSourceProvenanceFromFile(
  file: string,
  input: {
    selectionSource?: DeepSeekReleaseArtifactSelectionSource | undefined
    role?: DeepSeekReleaseEvidenceRootDescriptor['role'] | undefined
    cwd?: string | undefined
  } = {},
): DeepSeekReleaseArtifactSourceProvenance {
  const cwd = input.cwd ?? process.cwd()
  const selectionSource = input.selectionSource ?? 'explicit'
  const resolvedFile = resolve(cwd, file)
  const roots = resolveDeepSeekReleaseEvidenceRoots(cwd)

  if (isWithinRoot(roots.managedComparableDir, resolvedFile)) {
    return buildDeepSeekReleaseArtifactSourceProvenance(selectionSource, {
      kind: 'managed',
      role: 'comparable',
      path: roots.managedComparableDir,
    })
  }
  if (isWithinRoot(roots.managedTriageDir, resolvedFile)) {
    return buildDeepSeekReleaseArtifactSourceProvenance(selectionSource, {
      kind: 'managed',
      role: 'triage',
      path: roots.managedTriageDir,
    })
  }
  if (isWithinRoot(roots.legacyTriageDir, resolvedFile)) {
    return buildDeepSeekReleaseArtifactSourceProvenance(selectionSource, {
      kind: 'legacy',
      role: 'triage',
      path: roots.legacyTriageDir,
    })
  }
  if (isWithinRoot(roots.legacyComparableDir, resolvedFile)) {
    return buildDeepSeekReleaseArtifactSourceProvenance(selectionSource, {
      kind: 'legacy',
      role: 'comparable',
      path: roots.legacyComparableDir,
    })
  }

  return buildDeepSeekReleaseArtifactSourceProvenance(selectionSource, {
    kind: 'custom',
    role: input.role ?? 'comparable',
    path: dirname(resolvedFile),
  })
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

function isWithinRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}
