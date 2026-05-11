import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, Page } from 'puppeteer-core'
import type {
  DeepSeekMessageActionControlKind,
  DeepSeekMessageActionControlMatch,
  DeepSeekMessageActionItemSnapshot,
  DeepSeekMessageActionName,
  DeepSeekMessageActionRole,
  DeepSeekMessageActionSnapshot,
  DeepSeekMessageActionTarget,
  StableDeepSeekMessageActionSnapshotOptions,
} from '../../types/deepseek-message-actions.types.js'

const DEFAULT_STABLE_MESSAGE_ACTION_SNAPSHOT_OPTIONS: StableDeepSeekMessageActionSnapshotOptions = {
  timeoutMs: 10_000,
  pollIntervalMs: 250,
  stableWindowMs: 600,
}

const DEEPSEEK_MESSAGE_ACTION_DOM_HELPERS = String.raw`
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
const readElementLabel = element =>
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
const inferSelector = element => {
  if (element.tagName === 'BUTTON') {
    return 'button'
  }
  if (element.getAttribute('role') === 'button') {
    return '[role="button"]'
  }
  return element.tagName.toLowerCase()
}
const findMessageItem = messageId =>
  Array.from(document.querySelectorAll('[data-virtual-list-item-key]')).find(
    element => element.getAttribute('data-virtual-list-item-key') === messageId,
  ) ?? null
const collectVisibleMessageItems = () =>
  Array.from(document.querySelectorAll('[data-virtual-list-item-key]'))
    .filter(isVisible)
    .map(element => ({
      messageId: element.getAttribute('data-virtual-list-item-key') ?? '',
      selector:
        '[data-virtual-list-item-key="' +
        (element.getAttribute('data-virtual-list-item-key') ?? '') +
        '"]',
      className: normalize(element.getAttribute('class')) || null,
      textPreview: normalize(element.textContent).slice(0, 160) || null,
    }))
    .filter(item => item.messageId)
const collectVisibleMessageActionControls = messageId => {
  const item = findMessageItem(messageId)
  if (!item) {
    return []
  }

  return Array.from(item.querySelectorAll('[role="button"], button'))
    .filter(isVisible)
    .map((element, controlIndex) => ({
      controlIndex,
      selector: inferSelector(element),
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      className: normalize(element.getAttribute('class')) || null,
      label: readElementLabel(element) || null,
      text: normalize(element.textContent) || null,
    }))
}
const readVisibleTooltipText = () => {
  const candidates = Array.from(document.querySelectorAll('[role="tooltip"], .ds-tooltip'))
    .filter(isVisible)
    .map(element => normalize(element.textContent))
    .filter(Boolean)
  return candidates.at(-1) ?? null
}
`

export async function captureDeepSeekMessageActionSnapshot(
  page: Page,
): Promise<DeepSeekMessageActionSnapshot> {
  const items = await collectVisibleDeepSeekMessageItems(page)
  const snapshots: DeepSeekMessageActionItemSnapshot[] = []

  for (const item of items) {
    const itemHandle = await resolveDeepSeekMessageItemHandle(page, item.messageId)
    if (!itemHandle) {
      continue
    }

    try {
      await itemHandle.hover()
      await delay(150)

      const rawControls = await collectVisibleDeepSeekMessageActionControls(page, item.messageId)
      const actions: DeepSeekMessageActionControlMatch[] = []

      for (const rawControl of rawControls) {
        const tooltipLabel =
          rawControl.label && resolveDeepSeekMessageActionName(rawControl.label) !== 'unknown'
            ? null
            : await readVisibleDeepSeekMessageTooltipAfterHover(page, item.messageId, rawControl.controlIndex)
        const actionLabel = tooltipLabel ?? rawControl.label ?? rawControl.text
        actions.push({
          found: true,
          action: resolveDeepSeekMessageActionName(actionLabel),
          controlIndex: rawControl.controlIndex,
          selector: rawControl.selector,
          label: rawControl.label ?? rawControl.text,
          tooltipLabel,
          controlKind: inferDeepSeekMessageActionControlKind(rawControl),
        })
      }

      snapshots.push({
        messageId: item.messageId,
        selector: item.selector,
        role: inferDeepSeekMessageActionRole(actions),
        className: item.className,
        textPreview: item.textPreview,
        actions,
      })
    } finally {
      await itemHandle.dispose().catch(() => {})
    }
  }

  return {
    pageUrl: page.url(),
    items: snapshots,
  }
}

