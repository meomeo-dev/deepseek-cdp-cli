import type { Page } from 'puppeteer-core'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type { DeepSeekChatMode } from '../../types/deepseek-chat-mode.types.js'
import type {
  DeepSeekComposerModeActionResult,
  DeepSeekComposerChatModeTargetState,
  DeepSeekComposerIgnoredToggle,
  DeepSeekComposerModeInput,
  DeepSeekComposerModeRequest,
  DeepSeekComposerToggleName,
  DeepSeekComposerToggleTargetState,
  DeepSeekResolvedComposerMode,
} from '../../types/deepseek-composer-mode.types.js'
import type { DeepSeekComposerSnapshot, ToggleState } from '../../types/deepseek-controls.types.js'
import { waitForStableDeepSeekComposerSnapshot } from './deepSeekComposerControls.js'
import {
  buildDeepSeekChatModeCapabilityMatrix,
  captureDeepSeekChatModeSurface,
  waitForStableDeepSeekChatModeSurface,
} from './deepSeekChatModeControls.js'
import { selectDeepSeekChatMode } from './deepSeekChatModeInteractions.js'
import { clickDeepSeekComposerToggle } from './deepSeekComposerInteractions.js'
import {
  createDeepSeekChatModeSettleError,
  createDeepSeekComposerToggleSettleError,
  createDeepSeekComposerToggleUnavailableError,
} from '../../shared/errors/deepSeekComposerModeError.js'

const DEFAULT_COMPOSER_MODE_REQUEST: DeepSeekComposerModeRequest = {
  chatMode: 'unchanged',
  deepThink: 'unchanged',
  search: 'unchanged',
}

const TOGGLE_DESCRIPTORS: Array<{
  toggle: DeepSeekComposerToggleName
  snapshotKey: 'deepThinkToggle' | 'searchToggle'
  label: string
}> = [
  {
    toggle: 'deepThink',
    snapshotKey: 'deepThinkToggle',
    label: 'DeepThink',
  },
  {
    toggle: 'search',
    snapshotKey: 'searchToggle',
    label: 'Search',
  },
]

export interface EnsureDeepSeekComposerModeInput {
  requestedMode?: DeepSeekComposerModeInput | undefined
  authoritativeChatModeHint?: DeepSeekChatMode | undefined
  timeoutMs: number
  pollIntervalMs?: number | undefined
  stableWindowMs?: number | undefined
}

export function normalizeDeepSeekComposerModeRequest(
  requestedMode?: DeepSeekComposerModeInput,
): DeepSeekComposerModeRequest {
  return {
    chatMode: normalizeComposerChatModeTargetState(requestedMode?.chatMode),
    deepThink: normalizeComposerToggleTargetState(requestedMode?.deepThink),
    search: normalizeComposerToggleTargetState(requestedMode?.search),
  }
}

export function resolveDeepSeekComposerMode(
  snapshot: DeepSeekComposerSnapshot,
  options?: Partial<{
    modeSurface: {
      modeSelectorVisible: boolean
      availableModes: DeepSeekChatMode[]
      activeMode: DeepSeekChatMode | null
    } | null
    requestedChatMode: DeepSeekComposerChatModeTargetState
    authoritativeChatModeHint: DeepSeekChatMode
  }>,
): DeepSeekResolvedComposerMode {
  const resolvedChatMode = resolveSettledChatMode({
    activeMode: options?.modeSurface?.activeMode,
    modeSelectorVisible: options?.modeSurface?.modeSelectorVisible ?? false,
    availableModes: options?.modeSurface?.availableModes ?? [],
    requestedChatMode: options?.requestedChatMode,
    authoritativeChatModeHint: options?.authoritativeChatModeHint,
  })
  return {
    ...(resolvedChatMode ? { chatMode: resolvedChatMode } : {}),
    deepThink: resolveToggleState(snapshot.deepThinkToggle.state),
    search: resolveToggleState(snapshot.searchToggle.state),
  }
}

