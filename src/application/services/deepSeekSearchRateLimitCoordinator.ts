import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  buildDeepSeekSearchAttemptLeaseFilePath,
  buildDeepSeekSearchRateLimitCooldownStateFilePath,
  resolveDeepSeekSearchAttemptLeaseRootDir,
} from '../../shared/runtime/runtimePaths.js'
import type {
  DeepSeekReplyRetryProgressEvent,
  DeepSeekReplyRetryProgressInput,
} from '../../types/deepseek-reply-output.types.js'

const SEARCH_RETRY_COORDINATION_POLL_INTERVAL_MS = 1_000

type DeepSeekSearchAttemptLeasePhase = 'running' | 'cooldown'

interface DeepSeekSearchAttemptLeaseState {
  leaseId: string
  pid: number
  phase: DeepSeekSearchAttemptLeasePhase
  startedAt: string
  updatedAt: string
  attemptNumber: number
  retryNotBeforeMs: number | null
}

interface DeepSeekSearchCooldownState {
  leaseId: string | null
  notBeforeMs: number
  updatedAt: string
}

export interface DeepSeekSearchRateLimitCoordinatorOptions {
  cwd?: string | undefined
  runtimeDir?: string | undefined
  now?: (() => number) | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  isProcessAlive?: ((pid: number) => boolean) | undefined
}

export interface DeepSeekSearchRateLimitLeaseHandle {
  leaseId: string
  waitForRetryTurn: (input: {
    attemptNumber: number
    nextAttemptNumber: number
    cooldownMs: number
    progress?: DeepSeekReplyRetryProgressInput | undefined
  }) => Promise<void>
  close: () => Promise<void>
}

export class DeepSeekSearchRateLimitCoordinator {
  private readonly cwd: string | undefined
  private readonly runtimeDir: string | undefined
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly isProcessAlive: (pid: number) => boolean

  public constructor(options: DeepSeekSearchRateLimitCoordinatorOptions = {}) {
    this.cwd = options.cwd
    this.runtimeDir = options.runtimeDir
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? delay
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  }

  public async openLease(input: {
    attemptNumber?: number | undefined
    initialPhase?: DeepSeekSearchAttemptLeasePhase | undefined
  } = {}): Promise<DeepSeekSearchRateLimitLeaseHandle> {
    const leaseId = buildSearchRateLimitLeaseId(this.now(), process.pid)
    const initialPhase = input.initialPhase ?? 'running'
    const attemptNumber = Math.max(1, input.attemptNumber ?? 1)
    await this.writeLease({
      leaseId,
      pid: process.pid,
      phase: initialPhase,
      startedAt: this.toIso(this.now()),
      updatedAt: this.toIso(this.now()),
      attemptNumber,
      retryNotBeforeMs: null,
    })

    return {
      leaseId,
      waitForRetryTurn: async retryInput => {
        await this.waitForRetryTurn({
          leaseId,
          ...retryInput,
        })
      },
      close: async () => {
        await this.removeLease(leaseId)
      },
    }
  }

