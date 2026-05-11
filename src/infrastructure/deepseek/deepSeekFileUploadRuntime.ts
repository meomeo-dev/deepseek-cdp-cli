import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, HTTPResponse, Page } from 'puppeteer-core'
import type { RuntimeLogger } from '../../shared/logging/runtimeLogger.js'
import type {
  DeepSeekComposerFileInput,
  DeepSeekFetchFilesObservation,
  DeepSeekFileCapturedExchange,
  DeepSeekUploadComposerFilesInput,
  DeepSeekUploadedFileResult,
  DeepSeekFileUploadBatchResult,
} from '../../types/deepseek-file.types.js'
import {
  cloneFileCapturedExchange,
  cloneUploadedFileResult,
  finalizeDeepSeekFileUploadBatch,
  mergeFetchFilesIntoFileResults,
  mergeUploadCapturesIntoFileResults,
  preflightDeepSeekComposerFiles,
  summarizeFetchFilesCapture,
  summarizeFilePreviewCapture,
  normalizeRequestedFilePaths,
} from './deepSeekFileUploadSupport.js'
import {
  buildDeepSeekFileUploadFailureReport,
  createDeepSeekFileUploadError,
} from '../../shared/errors/deepSeekFileUploadError.js'

const DEFAULT_FETCH_FILES_POLL_INTERVAL_MS = 1_000
const DEFAULT_FETCH_FILES_ACTIVITY_WINDOW_MS = 15_000

const FIND_COMPOSER_FILE_INPUT_HANDLE_SOURCE = `
(() => {
  const isVisible = element => {
    if (!(element instanceof HTMLElement)) {
      return true
    }

    if (
      element.hidden ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    ) {
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
  const collectVisibleCandidates = root =>
    Array.from(root.querySelectorAll('button, [role="button"], label')).filter(isVisible)
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
  const input = findVisibleComposerInput()
  const root = findComposerRoot(input)
  const nested = root.querySelector('input[type="file"]')
  return nested ?? document.querySelector('input[type="file"]')
})()
`

const CHECK_COMPOSER_ATTACHMENT_MOUNT_SOURCE = `
(fileName => {
  const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase()
  const candidate = normalize(fileName)
  if (!candidate) {
    return false
  }

  const visibleRoots = Array.from(document.querySelectorAll('main, form, body'))
  for (const root of visibleRoots) {
    const text = normalize(root.textContent)
    if (text.includes(candidate)) {
      return true
    }
  }

  return false
})
`

