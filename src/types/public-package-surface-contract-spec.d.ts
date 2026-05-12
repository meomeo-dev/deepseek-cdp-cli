export type PublicPackageDefaultVisibility = 'deny-by-default'

export type PublicPackageReadmePublishMode = 'public-readme-only'

export type PublicPackageReadmeSourcePathMode =
  | 'generated-from-public-source'
  | 'hand-maintained-public-readme'

export type PublicPackagePublishPolicy = 'forbidden'

export type PublicPackageLicenseFilePublication = 'required'

export interface PublicPackageSurfaceContractDocument {
  kind: 'public-package-surface-contract'
  spec: {
    name: 'public-package-surface-contract'
    version: number
  }
  summary: string
  owners: string[]
  package: {
    packageName: string
    publicDistRoot: string
    publicReadmePath: string
    binNames: string[]
  }
  surface: {
    repoInternal: {
      defaultVisibility: PublicPackageDefaultVisibility
      forbiddenPaths: string[]
    }
    packagePublic: {
      defaultVisibility: PublicPackageDefaultVisibility
      allowedPaths: string[]
      requiredPaths: string[]
      conditionalPaths: string[]
      forbiddenPaths: string[]
    }
  }
  policies: {
    readme: {
      publishMode: PublicPackageReadmePublishMode
      tarballPath: string
      sourcePathMode: PublicPackageReadmeSourcePathMode
      preferredSourcePath: string
      forbiddenReferences: string[]
    }
    sourceMaps: {
      publish: PublicPackagePublishPolicy
      forbiddenPaths: string[]
    }
    declarations: {
      publish: PublicPackagePublishPolicy
      forbiddenPaths: string[]
    }
    license: {
      manifestValue: 'MIT'
      filePublication: PublicPackageLicenseFilePublication
      requiredPaths: string[]
    }
    repoInternalDocs: {
      publish: PublicPackagePublishPolicy
      forbiddenPaths: string[]
    }
    tracesAndFixtures: {
      publish: PublicPackagePublishPolicy
      forbiddenPaths: string[]
    }
  }
  sourceOfTruth: {
    manifestFilesField: string
    allowlistConfigPath: string
    packageVerifyScriptPath: string
    planSection: string
  }
  consumers: string[]
  acceptance: string[]
}

export type PublicPackageSurfaceContractSpec = PublicPackageSurfaceContractDocument
