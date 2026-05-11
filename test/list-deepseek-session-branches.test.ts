import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { listDeepSeekSessionBranches } from '../src/application/usecases/listDeepSeekSessionBranches.js'
import type { DeepSeekStoredSession } from '../src/types/deepseek-session.types.js'

void test('listDeepSeekSessionBranches carries stored-session active branch metadata into the catalog', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-list-branches-'))
  const sessionId = 'session-list-branches'
  const sessionFile = join(tempDir, `${sessionId}.json`)

  try {
    const storedSession: DeepSeekStoredSession = {
      kind: 'deepseek-stored-session',
      version: 1,
      session: {
        id: sessionId,
        agentId: 'chat',
        title: 'list branches regression',
        createdAt: '2026-04-07T00:00:00.000Z',
        branches: [
          {
            id: 'branch-main',
            sessionId,
            title: 'Main',
            createdAt: '2026-04-07T00:00:00.000Z',
            messages: [
              {
                id: '1',
                role: 'user',
                text: 'root',
                createdAt: '2026-04-07T00:00:00.000Z',
                branchId: 'branch-main',
                attachments: [],
                citations: [],
              },
            ],
          },
          {
            id: 'branch-regenerate-1-2',
            sessionId,
            title: 'Regenerated',
            createdAt: '2026-04-07T00:01:00.000Z',
            sourceMessageId: '2',
            messages: [
              {
                id: '2',
                role: 'assistant',
                text: 'regen',
                createdAt: '2026-04-07T00:01:00.000Z',
                branchId: 'branch-regenerate-1-2',
                attachments: [],
                citations: [],
              },
            ],
          },
        ],
      },
      metadata: {
        source: 'first-message',
        requestedUrl: 'https://chat.deepseek.com/',
        finalUrl: `https://chat.deepseek.com/a/chat/s/${sessionId}`,
        authoritativeAgentId: 'chat',
        authoritativeSessionId: sessionId,
        sessionCreate: null,
        generationObservations: [],
        outputTokensUsed: 0,
        settledAfterMs: 0,
        firstBatchSummary: {
          captureMode: 'generation-stream',
          userMessageId: '1',
          assistantMessageId: '2',
          userPrompt: 'root',
          userPromptPreview: 'root',
          assistantSummary: 'regen',
          generationEndpoints: ['/api/v0/chat/completion'],
          completionRequestObserved: true,
        },
        transcriptRecovery: null,
        lastAssistantTextSource: 'generation-stream',
        lastKnownActiveBranchId: 'branch-regenerate-1-2',
        lastKnownActiveBranchSource: 'regenerate',
        persistedAt: '2026-04-07T00:02:00.000Z',
      },
    }

    await writeFile(sessionFile, `${JSON.stringify(storedSession, null, 2)}\n`, 'utf8')

    const result = await listDeepSeekSessionBranches({
      sessionFile,
    })

    assert.equal(result.catalog.activeBranchId, 'branch-regenerate-1-2')
    assert.equal(result.catalog.activeBranchSource, 'stored-session')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
