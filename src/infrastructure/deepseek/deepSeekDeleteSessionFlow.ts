import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, Page } from 'puppeteer-core'
import type {
  DeepSeekDeleteSessionAuditFixture,
  DeepSeekDeleteSessionResult,
} from '../../types/deepseek-chat-session-delete.types.js'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'

const DEEPSEEK_DELETE_SESSION_ENDPOINT = '/api/v0/chat_session/delete'

interface DeleteSessionActionResult {
  triggerPath: string[]
  capture: DeepSeekDeleteSessionAuditFixture
}

type DeleteSessionWaitResult =
  | { capture: CapturedDeleteSessionExchange; error: null }
  | { capture: null; error: unknown }

interface ClickPoint {
  x: number
  y: number
}

interface ClickPointWithMethod extends ClickPoint {
  method: 'control' | 'hotspot'
}

export async function deleteDeepSeekSessionOnPage(
  page: Page,
  input: {
    requestedSessionId: string
    authoritativeSessionId: string
    finalUrl: string
    sessionFile: string
    timeoutMs: number
    actionLabel: string
    allowOptionName: string
    confirmationText: string
  },
  logger?: RuntimeLogger,
): Promise<DeleteSessionActionResult> {
  const triggerPath: string[] = []

  const sessionAnchor = await waitForSidebarSessionAnchor(page, input.authoritativeSessionId, input.timeoutMs)
  try {
    await openDeleteConfirmationDialog(
      page,
      sessionAnchor,
      input.authoritativeSessionId,
      input.timeoutMs,
      triggerPath,
    )
  } finally {
    await sessionAnchor.dispose().catch(() => {})
  }

  const deleteResponsePromise: Promise<DeleteSessionWaitResult> = waitForDeleteSessionExchange(page, {
    timeoutMs: input.timeoutMs,
  }).then(
    capture => ({ capture, error: null }),
    (error: unknown) => ({ capture: null, error }),
  )
  await clickDeleteConfirmationButton(page, input.timeoutMs)
  triggerPath.push('click Delete confirmation button')

  const deleteResponse = await deleteResponsePromise
  if (deleteResponse.error) {
    throw normalizeDeleteSessionError(deleteResponse.error)
  }
  const capture = deleteResponse.capture
  if (!capture) {
    throw new Error('DeepSeek delete response capture was unavailable.')
  }
  logger?.info('DeepSeek session delete completed on page', {
    sessionId: input.authoritativeSessionId,
    status: capture.response.status,
  })

  return {
    triggerPath,
    capture: {
      endpoint: DEEPSEEK_DELETE_SESSION_ENDPOINT,
      target: {
        requestedSessionId: input.requestedSessionId,
        authoritativeSessionId: input.authoritativeSessionId,
        finalUrl: input.finalUrl,
        sessionFile: input.sessionFile,
      },
      page: {
        url: page.url(),
      },
      interaction: {
        triggerPath,
        destructiveGuard: {
          actionLabel: input.actionLabel,
          allowOptionName: input.allowOptionName,
          confirmationText: input.confirmationText,
        },
      },
      request: capture.request,
      response: capture.response,
    },
  }
}

function normalizeDeleteSessionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export async function saveDeepSeekDeleteSessionAuditFixture(
  outputFile: string,
  fixture: DeepSeekDeleteSessionAuditFixture,
): Promise<void> {
  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
}

export function withDeleteSessionAuditOutput(
  result: DeleteSessionActionResult,
  input: {
    auditOutputFile?: string
    localSessionFileDeleted: boolean
  },
): DeepSeekDeleteSessionResult {
  return {
    ...result.capture,
    auditOutputFile: input.auditOutputFile ?? null,
    localSessionFileDeleted: input.localSessionFileDeleted,
  }
}

interface CapturedDeleteSessionExchange {
  request: {
    method: string
    url: string
    postData: Record<string, unknown> | string | null
  }
  response: {
    status: number
    contentType: string | null
    bodyText: string
  }
}

async function waitForSidebarSessionAnchor(
  page: Page,
  sessionId: string,
  timeoutMs: number,
): Promise<ElementHandle<Element>> {
  const deadline = Date.now() + timeoutMs
  const selector = `a[href*="/s/${sessionId}"]`

  while (Date.now() < deadline) {
    const element = await page.$(selector)
    if (element) {
      const box = await element.boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        return element
      }
      await element.dispose().catch(() => {})
    }
    await delay(150)
  }

  throw new Error(`Timed out waiting for sidebar session anchor ${sessionId}.`)
}