export async function uploadDeepSeekComposerFiles(
  page: Page,
  input: DeepSeekUploadComposerFilesInput,
  logger?: RuntimeLogger,
): Promise<DeepSeekFileUploadBatchResult | null> {
  const requestedPaths = normalizeRequestedFilePaths(input.filePaths)
  if (requestedPaths.length === 0) {
    return null
  }

  const fileInput = await discoverDeepSeekComposerFileInput(page)
  if (!fileInput.found) {
    throw new Error('Could not find the DeepSeek composer file input.')
  }

  const preflight = await preflightDeepSeekComposerFiles({
    requestedPaths,
    fileInput,
  })

  const fileResults = preflight.files.map(cloneUploadedFileResult)
  if (preflight.acceptedFiles.length === 0) {
    return finalizeDeepSeekFileUploadBatch({
      fileInput,
      requestedPaths,
      acceptedPaths: [],
      problems: preflight.problems,
      files: fileResults,
      fetches: [],
    })
  }

  const inputHandle = await resolveDeepSeekComposerFileInputHandle(page)
  if (!inputHandle) {
    throw new Error('Could not acquire the DeepSeek composer file input handle.')
  }

  let uploadCaptures: DeepSeekFileCapturedExchange[] = []
  const fetchFilesObserver = observeFetchFilesResponses(page)
  try {
    const uploadObserver = observeUploadFileResponses(page, preflight.acceptedFiles.length)
    await setComposerFileInputFiles(
      inputHandle,
      preflight.acceptedFiles.map(candidate => candidate.path),
    )
    uploadCaptures = await uploadObserver.stop(Math.min(input.timeoutMs, 15_000))
  } finally {
    await inputHandle.dispose().catch(() => {})
  }

  mergeUploadCapturesIntoFileResults(fileResults, preflight.acceptedFiles, uploadCaptures)
  logger?.debug('Observed upload_file responses', {
    files: fileResults.map(file => ({
      path: file.path,
      fileName: file.fileName,
      acceptedByPreflight: file.acceptedByPreflight,
      uploaded: file.uploaded,
      fileId: file.fileId,
      serverStatus: file.serverStatus,
      errorCode: file.errorCode,
      errorMessage: file.errorMessage,
      uploadBizCode: file.upload?.bizCode ?? null,
      uploadBizMessage: file.upload?.bizMessage ?? null,
    })),
  })

  const fileIds = fileResults
    .filter(file => file.acceptedByPreflight && file.uploaded && file.fileId)
    .map(file => file.fileId as string)
  const fetches: DeepSeekFetchFilesObservation[] = []
  if (fileIds.length > 0) {
    const observedFetches = await fetchFilesObserver.stop({
      fileIds,
      timeoutMs: input.timeoutMs,
      inactivityTimeoutMs: Math.min(
        input.timeoutMs,
        DEFAULT_FETCH_FILES_ACTIVITY_WINDOW_MS,
      ),
    })
    const settledFetches =
      observedFetches.length > 0
        ? observedFetches
        : await pollDeepSeekFetchFilesUntilSettled(
            page,
            {
              fileIds,
              timeoutMs: input.timeoutMs,
              pollIntervalMs: input.pollIntervalMs ?? DEFAULT_FETCH_FILES_POLL_INTERVAL_MS,
            },
            logger,
          )

    logger?.debug('Settled fetch_files strategy', {
      strategy: observedFetches.length > 0 ? 'observed-browser-traffic' : 'page-evaluate-fallback',
      observedFetchCount: observedFetches.length,
      settledFetchCount: settledFetches.length,
    })
    fetches.push(
      ...settledFetches.map(fetch => ({
        ...fetch,
        files: fetch.files.map(file => ({ ...file })),
      })),
    )
    mergeFetchFilesIntoFileResults(fileResults, settledFetches.at(-1) ?? null)
  }

  await verifyMountedDeepSeekFiles(page, fileResults, input.timeoutMs)

  const batch = finalizeDeepSeekFileUploadBatch({
    fileInput,
    requestedPaths,
    acceptedPaths: preflight.acceptedFiles.map(candidate => candidate.path),
    problems: preflight.problems,
    files: fileResults,
    fetches,
    allowSettledUnverifiedMount: input.allowSettledUnverifiedMount,
  })

  logger?.info('DeepSeek file upload settled', {
    blockingIssues: batch.blockingIssues,
    settled: batch.settled,
    failureClassification: batch.blockingIssues
      ? buildDeepSeekFileUploadFailureReport(batch).kind
      : null,
    mountedFiles: batch.files.filter(file => file.mounted).length,
    requestedFileCount: batch.requestedPaths.length,
    acceptedFileCount: batch.acceptedPaths.length,
  })

  return batch
}

export async function discoverDeepSeekComposerFileInput(
  page: Page,
): Promise<DeepSeekComposerFileInput> {
  const handle = await resolveDeepSeekComposerFileInputHandle(page)
  if (!handle) {
    return {
      found: false,
      selector: null,
      accept: null,
      acceptedExtensions: [],
      multiple: false,
      hidden: false,
    }
  }

  try {
    return await handle.evaluate(element => {
      const input = element instanceof HTMLInputElement ? element : null
      const acceptedExtensions = input?.accept
        ? input.accept
            .split(',')
            .map(token => token.trim().toLowerCase())
            .filter(token => token.startsWith('.'))
            .sort()
        : []
      const hidden = (() => {
        if (!(input instanceof HTMLElement)) {
          return false
        }
        if (input.hidden || input.closest('[hidden], [inert], [aria-hidden="true"]')) {
          return true
        }
        const style = window.getComputedStyle(input)
        return (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        )
      })()

      return {
        found: Boolean(input),
        selector: input ? 'input[type="file"]' : null,
        accept: input?.accept?.trim() || null,
        acceptedExtensions,
        multiple: Boolean(input?.multiple),
        hidden,
      }
    })
  } finally {
    await handle.dispose().catch(() => {})
  }
}

