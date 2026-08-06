export type CliPreferenceKey =
  | 'reply.quiet'
  | 'reply.headless'
  | 'reply.stream'
  | 'reply.format'
  | 'reply.jsonShape'
  | 'reply.chatMode'
  | 'reply.deepThink'
  | 'reply.search'
  | 'reply.new'
  | 'reply.citations'

export type CliReplyFormat = 'text' | 'json' | 'stream-json'
export type CliReplyJsonShape =
  | 'native'
  | 'openai-responses'
  | 'openai-chat-completions'
export type CliReplyChatMode = 'instant' | 'expert' | 'vision'
export type CliReplyToggle = 'on' | 'off' | 'unchanged'

export type CliPreferenceValue =
  | boolean
  | CliReplyFormat
  | CliReplyJsonShape
  | CliReplyChatMode
  | CliReplyToggle

export interface CliReplyPreferences {
  quiet?: boolean | undefined
  headless?: boolean | undefined
  stream?: boolean | undefined
  format?: CliReplyFormat | undefined
  jsonShape?: CliReplyJsonShape | undefined
  chatMode?: CliReplyChatMode | undefined
  deepThink?: CliReplyToggle | undefined
  search?: CliReplyToggle | undefined
  new?: boolean | undefined
  citations?: boolean | undefined
}

export interface CliPreferences {
  reply: CliReplyPreferences
}

export interface CliPreferencesDocument {
  schemaVersion: 1
  revision: number
  updatedAt: string
  preferences: CliPreferences
}

export interface CliPreferenceHistorySnapshot {
  schemaVersion: 1
  id: string
  exitedAt: string
  preferences: CliPreferencesDocument
}

export type CliPreferenceSource = 'built-in' | 'saved' | 'explicit'

export interface CliEffectiveReplyOptions {
  quiet: boolean
  headless: boolean
  stream: boolean
  format: CliReplyFormat
  jsonShape: CliReplyJsonShape | undefined
  chatMode: CliReplyChatMode
  deepThink: CliReplyToggle
  search: CliReplyToggle
  new: boolean
  citations: boolean
}

export interface CliResolvedReplyPreferences {
  options: CliEffectiveReplyOptions
  sources: Record<CliPreferenceKey, CliPreferenceSource>
}

export interface CliPreferenceDiffEntry {
  key: CliPreferenceKey
  before: CliPreferenceValue | undefined
  after: CliPreferenceValue | undefined
}

export interface CliLastSessionDocument {
  schemaVersion: 1
  sessionId: string
  updatedAt: string
}
