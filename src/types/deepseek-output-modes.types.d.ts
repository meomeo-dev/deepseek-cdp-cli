export type DeepSeekOutputFormat = 'text' | 'json' | 'stream-json'

export type DeepSeekOutputJsonShape =
  | 'native'
  | 'openai-responses'
  | 'openai-chat-completions'

export interface DeepSeekOutputModeInput {
  stream: boolean
  format?: DeepSeekOutputFormat | null
  jsonShape?: DeepSeekOutputJsonShape | null
}

export interface DeepSeekResolvedOutputMode {
  stream: boolean
  format: DeepSeekOutputFormat
  jsonShape: DeepSeekOutputJsonShape | null
  transport: 'streaming' | 'buffered'
  outputFamily: 'text' | 'json'
}