export async function waitForStableDeepSeekMessageActionSnapshot(
  page: Page,
  options: Partial<StableDeepSeekMessageActionSnapshotOptions> = {},
): Promise<DeepSeekMessageActionSnapshot> {
  const resolvedOptions = {
    ...DEFAULT_STABLE_MESSAGE_ACTION_SNAPSHOT_OPTIONS,
    ...options,
  }
  const deadline = Date.now() + resolvedOptions.timeoutMs
  let stableSince = 0
  let lastFingerprint = ''
  let lastSnapshot: DeepSeekMessageActionSnapshot | null = null

  while (Date.now() < deadline) {
    const snapshot = await captureDeepSeekMessageActionSnapshot(page)
    const fingerprint = JSON.stringify(snapshot)

    if (fingerprint === lastFingerprint) {
      if (stableSince === 0) {
        stableSince = Date.now()
      }
      if (Date.now() - stableSince >= resolvedOptions.stableWindowMs) {
        return snapshot
      }
    } else {
      lastFingerprint = fingerprint
      stableSince = 0
      lastSnapshot = snapshot
    }

    await delay(Math.min(resolvedOptions.pollIntervalMs, Math.max(deadline - Date.now(), 0)))
  }

  if (lastSnapshot) {
    return lastSnapshot
  }

  throw new Error('Timed out waiting for a stable DeepSeek message action snapshot.')
}

export async function resolveDeepSeekMessageActionControl(
  page: Page,
  target: DeepSeekMessageActionTarget,
): Promise<DeepSeekMessageActionControlMatch | null> {
  const snapshot = await captureDeepSeekMessageActionSnapshot(page)
  const item = snapshot.items.find(candidate => candidate.messageId === target.messageId)
  if (!item) {
    return null
  }

  return item.actions.find(action => action.action === target.action) ?? null
}

export async function clickDeepSeekMessageAction(
  page: Page,
  target: DeepSeekMessageActionTarget & {
    timeoutMs?: number | undefined
    pollIntervalMs?: number | undefined
  },
): Promise<DeepSeekMessageActionControlMatch> {
  const resolvedControl = await waitForDeepSeekMessageActionControl(page, target)
  const controlHandle = await resolveDeepSeekMessageActionControlHandle(
    page,
    target.messageId,
    resolvedControl.controlIndex ?? -1,
  )
  if (!controlHandle) {
    throw new Error(
      `Could not resolve DeepSeek message action handle for ${target.action} on message ${target.messageId}.`,
    )
  }

  try {
    await controlHandle.click()
  } finally {
    await controlHandle.dispose().catch(() => {})
  }

  return resolvedControl
}

async function waitForDeepSeekMessageActionControl(
  page: Page,
  target: DeepSeekMessageActionTarget & {
    timeoutMs?: number | undefined
    pollIntervalMs?: number | undefined
  },
): Promise<DeepSeekMessageActionControlMatch> {
  const timeoutMs = target.timeoutMs ?? DEFAULT_STABLE_MESSAGE_ACTION_SNAPSHOT_OPTIONS.timeoutMs
  const pollIntervalMs =
    target.pollIntervalMs ?? DEFAULT_STABLE_MESSAGE_ACTION_SNAPSHOT_OPTIONS.pollIntervalMs
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const resolvedControl = await resolveDeepSeekMessageActionControl(page, target)
    if (resolvedControl?.found) {
      return resolvedControl
    }

    await delay(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)))
  }

  throw new Error(
    `Timed out waiting for DeepSeek message action ${target.action} on message ${target.messageId}.`,
  )
}

async function collectVisibleDeepSeekMessageItems(page: Page): Promise<
  Array<{
    messageId: string
    selector: string
    className: string | null
    textPreview: string | null
  }>
> {
  return page.evaluate(source => {
    const helpers = window.eval(source) as {
      collectVisibleMessageItems: () => Array<{
        messageId: string
        selector: string
        className: string | null
        textPreview: string | null
      }>
    }
    return helpers.collectVisibleMessageItems()
  }, wrapDomHelpers('collectVisibleMessageItems'))
}

async function collectVisibleDeepSeekMessageActionControls(
  page: Page,
  messageId: string,
): Promise<
  Array<{
    controlIndex: number
    selector: string
    tagName: string
    role: string | null
    className: string | null
    label: string | null
    text: string | null
  }>