export { createDeepSeekFileUploadError }

async function pollDeepSeekFetchFilesUntilSettled(
  page: Page,
  input: {
    fileIds: string[]
    timeoutMs: number
    pollIntervalMs: number
  },
  logger?: RuntimeLogger,
): Promise<DeepSeekFetchFilesObservation[]> {
  const observations: DeepSeekFetchFilesObservation[] = []
  const deadline = Date.now() + input.timeoutMs

  while (Date.now() < deadline) {
    const capture = await fetchDeepSeekFilesCapture(page, input.fileIds)
    const observation = summarizeFetchFilesCapture(capture)
    observations.push(observation)

    logger?.debug('Observed fetch_files poll', {
      requestUrl: observation.requestUrl,
      acknowledged: observation.acknowledged,
      code: observation.code,
      bizCode: observation.bizCode,
      bizMessage: observation.bizMessage,
      fileCount: observation.files.length,
      successCount: observation.files.filter(file => normalizeStatus(file.status) === 'success').length,
      statuses: observation.files.map(file => file.status ?? 'unknown'),
      files: observation.files.map(file => ({
        id: file.id,
        fileName: file.fileName,
        status: file.status,
        errorCode: file.errorCode,
        tokenUsage: file.tokenUsage,
      })),
    })

    if (
      observation.acknowledged &&
      observation.files.length >= input.fileIds.length &&
      observation.files.every(file => normalizeStatus(file.status) === 'success')
    ) {
      return observations
    }

    if (isFetchFilesAuthRejected(observation) || hasFetchFilesFailedTerminalState(observation)) {
      return observations
    }

    await delay(Math.min(input.pollIntervalMs, Math.max(0, deadline - Date.now())))
  }

  return observations
}

async function verifyMountedDeepSeekFiles(
  page: Page,
  fileResults: DeepSeekUploadedFileResult[],
  timeoutMs: number,
): Promise<void> {
  for (const result of fileResults) {
    if (!result.settled || !result.fileId) {
      continue
    }

    const previewCapture = await fetchDeepSeekFilePreviewCapture(page, result.fileId)
    const preview = summarizeFilePreviewCapture(previewCapture)
    result.preview = preview
    result.previewUrl = preview.previewUrl
    result.mounted = preview.acknowledged

    if (!result.mounted) {
      const mountedViaDom = await isComposerAttachmentMounted(page, result.fileName, timeoutMs)
      result.mounted = mountedViaDom
    }

    if (!result.mounted) {
      if (isPreviewAuthRequired(preview)) {
        continue
      }

      result.problems.push({
        code: 'preview_failed',
        message: preview.bizMessage ?? preview.message ?? 'file/preview did not confirm the unsent attachment.',
        path: result.path,
        fileName: result.fileName,
      })
      result.errorMessage =
        preview.bizMessage ?? preview.message ?? 'file/preview did not confirm the unsent attachment.'
    }
  }
}

async function fetchDeepSeekFilesCapture(
  page: Page,
  fileIds: string[],
): Promise<DeepSeekFileCapturedExchange> {
  const search = fileIds.map(fileId => `file_ids=${encodeURIComponent(fileId)}`).join('&')
  const relativeUrl = `/api/v0/file/fetch_files?${search}`
  const response = await page.evaluate(async requestUrl => {
    const request = await fetch(requestUrl, {
      credentials: 'include',
      method: 'GET',
    })
    return {
      url: request.url,
      status: request.status,
      contentType: request.headers.get('content-type'),
      bodyText: await request.text(),
    }
  }, relativeUrl)

  return {
    endpoint: '/api/v0/file/fetch_files',
    request: {
      method: 'GET',
      url: new URL(response.url, page.url()).toString(),
      headers: {},
      bodyText: null,
    },
    response: {
      status: response.status,
      contentType: response.contentType,
      bodyText: response.bodyText,
    },
  }
}