async function waitForDeleteSessionExchange(
  page: Page,
  input: {
    timeoutMs: number
  },
): Promise<CapturedDeleteSessionExchange> {
  const response = await page.waitForResponse(
    candidate => candidate.url().includes(DEEPSEEK_DELETE_SESSION_ENDPOINT),
    {
      timeout: input.timeoutMs,
    },
  )

  return {
    request: {
      method: response.request().method(),
      url: response.request().url(),
      postData: parseRequestPostData(response.request().postData()),
    },
    response: {
      status: response.status(),
      contentType: response.headers()['content-type'] ?? null,
      bodyText: await response.text(),
    },
  }
}

function parseRequestPostData(
  postData: string | null | undefined,
): Record<string, unknown> | string | null {
  if (postData === null || postData === undefined) {
    return null
  }

  try {
    return JSON.parse(postData) as Record<string, unknown>
  } catch {
    return postData
  }
}

async function hoverSidebarSessionItem(
  page: Page,
  sessionAnchor: ElementHandle<Element>,
  sessionId: string,
): Promise<void> {
  const box = await resolveSidebarSessionItemBox(page, sessionId)
  if (!box) {
    await sessionAnchor.hover()
    return
  }

  await page.mouse.move(
    box.x + Math.min(Math.max(box.width / 2, 8), box.width - 8),
    box.y + box.height / 2,
  )
}

async function clickSidebarSessionOverflow(
  page: Page,
  sessionAnchor: ElementHandle<Element>,
  sessionId: string,
): Promise<'control' | 'hotspot'> {
  const control = await resolveSidebarSessionOverflowControlClickPoint(page, sessionId)
  if (control) {
    await page.mouse.move(control.x, control.y)
    await delay(150)
    await page.mouse.click(control.x, control.y)
    return control.method
  }

  const hotspot = await resolveSidebarSessionOverflowHotspotClickPoint(
    page,
    sessionAnchor,
    sessionId,
  )
  await page.mouse.move(hotspot.x, hotspot.y)
  await delay(150)
  await page.mouse.click(hotspot.x, hotspot.y)
  return hotspot.method
}

async function resolveSidebarSessionItemBox(
  page: Page,
  sessionId: string,
): Promise<ClickBox | null> {
  const box = await page.evaluate(`(() => {
    const sessionId = ${JSON.stringify(sessionId)}
    const anchor = document.querySelector('a[href*="/s/' + sessionId + '"]')
    if (!anchor) return null
    const root =
      anchor.closest(
        [
          'li',
          '[role="listitem"]',
          '[data-testid*="session"]',
          '[data-testid*="conversation"]',
          '[data-node-key]',
          '[class*="session"]',
          '[class*="conversation"]',
          '[class*="chat-item"]',
          '[class*="history-item"]',
        ].join(', '),
      ) ??
      anchor
    const rect = root.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })()`)

  return isClickBox(box) ? box : null
}

interface ClickBox extends ClickPoint {
  width: number
  height: number
}

