import type { DeepSeekComposerModeRequest } from './deepseek-composer-mode.types.js'

export interface DeepSeekSearchPromptPayload {
  title?: string | undefined
  dimensions: string[]
  task: string
}

export interface DeepSeekSearchPromptSample extends DeepSeekSearchPromptPayload {
  id: string
  rationale: string
  tags: string[]
}

export type DeepSeekSearchPromptSource =
  | DeepSeekSearchPromptPayload
  | DeepSeekSearchPromptSample

export interface DeepSeekSearchRequiredComposerMode extends DeepSeekComposerModeRequest {
  deepThink: 'on'
  search: 'on'
}

export interface DeepSeekSearchPromptValidationResult {
  valid: boolean
  issues: string[]
}

export interface DeepSeekRenderedSearchPrompt {
  prompt: string
  expectedOpeningPrefix: string
  requiredComposerMode: DeepSeekSearchRequiredComposerMode
  dimensionCount: number
}

export interface DeepSeekSearchVerificationScript {
  sampleId: string | null
  title: string | null
  preconditions: {
    composerMode: DeepSeekSearchRequiredComposerMode
  }
  prompt: string
  expectedOpeningPrefix: string
  checklist: string[]
  promptShape: {
    dimensionCount: number
    hasTaskSection: boolean
  }
}
