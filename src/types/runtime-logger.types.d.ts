export type LogLevel = 'silent' | 'error' | 'info' | 'debug'

export interface RuntimeLoggerOptions {
  level: LogLevel
  scope?: string | undefined
}
