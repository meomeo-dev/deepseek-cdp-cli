import type { HTTPResponse, Page } from 'puppeteer-core'
import {
  buildDeepSeekReleaseApiFingerprint,
  buildDeepSeekReleaseFingerprint,
  normalizeDeepSeekRouteFingerprint,
} from '../../domain/regression/deepSeekReleaseFingerprint.js'
import { DEEPSEEK_ENDPOINT_AUDIT_REGISTRY } from './deepSeekEndpointAuditRegistry.js'
import {
  captureDeepSeekComposerSnapshot,
  waitForStableDeepSeekComposerSnapshot,
} from './deepSeekComposerControls.js'
import { captureDeepSeekChatModeSurface } from './deepSeekChatModeControls.js'
import { captureDeepSeekMessageActionSnapshot } from './deepSeekMessageActionControls.js'
import type { WaitUntil } from '../../types/managed-chrome.types.js'
import type {
  DeepSeekComposerSnapshot,
  DeepSeekRouteKind,
} from '../../types/deepseek-controls.types.js'
import type { DeepSeekReleaseFingerprint } from '../../types/deepseek-release-fingerprint.types.js'

const CAPTURE_STATIC_ASSET_PATHS_SOURCE = String.raw`
(() => {
  const normalizeAssetUrl = value => {
    try {
      const parsed = new URL(value, window.location.href)
      return parsed.pathname.replace(/\/+$/, '') || parsed.pathname || '/'
    } catch {
      return null
    }
  }

  return Array.from(document.querySelectorAll('script[src], link[href]'))
    .map(element => {
      if (element instanceof HTMLScriptElement && element.src) {
        return normalizeAssetUrl(element.src)
      }
      if (element instanceof HTMLLinkElement && element.href) {
        return normalizeAssetUrl(element.href)
      }
      return null
    })
    .filter(value => Boolean(value))
})()
`

const CAPTURE_ROUTE_SHELL_PROJECTION_SOURCE = String.raw`
(({ routeKind: currentRouteKind, normalizedRoute }) => {
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim()
  const isVisible = element => {
    if (!(element instanceof HTMLElement)) {
      return Boolean(element)
    }
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
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const bucketCount = count => {
    if (count <= 0) {
      return '0'
    }
    if (count === 1) {
      return '1'
    }
    if (count <= 5) {
      return '2-5'
    }
    if (count <= 15) {
      return '6-15'
    }
    return '16+'
  }

  const bodyClassTokens = Array.from(
    new Set(
      normalize(document.body.getAttribute('class'))
        .split(/\s+/)
        .filter(Boolean),
    ),
  ).sort()
  const rootIds = Array.from(
    new Set(
      Array.from(document.querySelectorAll('body > [id], main[id], nav[id], aside[id], header[id]'))
        .map(element => normalize(element.getAttribute('id')))
        .filter(Boolean),
    ),
  ).sort()
  const visibleButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
    element => isVisible(element),
  ).length
  const messageItems = document.querySelectorAll('[data-virtual-list-item-key]').length
  const modals = Array.from(
    document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
  ).filter(element => isVisible(element)).length

  return {
    normalizedRoute,
    routeKind: currentRouteKind,
    pageTitle: normalize(document.title) || null,
    bodyClassTokens,
    rootIds,
    hasHeader: Array.from(document.querySelectorAll('header')).some(element =>
      isVisible(element),
    ),
    hasSidebar: Array.from(
      document.querySelectorAll('aside, nav, [data-sidebar], [data-testid*="sidebar"]'),
    ).some(element => isVisible(element)),
    hasComposerInput: Array.from(
      document.querySelectorAll(
        'textarea, [role="textbox"], [contenteditable="true"], [contenteditable="plaintext-only"]',
      ),
    ).some(element => isVisible(element)),
    hasVirtualMessageList: messageItems > 0,
    visibleButtonBucket: bucketCount(visibleButtons),
    messageItemBucket: bucketCount(messageItems),
    modalBucket: bucketCount(modals),
  }
})
`

