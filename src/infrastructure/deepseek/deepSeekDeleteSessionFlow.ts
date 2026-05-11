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

interface ClickPoint {
  x: number
  y: number
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
    await openDeleteConfirmationDialog(page, sessionAnchor, input.timeoutMs, triggerPath)
  } finally {
    await sessionAnchor.dispose().catch(() => {})
  }

  const deleteResponsePromise = waitForDeleteSessionExchange(page, {
    timeoutMs: input.timeoutMs,
  })
  await clickDeleteConfirmationButton(page, input.timeoutMs)
  triggerPath.push('click Delete confirmation button')

  const capture = await deleteResponsePromise
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

async function clickSidebarSessionOverflowHotspot(
  page: Page,
  sessionAnchor: ElementHandle<Element>,
): Promise<void> {
  const box = await sessionAnchor.boundingBox()
  if (!box) {
    throw new Error('Target sidebar session anchor does not expose a clickable bounding box.')
  }

  const clickX = box.x + Math.max(box.width - 14, box.width * 0.85)
  const clickY = box.y + box.height / 2
  await page.mouse.move(clickX, clickY)
  await delay(150)
  await page.mouse.click(clickX, clickY)
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
        document.querySelectorAll('.ds-dropdown-menu-option, .ds-dropdown-menu-option__label'),
      ).filter(isVisible);
      const target = candidates.find(
        element => acceptedLabels.includes(normalize(element.textContent).toLowerCase()),
      );
      if (!target) return null;
      const clickTarget = target.closest('.ds-dropdown-menu-option') ?? target;
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
        document.querySelectorAll('button.ds-basic-button--danger, button[role="button"], button'),
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
  timeoutMs: number,
  triggerPath: string[],
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let hovered = false

  while (Date.now() < deadline) {
    await sessionAnchor.hover()
    await delay(500)
    if (!hovered) {
      triggerPath.push('hover target sidebar session item')
      hovered = true
    }

    await clickSidebarSessionOverflowHotspot(page, sessionAnchor)
    if (!triggerPath.includes('click target session overflow hotspot')) {
      triggerPath.push('click target session overflow hotspot')
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
    const hasDeleteButton = buttonLabels.some(label => ['delete', '删除'].includes(label));
    const hasCancelButton = buttonLabels.some(label => ['cancel', '取消'].includes(label));
    const hasDeleteCopy =
      dialogText.includes('delete chat') ||
      dialogText.includes('share links from it will be disabled') ||
      dialogText.includes('永久删除对话') ||
      dialogText.includes('确认删除吗');
    return hasDeleteButton && hasCancelButton && hasDeleteCopy;
  })()`)
  return matched === true
}

function resolveDeleteUiLabelAliases(label: string): string[] {
  const normalized = label.trim().toLowerCase()
  switch (normalized) {
    case 'delete':
      return ['delete', '删除']
    case 'cancel':
      return ['cancel', '取消']
    default:
      return [normalized]
  }
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
