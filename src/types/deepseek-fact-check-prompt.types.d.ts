import type { DeepSeekComposerModeRequest } from './deepseek-composer-mode.types.js'

export interface DeepSeekFactCheckPromptPayload {
  title?: string | undefined
  claim: string
  context?: string | undefined
  constraints?: string[] | undefined
}

export interface DeepSeekFactCheckPromptSample extends DeepSeekFactCheckPromptPayload {
  id: string
  rationale: string
  tags: string[]
}

export type DeepSeekFactCheckPromptSource =
  | DeepSeekFactCheckPromptPayload
  | DeepSeekFactCheckPromptSample

export interface DeepSeekFactCheckRequiredComposerMode extends DeepSeekComposerModeRequest {
  deepThink: 'on'
  search: 'on'
}

export interface DeepSeekFactCheckPromptValidationResult {
  valid: boolean
  issues: string[]
}

export interface DeepSeekRenderedFactCheckPrompt {
  prompt: string
  expectedOpeningPrefix: string
  requiredComposerMode: DeepSeekFactCheckRequiredComposerMode
  probabilityBuckets: [string, string, string]
}

export interface DeepSeekFactCheckVerificationScript {
  sampleId: string | null
  title: string | null
  preconditions: {
    composerMode: DeepSeekFactCheckRequiredComposerMode
  }
  prompt: string
  expectedOpeningPrefix: string
  checklist: string[]
  probabilityBuckets: [string, string, string]
}