export async function captureDeepSeekReleaseFingerprintOnPage(
  page: Page,
  input: {
    targetUrl?: string | undefined
    waitUntil?: WaitUntil | undefined
    captureMessageActions?: boolean | undefined
    stableComposerTimeoutMs?: number | undefined
  } = {},
): Promise<DeepSeekReleaseFingerprint> {
  const targetUrl = (input.targetUrl ?? page.url()) || 'https://chat.deepseek.com/'
  const waitUntil = input.waitUntil ?? 'domcontentloaded'
  const response = await navigateForFingerprintCapture(page, targetUrl, waitUntil)
  const entryDocumentHtml =
    (await response?.text().catch(() => null)) ?? (await page.content())
  const composerSnapshot = await waitForStableDeepSeekComposerSnapshot(page, {
    timeoutMs: input.stableComposerTimeoutMs ?? 8_000,
  }).catch(() => captureDeepSeekComposerSnapshot(page))
  const modeSurface = await captureDeepSeekChatModeSurface(page).catch(() => null)
  const routeShellProjection = await captureRouteShellProjection(
    page,
    composerSnapshot.routeKind,
  )
  const staticAssetPaths = await captureStaticAssetPaths(page)
  const messageActionSnapshot = input.captureMessageActions
    ? await captureDeepSeekMessageActionSnapshot(page).catch(() => null)
    : null

  return buildDeepSeekReleaseFingerprint({
    ui: {
      capturedAtUrl: page.url(),
      routeKind: composerSnapshot.routeKind,
      entryDocumentUrl: response?.url() ?? targetUrl,
      entryDocumentStatus: response?.status() ?? null,
      entryDocumentHtml,
      staticAssetPaths,
      routeShellProjection,
      modeSurfaceProjection: modeSurface
        ? {
            heading: modeSurface.heading,
            modeSelectorVisible: modeSurface.modeSelectorVisible,
            availableModes: modeSurface.availableModes,
            activeMode: modeSurface.activeMode,
          }
        : undefined,
      composerSignature: buildComposerSignature(composerSnapshot),
      messageActionSignatures: buildMessageActionSignatures(messageActionSnapshot),
    },
    apiFingerprint: buildDeepSeekReleaseApiFingerprint(DEEPSEEK_ENDPOINT_AUDIT_REGISTRY),
  })
}

async function navigateForFingerprintCapture(
  page: Page,
  targetUrl: string,
  waitUntil: WaitUntil,
): Promise<HTTPResponse | null> {
  if (page.url() === targetUrl && targetUrl.length > 0) {
    return page.reload({ waitUntil })
  }

  return page.goto(targetUrl, { waitUntil })
}

async function captureStaticAssetPaths(page: Page): Promise<string[]> {
  const assetPaths = await page.evaluate(
    source => window.eval(source) as Array<string | null>,
    CAPTURE_STATIC_ASSET_PATHS_SOURCE,
  )

  return [...new Set(assetPaths.filter((value): value is string => typeof value === 'string'))].sort()
}

async function captureRouteShellProjection(
  page: Page,
  routeKind: DeepSeekRouteKind,
): Promise<RouteShellProjection> {
  const payload = {
    routeKind,
    normalizedRoute: normalizeDeepSeekRouteFingerprint(page.url()),
  }

  return page.evaluate(
    ({ source, payload }): RouteShellProjection => {
      const evaluated = window.eval(source) as unknown
      if (typeof evaluated !== 'function') {
        throw new Error('Route shell projection source did not evaluate to a function.')
      }
      return (evaluated as (input: typeof payload) => RouteShellProjection)(payload)
    },
    {
      source: CAPTURE_ROUTE_SHELL_PROJECTION_SOURCE,
      payload,
    },
  )
}

interface RouteShellProjection {
  normalizedRoute: string
  routeKind: DeepSeekRouteKind
  pageTitle: string | null
  bodyClassTokens: string[]
  rootIds: string[]
  hasHeader: boolean
  hasSidebar: boolean
  hasComposerInput: boolean
  hasVirtualMessageList: boolean
  visibleButtonBucket: string
  messageItemBucket: string
  modalBucket: string
}

function buildComposerSignature(
  snapshot: DeepSeekComposerSnapshot,
): Record<string, string> {
  return {
    normalizedRoute: normalizeDeepSeekRouteFingerprint(snapshot.pageUrl),
    routeKind: snapshot.routeKind,
    composerInput: describeControl(snapshot.composerInput.found, snapshot.composerInput.selector),
    sendOrStopButton: describeControl(
      snapshot.sendOrStopButton.found,
      snapshot.sendOrStopButton.selector,
      snapshot.sendOrStopButton.state,
    ),
    deepThinkToggle: describeControl(
      snapshot.deepThinkToggle.found,
      snapshot.deepThinkToggle.selector,
      snapshot.deepThinkToggle.state,
    ),
    searchToggle: describeControl(
      snapshot.searchToggle.found,
      snapshot.searchToggle.selector,
      snapshot.searchToggle.state,
    ),
    fileButton: describeControl(snapshot.fileButton.found, snapshot.fileButton.selector),
  }
}

function buildMessageActionSignatures(
  snapshot: Awaited<ReturnType<typeof captureDeepSeekMessageActionSnapshot>> | null,
): string[] {
  if (!snapshot) {
    return []
  }

  const grouped = new Map<string, number>()
  for (const item of snapshot.items) {
    const actionSignature = item.actions
      .map(action => `${action.action}:${action.controlKind ?? 'unknown'}`)
      .sort()
      .join(',')
    const signature = `role=${item.role}|actions=${actionSignature || 'none'}`
    grouped.set(signature, (grouped.get(signature) ?? 0) + 1)
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([signature, count]) => `${count}x:${signature}`)
}

function describeControl(
  found: boolean,
  selector: string | null,
  state?: string,
): string {
  return [
    found ? 'found' : 'missing',
    selector ?? 'none',
    state ?? 'na',
  ].join(':')
}