export async function ensureDeepSeekComposerMode(
  page: Page,
  input: EnsureDeepSeekComposerModeInput,
  logger?: RuntimeLogger,
): Promise<DeepSeekComposerModeActionResult> {
  const requestedMode = normalizeDeepSeekComposerModeRequest(input.requestedMode)
  const effectiveMode = resolveDeepSeekEffectiveComposerModeRequest(requestedMode)
  const startedAt = Date.now()
  const beforeModeSurface = await waitForStableModeSurfaceWithBudget(
    page,
    input,
    startedAt,
  ).catch(() => captureDeepSeekChatModeSurface(page))
  let settledModeSurface = beforeModeSurface
  let settledSnapshot = settledModeSurface.composerSnapshot
  const beforeSnapshot = settledSnapshot
  const transitions: DeepSeekComposerModeActionResult['transitions'] = []
  const ignoredToggles: DeepSeekComposerIgnoredToggle[] = []
  let chatModeTransition: DeepSeekComposerModeActionResult['chatModeTransition'] | undefined

  const requestedChatMode = effectiveMode.chatMode
  const currentChatMode = resolveSettledChatMode({
    activeMode: settledModeSurface.activeMode,
    modeSelectorVisible: settledModeSurface.modeSelectorVisible,
    availableModes: settledModeSurface.availableModes,
    requestedChatMode,
    authoritativeChatModeHint: input.authoritativeChatModeHint,
  })
  if (
    isDeepSeekChatMode(requestedChatMode) &&
    currentChatMode !== requestedChatMode
  ) {
    const previousChatMode = currentChatMode ?? 'unavailable'
    settledModeSurface = await selectDeepSeekChatMode(page, {
      mode: requestedChatMode,
      timeoutMs: resolveRemainingTimeoutMs(input.timeoutMs, startedAt),
    })
    settledSnapshot = settledModeSurface.composerSnapshot
    const nextChatMode = resolveChatMode(settledModeSurface.activeMode) ?? 'unavailable'
    if (nextChatMode !== requestedChatMode) {
      throw createDeepSeekChatModeSettleError({
        requestedChatMode,
        resolvedChatMode: nextChatMode,
        pageUrl: settledModeSurface.pageUrl,
        availableModes: settledModeSurface.availableModes,
        capabilityMatrix: buildDeepSeekChatModeCapabilityMatrix(settledModeSurface),
      })
    }

    chatModeTransition = {
      from: previousChatMode,
      to: nextChatMode,
    }
    logger?.info('DeepSeek chat mode settled', {
      requestedChatMode,
      previousChatMode,
      resolvedChatMode: nextChatMode,
      pageUrl: settledModeSurface.pageUrl,
    })
  }

  for (const descriptor of TOGGLE_DESCRIPTORS) {
    const rawTargetState = requestedMode[descriptor.toggle]
    const targetState = effectiveMode[descriptor.toggle]
    if (targetState === 'unchanged') {
      if (rawTargetState !== targetState) {
        ignoredToggles.push({
          toggle: descriptor.toggle,
          targetState: rawTargetState,
          reason: 'vision_mode_search_unavailable',
          requestedChatMode: requestedMode.chatMode,
          resolvedChatMode:
            resolveSettledChatMode({
              activeMode: settledModeSurface.activeMode,
              modeSelectorVisible: settledModeSurface.modeSelectorVisible,
              availableModes: settledModeSurface.availableModes,
              requestedChatMode,
              authoritativeChatModeHint: input.authoritativeChatModeHint,
            }) ?? 'unavailable',
        })
        logger?.info('DeepSeek composer toggle request ignored', {
          toggle: descriptor.toggle,
          requestedState: rawTargetState,
          requestedChatMode: requestedMode.chatMode,
          effectiveChatMode: requestedChatMode,
          reason: 'vision_mode_search_unavailable',
        })
      }
      continue
    }

    const resolvedChatModeForSurface = resolveSettledChatMode({
      activeMode: settledModeSurface.activeMode,
      modeSelectorVisible: settledModeSurface.modeSelectorVisible,
      availableModes: settledModeSurface.availableModes,
      requestedChatMode,
      authoritativeChatModeHint: input.authoritativeChatModeHint,
    })
    const currentState = resolveToggleState(settledSnapshot[descriptor.snapshotKey].state)
    if (currentState === targetState) {
      continue
    }

    if (currentState === 'unavailable' || !settledSnapshot[descriptor.snapshotKey].found) {
      throw createDeepSeekComposerToggleUnavailableError({
        toggle: descriptor.toggle,
        targetState,
        requestedChatMode,
        resolvedChatMode: resolvedChatModeForSurface ?? 'unavailable',
        pageUrl: settledModeSurface.pageUrl,
        capabilityMatrix: buildDeepSeekChatModeCapabilityMatrix(settledModeSurface),
      })
    }

    await clickDeepSeekComposerToggle(page, descriptor.toggle)
    const nextSnapshot = await waitForStableSnapshotWithBudget(page, input, startedAt)
    const nextState = resolveToggleState(nextSnapshot[descriptor.snapshotKey].state)
    if (nextState !== targetState) {
      throw createDeepSeekComposerToggleSettleError({
        toggle: descriptor.toggle,
        targetState,
        currentState: nextState,
        requestedChatMode,
        resolvedChatMode: resolvedChatModeForSurface ?? 'unavailable',
        pageUrl: settledModeSurface.pageUrl,
        capabilityMatrix: buildDeepSeekChatModeCapabilityMatrix({
          ...settledModeSurface,
          composerSnapshot: nextSnapshot,
        }),
      })
    }

    transitions.push({
      toggle: descriptor.toggle,
      from: currentState,
      to: nextState,
    })
    settledSnapshot = nextSnapshot
    settledModeSurface = {
      ...settledModeSurface,
      composerSnapshot: nextSnapshot,
    }
    logger?.info('DeepSeek composer toggle settled', {
      toggle: descriptor.toggle,
      requestedState: targetState,
      resolvedState: nextState,
    })
  }

  settledModeSurface = mergeDeepSeekChatModeSurface(
    settledModeSurface,
    await captureDeepSeekChatModeSurface(page),
  )
  const resolvedMode = resolveDeepSeekComposerMode(settledSnapshot, {
    modeSurface: settledModeSurface,
    requestedChatMode: requestedChatMode ?? 'unchanged',
    ...(input.authoritativeChatModeHint
      ? { authoritativeChatModeHint: input.authoritativeChatModeHint }
      : {}),
  })
  if (
    isDeepSeekChatMode(requestedChatMode) &&
    resolvedMode.chatMode !== requestedChatMode
  ) {
    throw createDeepSeekChatModeSettleError({
      requestedChatMode,
      resolvedChatMode: resolvedMode.chatMode ?? 'unavailable',
      pageUrl: settledModeSurface.pageUrl,
      availableModes: settledModeSurface.availableModes,
      capabilityMatrix: buildDeepSeekChatModeCapabilityMatrix(settledModeSurface),
    })
  }

  return {
    requestedMode,
    ...(hasEffectiveModeOverride(requestedMode, effectiveMode) ? { effectiveMode } : {}),
    beforeSnapshot,
    settledSnapshot,
    beforeModeSurface,
    settledModeSurface,
    capabilityMatrix: buildDeepSeekChatModeCapabilityMatrix(settledModeSurface),
    resolvedMode,
    transitions,
    ...(ignoredToggles.length > 0 ? { ignoredToggles } : {}),
    ...(chatModeTransition ? { chatModeTransition } : {}),
  }
}

