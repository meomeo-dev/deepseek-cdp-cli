import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, Page } from 'puppeteer-core'
import type {
  DeepSeekSelectorDriftAuditDialogButton,
  DeepSeekSelectorDriftAuditMenuOption,
  DeepSeekSelectorDriftAuditVisibleControl,
  DeepSeekSelectorDriftSidebarSessionAudit,
} from '../../types/deepseek-selector-drift-audit.types.js'

interface ClickPoint {
  x: number
  y: number
}

export async function captureDeepSeekSidebarSessionAudit(
  page: Page,
  input: {
    sessionId: string
    timeoutMs: number
  },
): Promise<DeepSeekSelectorDriftSidebarSessionAudit> {
  const triggerPath: string[] = []
  const sessionAnchor = await waitForSidebarSessionAnchor(page, input.sessionId, input.timeoutMs)

  try {
    await sessionAnchor.hover()
    await delay(500)
    triggerPath.push('hover target sidebar session item')

    const hoverControls = await captureSidebarHoverControls(page, input.sessionId)
    await clickSidebarSessionOverflowHotspot(page, sessionAnchor)
    triggerPath.push('click target session overflow hotspot')

    const menuOptions = await waitForSidebarMenuOptions(page, input.timeoutMs)
    const overflowMenuObserved = menuOptions.length > 0

    let deleteDialogObserved = false
    let deleteDialogTitle: string | null = null
    let deleteDialogButtons: DeepSeekSelectorDriftAuditDialogButton[] = []
    let deleteDialogDismissed = false

    if (overflowMenuObserved) {
      const deleteClicked = await clickSidebarDropdownOptionByLabel(page, 'Delete', input.timeoutMs)
      if (deleteClicked) {
        triggerPath.push('click Delete menu action')
        const dialog = await waitForDeleteDialogSnapshot(page, input.timeoutMs)
        deleteDialogObserved = dialog.observed
        deleteDialogTitle = dialog.title
        deleteDialogButtons = dialog.buttons
        if (dialog.observed) {
          deleteDialogDismissed = await dismissDeleteDialog(page, input.timeoutMs)
          if (deleteDialogDismissed) {
            triggerPath.push('dismiss Delete dialog')
          }
        }
      }
    }

    return {
      pageUrl: page.url(),
      sessionId: input.sessionId,
      anchorSelector: `a[href*="/s/${input.sessionId}"]`,
      hoverControls,
      overflowMenuObserved,
      menuOptions,
      deleteDialogObserved,
      deleteDialogTitle,
      deleteDialogButtons,
      deleteDialogDismissed,
      triggerPath,
    }
  } finally {
    await sessionAnchor.dispose().catch(() => {})
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

async function captureSidebarHoverControls(
  page: Page,
  sessionId: string,
): Promise<DeepSeekSelectorDriftAuditVisibleControl[]> {
  return page.evaluate(`(() => {
    const sessionId = ${JSON.stringify(sessionId)};
    const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
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
      );
    const inferSelector = element => {
      if (element.id) return '#' + element.id;
      if (element.getAttribute('data-testid')) {
        return '[data-testid="' + element.getAttribute('data-testid') + '"]';
      }
      if (element.tagName === 'BUTTON') return 'button';
      if (element.getAttribute('role') === 'button') return '[role="button"]';
      return element.tagName.toLowerCase();
    };
    const inferControlKind = element => {
      const text = normalize(element.textContent);
      const className = normalize(element.getAttribute('class')).toLowerCase();
      return text.length > 0 || !className.includes('icon-button') ? 'inline-button' : 'icon-button';
    };

    const anchor = document.querySelector('a[href*="/s/' + sessionId + '"]');
    if (!anchor) return [];

    const root =
      anchor.closest(
        'li, [role="listitem"], [data-testid*="session"], [data-testid*="sidebar"], [data-node-key]',
      ) ??
      anchor.parentElement ??
      anchor;

    return Array.from(root.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .map(element => ({
        selector: inferSelector(element),
        label: readLabel(element) || null,
        text: normalize(element.textContent) || null,
        role: element.getAttribute('role'),
        className: normalize(element.getAttribute('class')) || null,
        controlKind: inferControlKind(element),
      }));
  })()`) as Promise<DeepSeekSelectorDriftAuditVisibleControl[]>
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

async function waitForSidebarMenuOptions(
  page: Page,
  timeoutMs: number,
): Promise<DeepSeekSelectorDriftAuditMenuOption[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const menuOptions = await page.evaluate(`(() => {
      const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
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
      const inferSelector = element => {
        if (element.id) return '#' + element.id;
        if (element.getAttribute('data-testid')) {
          return '[data-testid="' + element.getAttribute('data-testid') + '"]';
        }
        if (element.getAttribute('role') === 'menuitem') return '[role="menuitem"]';
        return element.tagName.toLowerCase();
      };

      return Array.from(
        document.querySelectorAll('.ds-dropdown-menu-option, [role="menuitem"], .ds-dropdown-menu-option__label'),
      )
        .filter(isVisible)
        .map(element => ({
          selector: inferSelector(element),
          label: normalize(element.textContent) || null,
          className: normalize(element.getAttribute('class')) || null,
        }))
        .filter(item => item.label);
    })()`) as DeepSeekSelectorDriftAuditMenuOption[]

    if (menuOptions.length > 0) {
      return dedupeMenuOptions(menuOptions)
    }

    await delay(150)
  }

  return []
}

async function clickSidebarDropdownOptionByLabel(
  page: Page,
  label: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const acceptedLabels = resolveSelectorAuditLabelAliases(label)

  while (Date.now() < deadline) {
    const coordinates = await page.evaluate(`(() => {
      const acceptedLabels = ${JSON.stringify(acceptedLabels)};
      const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
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

      const candidates = Array.from(
        document.querySelectorAll('.ds-dropdown-menu-option, .ds-dropdown-menu-option__label, [role="menuitem"]'),
      ).filter(isVisible);
      const target = candidates.find(
        element => acceptedLabels.includes(normalize(element.textContent).toLowerCase()),
      );
      if (!target) return null;
      const clickTarget = target.closest('.ds-dropdown-menu-option, [role="menuitem"]') ?? target;
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

async function waitForDeleteDialogSnapshot(
  page: Page,
  timeoutMs: number,
): Promise<{
  observed: boolean
  title: string | null
  buttons: DeepSeekSelectorDriftAuditDialogButton[]
}> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const dialog = await page.evaluate(`(() => {
      const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
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
      const inferSelector = element => {
        if (element.id) return '#' + element.id;
        if (element.getAttribute('data-testid')) {
          return '[data-testid="' + element.getAttribute('data-testid') + '"]';
        }
        if (element.tagName === 'BUTTON') return 'button';
        if (element.getAttribute('role') === 'button') return '[role="button"]';
        return element.tagName.toLowerCase();
      };
      const inferIntent = element => {
        const className = normalize(element.getAttribute('class')).toLowerCase();
        const label = normalize(element.textContent).toLowerCase();
        if (className.includes('danger') || label === 'delete' || label === '删除') return 'danger';
        if (label === 'cancel' || label === '取消') return 'neutral';
        return 'unknown';
      };

      const dialog = Array.from(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
      ).find(isVisible);
      if (!dialog) {
        return { observed: false, title: null, buttons: [] };
      }

      const title =
        Array.from(dialog.querySelectorAll('h1, h2, h3, [role="heading"]'))
          .map(element => normalize(element.textContent))
          .find(Boolean) ?? null;

      const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .map(element => ({
          selector: inferSelector(element),
          label: normalize(element.textContent) || null,
          className: normalize(element.getAttribute('class')) || null,
          intent: inferIntent(element),
        }));

      return { observed: true, title, buttons };
    })()`) as {
      observed: boolean
      title: string | null
      buttons: DeepSeekSelectorDriftAuditDialogButton[]
    }

    if (dialog.observed) {
      return dialog
    }

    await delay(150)
  }

  return {
    observed: false,
    title: null,
    buttons: [],
  }
}

async function dismissDeleteDialog(page: Page, timeoutMs: number): Promise<boolean> {
  const cancelClicked = await clickVisibleDialogButton(page, 'Cancel', timeoutMs)
  if (cancelClicked) {
    await delay(250)
    return true
  }

  await page.keyboard.press('Escape').catch(() => {})
  await delay(250)
  const dialogStillVisible = await page.evaluate(`(() => {
    const isVisible = element => {
      if (!(element instanceof HTMLElement)) return Boolean(element);
      if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(isVisible);
  })()`)
  return dialogStillVisible !== true
}

async function clickVisibleDialogButton(
  page: Page,
  label: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const acceptedLabels = resolveSelectorAuditLabelAliases(label)

  while (Date.now() < deadline) {
    const coordinates = await page.evaluate(`(() => {
      const acceptedLabels = ${JSON.stringify(acceptedLabels)};
      const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
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
      if (!dialog) return null;

      const button = Array.from(dialog.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .find(element => acceptedLabels.includes(normalize(element.textContent).toLowerCase()));
      if (!button) return null;

      const rect = button.getBoundingClientRect();
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

function dedupeMenuOptions(
  options: DeepSeekSelectorDriftAuditMenuOption[],
): DeepSeekSelectorDriftAuditMenuOption[] {
  const seen = new Set<string>()
  const deduped: DeepSeekSelectorDriftAuditMenuOption[] = []
  for (const option of options) {
    const fingerprint = `${option.selector}:${option.label ?? ''}:${option.className ?? ''}`
    if (seen.has(fingerprint)) {
      continue
    }
    seen.add(fingerprint)
    deduped.push(option)
  }
  return deduped
}

function resolveSelectorAuditLabelAliases(label: string): string[] {
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
