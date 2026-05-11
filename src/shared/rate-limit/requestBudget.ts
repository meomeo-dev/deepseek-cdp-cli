import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface RequestBudgetPolicy {
  maxQueriesPerMinute: number
  maxTokensPerMinute: number
}

export interface RequestBudgetSnapshot {
  queriesRemaining: number
  tokensRemaining: number
  resetsAt: string
}

export const DEFAULT_REQUEST_BUDGET_POLICY: RequestBudgetPolicy = {
  maxQueriesPerMinute: 12,
  maxTokensPerMinute: 18_000,
}

interface RequestBudgetGateState {
  windowStartedAt: number
  queriesUsed: number
  tokensUsed: number
}

export interface RequestBudgetGateOptions {
  stateFilePath?: string | undefined
  now?: (() => number) | undefined
}

export class RequestBudgetGate {
  #policy: RequestBudgetPolicy
  #stateFilePath: string | null
  #now: () => number
  #windowStartedAt: number
  #queriesUsed: number
  #tokensUsed: number

  public constructor(
    policy: RequestBudgetPolicy = DEFAULT_REQUEST_BUDGET_POLICY,
    options: RequestBudgetGateOptions = {},
  ) {
    this.#policy = policy
    this.#stateFilePath = normalizeOptionalString(options.stateFilePath) ?? null
    this.#now = options.now ?? Date.now
    this.#windowStartedAt = this.#now()
    this.#queriesUsed = 0
    this.#tokensUsed = 0
    this.#hydrateStateFromDisk()
    this.#rotateIfNeeded()
  }

  public consumeQuery(): RequestBudgetSnapshot {
    this.#refreshState()

    if (this.#queriesUsed + 1 > this.#policy.maxQueriesPerMinute) {
      throw new Error('QPM budget exceeded for DeepSeek automation.')
    }
    if (this.#tokensUsed >= this.#policy.maxTokensPerMinute) {
      throw new Error('TPM budget exceeded for DeepSeek automation.')
    }

    this.#queriesUsed += 1
    this.#persistState()
    return this.snapshot()
  }

  public recordOutputTokens(outputTokens: number): RequestBudgetSnapshot {
    this.#refreshState()
    this.#tokensUsed += Math.max(0, Math.floor(outputTokens))
    this.#persistState()
    return this.snapshot()
  }

  public snapshot(): RequestBudgetSnapshot {
    this.#refreshState()

    const resetsAt = new Date(this.#windowStartedAt + 60_000).toISOString()
    return {
      queriesRemaining: this.#policy.maxQueriesPerMinute - this.#queriesUsed,
      tokensRemaining: Math.max(0, this.#policy.maxTokensPerMinute - this.#tokensUsed),
      resetsAt,
    }
  }

  #refreshState(): void {
    this.#hydrateStateFromDisk()
    this.#rotateIfNeeded()
  }

  #rotateIfNeeded(): void {
    if (this.#now() - this.#windowStartedAt < 60_000) {
      return
    }

    this.#windowStartedAt = this.#now()
    this.#queriesUsed = 0
    this.#tokensUsed = 0
    this.#persistState()
  }

  #hydrateStateFromDisk(): void {
    if (!this.#stateFilePath || !existsSync(this.#stateFilePath)) {
      return
    }

    try {
      const parsed = JSON.parse(readFileSync(this.#stateFilePath, 'utf8')) as unknown
      if (!isRequestBudgetGateState(parsed)) {
        return
      }

      this.#windowStartedAt = parsed.windowStartedAt
      this.#queriesUsed = parsed.queriesUsed
      this.#tokensUsed = parsed.tokensUsed
    } catch {
      return
    }
  }

  #persistState(): void {
    if (!this.#stateFilePath) {
      return
    }

    mkdirSync(dirname(this.#stateFilePath), { recursive: true })
    writeFileSync(this.#stateFilePath, JSON.stringify(this.#snapshotState(), null, 2))
  }

  #snapshotState(): RequestBudgetGateState {
    return {
      windowStartedAt: this.#windowStartedAt,
      queriesUsed: this.#queriesUsed,
      tokensUsed: this.#tokensUsed,
    }
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isRequestBudgetGateState(value: unknown): value is RequestBudgetGateState {
  if (!isRecord(value)) {
    return false
  }

  return (
    isFiniteNumber(value['windowStartedAt']) &&
    isFiniteNumber(value['queriesUsed']) &&
    isFiniteNumber(value['tokensUsed'])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