export function resolveDeepSeekEffectiveComposerModeRequest(
  requestedMode: DeepSeekComposerModeRequest,
): DeepSeekComposerModeRequest {
  if (
    requestedMode.chatMode === 'vision' &&
    requestedMode.search !== 'unchanged'
  ) {
    return {
      ...requestedMode,
      search: 'unchanged',
    }
  }

  return requestedMode
}

function hasEffectiveModeOverride(
  requestedMode: DeepSeekComposerModeRequest,
  effectiveMode: DeepSeekComposerModeRequest,
): boolean {
  return (
    requestedMode.chatMode !== effectiveMode.chatMode ||
    requestedMode.deepThink !== effectiveMode.deepThink ||
    requestedMode.search !== effectiveMode.search
  )
}

function waitForStableSnapshotWithBudget(
  page: Page,
  input: EnsureDeepSeekComposerModeInput,
  startedAt: number,
): Promise<DeepSeekComposerSnapshot> {
  const timeoutMs = resolveRemainingTimeoutMs(input.timeoutMs, startedAt)
  return waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs,
    ...(input.pollIntervalMs !== undefined ? { pollIntervalMs: input.pollIntervalMs } : {}),
    ...(input.stableWindowMs !== undefined ? { stableWindowMs: input.stableWindowMs } : {}),
  })
}

