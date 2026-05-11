import pc from 'picocolors'
import type { LogLevel, RuntimeLoggerOptions } from '../../types/runtime-logger.types.js'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
}

function formatScope(scope: string | undefined): string {
  return scope ? `[${scope}] ` : ''
}

export class RuntimeLogger {
  #level: LogLevel
  #scope: string | undefined

  public constructor(options: RuntimeLoggerOptions) {
    this.#level = options.level
    this.#scope = options.scope
  }

  public child(scope: string): RuntimeLogger {
    return new RuntimeLogger({
      level: this.#level,
      scope: this.#scope ? `${this.#scope}:${scope}` : scope,
    })
  }

  public debug(message: string, payload?: unknown): void {
    this.#write('debug', pc.cyan, message, payload)
  }

  public info(message: string, payload?: unknown): void {
    this.#write('info', pc.green, message, payload)
  }

  public error(message: string, payload?: unknown): void {
    this.#write('error', pc.red, message, payload)
  }

  #write(
    level: Exclude<LogLevel, 'silent'>,
    colorize: (value: string) => string,
    message: string,
    payload?: unknown,
  ): void {
    if (LOG_LEVEL_ORDER[this.#level] < LOG_LEVEL_ORDER[level]) {
      return
    }

    const prefix = `${new Date().toISOString()} ${colorize(level.toUpperCase())} ${formatScope(
      this.#scope,
    )}${message}`

    if (payload === undefined) {
      process.stderr.write(`${prefix}\n`)
      return
    }

    process.stderr.write(`${prefix} ${JSON.stringify(payload)}\n`)
  }
}

export function resolveLogLevel(verbose: boolean, quiet: boolean): LogLevel {
  if (quiet) {
    return 'silent'
  }

  return verbose ? 'debug' : 'info'
}
