import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'puppeteer-core'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeCapabilityMatrix,
  DeepSeekChatModeSurfaceSnapshot,
} from '../../types/deepseek-chat-mode.types.js'
import { captureDeepSeekComposerSnapshot } from './deepSeekComposerControls.js'
import { discoverDeepSeekComposerFileInput } from './deepSeekFileUploadRuntime.js'

const DEFAULT_STABLE_MODE_SURFACE_OPTIONS = {
  timeoutMs: 10_000,
  pollIntervalMs: 250,
  stableWindowMs: 600,
}

const CAPTURE_DEEPSEEK_CHAT_MODE_SURFACE_SOURCE = String.raw`
(() => {
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim()
  const hasHiddenAncestor = element => Boolean(
    element.closest('[hidden], [inert], [aria-hidden="true"]'),
  )
  const isVisible = element => {
    if (!(element instanceof HTMLElement)) {
      return true
    }
    if (element.hidden || hasHiddenAncestor(element)) {
      return false
    }
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false
    }
    if (Number.parseFloat(style.opacity || '1') === 0) {
      return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const readLabel = element =>
    normalize(
      [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.textContent,
      ]
        .filter(Boolean)
        .join(' '),
    )
  const matchesSingleOrDuplicatedLabel = (normalized, labels) => {
    const compact = normalized.replace(/\s+/g, '')
    return labels.some(label => {
      const compactLabel = label.replace(/\s+/g, '')
      return compact === compactLabel || compact === compactLabel + compactLabel
    })
  }
  const resolveMode = label => {
    const normalized = normalize(label).toLowerCase()
    if (matchesSingleOrDuplicatedLabel(normalized, ['instant', 'quick mode', '快速模式'])) {
      return 'instant'
    }
    if (matchesSingleOrDuplicatedLabel(normalized, ['expert', 'expert mode', '专家模式'])) {
      return 'expert'
    }
    if (matchesSingleOrDuplicatedLabel(normalized, ['vision', 'vision mode', '识图模式'])) {
      return 'vision'
    }
    return null
  }
  const resolveInteractiveOwner = element =>
    element.closest(
      'button, [role="button"], [role="radio"], [role="tab"], label, [aria-selected], [aria-pressed], [aria-checked]',
    ) ?? element
  const modeCandidates = Array.from(document.querySelectorAll('*'))
    .filter(isVisible)
    .map(element => {
      const label = readLabel(element)
      return {
        element,
        owner: resolveInteractiveOwner(element),
        label,
        mode: resolveMode(label),
      }
    })
    .filter(candidate => candidate.mode)

  const uniqueModes = []
  for (const candidate of modeCandidates) {
    if (!uniqueModes.includes(candidate.mode)) {
      uniqueModes.push(candidate.mode)
    }
  }

  const activeModeFromHeading = (() => {
    const headingCandidate = Array.from(
      document.querySelectorAll('h1, h2, h3, [role="heading"], p, span, div'),
    )
      .filter(isVisible)
      .map(element => normalize(element.textContent))
      .find(
        text =>
          /^Start chatting with (Instant|Expert|Vision)$/i.test(text) ||
          /^使用(快速模式|专家模式|识图模式)开始对话$/.test(text),
      )
    if (!headingCandidate) {
      return null
    }
    if (/(vision|识图模式)/i.test(headingCandidate)) {
      return 'vision'
    }
    return /(expert|专家模式)/i.test(headingCandidate) ? 'expert' : 'instant'
  })()

  const activeModeFromSelector = (() => {
    for (const candidate of modeCandidates) {
      const element = candidate.owner
      const pressed = element.getAttribute('aria-pressed')
      const selected = element.getAttribute('aria-selected')
      const checked = element.getAttribute('aria-checked')
      const dataState = normalize(element.getAttribute('data-state')).toLowerCase()
      const className = normalize(element.getAttribute('class')).toLowerCase()
      if (pressed === 'true' || selected === 'true' || checked === 'true') {
        return candidate.mode
      }
      if (['on', 'active', 'selected', 'checked'].includes(dataState)) {
        return candidate.mode
      }
      if (/(active|selected|checked)/.test(className) && !/(inactive|disabled)/.test(className)) {
        return candidate.mode
      }
    }
    return null
  })()

  const heading = Array.from(
    document.querySelectorAll('h1, h2, h3, [role="heading"], p, span, div'),
  )
    .filter(isVisible)
    .map(element => normalize(element.textContent))
    .find(
      text =>
        /^Start chatting with (Instant|Expert|Vision)$/i.test(text) ||
        /^使用(快速模式|专家模式|识图模式)开始对话$/.test(text),
    ) ?? null

  return {
    heading,
    modeSelectorVisible: uniqueModes.length > 0,
    availableModes: uniqueModes,
    activeMode: activeModeFromHeading ?? activeModeFromSelector ?? null,
  }
})()
`

