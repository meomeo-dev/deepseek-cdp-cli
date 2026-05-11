import type {
  DeepSeekMutationReleaseRegressionCheck,
  DeepSeekMutationReleaseRegressionFailureClass,
  DeepSeekMutationReleaseRegressionInput,
  DeepSeekMutationReleaseRegressionReport,
} from '../../types/deepseek-mutation-release-regression.types.js'

export function evaluateDeepSeekMutationReleaseRegression(
  input: DeepSeekMutationReleaseRegressionInput,
): DeepSeekMutationReleaseRegressionReport {
  const continueTargetReady =
    input.continueTarget.sessionId !== null &&
    input.continueTarget.sessionFile !== null &&
    input.continueTarget.finalUrl !== null &&
    input.continueTarget.status === 'resumable' &&
    input.continueTarget.branchId !== null &&
    input.continueTarget.messageId !== null &&
    input.continueTarget.continueCommandPresent
  const deleteSessionReached =
    input.deleteSession.endpoint !== null ||
    input.deleteSession.authoritativeSessionId !== null ||
    input.deleteSession.responseStatus !== null ||
    input.deleteSession.auditOutputFile !== null
  const checks: DeepSeekMutationReleaseRegressionCheck[] = [
    createCheck({
      id: 'mode-aware-coverage',
      passed:
        input.coveredChatModes.includes('instant') &&
        input.coveredChatModes.includes('expert'),
      failureClass: 'mode_contract_drift',
      passMessage:
        'The current mutation gate artifact explicitly covers core Instant/Expert paths instead of inheriting the old mode-less baseline; Vision coverage is tracked by release handoff until a dedicated image mutation gate exists.',
      failMessage:
        'The current mutation gate artifact no longer proves core Instant/Expert coverage, so the mode-aware release window is incomplete.',
      evidence: {
        coveredChatModes: input.coveredChatModes,
      },
    }),
    createCheck({
      id: 'warm-runtime-start',
      passed:
        (input.warmRuntimeStart.action === 'started' ||
          input.warmRuntimeStart.action === 'reused') &&
        input.warmRuntimeStart.browserId !== null &&
        input.warmRuntimeStart.mode === 'warm' &&
        input.warmRuntimeStart.owner === 'managed',
      failureClass: 'browser_runtime_drift',
      passMessage: 'Warm runtime still starts as a managed warm browser before the mutation gate.',
      failMessage: 'Warm runtime start drifted away from managed warm runtime semantics.',
      evidence: {
        action: input.warmRuntimeStart.action,
        browserId: input.warmRuntimeStart.browserId,
        mode: input.warmRuntimeStart.mode,
        owner: input.warmRuntimeStart.owner,
        purpose: input.warmRuntimeStart.purpose,
      },
    }),
    createCheck({
      id: 'search-seeded-session',
      passed:
        input.seededSession.requestedChatMode === 'expert' &&
        input.seededSession.rawModelType === 'expert' &&
        input.seededSession.resolvedChatMode === 'expert' &&
        input.seededSession.sessionId !== null &&
        input.seededSession.finalUrl !== null &&
        input.seededSession.sessionFile !== null &&
        input.seededSession.activeBranchId !== null &&
        input.seededSession.rootUserMessageId !== null &&
        input.seededSession.rootAssistantMessageId !== null &&
        input.seededSession.assistantTextLength > 0,
      failureClass: 'seeded_session_drift',
      passMessage:
        'The seeded baseline session still yields a stable branch-local assistant reply before message mutations begin.',
      failMessage:
        'The seeded baseline session drifted: base session recovery is incomplete before message mutations begin.',
      evidence: {
        requestedChatMode: input.seededSession.requestedChatMode,
        rawModelType: input.seededSession.rawModelType,
        resolvedChatMode: input.seededSession.resolvedChatMode,
        sessionId: input.seededSession.sessionId,
        activeBranchId: input.seededSession.activeBranchId,
        assistantSearchCount: input.seededSession.assistantSearchCount,
        assistantCitationCount: input.seededSession.assistantCitationCount,
        assistantResponseReferenceCount:
          input.seededSession.assistantResponseReferenceCount,
      },
    }),
    createCheck({
      id: 'expert-attachment-seeded-session',
      passed:
        input.seededSession.requestedChatMode === 'expert' &&
        input.seededSession.rawModelType === 'expert' &&
        input.seededSession.resolvedChatMode === 'expert' &&
        input.seededSession.fileUploadRequestedCount > 0 &&
        input.seededSession.fileUploadAcceptedCount > 0 &&
        input.seededSession.fileUploadMountedCount > 0 &&
        input.seededSession.rootUserAttachmentCount > 0 &&
        input.seededSession.branchAttachmentCount > 0,
      failureClass: 'attachment_persistence_drift',
      passMessage:
        'The Expert seeded session still creates a real attachment-bearing baseline before mutation/export checks run.',
      failMessage:
        'The Expert attachment baseline drifted: upload, mount, or recovered root-message attachment evidence is missing before mutation begins.',
      evidence: {
        requestedChatMode: input.seededSession.requestedChatMode,
        rawModelType: input.seededSession.rawModelType,
        resolvedChatMode: input.seededSession.resolvedChatMode,
        fileUploadRequestedCount: input.seededSession.fileUploadRequestedCount,
        fileUploadAcceptedCount: input.seededSession.fileUploadAcceptedCount,
        fileUploadMountedCount: input.seededSession.fileUploadMountedCount,
        rootUserAttachmentCount: input.seededSession.rootUserAttachmentCount,
        branchAttachmentCount: input.seededSession.branchAttachmentCount,
      },
    }),
    createCheck({
      id: 'edit-message',
      passed:
        input.edit.rawModelType === 'expert' &&
        input.edit.resolvedChatMode === 'expert' &&
        input.edit.entryMode === 'message-edit' &&
        input.edit.mutationKind === 'edit-message' &&
        input.edit.sourceBranchId !== null &&
        input.edit.sourceMessageId !== null &&
        input.edit.materializedBranchId !== null &&
        input.edit.materializedBranchId !== input.edit.sourceBranchId &&
        input.edit.materializedBranchCreated === true &&
        input.edit.assistantMessageId !== null &&
        input.edit.assistantTextLength > 0,
      failureClass: 'mutation_materialization_drift',
      passMessage:
        'Edit still materializes a new branch and produces an assistant reply through the shared output path.',
      failMessage:
        'Edit drifted: branch materialization or assistant reply evidence is incomplete.',
      evidence: {
        rawModelType: input.edit.rawModelType,
        resolvedChatMode: input.edit.resolvedChatMode,
        sourceBranchId: input.edit.sourceBranchId,
        sourceMessageId: input.edit.sourceMessageId,
        materializedBranchId: input.edit.materializedBranchId,
        materializedBranchCreated: input.edit.materializedBranchCreated,
        transcriptShape: input.edit.transcriptShape,
      },
    }),
    createCheck({
      id: 'regenerate-message',
      passed:
        input.regenerate.rawModelType === 'expert' &&
        input.regenerate.resolvedChatMode === 'expert' &&
        input.regenerate.entryMode === 'message-regenerate' &&
        input.regenerate.mutationKind === 'regenerate' &&
        input.regenerate.sourceBranchId !== null &&
        input.regenerate.sourceAssistantMessageId !== null &&
        input.regenerate.sourceParentMessageId !== null &&
        input.regenerate.materializedBranchId !== null &&
        input.regenerate.materializedBranchId !== input.regenerate.sourceBranchId &&
        input.regenerate.materializedBranchCreated === true &&
        input.regenerate.regeneratedAssistantMessageId !== null &&
        input.regenerate.assistantTextLength > 0,
      failureClass: 'mutation_materialization_drift',
      passMessage:
        'Regenerate still materializes its own branch and returns an assistant reply through the shared generation path.',
      failMessage:
        'Regenerate drifted: branch materialization or regenerated assistant evidence is incomplete.',
      evidence: {
        rawModelType: input.regenerate.rawModelType,
        resolvedChatMode: input.regenerate.resolvedChatMode,
        sourceBranchId: input.regenerate.sourceBranchId,
        sourceAssistantMessageId: input.regenerate.sourceAssistantMessageId,
        sourceParentMessageId: input.regenerate.sourceParentMessageId,
        materializedBranchId: input.regenerate.materializedBranchId,
        materializedBranchCreated: input.regenerate.materializedBranchCreated,
        transcriptShape: input.regenerate.transcriptShape,
      },
    }),
    createCheck({
      id: 'branch-catalog',
      passed:
        input.branchCatalog.branchCount >= 3 &&
        input.seededSession.activeBranchId !== null &&
        input.edit.materializedBranchId !== null &&
        input.regenerate.materializedBranchId !== null &&
        input.branchCatalog.branchIds.includes(input.seededSession.activeBranchId) &&
        input.branchCatalog.branchIds.includes(input.edit.materializedBranchId) &&
        input.branchCatalog.branchIds.includes(input.regenerate.materializedBranchId) &&
        input.branchCatalog.activeBranchId === input.regenerate.materializedBranchId,
      failureClass: 'branch_catalog_drift',
      passMessage:
        'Branch catalog still exposes the original, edited, and regenerated branches with the regenerated branch active.',
      failMessage:
        'Branch catalog drifted: expected branch lineage or active branch state is missing.',
      evidence: {
        branchCount: input.branchCatalog.branchCount,
        activeBranchId: input.branchCatalog.activeBranchId,
        branchIds: input.branchCatalog.branchIds,
      },
    }),
    createCheck({
      id: 'mutation-branch-export',
      passed:
        input.branchExport.rawModelType === 'expert' &&
        input.branchExport.resolvedChatMode === 'expert' &&
        input.branchExport.branchId === input.regenerate.materializedBranchId &&
        input.branchExport.transcriptShape !== null &&
        input.branchExport.transcriptShape !== 'summary-only' &&
        input.branchExport.searchEvidenceAvailable === true &&
        input.branchExport.searchEvidenceDerivedFrom === 'message-searches' &&
        input.branchExport.searchQueryCount > 0 &&
        input.branchExport.searchResultCount > 0 &&
        input.branchExport.citationCount > 0 &&
        input.branchExport.messageSearchCount > 0 &&
        input.branchExport.responseReferenceCount > 0 &&
        input.branchExport.messageCount > 0,
      failureClass: 'export_provenance_drift',
      passMessage:
        'Regenerated branch export still preserves provenance, searches, citations, and responseReferences without regressing to summary-only.',
      failMessage:
        'Regenerated branch export drifted: provenance or search/reference evidence is missing.',
      evidence: {
        rawModelType: input.branchExport.rawModelType,
        resolvedChatMode: input.branchExport.resolvedChatMode,
        branchId: input.branchExport.branchId,
        transcriptShape: input.branchExport.transcriptShape,
        provenanceSource: input.branchExport.provenanceSource,
        searchEvidenceDerivedFrom: input.branchExport.searchEvidenceDerivedFrom,
        searchQueryCount: input.branchExport.searchQueryCount,
        searchResultCount: input.branchExport.searchResultCount,
        responseReferenceCount: input.branchExport.responseReferenceCount,
      },
    }),
    createCheck({
      id: 'mutation-attachment-export',
      passed:
        input.branchExport.rawModelType === 'expert' &&
        input.branchExport.resolvedChatMode === 'expert' &&
        input.branchExport.branchAttachmentCount > 0 &&
        input.branchExport.branchAttachmentRecordCount > 0 &&
        input.branchExport.messageAttachmentCount > 0 &&
        input.sessionExport.rawModelType === 'expert' &&
        input.sessionExport.resolvedChatMode === 'expert' &&
        input.sessionExport.totalAttachmentCount > 0 &&
        input.sessionExport.branchAttachmentRecordCount > 0 &&
        input.sessionExport.messageAttachmentCount > 0 &&
        input.sessionExport.branchesWithAttachments > 0,
      failureClass: 'attachment_persistence_drift',
      passMessage:
        'Mutation exports still preserve attachment evidence at both branch and message level after the Expert edit/regenerate chain.',
      failMessage:
        'Mutation export drifted: Expert attachment evidence disappeared from branch-level or message-level export surfaces after mutation.',
      evidence: {
        branchExportRawModelType: input.branchExport.rawModelType,
        branchExportResolvedChatMode: input.branchExport.resolvedChatMode,
        branchAttachmentCount: input.branchExport.branchAttachmentCount,
        branchAttachmentRecordCount: input.branchExport.branchAttachmentRecordCount,
        branchMessageAttachmentCount: input.branchExport.messageAttachmentCount,
        sessionExportRawModelType: input.sessionExport.rawModelType,
        sessionExportResolvedChatMode: input.sessionExport.resolvedChatMode,
        sessionTotalAttachmentCount: input.sessionExport.totalAttachmentCount,
        sessionBranchAttachmentRecordCount: input.sessionExport.branchAttachmentRecordCount,
        sessionMessageAttachmentCount: input.sessionExport.messageAttachmentCount,
        sessionBranchesWithAttachments: input.sessionExport.branchesWithAttachments,
      },
    }),
    createCheck({
      id: 'full-session-export',
      passed:
        input.sessionExport.rawModelType === 'expert' &&
        input.sessionExport.resolvedChatMode === 'expert' &&
        input.sessionExport.branchCount >= input.branchCatalog.branchCount &&
        input.sessionExport.branchIndexCount === input.sessionExport.branchCount &&
        input.sessionExport.searchEvidenceBranchCount > 0 &&
        input.sessionExport.nonSummaryOnlyBranchCount === input.sessionExport.branchCount &&
        input.sessionExport.messageSearchCount > 0 &&
        input.sessionExport.responseReferenceCount > 0,
      failureClass: 'export_provenance_drift',
      passMessage:
        'Full-session export still contains all branches with non-summary provenance and retained search/reference evidence.',
      failMessage:
        'Full-session export drifted: branch coverage, provenance, or search/reference evidence regressed.',
      evidence: {
        rawModelType: input.sessionExport.rawModelType,
        resolvedChatMode: input.sessionExport.resolvedChatMode,
        branchCount: input.sessionExport.branchCount,
        branchIndexCount: input.sessionExport.branchIndexCount,
        searchEvidenceBranchCount: input.sessionExport.searchEvidenceBranchCount,
        nonSummaryOnlyBranchCount: input.sessionExport.nonSummaryOnlyBranchCount,
        responseReferenceCount: input.sessionExport.responseReferenceCount,
      },
    }),
    createCheck({
      id: 'prepare-continue-target',
      passed: continueTargetReady,
      failureClass: 'continue_preflight_drift',
      passMessage:
        'Continue preflight still yields a real resumable assistant target before explicit continue runs.',
      failMessage:
        'Continue preflight drifted: the gate could no longer establish a real resumable assistant target.',
      evidence: {
        sessionId: input.continueTarget.sessionId,
        status: input.continueTarget.status,
        branchId: input.continueTarget.branchId,
        messageId: input.continueTarget.messageId,
        continueCommandPresent: input.continueTarget.continueCommandPresent,
      },
    }),
    createCheck({
      id: 'continue-message',
      passed:
        input.continueResult.rawModelType === 'default' &&
        input.continueResult.resolvedChatMode === 'instant' &&
        input.continueResult.entryMode === 'message-continue' &&
        input.continueResult.mutationKind === 'continue' &&
        input.continueResult.sourceBranchId === input.continueTarget.branchId &&
        input.continueResult.materializedBranchId === input.continueTarget.branchId &&
        input.continueResult.continuedAssistantMessageId === input.continueTarget.messageId &&
        input.continueResult.continuationDisposition === 'in-place' &&
        input.continueResult.assistantTextLength > 0,
      failureClass: 'continue_delivery_drift',
      passMessage:
        'Continue still resumes the targeted assistant message in place through the shared generation path.',
      failMessage:
        'Continue delivery drifted: in-place resume evidence or assistant output is missing.',
      evidence: {
        rawModelType: input.continueResult.rawModelType,
        resolvedChatMode: input.continueResult.resolvedChatMode,
        targetBranchId: input.continueTarget.branchId,
        targetMessageId: input.continueTarget.messageId,
        sourceBranchId: input.continueResult.sourceBranchId,
        materializedBranchId: input.continueResult.materializedBranchId,
        continuationDisposition: input.continueResult.continuationDisposition,
        transcriptShape: input.continueResult.transcriptShape,
      },
    }),
    createCheck({
      id: 'continue-export',
      passed:
        input.continueExport.branchId === input.continueResult.materializedBranchId &&
        input.continueExport.transcriptShape !== null &&
        input.continueExport.transcriptShape !== 'summary-only' &&
        input.continueExport.messageCount > 0,
      failureClass: 'export_provenance_drift',
      passMessage:
        'Continue branch export still remains usable and does not regress to summary-only after the in-place continuation.',
      failMessage:
        'Continue branch export drifted: provenance or branch payload regressed after continue.',
      evidence: {
        branchId: input.continueExport.branchId,
        transcriptShape: input.continueExport.transcriptShape,
        provenanceSource: input.continueExport.provenanceSource,
        messageCount: input.continueExport.messageCount,
      },
    }),
    createCheck({
      id: 'delete-session',
      passed:
        input.deleteSession.endpoint === '/api/v0/chat_session/delete' &&
        input.deleteSession.authoritativeSessionId === input.continueTarget.sessionId &&
        input.deleteSession.responseStatus === 200 &&
        input.deleteSession.localSessionFileDeleted === true,
      failureClass:
        continueTargetReady || deleteSessionReached
          ? 'delete_session_drift'
          : 'continue_preflight_drift',
      passMessage:
        'Delete-session still routes through the audited endpoint and removes the local session file after explicit confirmation.',
      failMessage: continueTargetReady || deleteSessionReached
        ? 'Delete-session drifted: audited endpoint evidence or local cleanup is incomplete.'
        : 'Delete-session was not reached because the continue target was not established.',
      evidence: {
        endpoint: input.deleteSession.endpoint,
        authoritativeSessionId: input.deleteSession.authoritativeSessionId,
        responseStatus: input.deleteSession.responseStatus,
        localSessionFileDeleted: input.deleteSession.localSessionFileDeleted,
        auditOutputFile: input.deleteSession.auditOutputFile,
      },
    }),
    createCheck({
      id: 'warm-runtime-status',
      passed:
        input.warmRuntimeStatus.browserId === input.warmRuntimeStart.browserId &&
        input.warmRuntimeStatus.mode === 'warm' &&
        input.warmRuntimeStatus.owner === 'managed' &&
        input.warmRuntimeStatus.lastUsedAt !== null &&
        (input.warmRuntimeStatus.state === 'idle' ||
          input.warmRuntimeStatus.state === 'busy' ||
          input.warmRuntimeStatus.state === 'ready'),
      failureClass: 'browser_runtime_drift',
      passMessage:
        'Warm runtime remained registered and reusable after mutation, continue, export, and delete-session commands.',
      failMessage:
        'Warm runtime status drifted: runtime reuse no longer survives the mutation gate.',
      evidence: {
        startedBrowserId: input.warmRuntimeStart.browserId,
        statusBrowserId: input.warmRuntimeStatus.browserId,
        state: input.warmRuntimeStatus.state,
        lastUsedAt: input.warmRuntimeStatus.lastUsedAt,
      },
    }),
  ]

  return {
    scenario: 'release-message-actions',
    ok: checks.every(check => check.status !== 'fail'),
    checks,
  }
}

function createCheck(input: {
  id: string
  passed: boolean
  failureClass: Exclude<DeepSeekMutationReleaseRegressionFailureClass, 'ok'>
  passMessage: string
  failMessage: string
  evidence?: Record<string, unknown> | undefined
}): DeepSeekMutationReleaseRegressionCheck {
  return {
    id: input.id,
    status: input.passed ? 'pass' : 'fail',
    failureClass: input.passed ? 'ok' : input.failureClass,
    message: input.passed ? input.passMessage : input.failMessage,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  }
}