  private async waitForRetryTurn(input: {
    leaseId: string
    attemptNumber: number
    nextAttemptNumber: number
    cooldownMs: number
    progress?: DeepSeekReplyRetryProgressInput | undefined
  }): Promise<void> {
    const retryNotBeforeMs = this.now() + Math.max(0, input.cooldownMs)
    await this.writeCooldownState({
      leaseId: input.leaseId,
      notBeforeMs: retryNotBeforeMs,
      updatedAt: this.toIso(this.now()),
    })
    await this.updateLease(input.leaseId, state => ({
      ...state,
      phase: 'cooldown',
      attemptNumber: input.nextAttemptNumber,
      retryNotBeforeMs,
    }))

    let announcedPeerWaitCount: number | null = null

    while (true) {
      await this.cleanupStaleLeases()
      const now = this.now()
      const ownLease = await this.readLease(input.leaseId)
      if (!ownLease) {
        throw new Error(
          `DeepSeek search retry coordination lease ${input.leaseId} disappeared before retry attempt ${input.nextAttemptNumber}.`,
        )
      }

      const effectiveCooldownMs = await this.readEffectiveCooldownRemainingMs(retryNotBeforeMs)
      if (effectiveCooldownMs > 0) {
        emitRetryProgressEvent(input.progress, {
          kind: 'retry.tick',
          attemptNumber: input.attemptNumber,
          nextAttemptNumber: input.nextAttemptNumber,
          remainingMs: effectiveCooldownMs,
          cooldownMs: input.cooldownMs,
        })
        await this.heartbeatLease(ownLease, {
          phase: 'cooldown',
          attemptNumber: input.nextAttemptNumber,
          retryNotBeforeMs,
        })
        await this.sleep(
          Math.min(SEARCH_RETRY_COORDINATION_POLL_INTERVAL_MS, effectiveCooldownMs),
        )
        continue
      }

      const leases = await this.readLeases()
      const runningPeers = leases.filter(
        lease => lease.leaseId !== input.leaseId && lease.phase === 'running',
      )
      if (runningPeers.length > 0) {
        if (announcedPeerWaitCount !== runningPeers.length) {
          emitRetryProgressEvent(input.progress, {
            kind: 'retry.peer-wait',
            attemptNumber: input.attemptNumber,
            nextAttemptNumber: input.nextAttemptNumber,
            activeSearchAttemptCount: runningPeers.length,
          })
          announcedPeerWaitCount = runningPeers.length
        }
        await this.heartbeatLease(ownLease, {
          phase: 'cooldown',
          attemptNumber: input.nextAttemptNumber,
          retryNotBeforeMs,
        })
        await this.sleep(SEARCH_RETRY_COORDINATION_POLL_INTERVAL_MS)
        continue
      }

      const readyCooldownLeases = leases
        .filter(lease => lease.phase === 'cooldown' && (lease.retryNotBeforeMs ?? 0) <= now)
        .sort(compareSearchAttemptLeaseStates)
      if (readyCooldownLeases[0]?.leaseId !== input.leaseId) {
        await this.heartbeatLease(ownLease, {
          phase: 'cooldown',
          attemptNumber: input.nextAttemptNumber,
          retryNotBeforeMs,
        })
        await this.sleep(SEARCH_RETRY_COORDINATION_POLL_INTERVAL_MS)
        continue
      }

      await this.heartbeatLease(ownLease, {
        phase: 'running',
        attemptNumber: input.nextAttemptNumber,
        retryNotBeforeMs: null,
      })
      return
    }
  }

  private async readEffectiveCooldownRemainingMs(ownRetryNotBeforeMs: number): Promise<number> {
    const cooldownState = await this.readCooldownState()
    const effectiveNotBeforeMs = Math.max(
      ownRetryNotBeforeMs,
      cooldownState?.notBeforeMs ?? 0,
    )
    return Math.max(0, effectiveNotBeforeMs - this.now())
  }

  private async cleanupStaleLeases(): Promise<void> {
    const leases = await this.readLeases({ cleanupInvalid: true })
    for (const lease of leases) {
      if (!this.isProcessAlive(lease.pid)) {
        await this.removeLease(lease.leaseId)
      }
    }
  }

  private async heartbeatLease(
    lease: DeepSeekSearchAttemptLeaseState,
    override: Partial<
      Pick<DeepSeekSearchAttemptLeaseState, 'phase' | 'attemptNumber' | 'retryNotBeforeMs'>
    > = {},
  ): Promise<void> {
    await this.writeLease({
      ...lease,
      ...override,
      updatedAt: this.toIso(this.now()),
    })
  }

  private async readLeases(input: {
    cleanupInvalid?: boolean | undefined
  } = {}): Promise<DeepSeekSearchAttemptLeaseState[]> {
    const rootDir = resolveDeepSeekSearchAttemptLeaseRootDir(this.runtimeDir, this.cwd)
    const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => [])
    const leases: DeepSeekSearchAttemptLeaseState[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }

      const filePath = buildDeepSeekSearchAttemptLeaseFilePath(
        entry.name.replace(/\.json$/u, ''),
        this.runtimeDir,
        this.cwd,
      )
      const parsed = await this.readJsonFile(filePath)
      if (!isDeepSeekSearchAttemptLeaseState(parsed)) {
        if (input.cleanupInvalid) {
          await rm(filePath, { force: true })
        }
        continue
      }

