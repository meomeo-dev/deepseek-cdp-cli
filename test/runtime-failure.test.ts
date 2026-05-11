import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeepSeekFileUploadError } from '../src/shared/errors/deepSeekFileUploadError.js'
import { classifyDeepSeekRuntimeFailure } from '../src/shared/errors/runtimeFailure.js'

void test('classifies managed Chrome concurrency failures as retryable busy errors', () => {
  const failure = classifyDeepSeekRuntimeFailure(
    new Error('Managed Chrome is already active for http://127.0.0.1:9222 under pid 12345.'),
  )

  assert.equal(failure.kind, 'managed-chrome-busy')
  assert.equal(failure.retryable, true)
  assert.match(failure.message, /managed chrome is already active/i)
})

void test('classifies fixed managed Chrome endpoint conflicts separately from busy leases', () => {
  const failure = classifyDeepSeekRuntimeFailure(
    new Error(
      'Requested managed Chrome CDP endpoint http://127.0.0.1:9222 is already serving a Chrome DevTools endpoint before launch.',
    ),
  )

  assert.equal(failure.kind, 'managed-chrome-port-conflict')
  assert.equal(failure.retryable, false)
  assert.match(failure.message, /requested managed chrome cdp endpoint/i)
})

void test('classifies detached frame and page close failures as retryable browser failures', () => {
  const detached = classifyDeepSeekRuntimeFailure(new Error('Navigating frame was detached'))
  const closed = classifyDeepSeekRuntimeFailure(new Error('TargetCloseError: Page closed!'))

  assert.equal(detached.kind, 'browser-frame-detached')
  assert.equal(detached.retryable, true)
  assert.equal(closed.kind, 'browser-page-closed')
  assert.equal(closed.retryable, true)
})

void test('classifies validation and timeout failures without guessing extra semantics', () => {
  const validation = classifyDeepSeekRuntimeFailure(
    new Error('Invalid DeepSeek session target: missing sessionId.'),
  )
  const timeout = classifyDeepSeekRuntimeFailure(new Error('Timed out waiting for DeepSeek home entry.'))

  assert.equal(validation.kind, 'validation')
  assert.equal(validation.retryable, false)
  assert.equal(timeout.kind, 'timeout')
  assert.equal(timeout.retryable, true)
})

void test('classifies destructive confirmation failures as cancelled', () => {
  const cancelled = classifyDeepSeekRuntimeFailure(
    new Error('Destructive action cancelled for delete DeepSeek session session-123: confirmation text mismatch.'),
  )

  assert.equal(cancelled.kind, 'cancelled')
  assert.equal(cancelled.retryable, false)
})

void test('classifies structured attachment upload failures without collapsing to unknown', () => {
  const failure = classifyDeepSeekRuntimeFailure(
    createDeepSeekFileUploadError({
      fileInput: {
        found: true,
        selector: 'input[type="file"]',
        accept: '.txt',
        acceptedExtensions: ['.txt'],
        multiple: true,
        hidden: true,
      },
      requestedPaths: ['/tmp/alpha.txt'],
      acceptedPaths: ['/tmp/alpha.txt'],
      problems: [],
      files: [
        {
          path: '/tmp/alpha.txt',
          fileName: 'alpha.txt',
          extension: '.txt',
          sizeBytes: 11,
          acceptedByPreflight: true,
          uploaded: true,
          settled: false,
          mounted: false,
          fileId: 'file-1',
          serverStatus: 'PARSING',
          previewable: false,
          tokenUsage: null,
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
          upload: null,
          fetched: {
            id: 'file-1',
            status: 'PARSING',
            fileName: 'alpha.txt',
            previewable: false,
            fileSize: 11,
            tokenUsage: null,
            errorCode: null,
            insertedAt: null,
            updatedAt: null,
          },
          preview: null,
          problems: [
            {
              code: 'fetch_files_processing_timeout',
              message: 'fetch_files last observed status was PARSING before timeout.',
              path: '/tmp/alpha.txt',
              fileName: 'alpha.txt',
            },
          ],
        },
      ],
      fetches: [],
      settled: false,
      blockingIssues: true,
    }),
  )

  assert.equal(failure.kind, 'attachment-upload')
  assert.equal(failure.retryable, true)
  assert.match(failure.message, /DeepSeek file upload failed/)
})