async function resolveSidebarSessionOverflowControlClickPoint(
  page: Page,
  sessionId: string,
): Promise<ClickPointWithMethod | null> {
  const point = await page.evaluate(`(() => {
    const sessionId = ${JSON.stringify(sessionId)}
    const anchor = document.querySelector('a[href*="/s/' + sessionId + '"]')
    if (!anchor) return null
    const whitespacePattern = new RegExp('\\\\s+', 'g')
    const normalize = value =>
      (value ?? '').replace(whitespacePattern, ' ').trim()
    const isVisible = element => {
      if (!(element instanceof HTMLElement)) return Boolean(element)
      if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
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
      if (Number.parseFloat(style.opacity || '1') === 0) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const readLabel = element =>
      normalize(
        [
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('data-testid'),
          element.querySelector('svg title')?.textContent,
          element.textContent,
        ]
          .filter(Boolean)
          .join(' '),
      )
    const root =
      anchor.closest(
        [
          'li',
          '[role="listitem"]',
          '[data-testid*="session"]',
          '[data-testid*="conversation"]',
          '[data-node-key]',
          '[class*="session"]',
          '[class*="conversation"]',
          '[class*="chat-item"]',
          '[class*="history-item"]',
        ].join(', '),
      ) ?? anchor
    const anchorRect = anchor.getBoundingClientRect()
    const rowTop = anchorRect.top - Math.max(8, anchorRect.height * 0.5)
    const rowBottom = anchorRect.bottom + Math.max(8, anchorRect.height * 0.5)
    const anchorCenterY = anchorRect.top + anchorRect.height / 2

    const candidates = Array.from(
      root.querySelectorAll(
        [
          'button',
          '[role="button"]',
          '[aria-haspopup]',
          '[aria-label]',
          '[title]',
          '[data-testid]',
          '[class*="more"]',
          '[class*="menu"]',
          '[class*="ellipsis"]',
          '[class*="operate"]',
          '[class*="action"]',
        ].join(', '),
      ),
    )
      .filter(element => element !== anchor)
      .filter(isVisible)
      .map(element => {
        const rect = element.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        const label = readLabel(element).toLowerCase()
        const className = normalize(element.getAttribute('class')).toLowerCase()
        const explicitMenu =
          /more|menu|ellipsis|overflow|dropdown|popover|operate|action|更多|操作|菜单/.test(
            label,
          ) ||
          /more|menu|ellipsis|overflow|dropdown|popover|operate|action/.test(
            className,
          ) ||
          element.getAttribute('aria-haspopup') === 'menu' ||
          element.getAttribute('aria-expanded') !== null
        const searchLike = /search|搜索/.test(label)
        const score =
          (explicitMenu ? 100 : 0) +
          (rect.left >= anchorRect.left + anchorRect.width * 0.55 ? 25 : 0) +
          (normalize(element.textContent).length === 0 ? 10 : 0) -
          (searchLike ? 100 : 0) -
          Math.abs(centerY - anchorCenterY) / 10

        return { element, rect, centerY, score }
      })
      .filter(candidate => candidate.centerY >= rowTop && candidate.centerY <= rowBottom)
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score)

    const target = candidates[0]
    if (!target) {
      return null
    }

    return {
      x: target.rect.x + target.rect.width / 2,
      y: target.rect.y + target.rect.height / 2,
      method: 'control',
    }
  })()`)

  return isClickPointWithMethod(point) ? point : null
}

async function resolveSidebarSessionOverflowHotspotClickPoint(
  page: Page,
  sessionAnchor: ElementHandle<Element>,
  sessionId: string,
): Promise<ClickPointWithMethod> {
  const box = await resolveSidebarSessionItemBox(page, sessionId) ??
    await sessionAnchor.boundingBox()
  if (!box) {
    throw new Error('Target sidebar session anchor does not expose a clickable bounding box.')
  }

  return {
    x: box.x + Math.max(box.width - 14, box.width * 0.85),
    y: box.y + box.height / 2,
    method: 'hotspot',
  }
}

