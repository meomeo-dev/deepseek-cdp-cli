import type {
  DeepSeekOutputJsonShape,
  DeepSeekResolvedOutputMode,
} from './deepseek-output-modes.types.js'
import type { DeepSeekReplyOutputSummary } from './deepseek-reply-output.types.js'

export interface DeepSeekRpcOutputModeInput {
  stream?: boolean
  format?: 'text' | 'json' | 'stream-json'
  jsonShape?: DeepSeekOutputJsonShape
}

export interface DeepSeekRpcTextOutputEnvelope {
  format: 'text'
  text: string
}

export interface DeepSeekRpcJsonOutputEnvelope {
  format: 'json'
  jsonShape: DeepSeekOutputJsonShape
  data: unknown
}

export type DeepSeekRpcBufferedOutputEnvelope =
  | DeepSeekRpcTextOutputEnvelope
  | DeepSeekRpcJsonOutputEnvelope

export interface DeepSeekRpcTextStreamEnvelope {
  format: 'text'
  delta: string
}

export interface DeepSeekRpcJsonStreamEnvelope {
  format: 'stream-json'
  jsonShape: DeepSeekOutputJsonShape
  data: unknown
}

export type DeepSeekRpcStreamingOutputEnvelope =
  | DeepSeekRpcTextStreamEnvelope
  | DeepSeekRpcJsonStreamEnvelope

export type DeepSeekRpcReplySummary = DeepSeekReplyOutputSummary

export interface DeepSeekRpcBufferedResult {
  outputMode: DeepSeekResolvedOutputMode
  output: DeepSeekRpcBufferedOutputEnvelope
  summary: DeepSeekRpcReplySummary
}

export interface DeepSeekRpcStreamEventFrame {
  outputMode: DeepSeekResolvedOutputMode
  output: DeepSeekRpcStreamingOutputEnvelope
}

export interface DeepSeekRpcStreamingResult {
  outputMode: DeepSeekResolvedOutputMode
  finalOutput: DeepSeekRpcBufferedOutputEnvelope
  summary: DeepSeekRpcReplySummary
}
