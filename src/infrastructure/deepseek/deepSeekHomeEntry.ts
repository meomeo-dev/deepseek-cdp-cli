import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'puppeteer-core'
import { captureDeepSeekComposerSnapshot, isDeepSeekComposerInputReady } from './deepSeekComposerControls.js'
import type {
  DeepSeekHomeEntryResult,
  DeepSeekHomeEntryWaitOptions,
} from '../../types/deepseek-home-entry.types.js'

const DEFAULT_HOME_ENTRY_WAIT_OPTIONS: Omit<DeepSeekHomeEntryWaitOptions, 'requestedUrl'> = {
  timeoutMs: 15_000,
  pollIntervalMs: 250,
  stableWindowMs: 800,
}

export async function waitForDeepSeekHomeEntry(
  page: Page,
  options: Partial<Omit<DeepSeekHomeEntryWaitOptions, 'requestedUrl'>> & {
    requestedUrl: string
  },
): Promise<DeepSeekHomeEntryResult> {
  const merged: DeepSeekHomeEntryWaitOptions = {
    ...DEFAULT_HOME_ENTRY_WAIT_OPTIONS,
    ...options,
  }
  const startedAt = Date.now()
  const deadline = startedAt + merged.timeoutMs
  let stableResult: DeepSeekHomeEntryResult | null = null
  let stableStartedAt = 0
  let lastSnapshot = await captureDeepSeekComposerSnapshot(page)

  while (Date.now() < deadline) {
    lastSnapshot = await captureDeepSeekComposerSnapshot(page)
    if (isDeepSeekHomeEntryReady(lastSnapshot)) {
      const nextResult = buildDeepSeekHomeEntryResult(lastSnapshot, merged.requestedUrl, startedAt)
      if (stableResult && isSameHomeEntry(stableResult, nextResult)) {
        if (Date.now() - stableStartedAt >= merged.stableWindowMs) {
          return nextResult
        }
      } else {
        stableResult = nextResult
        stableStartedAt = Date.now()
      }
    } else {
      stableResult = null
      stableStartedAt = 0
    }

    await delay(merged.pollIntervalMs)
  }

  throw new Error(
    [
      `Timed out waiting for DeepSeek home entry at ${merged.requestedUrl}.`,
      `Last url: ${lastSnapshot.pageUrl}.`,
      `Missing: ${listDeepSeekHomeEntryBlockers(lastSnapshot).join(', ')}.`,
    ].join(' '),
  )
}

export function isDeepSeekHomeEntryReady(snapshot: DeepSeekHomeEntryResult['snapshot']): boolean {
  return isDeepSeekComposerInputReady(snapshot)
}

export function listDeepSeekHomeEntryBlockers(
  snapshot: DeepSeekHomeEntryResult['snapshot'],
): string[] {
  const blockers: string[] = []
  if (!snapshot.composerInput.found) {
    blockers.push('composerInput')
  }
  if (snapshot.routeKind === 'session') {
    blockers.push('nonSessionRoute')
  }
  return blockers
}

function buildDeepSeekHomeEntryResult(
  snapshot: DeepSeekHomeEntryResult['snapshot'],
  requestedUrl: string,
  startedAt: number,
): DeepSeekHomeEntryResult {
  return {
    requestedUrl,
    finalUrl: snapshot.pageUrl,
    routeKind: snapshot.routeKind,
    agentId: snapshot.agentId,
    sessionId: snapshot.sessionId,
    settledAfterMs: Date.now() - startedAt,
    snapshot,
  }
}

function isSameHomeEntry(
  left: DeepSeekHomeEntryResult,
  right: DeepSeekHomeEntryResult,
): boolean {
  return JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot)
}
