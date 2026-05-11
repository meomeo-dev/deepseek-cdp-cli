import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'puppeteer-core'
import type {
  DeepSeekChatMode,
  DeepSeekChatModeSurfaceSnapshot,
} from '../../types/deepseek-chat-mode.types.js'
import {
  captureDeepSeekChatModeSurface,
  waitForStableDeepSeekChatModeSurface,
} from './deepSeekChatModeControls.js'

interface DeepSeekChatModeClickCandidateSummary {
  tagName: string | null
  className: string | null
  text: string
  cursor: string | null
  area: number
  interactiveScore?: number
}

interface DeepSeekChatModeClickResult {
  clicked: boolean
  expectedLabel: string
  matchedCount: number
  target?: DeepSeekChatModeClickCandidateSummary | undefined
  candidates?: DeepSeekChatModeClickCandidateSummary[] | undefined
}

function buildClickDeepSeekChatModeExpression(targetMode: DeepSeekChatMode): string {
  return String.raw`
(() => {
  const targetMode = ${JSON.stringify(targetMode)}
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
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false
    }
    if (Number.parseFloat(style.opacity || '1') === 0) {
      return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const resolveMode = label => {
    const normalized = normalize(label).toLowerCase()
    const matchesSingleOrDuplicatedLabel = labels => {
      const compact = normalized.replace(/\s+/g, '')
      return labels.some(label => {
        const compactLabel = label.replace(/\s+/g, '')
        return compact === compactLabel || compact === compactLabel + compactLabel
      })
    }
    if (matchesSingleOrDuplicatedLabel(['instant', 'quick mode', '快速模式'])) {
      return 'instant'
    }
    if (matchesSingleOrDuplicatedLabel(['expert', 'expert mode', '专家模式'])) {
      return 'expert'
    }
    if (matchesSingleOrDuplicatedLabel(['vision', 'vision mode', '识图模式'])) {
      return 'vision'
    }
    return null
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
  const resolveInteractiveOwner = element =>
    element.closest(
      'button, [role="button"], [role="radio"], [role="tab"], label, [aria-selected], [aria-pressed], [aria-checked]',
    ) ?? element
  const expectedLabel = targetMode === 'expert'
    ? 'Expert/专家模式'
    : targetMode === 'vision'
      ? 'Vision/识图模式'
      : 'Instant/快速模式'
  const toElementSummary = element => {
    if (!(element instanceof HTMLElement)) {
      return {
        tagName: element.tagName ?? null,
        className: null,
        text: normalize(element.textContent),
        cursor: null,
        area: 0,
      }
    }
    const rect = element.getBoundingClientRect()
    return {
      tagName: element.tagName,
      className: normalize(element.className),
      text: normalize(element.textContent),
      cursor: window.getComputedStyle(element).cursor,
      area: Math.round(rect.width * rect.height),
    }
  }
  const labelMatches = Array.from(document.querySelectorAll('*'))
    .filter(isVisible)
    .map(element => {
      const label = readLabel(element)
      return {
        element,
        owner: resolveInteractiveOwner(element),
        mode: resolveMode(label),
      }
    })
    .filter(candidate => candidate.mode === targetMode)
  const directMatches = labelMatches.length > 0
    ? labelMatches
    : Array.from(document.querySelectorAll('[role="radiogroup"] [role="radio"], [role="radio"]'))
        .filter(isVisible)
        .map((element, index) => ({
          element,
          owner: resolveInteractiveOwner(element),
          mode: ['instant', 'expert', 'vision'][index] ?? null,
        }))
        .filter(candidate => candidate.mode === targetMode)
  const dedupedCandidates = []
  for (const candidate of directMatches) {
    if (!dedupedCandidates.some(item => item.owner === candidate.owner)) {
      dedupedCandidates.push(candidate)
    }
  }
  const rankedCandidates = dedupedCandidates
    .map(candidate => {
      const element = candidate.owner
      const summary = toElementSummary(element)
      const interactiveScore =
        (element instanceof HTMLElement && window.getComputedStyle(element).cursor === 'pointer'
          ? 4
          : 0) +
        (element.matches('button, [role="button"], [role="radio"], [role="tab"], label') ? 3 : 0) +
        (element.getAttribute('aria-selected') === 'true' ||
        element.getAttribute('aria-pressed') === 'true' ||
        element.getAttribute('aria-checked') === 'true'
          ? 1
          : 0) +
        summary.area / 100000
      return {
        element,
        summary,
        interactiveScore,
      }
    })
    .sort((left, right) => right.interactiveScore - left.interactiveScore)
  const target = rankedCandidates[0]?.element ?? null
  if (!target) {
    return {
      clicked: false,
      expectedLabel,
      matchedCount: dedupedCandidates.length,
      candidates: dedupedCandidates
        .slice(0, 8)
        .map(candidate => toElementSummary(candidate.owner)),
    }
  }
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
  )
  return {
    clicked: true,
    expectedLabel,
    matchedCount: dedupedCandidates.length,
    target: toElementSummary(target),
    candidates: rankedCandidates.slice(0, 8).map(candidate => ({
      ...candidate.summary,
      interactiveScore: Number(candidate.interactiveScore.toFixed(4)),
    })),
  }
})()
`
}

export async function selectDeepSeekChatMode(
  page: Page,
  input: {
    mode: DeepSeekChatMode
    timeoutMs: number
  },
): Promise<DeepSeekChatModeSurfaceSnapshot> {
  const deadline = Date.now() + input.timeoutMs
  let attemptCount = 0
  let lastInteraction: DeepSeekChatModeClickResult | null = null
  let lastSurface: DeepSeekChatModeSurfaceSnapshot | null = null

  while (Date.now() < deadline) {
    lastSurface = await captureDeepSeekChatModeSurface(page)
    if (isRequestedModeSettled(lastSurface, input.mode)) {
      return waitForStableDeepSeekChatModeSurface(page, {
        timeoutMs: Math.max(500, deadline - Date.now()),
        expectedMode: input.mode,
      })
    }

    lastInteraction = await page.evaluate(
      buildClickDeepSeekChatModeExpression(input.mode),
    ) as DeepSeekChatModeClickResult
    if (!lastInteraction?.clicked) {
      await delay(250)
      continue
    }
    attemptCount += 1

    try {
      return await waitForStableDeepSeekChatModeSurface(page, {
        timeoutMs: Math.min(10_000, Math.max(1_500, deadline - Date.now())),
        expectedMode: input.mode,
      })
    } catch {
      const retryCooldownMs = attemptCount >= 1 ? 5_000 : 350
      await delay(Math.min(retryCooldownMs, Math.max(250, deadline - Date.now())))
    }
  }

  throw new Error(
    `Timed out selecting DeepSeek ${input.mode} mode.` +
      (lastSurface ? ` Last active mode: ${lastSurface.activeMode ?? 'unknown'}.` : '') +
      (lastSurface ? ` Last page: ${lastSurface.pageUrl}.` : '') +
      (lastInteraction
        ? ` Last click matched ${lastInteraction.matchedCount} candidate(s); target=${lastInteraction.target?.tagName ?? 'none'}:${lastInteraction.target?.text ?? 'none'}.`
        : ''),
  )
}

function isRequestedModeSettled(
  surface: DeepSeekChatModeSurfaceSnapshot,
  requestedMode: DeepSeekChatMode,
): boolean {
  return (
    surface.activeMode === requestedMode ||
    surface.heading?.toLowerCase().includes(requestedMode) === true
  )
}
