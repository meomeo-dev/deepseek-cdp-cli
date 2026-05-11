import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, Page } from 'puppeteer-core'
import { captureDeepSeekMessageActionSnapshot } from './deepSeekMessageActionControls.js'
import type {
  DeepSeekResolvedRetryUiTarget,
  DeepSeekUiRetryAuditResult,
  DeepSeekUiRetryAuditStep,
  DeepSeekUiRetryHintSnapshot,
  DeepSeekUiRetryMessageActionMatch,
  DeepSeekUiRetryObservationPath,
  DeepSeekUiRetryVisibleControlCandidate,
} from '../../types/deepseek-retry-ui.types.js'

const RATE_LIMIT_TEXT_PATTERN = /(messages too frequent|try again later|请求过于频繁|重试|再试)/i
const OVERFLOW_BUTTON_PATTERN = /(more|更多|更多操作|menu|ellipsis|overflow|更多选项)/i

const DEEPSEEK_RETRY_UI_DOM_HELPERS = String.raw`
const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim()
const isVisible = element => {
  if (!(element instanceof HTMLElement)) {
    return true
  }
  if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
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
      element.getAttribute('data-testid'),
      element.textContent,
      element.querySelector('svg title')?.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  )
const inferControlKind = element => {
  const text = normalize(element.textContent)
  const className = normalize(element.getAttribute('class')).toLowerCase()
  if (element.getAttribute('role') === 'menuitem') {
    return 'inline-button'
  }
  if (element.tagName === 'BUTTON' || text.length > 0 || !className.includes('icon-button')) {
    return 'inline-button'
  }
  return 'icon-button'
}
const collectVisibleRetryHints = () =>
  Array.from(document.querySelectorAll('body *'))
    .filter(isVisible)
    .map(element => ({
      text: normalize(element.textContent),
      selector:
        element.id
          ? '#' + element.id
          : element.getAttribute('data-virtual-list-item-key')
            ? '[data-virtual-list-item-key="' + element.getAttribute('data-virtual-list-item-key') + '"]'
            : element.tagName.toLowerCase(),
    }))
    .filter(item => item.text && /(messages too frequent|try again later|请求过于频繁|再试|重试)/i.test(item.text))
const collectVisibleRetryControls = observationPath =>
  Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], a'))
    .filter(isVisible)
    .map(element => {
      const text = normalize(element.textContent) || null
      const ariaLabel = normalize(element.getAttribute('aria-label')) || null
      const title = normalize(element.getAttribute('title')) || null
      const testId = normalize(element.getAttribute('data-testid')) || null
      const label = readLabel(element) || null
      const className = normalize(element.getAttribute('class')) || null
      return {
        selector:
          element.id
            ? '#' + element.id
            : element.getAttribute('data-testid')
              ? '[data-testid="' + element.getAttribute('data-testid') + '"]'
              : element.tagName.toLowerCase(),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        className,
        label,
        text,
        ariaLabel,
        title,
        testId,
        controlKind: inferControlKind(element),
        observationPath,
      }
    })
    .filter(candidate =>
      /(retry|try again|重试|再试|重新尝试)/i.test(
        [candidate.label, candidate.text, candidate.ariaLabel, candidate.title, candidate.testId]
          .filter(Boolean)
          .join(' '),
      ),
    )
const collectVisibleOverflowButtons = messageId => {
  const root = messageId
    ? document.querySelector('[data-virtual-list-item-key="' + messageId + '"]')
    : document.body
  if (!root) {
    return []
  }
  return Array.from(root.querySelectorAll('button, [role="button"]'))
    .filter(isVisible)
    .map((element, controlIndex) => ({
      controlIndex,
      label: readLabel(element) || null,
      className: normalize(element.getAttribute('class')) || null,
    }))
}
`