async function tryClickSidebarDropdownOptionByLabel(
  page: Page,
  label: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const acceptedLabels = resolveDeleteUiLabelAliases(label)

  while (Date.now() < deadline) {
    const coordinates = await page.evaluate(`(() => {
      const acceptedLabels = ${JSON.stringify(acceptedLabels)};
      const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = element => {
        if (!(element instanceof HTMLElement)) return true;
        if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
          return false;
        }
        if (Number.parseFloat(style.opacity || '1') === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const candidates = Array.from(
        document.querySelectorAll([
          '.ds-dropdown-menu-option',
          '.ds-dropdown-menu-option__label',
          '[role="menuitem"]',
          '[data-radix-collection-item]',
          '[cmdk-item]',
          '[data-menu-item]',
          '[class*="dropdown"] button',
          '[class*="dropdown"] [role="button"]',
          '[class*="popover"] button',
          '[class*="popover"] [role="button"]',
          '[class*="menu"] button',
          '[class*="menu"] [role="button"]',
        ].join(', ')),
      ).filter(isVisible);
      const target = candidates.find(
        element => acceptedLabels.includes(normalize(element.textContent).toLowerCase()) ||
          acceptedLabels.some(label => label !== 'delete' && normalize(element.textContent).toLowerCase().includes(label)),
      );
      if (!target) return null;
      const clickTarget =
        target.closest('.ds-dropdown-menu-option, [role="menuitem"], [data-radix-collection-item], [cmdk-item], [data-menu-item], button, [role="button"]') ??
        target;
      const rect = clickTarget.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)

    if (isClickPoint(coordinates)) {
      await page.mouse.move(coordinates.x, coordinates.y)
      await delay(100)
      await page.mouse.click(coordinates.x, coordinates.y)
      return true
    }

    await delay(150)
  }

  return false
}

async function clickDeleteConfirmationButton(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const acceptedLabels = resolveDeleteUiLabelAliases('Delete')

  while (Date.now() < deadline) {
    const coordinates = await page.evaluate(`(() => {
      const acceptedLabels = ${JSON.stringify(acceptedLabels)};
      const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = element => {
        if (!(element instanceof HTMLElement)) return true;
        if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
          return false;
        }
        if (Number.parseFloat(style.opacity || '1') === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const target = Array.from(
        document.querySelectorAll(
          [
            'button.ds-basic-button--danger',
            'button[role="button"]',
            'button',
            '[role="button"]',
          ].join(', '),
        ),
      )
        .filter(isVisible)
        .find(element => acceptedLabels.includes(normalize(element.textContent).toLowerCase()));
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)

    if (isClickPoint(coordinates)) {
      await page.mouse.move(coordinates.x, coordinates.y)
      await delay(100)
      await page.mouse.click(coordinates.x, coordinates.y)
      return
    }

    await delay(150)
  }

  throw new Error('Timed out waiting for Delete confirmation button.')
}

async function openDeleteConfirmationDialog(
  page: Page,
  sessionAnchor: ElementHandle<Element>,
  sessionId: string,
  timeoutMs: number,
  triggerPath: string[],
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let hovered = false

  while (Date.now() < deadline) {
    await hoverSidebarSessionItem(page, sessionAnchor, sessionId)
    await delay(500)
    if (!hovered) {
      triggerPath.push('hover target sidebar session item')
      hovered = true
    }

    const overflowClickMethod = await clickSidebarSessionOverflow(
      page,
      sessionAnchor,
      sessionId,
    )
    const overflowTrigger =
      overflowClickMethod === 'control'
        ? 'click target session overflow control'
        : 'click target session overflow hotspot'
    if (!triggerPath.includes(overflowTrigger)) {
      triggerPath.push(overflowTrigger)
    }

    const dropdownClicked = await tryClickSidebarDropdownOptionByLabel(page, 'Delete', 2_500)
    if (dropdownClicked && !triggerPath.includes('click Delete menu action')) {
      triggerPath.push('click Delete menu action')
    }

    if (await hasVisibleDeleteConfirmationDialog(page)) {
      return
    }

    await delay(400)
  }

  throw new Error('Timed out waiting for Delete confirmation dialog.')
}

async function hasVisibleDeleteConfirmationDialog(page: Page): Promise<boolean> {
  const matched = await page.evaluate(`(() => {
    const normalize = value => (value ?? '').replace(/\\s+/g, ' ').replace(/[’']/g, "'").trim();
    const isVisible = element => {
      if (!(element instanceof HTMLElement)) return Boolean(element);
      if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      if (Number.parseFloat(style.opacity || '1') === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const dialog = Array.from(
      document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
    ).find(isVisible);
    if (!dialog) return false;
    const dialogText = normalize(dialog.textContent).toLowerCase();
    const buttonLabels = Array.from(dialog.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .map(element => normalize(element.textContent).toLowerCase());
      const hasDeleteButton = buttonLabels.some(label => ['delete', 'delete chat', 'delete conversation', '删除', '删除对话', '删除此对话', '删除该对话'].includes(label));
      const hasCancelButton = buttonLabels.some(label => ['cancel', '取消'].includes(label));
      const hasDeleteCopy =
        dialogText.includes('delete chat') ||
        dialogText.includes('delete conversation') ||
        dialogText.includes('share links from it will be disabled') ||
        dialogText.includes('永久删除对话') ||
        dialogText.includes('确认删除吗') ||
        dialogText.includes('删除此对话') ||
        dialogText.includes('删除该对话') ||
        dialogText.includes('删除对话');
      return hasDeleteButton && hasCancelButton && (hasDeleteCopy || buttonLabels.length >= 2);
  })()`)
  return matched === true
}

function resolveDeleteUiLabelAliases(label: string): string[] {
  const normalized = label.trim().toLowerCase()
  switch (normalized) {
    case 'delete':
      return ['delete', 'delete chat', 'delete conversation', '删除', '删除对话', '删除此对话', '删除该对话']
    case 'cancel':
      return ['cancel', '取消']
    default:
      return [normalized]
  }
}

function isClickPointWithMethod(value: unknown): value is ClickPointWithMethod {
  const candidate = value as ClickPoint & {
    method?: unknown
  }
  return (
    isClickPoint(value) &&
    (candidate.method === 'control' || candidate.method === 'hotspot')
  )
}

function isClickBox(value: unknown): value is ClickBox {
  if (!isClickPoint(value)) {
    return false
  }

  const candidate = value as {
    width?: unknown
    height?: unknown
  }
  return typeof candidate.width === 'number' && typeof candidate.height === 'number'
}

function isClickPoint(value: unknown): value is ClickPoint {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as {
    x?: unknown
    y?: unknown
  }
  return typeof candidate.x === 'number' && typeof candidate.y === 'number'
}
