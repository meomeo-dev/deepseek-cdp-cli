import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  resolveDeepSeekContinuePreflight,
} from '../src/infrastructure/deepseek/deepSeekContinuePreflight.js'
import {
  recoverDeepSeekSessionFromHistoryMessagesCapture,
} from '../src/infrastructure/deepseek/deepSeekHistoryMessages.js'
import {
  summarizeObservedDeepSeekStreamControls,
} from '../src/infrastructure/deepseek/deepSeekStreamControlRuntime.js'
import type { DeepSeekHistoryMessagesCapturedExchange } from '../src/types/deepseek-history-messages.types.js'
import type { DeepSeekSessionRestoreResult } from '../src/types/deepseek-session-restore.types.js'
import type { DeepSeekStreamControlCapturedExchange } from '../src/types/deepseek-stream-control.types.js'

const HISTORY_FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-stream-control')
const GENERATION_FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-generation-stream')
const RECOVERED_HISTORY_FIXTURE_DIR = join(process.cwd(), 'test/fixtures/deepseek-history-messages')

void test('continue preflight allows explicit continue only when restore evidence is resumable and no auto-resume was observed', async () => {
  const historyCapture = await loadHistoryFixture(
    'history-messages.wip.real.fixture.json',
    HISTORY_FIXTURE_DIR,
  )
  const historyMessagesRecovery = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture: historyCapture,
    attempts: 1,
  })
  const preflight = resolveDeepSeekContinuePreflight({
    restore: buildRestoreResult(historyMessagesRecovery),
    streamControls: [],
  })

  assert.equal(preflight.status, 'resumable')
  assert.equal(preflight.disposition, 'allow-explicit-continue')
  assert.equal(preflight.explicitContinueAllowed, true)
  assert.equal(preflight.controlSettlement.status, 'resumable')
  assert.equal(preflight.autoResume.observed, false)
  assert.equal(preflight.historyCapture?.sessionId, 'session-redacted')
})

void test('continue preflight isolates restore-time resume_stream as auto-resumed even when canonical settlement completed', async () => {
  const historyCapture = await loadHistoryFixture(
    'history-messages.wip.real.fixture.json',
    HISTORY_FIXTURE_DIR,
  )
  const historyMessagesRecovery = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture: historyCapture,
    attempts: 1,
  })
  const streamControls = summarizeObservedDeepSeekStreamControls({
    captures: [await loadStreamControlFixture('resume_stream.real.fixture.json', GENERATION_FIXTURE_DIR)],
  })
  const preflight = resolveDeepSeekContinuePreflight({
    restore: buildRestoreResult(historyMessagesRecovery),
    streamControls,
  })

  assert.equal(preflight.status, 'auto-resumed')
  assert.equal(preflight.disposition, 'blocked-auto-resume')
  assert.equal(preflight.explicitContinueAllowed, false)
  assert.equal(preflight.controlSettlement.status, 'completed')
  assert.equal(preflight.autoResume.observed, true)
  assert.equal(preflight.autoResume.runStatus, 'completed')
  assert.equal(preflight.autoResume.assistantMessageId, '2')
})

void test('continue preflight treats settled history recovery as completed without inventing a synthetic resumable state', async () => {
  const historyCapture = await loadHistoryFixture(
    'history-messages.real.fixture.json',
    RECOVERED_HISTORY_FIXTURE_DIR,
  )
  const historyMessagesRecovery = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture: historyCapture,
    attempts: 1,
  })
  const preflight = resolveDeepSeekContinuePreflight({
    restore: buildRestoreResult(historyMessagesRecovery),
    streamControls: [],
  })

  assert.equal(preflight.status, 'completed')
  assert.equal(preflight.disposition, 'blocked-completed')
  assert.equal(preflight.explicitContinueAllowed, false)
  assert.equal(preflight.controlSettlement.status, 'failed')
  assert.equal(preflight.restore.historyMessagesRecovery.outcome, 'recovered')
})