async function fetchDeepSeekFilePreviewCapture(
  page: Page,
  fileId: string,
): Promise<DeepSeekFileCapturedExchange> {
  const relativeUrl = `/api/v0/file/preview?file_id=${encodeURIComponent(fileId)}&unsent=true`
  const response = await page.evaluate(async requestUrl => {
    const request = await fetch(requestUrl, {
      credentials: 'include',
      method: 'GET',
    })
    return {
      url: request.url,
      status: request.status,
      contentType: request.headers.get('content-type'),
      bodyText: await request.text(),
    }
  }, relativeUrl)

  return {
    endpoint: '/api/v0/file/preview',
    request: {
      method: 'GET',
      url: new URL(response.url, page.url()).toString(),
      headers: {},
      bodyText: null,
    },
    response: {
      status: response.status,
      contentType: response.contentType,
      bodyText: response.bodyText,
    },
  }
}

function observeUploadFileResponses(
  page: Page,
  expectedCount: number,
): {
  stop: (timeoutMs: number) => Promise<DeepSeekFileCapturedExchange[]>
} {
  const captures: DeepSeekFileCapturedExchange[] = []
  const pending = new Set<Promise<void>>()
  let settled = false

  const onResponse = (response: HTTPResponse) => {
    if (!isUploadFileResponse(response.url())) {
      return
    }

    const task = captureUploadFileResponse(response)
      .then(capture => {
        if (capture) {
          captures.push(capture)
        }
      })
      .finally(() => {
        pending.delete(task)
      })
    pending.add(task)
  }

  page.on('response', onResponse)

  return {
    async stop(timeoutMs: number) {
      if (settled) {
        return captures.map(cloneFileCapturedExchange)
      }

      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (captures.length >= expectedCount && pending.size === 0) {
          break
        }
        await delay(50)
      }

      page.off('response', onResponse)
      if (pending.size > 0) {
        await Promise.allSettled([...pending])
      }

      settled = true
      return captures.map(cloneFileCapturedExchange)
    },
  }
}

function observeFetchFilesResponses(
  page: Page,
): {
  stop: (options: {
    fileIds: string[]
    timeoutMs: number
    inactivityTimeoutMs: number
  }) => Promise<DeepSeekFetchFilesObservation[]>
} {
  const observations: DeepSeekFetchFilesObservation[] = []
  const pending = new Set<Promise<void>>()
  let settled = false

  const onResponse = (response: HTTPResponse) => {
    if (!isFetchFilesResponse(response.url())) {
      return
    }

    const task = captureFileEndpointResponse(response, '/api/v0/file/fetch_files')
      .then(capture => {
        if (!capture) {
          return
        }
        observations.push(summarizeFetchFilesCapture(capture))
      })
      .finally(() => {
        pending.delete(task)
      })

    pending.add(task)
  }

  page.on('response', onResponse)

  return {
    async stop(options) {
      if (settled) {
        return observations.map(cloneFetchFilesObservation)
      }

      const startedAt = Date.now()
      const deadline = startedAt + options.timeoutMs
      let sawActivity = observations.length > 0 || pending.size > 0
      let lastFingerprint = buildFetchFilesObserverFingerprint(observations.length, pending.size)

      while (Date.now() < deadline) {
        const fingerprint = buildFetchFilesObserverFingerprint(observations.length, pending.size)
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint
          sawActivity = true
        }

        const latestObservation = observations.at(-1) ?? null
        if (latestObservation && areFetchFilesSettled(latestObservation, options.fileIds)) {
          break
        }

        if (!sawActivity && Date.now() - startedAt >= options.inactivityTimeoutMs) {
          break
        }

        await delay(50)
      }

      page.off('response', onResponse)
      if (pending.size > 0) {
        await Promise.allSettled([...pending])
      }

      settled = true
      return observations.map(cloneFetchFilesObservation)
    },
  }
}

async function captureUploadFileResponse(
  response: HTTPResponse,
): Promise<DeepSeekFileCapturedExchange | null> {
  return captureFileEndpointResponse(response, '/api/v0/file/upload_file')
}

async function captureFileEndpointResponse(
  response: HTTPResponse,
  endpoint: DeepSeekFileCapturedExchange['endpoint'],
): Promise<DeepSeekFileCapturedExchange | null> {
  if (!isFileEndpointResponse(response.url(), endpoint)) {
    return null
  }

  const request = response.request()
  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch {
    bodyText = ''
  }

  return {
    endpoint,
    request: {
      method: request.method(),
      url: request.url(),
      headers: Object.fromEntries(
        Object.entries(request.headers()).map(([key, value]) => [key.toLowerCase(), String(value)]),
      ),
      bodyText: request.postData() ?? null,
    },
    response: {
      status: response.status(),
      contentType: response.headers()['content-type'] ?? null,
      bodyText,
    },
  }
}