> {
  return page.evaluate(
    ({ source, requestedMessageId }) => {
      const helpers = window.eval(source) as {
        collectVisibleMessageActionControls: (
          messageId: string,
        ) => Array<{
          controlIndex: number
          selector: string
          tagName: string
          role: string | null
          className: string | null
          label: string | null
          text: string | null
        }>
      }
      return helpers.collectVisibleMessageActionControls(requestedMessageId)
    },
    {
      source: wrapDomHelpers('collectVisibleMessageActionControls'),
      requestedMessageId: messageId,
    },
  )
}

async function resolveDeepSeekMessageItemHandle(
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
      source: wrapDomHelpers('findMessageItem'),
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

async function resolveDeepSeekMessageActionControlHandle(
  page: Page,
  messageId: string,
  controlIndex: number,
): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    ({ source, requestedMessageId, requestedControlIndex }) => {
      const helpers = window.eval(source) as {
        findMessageItem: (messageId: string) => Element | null
      }
      const item = helpers.findMessageItem(requestedMessageId)
      if (!item) {
        return null
      }
      const controls = Array.from(item.querySelectorAll('[role="button"], button')).filter(
        element => {
          const visibleHelpers = window.eval(source) as {
            isVisible: (element: Element) => boolean
          }
          return visibleHelpers.isVisible(element)
        },
      )
      return controls[requestedControlIndex] ?? null
    },
    {
      source: wrapDomHelpers('findMessageItem', 'isVisible'),
      requestedMessageId: messageId,
      requestedControlIndex: controlIndex,
    },
  )
  const element = handle.asElement()
  if (!element) {
    await handle.dispose().catch(() => {})
    return null
  }
  return element as ElementHandle<Element>
}

async function readVisibleDeepSeekMessageTooltipAfterHover(
  page: Page,
  messageId: string,
  controlIndex: number,
): Promise<string | null> {
  const controlHandle = await resolveDeepSeekMessageActionControlHandle(page, messageId, controlIndex)
  if (!controlHandle) {
    return null
  }

  try {
    await controlHandle.hover()
    await delay(120)
    return page.evaluate(source => {
      const helpers = window.eval(source) as {
        readVisibleTooltipText: () => string | null
      }
      return helpers.readVisibleTooltipText()
    }, wrapDomHelpers('readVisibleTooltipText'))
  } finally {
    await controlHandle.dispose().catch(() => {})
  }
}

function wrapDomHelpers(...exports: string[]): string {
  return `(() => { ${DEEPSEEK_MESSAGE_ACTION_DOM_HELPERS}; return { ${exports.join(', ')} }; })()`
}

function inferDeepSeekMessageActionControlKind(input: {
  selector: string
  tagName: string
  role: string | null
  className: string | null
  label: string | null
  text: string | null
}): DeepSeekMessageActionControlKind {
  const className = input.className?.toLowerCase() ?? ''
  const text = input.text?.trim() ?? ''
  if (
    input.tagName === 'button' ||
    text.length > 0 ||
    !className.includes('icon-button')
  ) {
    return 'inline-button'
  }

  return 'icon-button'
}

function inferDeepSeekMessageActionRole(
  actions: DeepSeekMessageActionControlMatch[],
): DeepSeekMessageActionRole {
  const names = new Set(actions.map(action => action.action))
  if (names.has('edit') && !names.has('retry') && !names.has('regenerate') && !names.has('continue')) {
    return 'user'
  }
  if (
    names.has('retry') ||
    names.has('regenerate') ||
    names.has('continue') ||
    names.has('like') ||
    names.has('dislike') ||
    names.has('share')
  ) {
    return 'assistant'
  }
  return 'unknown'
}

function resolveDeepSeekMessageActionName(
  label: string | null | undefined,
): DeepSeekMessageActionName {
  const normalizedLabel = label?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  if (!normalizedLabel) {
    return 'unknown'
  }
  if (/(^| )copy($| )|复制/.test(normalizedLabel)) {
    return 'copy'
  }
  if (/(^| )edit($| )|编辑|修改/.test(normalizedLabel)) {
    return 'edit'
  }
  if (/(retry|try again|重试|再试|重新尝试)/.test(normalizedLabel)) {
    return 'retry'
  }
  if (/(regenerate|重新生成)/.test(normalizedLabel)) {
    return 'regenerate'
  }
  if (/(continue|继续)/.test(normalizedLabel)) {
    return 'continue'
  }
  if (/(^| )like($| )|点赞|喜欢/.test(normalizedLabel)) {
    return 'like'
  }
  if (/(dislike|点踩|不喜欢)/.test(normalizedLabel)) {
    return 'dislike'
  }
  if (/(share|分享)/.test(normalizedLabel)) {
    return 'share'
  }
  return 'unknown'
}