export async function captureDeepSeekChatModeSurface(
  page: Page,
): Promise<DeepSeekChatModeSurfaceSnapshot> {
  const composerSnapshot = await captureDeepSeekComposerSnapshot(page)
  const fileInput = await discoverDeepSeekComposerFileInput(page)
  const surface = await page.evaluate(CAPTURE_DEEPSEEK_CHAT_MODE_SURFACE_SOURCE) as {
    heading: string | null
    modeSelectorVisible: boolean
    availableModes: DeepSeekChatMode[]
    activeMode: DeepSeekChatMode | null
  }

  return {
    pageUrl: composerSnapshot.pageUrl,
    routeKind: composerSnapshot.routeKind,
    heading: surface.heading,
    modeSelectorVisible: surface.modeSelectorVisible,
    availableModes: surface.availableModes,
    activeMode: surface.activeMode,
    composerSnapshot,
    fileInput,
  }
}

export async function waitForStableDeepSeekChatModeSurface(
  page: Page,
  options: Partial<{
    timeoutMs: number
    pollIntervalMs: number
    stableWindowMs: number
    expectedMode: DeepSeekChatMode
  }> = {},
): Promise<DeepSeekChatModeSurfaceSnapshot> {
  const merged = {
    ...DEFAULT_STABLE_MODE_SURFACE_OPTIONS,
    ...options,
  }
  const deadline = Date.now() + merged.timeoutMs
  let stableSnapshot: DeepSeekChatModeSurfaceSnapshot | null = null
  let stableStartedAt = 0
  let lastSnapshot: DeepSeekChatModeSurfaceSnapshot | null = null

  while (Date.now() < deadline) {
    const snapshot = await captureDeepSeekChatModeSurface(page)
    lastSnapshot = snapshot
    if (isExpectedChatModeSurface(snapshot, merged.expectedMode)) {
      if (stableSnapshot && JSON.stringify(stableSnapshot) === JSON.stringify(snapshot)) {
        if (Date.now() - stableStartedAt >= merged.stableWindowMs) {
          return snapshot
        }
      } else {
        stableSnapshot = snapshot
        stableStartedAt = Date.now()
      }
    } else {
      stableSnapshot = null
      stableStartedAt = 0
    }

    await delay(merged.pollIntervalMs)
  }

  throw new Error(
    `Timed out waiting for a stable DeepSeek chat mode surface.` +
      (merged.expectedMode ? ` Expected mode: ${merged.expectedMode}.` : '') +
      (lastSnapshot ? ` Last page: ${lastSnapshot.pageUrl}.` : ''),
  )
}

export function buildDeepSeekChatModeCapabilityMatrix(
  snapshot: DeepSeekChatModeSurfaceSnapshot,
): DeepSeekChatModeCapabilityMatrix {
  return {
    composerInput: snapshot.composerSnapshot.composerInput.found,
    sendOrStop: snapshot.composerSnapshot.sendOrStopButton.found,
    deepThink: snapshot.composerSnapshot.deepThinkToggle.found,
    search: snapshot.composerSnapshot.searchToggle.found,
    fileButton: snapshot.composerSnapshot.fileButton.found,
    fileInput: snapshot.fileInput.found,
  }
}

function isExpectedChatModeSurface(
  snapshot: DeepSeekChatModeSurfaceSnapshot,
  expectedMode: DeepSeekChatMode | undefined,
): boolean {
  if (!expectedMode) {
    return true
  }

  if (snapshot.activeMode === expectedMode) {
    return true
  }

  if (snapshot.heading?.toLowerCase().includes(expectedMode)) {
    return true
  }

  return false
}