export async function auditDeepSeekRetryUi(input: {
  page: Page
  targetMessageId?: string | null | undefined
  reopenUrl?: string | null | undefined
  timeoutMs?: number | undefined
}): Promise<DeepSeekUiRetryAuditResult> {
  const steps: DeepSeekUiRetryAuditStep[] = []
  const visibleHints: DeepSeekUiRetryHintSnapshot[] = []
  const pageCandidates: DeepSeekUiRetryVisibleControlCandidate[] = []
  const messageActionMatches: DeepSeekUiRetryMessageActionMatch[] = []

  let latestMessageActionSnapshot = null

  const immediateState = await captureDeepSeekRetryUiState(input.page, 'page-visible')
  visibleHints.push(...immediateState.visibleHints)
  pageCandidates.push(...immediateState.pageCandidates)
  steps.push(immediateState.step)

  const immediateMessageAction = await captureRetryMessageActionMatches(
    input.page,
    input.targetMessageId ?? null,
    'message-action-snapshot',
  )
  latestMessageActionSnapshot = immediateMessageAction.snapshot
  messageActionMatches.push(...immediateMessageAction.matches)
  steps.push(immediateMessageAction.step)

  const menuState = await captureRetryControlsFromMessageOverflowMenu(input.page, {
    targetMessageId: input.targetMessageId ?? null,
    observationPath: 'message-overflow-menu',
    timeoutMs: input.timeoutMs,
  })
  if (menuState) {
    visibleHints.push(...menuState.visibleHints)
    pageCandidates.push(...menuState.pageCandidates)
    steps.push(menuState.step)
  }

  if (
    pageCandidates.length === 0 &&
    messageActionMatches.length === 0 &&
    input.reopenUrl
  ) {
    await input.page.goto(input.reopenUrl, { waitUntil: 'domcontentloaded' })
    await delay(1_000)

    const reopenedState = await captureDeepSeekRetryUiState(input.page, 'reopen-page-visible')
    visibleHints.push(...reopenedState.visibleHints)
    pageCandidates.push(...reopenedState.pageCandidates)
    steps.push(reopenedState.step)

    const reopenedMessageAction = await captureRetryMessageActionMatches(
      input.page,
      input.targetMessageId ?? null,
      'reopen-message-action-snapshot',
    )
    latestMessageActionSnapshot = reopenedMessageAction.snapshot
    messageActionMatches.push(...reopenedMessageAction.matches)
    steps.push(reopenedMessageAction.step)

    const reopenedMenuState = await captureRetryControlsFromMessageOverflowMenu(input.page, {
      targetMessageId: input.targetMessageId ?? null,
      observationPath: 'reopen-message-overflow-menu',
      timeoutMs: input.timeoutMs,
    })
    if (reopenedMenuState) {
      visibleHints.push(...reopenedMenuState.visibleHints)
      pageCandidates.push(...reopenedMenuState.pageCandidates)
      steps.push(reopenedMenuState.step)
    }
  }

  const observed = pageCandidates.length > 0 || messageActionMatches.length > 0

  return {
    pageUrl: input.page.url(),
    targetMessageId: input.targetMessageId ?? null,
    observed,
    unresolvedReason: observed
      ? null
      : 'No stable UI retry control was observed after page-visible, message-action, overflow-menu, and reopen checks.',
    visibleHints: dedupeHints(visibleHints),
    pageCandidates: dedupePageCandidates(pageCandidates),
    messageActionSnapshot: latestMessageActionSnapshot,
    messageActionMatches: dedupeMessageActionMatches(messageActionMatches),
    steps,
  }
}

export function resolveDeepSeekRetryUiTargetMessage(input: {
  auditResult: Pick<DeepSeekUiRetryAuditResult, 'messageActionMatches'> | null
  canonicalTargetMessageId: string | null
}): DeepSeekResolvedRetryUiTarget {
  const matchedMessageId =
    input.auditResult?.messageActionMatches.find(match => match.control.action === 'retry')
      ?.messageId ?? null
  if (matchedMessageId) {
    return {
      messageId: matchedMessageId,
      source: 'message-action-match',
    }
  }

  if (input.canonicalTargetMessageId) {
    return {
      messageId: input.canonicalTargetMessageId,
      source: 'canonical-generation',
    }
  }

  return {
    messageId: null,
    source: 'missing',
  }
}

async function captureDeepSeekRetryUiState(
  page: Page,
  observationPath: Extract<
    DeepSeekUiRetryObservationPath,
    'page-visible' | 'reopen-page-visible'
  >,
): Promise<{
  visibleHints: DeepSeekUiRetryHintSnapshot[]
  pageCandidates: DeepSeekUiRetryVisibleControlCandidate[]
  step: DeepSeekUiRetryAuditStep
}> {
  const visibleHints = await captureVisibleRetryHints(page)
  const pageCandidates = await captureVisibleRetryControls(page, observationPath)

  return {
    visibleHints,
    pageCandidates,
    step: {
      observationPath,
      observed: visibleHints.length > 0 || pageCandidates.length > 0,
      hintCount: visibleHints.length,
      pageCandidateCount: pageCandidates.length,
      messageActionMatchCount: 0,
      notes:
        visibleHints.length > 0
          ? ['Visible rate-limit hint text was present on page.']
          : ['No visible rate-limit hint text was detected on page.'],
    },
  }
}

