import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'puppeteer-core'
import type {
  DeepSeekComposerSnapshot,
  StableComposerSnapshotOptions,
} from '../../types/deepseek-controls.types.js'
import { matchDeepSeekSessionRoute } from './deepSeekApiCatalog.js'

const DEFAULT_STABLE_SNAPSHOT_OPTIONS: StableComposerSnapshotOptions = {
  timeoutMs: 10_000,
  pollIntervalMs: 250,
  stableWindowMs: 600,
}

const DEEPSEEK_COMPOSER_SNAPSHOT_SOURCE = String.raw`
(() => {
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim()
  const candidateSelectors = [
    'button',
    '[role="button"]',
    'label',
    '[aria-pressed]',
    '[aria-checked]',
  ]
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
  const readElementLabel = element => normalize(
    [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.textContent,
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.placeholder
        : null,
      element.querySelector('svg title')?.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  )
  const collectVisibleCandidates = root =>
    Array.from(root.querySelectorAll(candidateSelectors.join(','))).filter(isVisible)
  const findVisibleComposerInput = () =>
    Array.from(
      document.querySelectorAll(
        [
          'textarea:not([disabled])',
          '[contenteditable="true"]',
          '[contenteditable="plaintext-only"]',
          '[role="textbox"]',
        ].join(','),
      ),
    ).find(isVisible) ?? null
  const findComposerRoot = inputElement => {
    let current = inputElement?.parentElement ?? null
    while (current) {
      if (collectVisibleCandidates(current).length >= 2) {
        return current
      }
      current = current.parentElement
    }
    return document.body
  }
  const inferSelector = element => {
    if (element instanceof HTMLTextAreaElement) {
      return 'textarea:not([disabled])'
    }
    if (element.getAttribute('role') === 'textbox') {
      return '[role="textbox"]'
    }
    if (element.getAttribute('contenteditable') === 'plaintext-only') {
      return '[contenteditable="plaintext-only"]'
    }
    if (element.getAttribute('contenteditable') === 'true') {
      return '[contenteditable="true"]'
    }
    if (element.tagName === 'LABEL') {
      return 'label'
    }
    if (element.getAttribute('role') === 'button') {
      return '[role="button"]'
    }
    if (element.hasAttribute('aria-pressed')) {
      return '[aria-pressed]'
    }
    if (element.hasAttribute('aria-checked')) {
      return '[aria-checked]'
    }
    return element.tagName.toLowerCase()
  }
  const inferButtonLabel = element => readElementLabel(element).toLowerCase()
  const isIconOnlyButton = element => {
    const label = inferButtonLabel(element)
    const className = normalize(element.getAttribute('class')).toLowerCase()
    const rect = element.getBoundingClientRect()
    const hasIconShape =
      element.querySelector('svg') ||
      /(?:^|\s)(?:icon-button|ds-icon-button)(?:\s|$)/.test(className) ||
      /ds-button--(?:icon|circle|primary|filled)/.test(className)
    return (
      !label &&
      element.getAttribute('role') === 'button' &&
      Boolean(hasIconShape) &&
      rect.width >= 12 &&
      rect.height >= 12 &&
      rect.width <= 96 &&
      rect.height <= 96
    )
  }
  const findButtonMatch = (buttons, labelMatcher) => {
    for (const element of buttons) {
      const label = inferButtonLabel(element)
      if (labelMatcher(label, element)) {
        return element
      }
    }
    return null
  }
  const describeResolvedElement = (element, stateResolver) => {
    if (!element) {
      return {
        found: false,
        selector: null,
        label: null,
        state: stateResolver ? 'unavailable' : undefined,
      }
    }

    const label = readElementLabel(element)
    return {
      found: true,
      selector: inferSelector(element),
      label: label || null,
      state: stateResolver ? stateResolver(element, label.toLowerCase()) : undefined,
    }
  }
  const describeElement = (candidates, labelMatcher, stateResolver) => {
    for (const selector of candidates) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(element)) {
          continue
        }

        const label = readElementLabel(element)
        if (labelMatcher && !labelMatcher(label.toLowerCase(), element)) {
          continue
        }

        return {
          found: true,
          selector,
          label: label || null,
          state: stateResolver ? stateResolver(element, label.toLowerCase()) : undefined,
        }
      }
    }

    return {
      found: false,
      selector: null,
      label: null,
      state: labelMatcher ? 'unavailable' : undefined,
    }
  }
  const resolveToggleState = (element, normalizedLabel) => {
    const pressed = element.getAttribute('aria-pressed')
    const checked = element.getAttribute('aria-checked')
    const dataState = normalize(element.getAttribute('data-state')).toLowerCase()
    const className = normalize(element.getAttribute('class')).toLowerCase()

    if (pressed === 'true' || checked === 'true') {
      return 'on'
    }
    if (pressed === 'false' || checked === 'false') {
      return 'off'
    }
    if (['on', 'active', 'selected', 'checked'].includes(dataState)) {
      return 'on'
    }
    if (['off', 'inactive', 'unselected', 'unchecked'].includes(dataState)) {
      return 'off'
    }
    if (/(active|selected|enabled|checked)/.test(className) && !/(inactive|disabled)/.test(className)) {
      return 'on'
    }
    if (normalizedLabel.includes('关闭') || normalizedLabel.includes('off')) {
      return 'off'
    }

    return 'off'
  }
  const resolveSendStopState = (element, normalizedLabel) => {
    const svgSignature = normalize(
      Array.from(element.querySelectorAll('svg path'))
        .map(path => path.getAttribute('d'))
        .filter(Boolean)
        .join(' '),
    )
    const isRoundedSquareStopIcon =
      svgSignature.includes('M2 4.88C2 3.68009') &&
      svgSignature.includes('H11.12') &&
      svgSignature.includes('V11.12')
    if (
      /(stop|停止|square|cancel|暂停|终止)/.test(normalizedLabel) ||
      normalize(element.getAttribute('data-testid')).toLowerCase().includes('stop') ||
      /M4(?:\.\d+)? 4(?:\.\d+)?H12/.test(svgSignature) ||
      isRoundedSquareStopIcon
    ) {
      return 'stop'
    }

    return 'send'
  }
  const inputElement = findVisibleComposerInput()
  const composerRoot = findComposerRoot(inputElement)
  const composerButtons = collectVisibleCandidates(composerRoot)
  const unmatchedIconButtons = composerButtons.filter(
    element =>
      isIconOnlyButton(element) &&
      !/(deepthink|深度思考|thinking|reason|search|联网搜索|智能搜索|web search|smart search|browse)/.test(
        inferButtonLabel(element),
      ),
  )
  const input = describeResolvedElement(inputElement)
  const resolvedSendOrStopElement =
    findButtonMatch(
      composerButtons,
      (label, element) =>
        /(send|stop|发送|停止|paper plane|arrow up|square|submit|continue)/.test(label) ||
        /(send|submit|stop)/.test(normalize(element.getAttribute('data-testid')).toLowerCase()),
    ) ?? unmatchedIconButtons.at(-1) ?? null
  const remainingUnmatchedIconButtons = unmatchedIconButtons.filter(
    element => element !== resolvedSendOrStopElement,
  )
  const hasComposerFileInput = Boolean(
    composerRoot.querySelector('input[type="file"]') ?? document.querySelector('input[type="file"]'),
  )
  const sendOrStop = describeResolvedElement(
    resolvedSendOrStopElement,
    resolveSendStopState,
  )
  const deepThinkToggle = describeResolvedElement(
    findButtonMatch(composerButtons, label => /(deepthink|深度思考|thinking|reason)/.test(label)),
    resolveToggleState,
  )
  const searchToggle = describeResolvedElement(
    findButtonMatch(
      composerButtons,
      label => /(search|联网搜索|智能搜索|web search|smart search|browse)/.test(label),
    ),
    resolveToggleState,
  )
  const fileButton = describeResolvedElement(
    findButtonMatch(
      composerButtons,
      (label, element) =>
        /(file|附件|上传文件|upload|attach)/.test(label) ||
        /(file|upload|attach)/.test(normalize(element.getAttribute('data-testid')).toLowerCase()),
    ) ?? (hasComposerFileInput ? remainingUnmatchedIconButtons.at(0) : null) ?? null,
  )
  const normalizedPathname = (() => {
    const trimmed = window.location.pathname.replace(/\/+$/, '')
    return trimmed || '/'
  })()
  const routeMatch = (() => {
    if (normalizedPathname === '/') {
      return {
        routeKind: 'home',
        agentId: null,
        sessionId: null,
      }
    }

    const sessionMatch = normalizedPathname.match(/^\/a\/([^/]+)\/s\/([^/?#]+)$/)
    if (sessionMatch) {
      return {
        routeKind: 'session',
        agentId: sessionMatch[1] ?? null,
        sessionId: sessionMatch[2] ?? null,
      }
    }

    const landingMatch = normalizedPathname.match(/^\/a\/([^/]+)$/)
    if (landingMatch) {
      return {
        routeKind: 'landing',
        agentId: landingMatch[1] ?? null,
        sessionId: null,
      }
    }

    return {
      routeKind: 'unknown',
      agentId: null,
      sessionId: null,
    }
  })()

  return {
    pageUrl: window.location.href,
    routeKind: routeMatch.routeKind,
    agentId: routeMatch.agentId,
    sessionId: routeMatch.sessionId,
    composerInput: input,
    sendOrStopButton: sendOrStop,
    deepThinkToggle,
    searchToggle,
    fileButton,
  }
})()
`

