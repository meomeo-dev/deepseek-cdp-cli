import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureCliDestructiveActionConfirmed } from '../src/shared/runtime/destructiveActionGuard.js'

void test('rejects destructive actions when the explicit allow flag is missing', async () => {
  await assert.rejects(
    ensureCliDestructiveActionConfirmed({
      actionLabel: 'delete DeepSeek session session-123',
      allowOptionName: '--allow-destructive-delete-session',
      allowOptionEnabled: false,
      confirmationText: 'DELETE SESSION session-123',
      interactive: false,
    }),
    /--allow-destructive-delete-session/,
  )
})

void test('rejects non-interactive execution when confirm-text is absent', async () => {
  await assert.rejects(
    ensureCliDestructiveActionConfirmed({
      actionLabel: 'delete DeepSeek session session-123',
      allowOptionName: '--allow-destructive-delete-session',
      allowOptionEnabled: true,
      confirmationText: 'DELETE SESSION session-123',
      interactive: false,
    }),
    /--confirm-text "DELETE SESSION session-123"/,
  )
})

void test('accepts non-interactive execution when confirm-text matches exactly', async () => {
  await assert.doesNotReject(async () =>
    ensureCliDestructiveActionConfirmed({
      actionLabel: 'delete DeepSeek session session-123',
      allowOptionName: '--allow-destructive-delete-session',
      allowOptionEnabled: true,
      confirmationText: 'DELETE SESSION session-123',
      providedConfirmationText: 'DELETE SESSION session-123',
      interactive: false,
    }),
  )
})

void test('rejects confirmation text mismatches from explicit flag input', async () => {
  await assert.rejects(
    ensureCliDestructiveActionConfirmed({
      actionLabel: 'delete DeepSeek session session-123',
      allowOptionName: '--allow-destructive-delete-session',
      allowOptionEnabled: true,
      confirmationText: 'DELETE SESSION session-123',
      providedConfirmationText: 'DELETE SESSION wrong-session',
      interactive: false,
    }),
    /confirmation text mismatch/i,
  )
})

void test('prompts in interactive mode and accepts an exact answer', async () => {
  const output: string[] = []

  await assert.doesNotReject(async () =>
    ensureCliDestructiveActionConfirmed({
      actionLabel: 'delete DeepSeek session session-123',
      allowOptionName: '--allow-destructive-delete-session',
      allowOptionEnabled: true,
      confirmationText: 'DELETE SESSION session-123',
      interactive: true,
      output: {
        write(chunk: string) {
          output.push(chunk)
        },
      },
      prompt: message => {
        output.push(message)
        return Promise.resolve('DELETE SESSION session-123')
      },
    }),
  )

  assert.match(output.join(''), /Dangerous action: delete DeepSeek session session-123/)
  assert.match(output.join(''), /Type DELETE SESSION session-123 to continue:/)
})