async function resolveDeepSeekComposerFileInputHandle(
  page: Page,
): Promise<ElementHandle<HTMLInputElement> | null> {
  const handle = await page.evaluateHandle(
    script => window.eval(script) as Element | null,
    FIND_COMPOSER_FILE_INPUT_HANDLE_SOURCE,
  )
  const element = handle.asElement()
  if (!element) {
    await handle.dispose().catch(() => {})
    return null
  }

  return element as ElementHandle<HTMLInputElement>
}

async function isComposerAttachmentMounted(
  page: Page,
  fileName: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.min(timeoutMs, 5_000)
  while (Date.now() < deadline) {
    const mounted = await page.evaluate(
      ({ source, requestedFileName }) => {
        const resolver = window.eval(source) as (fileName: string) => boolean
        return resolver(requestedFileName)
      },
      {
        source: CHECK_COMPOSER_ATTACHMENT_MOUNT_SOURCE,
        requestedFileName: fileName,
      },
    )
    if (mounted) {
      return true
    }

    await delay(100)
  }

  return false
}

function isUploadFileResponse(url: string): boolean {
  return isFileEndpointResponse(url, '/api/v0/file/upload_file')
}

function isFetchFilesResponse(url: string): boolean {
  return isFileEndpointResponse(url, '/api/v0/file/fetch_files')
}

function isFileEndpointResponse(
  url: string,
  endpoint: DeepSeekFileCapturedExchange['endpoint'],
): boolean {
  try {
    return new URL(url).pathname === endpoint
  } catch {
    return false
  }
}

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function isFetchFilesAuthRejected(observation: DeepSeekFetchFilesObservation): boolean {
  return (
    observation.code === 40003 ||
    /invalid_token/i.test(observation.message ?? '') ||
    /invalid_token/i.test(observation.bizMessage ?? '')
  )
}

function hasFetchFilesFailedTerminalState(observation: DeepSeekFetchFilesObservation): boolean {
  return observation.files.some(file => {
    const status = normalizeStatus(file.status)
    return (
      Boolean(file.errorCode) ||
      ['failed', 'error', 'rejected', 'cancelled', 'canceled', 'timeout'].includes(status)
    )
  })
}

function isPreviewAuthRequired(preview: {
  code: number | null
  message: string | null
  bizCode: number | null
  bizMessage: string | null
}): boolean {
  return (
    preview.code === 40002 ||
    preview.bizCode === 40002 ||
    /missing token/i.test(preview.message ?? '') ||
    /missing token/i.test(preview.bizMessage ?? '')
  )
}

function areFetchFilesSettled(
  observation: DeepSeekFetchFilesObservation,
  fileIds: string[],
): boolean {
  return (
    observation.acknowledged &&
    fileIds.length > 0 &&
    fileIds.every(fileId =>
      observation.files.some(
        file => file.id === fileId && normalizeStatus(file.status) === 'success',
      ),
    )
  )
}

function buildFetchFilesObserverFingerprint(observationCount: number, pendingCount: number): string {
  return `${observationCount}:${pendingCount}`
}

function cloneFetchFilesObservation(
  observation: DeepSeekFetchFilesObservation,
): DeepSeekFetchFilesObservation {
  return {
    ...observation,
    files: observation.files.map(file => ({ ...file })),
  }
}

async function setComposerFileInputFiles(
  handle: ElementHandle<HTMLInputElement>,
  filePaths: string[],
): Promise<void> {
  const candidate = handle as unknown as {
    uploadFile?: ((...paths: string[]) => Promise<void>) | undefined
    setInputFiles?: ((paths: string[] | string) => Promise<void>) | undefined
  }

  if (typeof candidate.uploadFile === 'function') {
    await candidate.uploadFile(...filePaths)
    return
  }

  if (typeof candidate.setInputFiles === 'function') {
    await candidate.setInputFiles(filePaths)
    return
  }

  throw new Error('The resolved file input handle does not support file uploads.')
}
