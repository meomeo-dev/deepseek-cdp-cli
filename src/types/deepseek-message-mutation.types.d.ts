export interface DeepSeekEditConversationMutation {
  kind: 'edit-message'
  sourceBranchId: string
  sourceMessageId: string
  materializedBranchId: string
  materializedBranchCreated: boolean
  replacementMessageId: string | null
  assistantMessageId: string | null
  transcriptShape: 'history-recovered' | 'synthetic-fallback'
}

export interface DeepSeekRegenerateConversationMutation {
  kind: 'regenerate'
  sourceBranchId: string
  sourceAssistantMessageId: string
  sourceParentMessageId: string
  materializedBranchId: string
  materializedBranchCreated: boolean
  regeneratedAssistantMessageId: string | null
  transcriptShape: 'active-view-assistant-only' | 'history-recovered' | 'synthetic-fallback'
}

export interface DeepSeekContinueConversationMutation {
  kind: 'continue'
  sourceBranchId: string
  sourceAssistantMessageId: string
  sourceParentMessageId: string | null
  materializedBranchId: string
  materializedBranchCreated: boolean
  continuedAssistantMessageId: string | null
  continuationDisposition: 'in-place'
  transcriptShape: 'history-recovered-in-place' | 'synthetic-in-place'
}

export type DeepSeekConversationMutation =
  | DeepSeekEditConversationMutation
  | DeepSeekContinueConversationMutation
  | DeepSeekRegenerateConversationMutation