export async function captureDeepSeekComposerSnapshot(page: Page): Promise<DeepSeekComposerSnapshot> {
  return page.evaluate(source => window.eval(source) as DeepSeekComposerSnapshot, DEEPSEEK_COMPOSER_SNAPSHOT_SOURCE)
}

export async function waitForStableDeepSeekComposerSnapshot(
  page: Page,
  options: Partial<StableComposerSnapshotOptions> = {},
): Promise<DeepSeekComposerSnapshot> {
  const merged = {
    ...DEFAULT_STABLE_SNAPSHOT_OPTIONS,
    ...options,
  }

  const deadline = Date.now() + merged.timeoutMs
  let stableSnapshot: DeepSeekComposerSnapshot | null = null
  let stableStartedAt = 0

  while (Date.now() < deadline) {
    const snapshot = await captureDeepSeekComposerSnapshot(page)

    if (stableSnapshot && isSameSnapshot(stableSnapshot, snapshot)) {
      if (Date.now() - stableStartedAt >= merged.stableWindowMs) {
        return snapshot
      }
    } else {
      stableSnapshot = snapshot
      stableStartedAt = Date.now()
    }

    await delay(merged.pollIntervalMs)
  }

  throw new Error('Timed out waiting for a stable DeepSeek composer snapshot.')
}

export function isDeepSeekComposerInputReady(snapshot: DeepSeekComposerSnapshot): boolean {
  return snapshot.composerInput.found && snapshot.routeKind !== 'session'
}

export function summarizeDeepSeekRoute(url: string): string {
  const match = matchDeepSeekSessionRoute(url)
  if (match.routeKind === 'session') {
    return `session:${match.agentId ?? 'unknown'}/${match.sessionId ?? 'unknown'}`
  }
  if (match.routeKind === 'home') {
    return 'home'
  }
  if (match.routeKind === 'landing') {
    return `landing:${match.agentId ?? 'unknown'}`
  }
  return 'unknown'
}

function isSameSnapshot(
  left: DeepSeekComposerSnapshot,
  right: DeepSeekComposerSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
