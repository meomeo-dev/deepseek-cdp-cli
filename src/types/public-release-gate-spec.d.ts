export type PublicReleaseGatePassStatus = 'ready'

export type PublicReleaseGateBlockStatus = 'blocked'

export type PublicReleaseGatePublishDecisionPassStatus = 'pass'

export type PublicReleaseGatePublishDecisionFailStatus = 'fail'

export type PublicReleaseGatePublishDecisionUnknownStatus = 'unknown'

export type PublicReleaseGatePublishDecisionBlockStatus = 'blocked'

export interface PublicReleaseGateSpecDocument {
  kind: 'public-release-gate'
  spec: {
    name: 'public-release-gate'
    version: number
  }
  summary: string
  owners: string[]
  gate: {
    scripts: {
      buildPublish: 'build:publish'
      specValidate: 'spec:validate'
      contractTests: 'test:contract'
      prepack: 'prepack'
      packageVerify: 'package:verify'
      releasePreflight: 'release:preflight'
      releaseTraceability: 'release:traceability'
      releaseRehearsal: 'release:rehearsal'
      postPublishVerify: 'release:post-publish-verify'
      releaseGate: 'release:gate'
    }
    workflowPlacement: {
      ciWorkflowPath: string
      releaseWorkflowPath: string
      publicReleaseGateWorkflowPath: string
      publishRunbookPath: string
    }
    statusModel: {
      machine: {
        pass: PublicReleaseGatePassStatus[]
        block: PublicReleaseGateBlockStatus[]
      }
      publishDecision: {
        pass: PublicReleaseGatePublishDecisionPassStatus[]
        fail: PublicReleaseGatePublishDecisionFailStatus[]
        unknown: PublicReleaseGatePublishDecisionUnknownStatus[]
        block: PublicReleaseGatePublishDecisionBlockStatus[]
      }
    }
    currentBoundaries: string[]
  }
  rules: string[]
  deliverables: string[]
  acceptance: string[]
}

export type PublicReleaseGateSpec = PublicReleaseGateSpecDocument
