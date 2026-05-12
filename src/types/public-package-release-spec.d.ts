export type PublicPackageReleaseChannel = 'public-npm'

export type PublicPackageRequiredReleaseCapability =
  | 'public-build-assembly'
  | 'tarball-leak-block'
  | 'fresh-install-smoke'
  | 'traceability-manifest'
  | 'publish-rehearsal'
  | 'public-release-gate'
  | 'post-publish-verify'

export type PublicPackagePlannedReleaseCapability = never

export interface PublicPackageReleaseDocument {
  kind: 'public-package-release'
  spec: {
    name: 'public-package-release'
    version: number
  }
  summary: string
  owners: string[]
  scope: {
    packageName: string
    publishChannel: PublicPackageReleaseChannel
    targetArtifactRoot: string
    dependsOnSpecKinds: Array<'public-package-surface-contract'>
    excludes: string[]
  }
  releaseInputs: {
    required: string[]
    planned: string[]
  }
  releaseCapabilities: {
    required: PublicPackageRequiredReleaseCapability[]
    planned: PublicPackagePlannedReleaseCapability[]
  }
  plannedCommandIds: string[]
  entrypoints: {
    bins: string[]
    manifest: {
      packageJsonPath: string
      tarballReadmePath: string
    }
  }
  metadata: {
    packageShape: 'bin-only-cli'
    manifest: {
      publicManifestPath: string
      inheritFromRoot: string[]
      generatedFields: string[]
      omittedFields: string[]
    }
    license: {
      manifestValue: 'MIT'
      filePublication: 'required'
    }
    discoverability: {
      descriptionSource: string
      keywords: string[]
    }
    support: {
      reopenWhen: string[]
    }
  }
  traceability: {
    requiredEvidence: string[]
    artifactPaths: string[]
  }
  rules: string[]
  deliverables: string[]
  acceptance: string[]
}

export type PublicPackageReleaseSpec = PublicPackageReleaseDocument