async function captureRetryMessageActionMatches(
  page: Page,
  targetMessageId: string | null,
  observationPath: Extract<
    DeepSeekUiRetryObservationPath,
    'message-action-snapshot' | 'reopen-message-action-snapshot'
  >,
): Promise<{
  snapshot: Awaited<ReturnType<typeof captureDeepSeekMessageActionSnapshot>>
  matches: DeepSeekUiRetryMessageActionMatch[]
  step: DeepSeekUiRetryAuditStep
}> {
  const snapshot = await captureDeepSeekMessageActionSnapshot(page)
  const items = targetMessageId
    ? [
        ...snapshot.items.filter(item => item.messageId === targetMessageId),
        ...snapshot.items.filter(item => item.messageId !== targetMessageId),
      ]
    : snapshot.items

  const matches = items.flatMap(item =>
    item.actions
      .filter(action => action.action === 'retry')
      .map(action => ({
        messageId: item.messageId,
        role: item.role,
        textPreview: item.textPreview,
        control: action,
        observationPath,
      })),
  )

  return {
    snapshot,
    matches,
    step: {
      observationPath,
      observed: matches.length > 0,
      hintCount: 0,
      pageCandidateCount: 0,
      messageActionMatchCount: matches.length,
      notes:
        matches.length > 0
          ? ['Retry action was recognized via message action snapshot/tooltip resolution.']
          : ['Message action snapshot did not expose a retry action.'],
    },
  }
}

async function captureRetryControlsFromMessageOverflowMenu(
  page: Page,
  input: {
    targetMessageId: string | null
    observationPath: Extract<
      DeepSeekUiRetryObservationPath,
      'message-overflow-menu' | 'reopen-message-overflow-menu'
    >
    timeoutMs?: number | undefined
  },
): Promise<{
  visibleHints: DeepSeekUiRetryHintSnapshot[]
  pageCandidates: DeepSeekUiRetryVisibleControlCandidate[]
  step: DeepSeekUiRetryAuditStep
} | null> {
  const candidateMessageIds = await resolveRetryRelevantMessageIds(page, input.targetMessageId)
  for (const messageId of candidateMessageIds) {
    const opened = await openVisibleOverflowMenuForMessage(page, messageId)
    if (!opened) {
      continue
    }

    try {
      await delay(Math.min(input.timeoutMs ?? 2_000, 250))
      const visibleHints = await captureVisibleRetryHints(page)
      const pageCandidates = await captureVisibleRetryControls(page, input.observationPath)
      return {
        visibleHints,
        pageCandidates,
        step: {
          observationPath: input.observationPath,
          observed: pageCandidates.length > 0,
          hintCount: visibleHints.length,
          pageCandidateCount: pageCandidates.length,
          messageActionMatchCount: 0,
          notes: [
            `Opened overflow menu for message ${messageId}.`,
            pageCandidates.length > 0
              ? 'Retry-labeled control became visible inside or after menu expansion.'
              : 'Overflow menu opened but no retry-labeled control became visible.',
          ],
        },
      }
    } finally {
      await page.keyboard.press('Escape').catch(() => {})
      await delay(100)
    }
  }

  return {
    visibleHints: [],
    pageCandidates: [],
    step: {
      observationPath: input.observationPath,
      observed: false,
      hintCount: 0,
      pageCandidateCount: 0,
      messageActionMatchCount: 0,
      notes: ['No visible overflow menu trigger was found for retry-relevant messages.'],
    },
  }
}

async function resolveRetryRelevantMessageIds(
  page: Page,
  targetMessageId: string | null,
): Promise<string[]> {
  const snapshot = await captureDeepSeekMessageActionSnapshot(page)
  const matchingIds = snapshot.items
    .filter(item => RATE_LIMIT_TEXT_PATTERN.test(item.textPreview ?? ''))
    .map(item => item.messageId)

  const ordered = [
    ...(targetMessageId ? [targetMessageId] : []),
    ...matchingIds,
    ...snapshot.items.map(item => item.messageId),
  ]
  return [...new Set(ordered.filter(Boolean))]
}

async function openVisibleOverflowMenuForMessage(
  page: Page,
  messageId: string,
): Promise<boolean> {
  const messageHandle = await resolveMessageItemHandle(page, messageId)
  if (!messageHandle) {
    return false
  }

  try {
    await messageHandle.hover()
    await delay(150)
  } finally {
    await messageHandle.dispose().catch(() => {})
  }

  const overflowHandle = await resolveOverflowButtonHandle(page, messageId)
  if (!overflowHandle) {
    return false
  }

  try {
    await overflowHandle.click()
    return true
  } finally {
    await overflowHandle.dispose().catch(() => {})
  }
}