void test('continue preflight accepts a visible inline Continue control as resumable evidence when history recovery did not recover a transcript', async () => {
  const recoveredHistoryCapture = await loadHistoryFixture(
    'history-messages.real.fixture.json',
    RECOVERED_HISTORY_FIXTURE_DIR,
  )
  const recoveredHistoryMessagesRecovery = recoverDeepSeekSessionFromHistoryMessagesCapture({
    capture: recoveredHistoryCapture,
    attempts: 1,
  })
  if (recoveredHistoryMessagesRecovery.outcome !== 'recovered' || !recoveredHistoryMessagesRecovery.session) {
    throw new Error('Expected the recovered history fixture to produce a session payload.')
  }

  const preflight = resolveDeepSeekContinuePreflight({
    restore: {
      ...buildRestoreResult(recoveredHistoryMessagesRecovery),
      historyMessagesRecovery: {
        outcome: 'failed',
        capture: null,
        session: recoveredHistoryMessagesRecovery.session,
        recovery: {
          source: 'history_messages',
          status: 'failed',
          requestUrl: null,
          responseStatus: null,
          recoveredAt: '2026-04-07T00:00:00.000Z',
          attempts: 1,
          branchCount: recoveredHistoryMessagesRecovery.session.branches.length,
          messageCount: recoveredHistoryMessagesRecovery.session.branches.reduce(
            (total, branch) => total + branch.messages.length,
            0,
          ),
          settled: false,
          errorMessage: 'history_messages returned empty MERGE after stop',
        },
      },
      contextSource: 'stored-session',
      transcriptRecovery: {
        source: 'history_messages',
        status: 'failed',
        requestUrl: null,
        responseStatus: null,
        recoveredAt: '2026-04-07T00:00:00.000Z',
        attempts: 1,
        branchCount: recoveredHistoryMessagesRecovery.session.branches.length,
        messageCount: recoveredHistoryMessagesRecovery.session.branches.reduce(
          (total, branch) => total + branch.messages.length,
          0,
        ),
        settled: false,
        errorMessage: 'history_messages returned empty MERGE after stop',
      },
      session: recoveredHistoryMessagesRecovery.session,
    },
    streamControls: [],
    continueControl: {
      observed: true,
      assistantMessageId: '2',
      controlKind: 'inline-button',
      label: 'Continue',
      selector: 'button',
      matchedBy: 'preferred-message',
    },
  })

  assert.equal(preflight.status, 'resumable')
  assert.equal(preflight.disposition, 'allow-explicit-continue')
  assert.equal(preflight.explicitContinueAllowed, true)
  assert.equal(preflight.controlSettlement.status, 'resumable')
  assert.equal(preflight.controlSettlement.source, 'message_action_control')
  assert.equal(preflight.controlSettlement.resumable?.assistantMessageId, '2')
  assert.equal(preflight.continueControl.observed, true)
  assert.equal(preflight.continueControl.assistantMessageId, '2')
})

async function loadHistoryFixture(
  fileName: string,
  fixtureDir: string,
): Promise<DeepSeekHistoryMessagesCapturedExchange> {
  return JSON.parse(
    await readFile(join(fixtureDir, fileName), 'utf8'),
  ) as DeepSeekHistoryMessagesCapturedExchange
}

async function loadStreamControlFixture(
  fileName: string,
  fixtureDir: string,
): Promise<DeepSeekStreamControlCapturedExchange> {
  return JSON.parse(
    await readFile(join(fixtureDir, fileName), 'utf8'),
  ) as DeepSeekStreamControlCapturedExchange
}

function buildRestoreResult(
  historyMessagesRecovery: DeepSeekSessionRestoreResult['historyMessagesRecovery'],
): DeepSeekSessionRestoreResult {
  const recoveredSession = historyMessagesRecovery.session
  if (!recoveredSession) {
    throw new Error('Could not synthesize a restore result without a session payload.')
  }

  return {
    requestedSessionId: 'session-redacted',
    authoritativeSessionId: 'session-redacted',
    authoritativeAgentId: 'chat',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-redacted',
    sessionFile: '/tmp/session-redacted.json',
    routeVerified: true,
    composerSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-redacted',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-redacted',
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: 'button[type="submit"]',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[data-testid="deepthink"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: true,
        selector: '[data-testid="search"]',
        label: 'Search',
        state: 'on',
      },
      fileButton: {
        found: true,
        selector: '[data-testid="file"]',
        label: 'File',
      },
    },
    historyMessagesRecovery,
    contextSource: historyMessagesRecovery.outcome === 'recovered' ? 'history_messages' : 'stored-session',
    transcriptRecovery: historyMessagesRecovery.recovery,
    session: recoveredSession,
  }
}