function waitForStableModeSurfaceWithBudget(
  page: Page,
  input: EnsureDeepSeekComposerModeInput,
  startedAt: number,
) {
  return waitForStableDeepSeekChatModeSurface(page, {
    timeoutMs: resolveRemainingTimeoutMs(input.timeoutMs, startedAt),
    ...(input.pollIntervalMs !== undefined ? { pollIntervalMs: input.pollIntervalMs } : {}),
    ...(input.stableWindowMs !== undefined ? { stableWindowMs: input.stableWindowMs } : {}),
  })
}

function resolveRemainingTimeoutMs(timeoutMs: number, startedAt: number): number {
  const elapsedMs = Date.now() - startedAt
  return Math.max(1, timeoutMs - elapsedMs)
}

function normalizeComposerChatModeTargetState(
  value: DeepSeekComposerChatModeTargetState | undefined,
): DeepSeekComposerChatModeTargetState {
  return value ?? DEFAULT_COMPOSER_MODE_REQUEST.chatMode ?? 'unchanged'
}

function normalizeComposerToggleTargetState(
  value: DeepSeekComposerToggleTargetState | undefined,
): DeepSeekComposerToggleTargetState {
  return value ?? DEFAULT_COMPOSER_MODE_REQUEST.deepThink
}

function resolveChatMode(
  activeMode: DeepSeekChatMode | null | undefined,
): DeepSeekChatMode | 'unavailable' | null {
  if (isDeepSeekChatMode(activeMode)) {
    return activeMode
  }

  if (activeMode === null) {
    return 'unavailable'
  }

  return null
}

function resolveSettledChatMode(input: {
  activeMode: DeepSeekChatMode | null | undefined
  modeSelectorVisible: boolean
  availableModes: DeepSeekChatMode[]
  requestedChatMode?: DeepSeekComposerChatModeTargetState | undefined
  authoritativeChatModeHint?: DeepSeekChatMode | undefined
}): DeepSeekChatMode | 'unavailable' | null {
  const resolvedFromSurface = resolveChatMode(input.activeMode)
  if (isDeepSeekChatMode(resolvedFromSurface)) {
    return resolvedFromSurface
  }

  if (
    isDeepSeekChatMode(input.requestedChatMode) &&
    input.authoritativeChatModeHint === input.requestedChatMode
  ) {
    return input.authoritativeChatModeHint
  }

  return resolvedFromSurface
}

function isDeepSeekChatMode(value: unknown): value is DeepSeekChatMode {
  return value === 'instant' || value === 'expert' || value === 'vision'
}

function mergeDeepSeekChatModeSurface(
  previous: Awaited<ReturnType<typeof captureDeepSeekChatModeSurface>>,
  current: Awaited<ReturnType<typeof captureDeepSeekChatModeSurface>>,
) {
  return {
    ...current,
    heading: current.heading ?? previous.heading,
    modeSelectorVisible: current.modeSelectorVisible || previous.modeSelectorVisible,
    availableModes:
      current.availableModes.length > 0 ? current.availableModes : previous.availableModes,
    activeMode: current.activeMode ?? previous.activeMode,
  }
}

function resolveToggleState(state: string | undefined): ToggleState {
  if (state === 'on' || state === 'off') {
    return state
  }
  return 'unavailable'
}