async function resolveMessageItemHandle(
  page: Page,
  messageId: string,
): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    ({ source, requestedMessageId }) => {
      const helpers = window.eval(source) as {
        findMessageItem: (messageId: string) => Element | null
      }
      return helpers.findMessageItem(requestedMessageId)
    },
    {
      source: wrapRetryUiDomHelpers('findMessageItem'),
      requestedMessageId: messageId,
    },
  )
  const element = handle.asElement()
  if (!element) {
    await handle.dispose().catch(() => {})
    return null
  }
  return element as ElementHandle<Element>
}

async function resolveOverflowButtonHandle(
  page: Page,
  messageId: string,
): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    ({ source, requestedMessageId, pattern }) => {
      const helpers = window.eval(source) as {
        findMessageItem: (messageId: string) => Element | null
        collectVisibleOverflowButtons: (
          messageId: string,
        ) => Array<{ controlIndex: number; label: string | null; className: string | null }>
      }
      const item = helpers.findMessageItem(requestedMessageId)
      if (!item) {
        return null
      }
      const controls = Array.from(item.querySelectorAll('button, [role="button"]')).filter(
        element => {
          const localHelpers = window.eval(source) as {
            isVisible: (element: Element) => boolean
            readLabel: (element: Element) => string
          }
          if (!localHelpers.isVisible(element)) {
            return false
          }
          const label = localHelpers.readLabel(element)
          const className = String(element.getAttribute('class') ?? '')
          return new RegExp(pattern, 'i').test(label) || new RegExp(pattern, 'i').test(className)
        },
      )
      return controls[0] ?? null
    },
    {
      source: wrapRetryUiDomHelpers(
        'findMessageItem',
        'isVisible',
        'readLabel',
        'collectVisibleOverflowButtons',
      ),
      requestedMessageId: messageId,
      pattern: OVERFLOW_BUTTON_PATTERN.source,
    },
  )
  const element = handle.asElement()
  if (!element) {
    await handle.dispose().catch(() => {})
    return null
  }
  return element as ElementHandle<Element>
}

async function captureVisibleRetryHints(page: Page): Promise<DeepSeekUiRetryHintSnapshot[]> {
  return page.evaluate(source => {
    const helpers = window.eval(source) as {
      collectVisibleRetryHints: () => DeepSeekUiRetryHintSnapshot[]
    }
    return helpers.collectVisibleRetryHints()
  }, wrapRetryUiDomHelpers('collectVisibleRetryHints'))
}

async function captureVisibleRetryControls(
  page: Page,
  observationPath: DeepSeekUiRetryObservationPath,
): Promise<DeepSeekUiRetryVisibleControlCandidate[]> {
  return page.evaluate(
    ({ source, requestedObservationPath }) => {
      const helpers = window.eval(source) as {
        collectVisibleRetryControls: (
          observationPath: DeepSeekUiRetryObservationPath,
        ) => DeepSeekUiRetryVisibleControlCandidate[]
      }
      return helpers.collectVisibleRetryControls(requestedObservationPath)
    },
    {
      source: wrapRetryUiDomHelpers('collectVisibleRetryControls'),
      requestedObservationPath: observationPath,
    },
  )
}

function wrapRetryUiDomHelpers(...exports: string[]): string {
  return `(() => {
    ${DEEPSEEK_RETRY_UI_DOM_HELPERS}
    const findMessageItem = messageId =>
      Array.from(document.querySelectorAll('[data-virtual-list-item-key]')).find(
        element => element.getAttribute('data-virtual-list-item-key') === messageId,
      ) ?? null
    return { ${exports.join(', ')} }
  })()`
}

function dedupeHints(items: DeepSeekUiRetryHintSnapshot[]): DeepSeekUiRetryHintSnapshot[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const fingerprint = `${item.selector}:${item.text}`
    if (seen.has(fingerprint)) {
      return false
    }
    seen.add(fingerprint)
    return true
  })
}

function dedupePageCandidates(
  items: DeepSeekUiRetryVisibleControlCandidate[],
): DeepSeekUiRetryVisibleControlCandidate[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const fingerprint = [
      item.observationPath,
      item.selector,
      item.label,
      item.text,
      item.ariaLabel,
      item.title,
      item.testId,
    ].join('::')
    if (seen.has(fingerprint)) {
      return false
    }
    seen.add(fingerprint)
    return true
  })
}

function dedupeMessageActionMatches(
  items: DeepSeekUiRetryMessageActionMatch[],
): DeepSeekUiRetryMessageActionMatch[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const fingerprint = [
      item.observationPath,
      item.messageId,
      item.control.controlIndex,
      item.control.label,
      item.control.tooltipLabel,
    ].join('::')
    if (seen.has(fingerprint)) {
      return false
    }
    seen.add(fingerprint)
    return true
  })
}