      leases.push(parsed)
    }

    return leases
  }

  private async readLease(leaseId: string): Promise<DeepSeekSearchAttemptLeaseState | null> {
    const parsed = await this.readJsonFile(
      buildDeepSeekSearchAttemptLeaseFilePath(leaseId, this.runtimeDir, this.cwd),
    )
    return isDeepSeekSearchAttemptLeaseState(parsed) ? parsed : null
  }

  private async updateLease(
    leaseId: string,
    transform: (state: DeepSeekSearchAttemptLeaseState) => DeepSeekSearchAttemptLeaseState,
  ): Promise<void> {
    const existing = await this.readLease(leaseId)
    if (!existing) {
      throw new Error(`DeepSeek search retry lease ${leaseId} does not exist.`)
    }

    await this.writeLease({
      ...transform(existing),
      updatedAt: this.toIso(this.now()),
    })
  }

  private async writeLease(state: DeepSeekSearchAttemptLeaseState): Promise<void> {
    const filePath = buildDeepSeekSearchAttemptLeaseFilePath(
      state.leaseId,
      this.runtimeDir,
      this.cwd,
    )
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  private async removeLease(leaseId: string): Promise<void> {
    await rm(buildDeepSeekSearchAttemptLeaseFilePath(leaseId, this.runtimeDir, this.cwd), {
      force: true,
    })
  }

  private async readCooldownState(): Promise<DeepSeekSearchCooldownState | null> {
    const parsed = await this.readJsonFile(
      buildDeepSeekSearchRateLimitCooldownStateFilePath(this.runtimeDir, this.cwd),
    )
    return isDeepSeekSearchCooldownState(parsed) ? parsed : null
  }

  private async writeCooldownState(state: DeepSeekSearchCooldownState): Promise<void> {
    const filePath = buildDeepSeekSearchRateLimitCooldownStateFilePath(
      this.runtimeDir,
      this.cwd,
    )
    const existing = await this.readCooldownState()
    const notBeforeMs = Math.max(existing?.notBeforeMs ?? 0, state.notBeforeMs)
    const leaseId = notBeforeMs === state.notBeforeMs ? state.leaseId : existing?.leaseId ?? null
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          leaseId,
          notBeforeMs,
          updatedAt: this.toIso(this.now()),
        } satisfies DeepSeekSearchCooldownState,
        null,
        2,
      )}\n`,
      'utf8',
    )
  }

  private async readJsonFile(filePath: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as unknown
    } catch {
      return null
    }
  }

  private toIso(value: number): string {
    return new Date(value).toISOString()
  }
}

function emitRetryProgressEvent(
  progress: DeepSeekReplyRetryProgressInput | undefined,
  event: Extract<DeepSeekReplyRetryProgressEvent, { kind: 'retry.tick' | 'retry.peer-wait' }>,
): void {
  progress?.onEvent?.(event)
}

function buildSearchRateLimitLeaseId(now: number, pid: number): string {
  return `search-rate-limit-${pid}-${now}-${Math.random().toString(36).slice(2, 10)}`
}

function compareSearchAttemptLeaseStates(
  left: DeepSeekSearchAttemptLeaseState,
  right: DeepSeekSearchAttemptLeaseState,
): number {
  const byStartedAt = Date.parse(left.startedAt) - Date.parse(right.startedAt)
  if (byStartedAt !== 0) {
    return byStartedAt
  }

  return left.leaseId.localeCompare(right.leaseId)
}

function isDeepSeekSearchAttemptLeaseState(
  value: unknown,
): value is DeepSeekSearchAttemptLeaseState {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value['leaseId'] === 'string' &&
    typeof value['pid'] === 'number' &&
    Number.isInteger(value['pid']) &&
    typeof value['phase'] === 'string' &&
    ['running', 'cooldown'].includes(value['phase']) &&
    typeof value['startedAt'] === 'string' &&
    typeof value['updatedAt'] === 'string' &&
    typeof value['attemptNumber'] === 'number' &&
    Number.isInteger(value['attemptNumber']) &&
    (value['retryNotBeforeMs'] === null ||
      (typeof value['retryNotBeforeMs'] === 'number' &&
        Number.isFinite(value['retryNotBeforeMs'])))
  )
}

function isDeepSeekSearchCooldownState(value: unknown): value is DeepSeekSearchCooldownState {
  if (!isRecord(value)) {
    return false
  }

  return (
    (value['leaseId'] === null || typeof value['leaseId'] === 'string') &&
    typeof value['notBeforeMs'] === 'number' &&
    Number.isFinite(value['notBeforeMs']) &&
    typeof value['updatedAt'] === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
