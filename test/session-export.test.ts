import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { exportConversation } from '../src/application/usecases/exportConversation.js'
import {
  appendReplyTurnToStoredSession,
  applyTranscriptRecoveryToStoredSession,
  createStoredSessionFromFirstMessage,
  overlayLocalAttachmentMetadataOnRecoveredSession,
} from '../src/infrastructure/deepseek/deepSeekStoredSession.js'
import { saveStoredSessionToFile } from '../src/infrastructure/deepseek/fileSystemSessionStore.js'
import { mapHistoryMessagesEnvelopeToSession } from '../src/infrastructure/deepseek/historyMessagesMapper.js'
import type { DeepSeekFileUploadBatchResult } from '../src/types/deepseek-file.types.js'
import type { DeepSeekFirstMessageResult } from '../src/types/deepseek-first-message.types.js'

void test('exports a stored session branch to markdown', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-'))

  try {
    const outputFile = join(outputDir, 'session.md')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-session.json'),
      branchId: 'branch-main',
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-main')
    assert.match(content, /# Fixture Session/)
    assert.match(content, /## Branch Summary/)
    assert.match(content, /## Transcript Provenance/)
    assert.match(content, /Citations \/ Search Evidence/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a raw history_messages branch to markdown through the same pipeline', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-history-'))

  try {
    const outputFile = join(outputDir, 'history.md')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      branchId: 'branch-main',
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-main')
    assert.match(content, /# History Session/)
    assert.match(content, /## Search Evidence/)
    assert.match(content, /brief\.pdf/)
    assert.match(content, /Example Search Result/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a stored session branch to text without markdown scaffolding', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-text-'))

  try {
    const outputFile = join(outputDir, 'session.txt')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-session.json'),
      branchId: 'branch-main',
      format: 'text',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-main')
    assert.match(content, /DeepSeek Session: Fixture Session/)
    assert.match(content, /Branch: Main Branch \(branch-main\)/)
    assert.match(content, /User:\n请总结附件并联网搜索补充。/)
    assert.match(content, /Assistant:\n这是总结结果。/)
    assert.match(
      content,
      /Citations:\n- \[citation\] Example Search Result \| https:\/\/example\.com\/result/,
    )
    assert.doesNotMatch(content, /DeepSeek Session Branch Export/)
    assert.doesNotMatch(content, /Branch Summary/)
    assert.doesNotMatch(content, /Search Evidence/)
    assert.doesNotMatch(content, /^## /m)
    assert.doesNotMatch(content, /\[[^\]]+\]\(https?:\/\//)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('creates missing parent directories before exporting a session', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-nested-'))

  try {
    const outputFile = join(outputDir, 'nested', 'exports', 'session.md')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-session.json'),
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'session')
    assert.match(content, /# Fixture Session/)
    assert.match(content, /## Branches/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a branch by sessionId through the resolved session store path', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-session-id-'))

  try {
    const sessionStoreDir = join(outputDir, 'sessions')
    const sessionFile = join(sessionStoreDir, 'session-history-001.json')
    const outputFile = join(outputDir, 'history-by-session-id.md')

    await copyFixture(
      join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      sessionFile,
    )

    const result = await exportConversation({
      sessionId: 'session-history-001',
      sessionStoreDir,
      branchId: 'branch-alt',
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-alt')
    assert.match(content, /Lineage Kind:/)
    assert.match(content, /另一个分支的答案/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a stored first-message session envelope through the same pipeline', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-stored-'))

  try {
    const sessionFile = join(outputDir, 'stored-session.json')
    const outputFile = join(outputDir, 'stored.md')
    const textOutputFile = join(outputDir, 'stored.txt')

    await saveStoredSessionToFile(
      sessionFile,
      createStoredSessionFromFirstMessage({
        prompt: '请总结这次会话',
        persistedAt: '2026-04-04T00:00:00.000Z',
        result: {
          requestedUrl: 'https://chat.deepseek.com/',
          finalUrl: 'https://chat.deepseek.com/a/chat/s/session-stored',
          agentId: 'chat',
          sessionId: 'session-stored',
          sessionCreate: {
            sessionId: 'session-create-other',
            agentId: 'chat',
            url: 'https://chat.deepseek.com/api/v0/chat_session/create',
            status: 200,
          },
          completionRequestObserved: true,
          generationObservations: [
            {
              endpoint: '/api/v0/chat/completion',
              url: 'https://chat.deepseek.com/api/v0/chat/completion',
              status: 200,
              contentType: 'application/json',
              outputTokens: 12,
            },
          ],
          generationRuns: [
            {
              endpoint: '/api/v0/chat/completion',
              transport: 'json',
              routeUrl: 'https://chat.deepseek.com/a/chat/s/session-stored',
              context: {
                runId: 'run-stored',
                endpoint: '/api/v0/chat/completion',
                transport: 'json',
                requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
                routeUrl: 'https://chat.deepseek.com/a/chat/s/session-stored',
                agentId: 'chat',
                sessionId: 'session-stored',
                branchId: null,
                parentMessageId: null,
                assistantMessageId: '2',
                modeFact: {
                  sourceLayer: 'canonical-generation-context',
                  rawModelType: 'default',
                  resolvedMode: 'instant',
                  derivedFromLayer: 'generation-ready-sse',
                },
              },
              finalized: {
                status: 'completed',
                finishReason: 'stop',
                outputText: '这是 generation stream 回填文本。',
                reasoningText: '',
                reasoningKind: 'unknown',
                citations: [],
                responseReferences: [],
                searches: [],
                usage: {
                  inputTokens: null,
                  outputTokens: 12,
                  totalTokens: null,
                  reasoningTokens: null,
                },
                error: null,
                completedAt: '2026-04-04T00:00:01.000Z',
              },
              eventCount: 3,
              unknownObservationCount: 0,
              unknownObservationLabels: [],
            },
          ],
          outputTokensUsed: 12,
          settledAfterMs: 1_500,
          requestedComposerMode: {
            deepThink: 'unchanged',
            search: 'unchanged',
          },
          composerMode: {
            deepThink: 'on',
            search: 'on',
          },
          beforeSendSnapshot: {
            pageUrl: 'https://chat.deepseek.com/',
            routeKind: 'home',
            agentId: null,
            sessionId: null,
            composerInput: {
              found: true,
              selector: 'textarea',
              label: 'Message DeepSeek',
            },
            sendOrStopButton: {
              found: true,
              selector: '#send',
              label: 'Send',
              state: 'send',
            },
            deepThinkToggle: {
              found: true,
              selector: '[role="button"]',
              label: 'DeepThink',
              state: 'on',
            },
            searchToggle: {
              found: true,
              selector: '[role="button"]',
              label: 'Search',
              state: 'on',
            },
            fileButton: {
              found: true,
              selector: '[role="button"]',
              label: 'File',
            },
          },
          afterSendSnapshot: {
            pageUrl: 'https://chat.deepseek.com/a/chat/s/session-stored',
            routeKind: 'session',
            agentId: 'chat',
            sessionId: 'session-stored',
            composerInput: {
              found: true,
              selector: 'textarea',
              label: 'Message DeepSeek',
            },
            sendOrStopButton: {
              found: true,
              selector: '#send',
              label: 'Send',
              state: 'send',
            },
            deepThinkToggle: {
              found: true,
              selector: '[role="button"]',
              label: 'DeepThink',
              state: 'on',
            },
            searchToggle: {
              found: true,
              selector: '[role="button"]',
              label: 'Search',
              state: 'on',
            },
            fileButton: {
              found: true,
              selector: '[role="button"]',
              label: 'File',
            },
          },
          assistantText: '这是 generation stream 回填文本。',
          assistantTextSource: 'generation-stream',
        },
      }),
    )

    const result = await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-main')
    assert.match(content, /generation stream 回填文本/)
    assert.match(content, /generation-stream-fallback/)
    assert.match(
      content,
      /Mode Fact: mode=`instant` · model_type=`default` · source=`export-document` · derivedFrom=`stored-session`/,
    )
    assert.match(content, /session-stored/)

    const textResult = await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'text',
      outputFile: textOutputFile,
    })

    const textContent = await readFile(textOutputFile, 'utf8')
    assert.equal(textResult.exportScope, 'branch')
    assert.equal(textResult.branchId, 'branch-main')
    assert.match(
      textContent,
      /Mode: mode=instant \| model_type=default \| source=export-document \| derivedFrom=stored-session/,
    )
    assert.match(textContent, /Assistant:\n这是 generation stream 回填文本。/)
    assert.doesNotMatch(textContent, /^## /m)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a stored session branch to enriched json with provenance and lineage', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-json-'))

  try {
    const outputFile = join(outputDir, 'session.json')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      branchId: 'branch-alt',
      format: 'json',
      outputFile,
    })

    const content = JSON.parse(await readFile(outputFile, 'utf8')) as {
      kind: string
      branch: {
        branchId: string
        summary: {
          lineageKind: string
          sourceMessageId: string | null
        }
        provenance: {
          source: string
          transcriptShape: string
        }
        searchEvidence: {
          derivedFrom: string
          resultCount: number
        }
        citations: Array<{ title: string }>
      }
    }
    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-alt')
    assert.equal(content.kind, 'deepseek-session-branch-export')
    assert.equal(content.branch.branchId, 'branch-alt')
    assert.equal(content.branch.summary.lineageKind, 'unresolved')
    assert.equal(content.branch.summary.sourceMessageId, 'user-2')
    assert.equal(content.branch.provenance.source, 'unknown')
    assert.equal(content.branch.provenance.transcriptShape, 'unknown')
    assert.equal(content.branch.searchEvidence.derivedFrom, 'citations')
    assert.equal(content.branch.searchEvidence.resultCount, 1)
    assert.equal(content.branch.citations[0]?.title, 'Another Source')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a complete session to markdown when branchId is omitted', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-session-full-md-'))

  try {
    const outputFile = join(outputDir, 'session-full.md')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'session')
    assert.equal(result.branchId, null)
    assert.match(content, /## Session Overview/)
    assert.match(content, /## Branch Index/)
    assert.match(content, /## Branches/)
    assert.match(content, /### Main Branch \(`branch-main`\)/)
    assert.match(content, /### Alt Branch \(`branch-alt`\)/)
    assert.match(content, /provenance=`unknown\/unknown`/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a complete session to text when branchId is omitted', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-session-full-text-'))

  try {
    const outputFile = join(outputDir, 'session-full.txt')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      format: 'text',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'session')
    assert.equal(result.branchId, null)
    assert.match(content, /DeepSeek Session: History Session/)
    assert.match(content, /Branch Count: 2/)
    assert.match(content, /Branch: Main Branch \(branch-main\)/)
    assert.match(content, /Branch: Alt Branch \(branch-alt\)/)
    assert.match(content, /Assistant:\n这是基于 history_messages 的总结。/)
    assert.match(content, /Assistant:\n这是另一个分支的答案。/)
    assert.match(content, /provenance=unknown\/unknown\/unavailable/)
    assert.match(content, /Session Metadata:/)
    assert.doesNotMatch(content, /DeepSeek Session Export/)
    assert.doesNotMatch(content, /^## /m)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports a complete session to enriched json when branchId is omitted', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-session-full-json-'))

  try {
    const outputFile = join(outputDir, 'session-full.json')
    const result = await exportConversation({
      sessionFile: join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
      format: 'json',
      outputFile,
    })

    const content = JSON.parse(await readFile(outputFile, 'utf8')) as {
      kind: string
      session: {
        branchCount: number
        totalMessageCount: number
        totalCitationCount: number
        modeFact: {
          rawModelType: string
          sourceLayer: string
        } | null
      }
      branchIndex: Array<{
        branchId: string
        summary: {
          lineageKind: string
        }
        provenance: {
          source: string
          transcriptShape: string
        }
      }>
      branches: Array<{
        branchId: string
        searchEvidence: {
          derivedFrom: string
          resultCount: number
        }
      }>
    }

    assert.equal(result.exportScope, 'session')
    assert.equal(result.branchId, null)
    assert.equal(content.kind, 'deepseek-session-export')
    assert.equal(content.session.branchCount, 2)
    assert.equal(content.session.totalMessageCount, 4)
    assert.equal(content.session.totalCitationCount, 2)
    assert.equal(content.session.modeFact, null)
    assert.equal(content.branchIndex.length, 2)
    assert.equal(content.branchIndex[1]?.branchId, 'branch-alt')
    assert.equal(content.branchIndex[1]?.summary.lineageKind, 'unresolved')
    assert.equal(content.branchIndex[1]?.provenance.source, 'unknown')
    assert.equal(content.branchIndex[1]?.provenance.transcriptShape, 'unknown')
    assert.equal(content.branches.length, 2)
    assert.equal(content.branches[0]?.branchId, 'branch-main')
    assert.equal(content.branches[0]?.searchEvidence.derivedFrom, 'citations')
    assert.equal(content.branches[1]?.searchEvidence.resultCount, 1)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports reply attachment metadata after recovery without dropping richer local fields', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-attachment-chain-'))

  try {
    const sessionFile = join(outputDir, 'attachment-session.json')
    const outputFile = join(outputDir, 'attachment-export.json')

    const firstStoredSession = createStoredSessionFromFirstMessage({
      prompt: '请阅读附件后，只回复：attachment history probe ok。',
      persistedAt: '2026-04-06T02:19:42.000Z',
      result: createAttachmentFirstMessageResult({
        fileUpload: createAttachmentFileUploadBatch({
          fileId: 'file-attachment-first-redacted',
          previewUrl: 'https://files.example/README.md',
        }),
      }),
    })

    const recoveredFirstStoredSession = applyTranscriptRecoveryToStoredSession({
      storedSession: firstStoredSession,
      transcriptRecovery: {
        source: 'history_messages',
        status: 'recovered',
        requestUrl:
          'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-attachment-redacted',
        responseStatus: 200,
        recoveredAt: '2026-04-06T02:19:42.950Z',
        attempts: 1,
        branchCount: 1,
        messageCount: 2,
        settled: true,
      },
      recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
        localSession: firstStoredSession.session,
        recoveredSession: await loadHistoryFixtureSession(
          'history-messages.attachments.first-message.real.fixture.json',
        ),
      }),
    })

    const replyOverlaySession = appendReplyTurnToStoredSession({
      storedSession: recoveredFirstStoredSession,
      prompt: '再次阅读附件后，只回复：attachment reply ok。',
      persistedAt: '2026-04-06T02:21:10.955Z',
      result: {
        finalUrl: 'https://chat.deepseek.com/a/chat/s/session-attachment-redacted',
        agentId: 'chat',
        sessionId: 'session-attachment-redacted',
        generationObservations: [],
        generationRuns: [],
        fileUpload: createAttachmentFileUploadBatch({
          fileId: 'file-attachment-reply-redacted',
          previewUrl: 'https://files.example/reply-README.md',
        }),
        assistantText: 'attachment reply ok',
        assistantTextSource: 'generation-stream',
      },
    })

    const recoveredReplyStoredSession = applyTranscriptRecoveryToStoredSession({
      storedSession: recoveredFirstStoredSession,
      transcriptRecovery: {
        source: 'history_messages',
        status: 'recovered',
        requestUrl:
          'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-attachment-redacted&cache_version=2&cache_reset_at=1775442058',
        responseStatus: 200,
        recoveredAt: '2026-04-06T02:21:10.955Z',
        attempts: 1,
        branchCount: 1,
        messageCount: 2,
        settled: true,
      },
      recoveredSession: overlayLocalAttachmentMetadataOnRecoveredSession({
        localSession: replyOverlaySession.session,
        recoveredSession: await loadHistoryFixtureSession(
          'history-messages.attachments.reply.real.fixture.json',
        ),
      }),
    })

    await saveStoredSessionToFile(sessionFile, recoveredReplyStoredSession)

    const result = await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'json',
      outputFile,
    })

    const content = JSON.parse(await readFile(outputFile, 'utf8')) as {
      kind: string
      branch: {
        summary: {
          attachmentCount: number
        }
        attachments: Array<{
          id: string
          url?: string
        }>
        messages: Array<{
          id: string
          attachments: Array<{
            id: string
            url?: string
          }>
        }>
      }
    }

    assert.equal(result.exportScope, 'branch')
    assert.equal(result.branchId, 'branch-main')
    assert.equal(content.kind, 'deepseek-session-branch-export')
    assert.equal(content.branch.summary.attachmentCount, 2)
    assert.equal(
      content.branch.attachments.find(attachment => attachment.id === 'file-attachment-first-redacted')
        ?.url,
      'https://files.example/README.md',
    )
    assert.equal(
      content.branch.attachments.find(attachment => attachment.id === 'file-attachment-reply-redacted')
        ?.url,
      'https://files.example/reply-README.md',
    )
    assert.equal(
      content.branch.messages.find(message => message.id === '1')?.attachments[0]?.url,
      'https://files.example/README.md',
    )
    assert.equal(
      content.branch.messages.find(message => message.id === '3')?.attachments[0]?.url,
      'https://files.example/reply-README.md',
    )
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports vision mode fact and local image upload provenance across formats', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-export-vision-image-'))

  try {
    const sessionFile = join(outputDir, 'vision-session.json')
    const jsonOutputFile = join(outputDir, 'vision-session.json.out')
    const markdownOutputFile = join(outputDir, 'vision-session.md')
    const textOutputFile = join(outputDir, 'vision-session.txt')

    await saveStoredSessionToFile(
      sessionFile,
      createStoredSessionFromFirstMessage({
        prompt: '请用一句话描述这张图。',
        persistedAt: '2026-04-29T10:40:42.000Z',
        result: createVisionImageFirstMessageResult(),
      }),
    )

    const jsonResult = await exportConversation({
      sessionFile,
      format: 'json',
      outputFile: jsonOutputFile,
    })
    const markdownResult = await exportConversation({
      sessionFile,
      format: 'markdown',
      outputFile: markdownOutputFile,
    })
    const textResult = await exportConversation({
      sessionFile,
      format: 'text',
      outputFile: textOutputFile,
    })

    const jsonContent = JSON.parse(await readFile(jsonOutputFile, 'utf8')) as {
      session: {
        modeFact: {
          rawModelType: string
          resolvedMode: string | null
        } | null
        totalAttachmentCount: number
      }
      branches: Array<{
        attachments: Array<{
          id: string
          name: string
          url?: string
        }>
        messages: Array<{
          role: string
          attachments: Array<{
            id: string
          }>
        }>
      }>
    }
    const markdownContent = await readFile(markdownOutputFile, 'utf8')
    const textContent = await readFile(textOutputFile, 'utf8')

    assert.equal(jsonResult.exportScope, 'session')
    assert.equal(markdownResult.exportScope, 'session')
    assert.equal(textResult.exportScope, 'session')
    assert.equal(jsonContent.session.modeFact?.rawModelType, 'vision')
    assert.equal(jsonContent.session.modeFact?.resolvedMode, 'vision')
    assert.equal(jsonContent.session.totalAttachmentCount, 1)
    assert.equal(jsonContent.branches[0]?.attachments[0]?.id, 'file-vision-image')
    assert.equal(jsonContent.branches[0]?.attachments[0]?.name, 'vision-white-rect.png')
    assert.equal(
      jsonContent.branches[0]?.attachments[0]?.url,
      'https://files.example/vision-white-rect.png',
    )
    assert.equal(
      jsonContent.branches[0]?.messages.find(message => message.role === 'user')?.attachments[0]?.id,
      'file-vision-image',
    )
    assert.match(
      markdownContent,
      /Mode Fact: mode=`vision` · model_type=`vision` · source=`export-document`/,
    )
    assert.match(markdownContent, /Total Attachment Count: 1/)
    assert.match(markdownContent, /vision-white-rect\.png \(`file-vision-image`\)/)
    assert.match(
      textContent,
      /Mode: mode=vision \| model_type=vision \| source=export-document/,
    )
    assert.match(textContent, /Attachments:\n- vision-white-rect\.png .*id=file-vision-image/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

async function copyFixture(sourceFile: string, destinationFile: string): Promise<void> {
  await mkdir(dirname(destinationFile), { recursive: true })
  await copyFile(sourceFile, destinationFile)
}

function createAttachmentFirstMessageResult(input: {
  fileUpload: NonNullable<Parameters<typeof createStoredSessionFromFirstMessage>[0]['result']['fileUpload']>
}): Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'> {
  return {
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-attachment-redacted',
    agentId: 'chat',
    sessionId: 'session-attachment-redacted',
    sessionCreate: null,
    completionRequestObserved: true,
    generationObservations: [],
    generationRuns: [],
    outputTokensUsed: 0,
    settledAfterMs: 1_500,
    requestedComposerMode: {
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
      deepThink: 'on',
      search: 'on',
    },
    beforeSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/',
      routeKind: 'home',
      agentId: null,
      sessionId: null,
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: '#send',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'Search',
        state: 'off',
      },
      fileButton: {
        found: true,
        selector: '[role="button"]',
        label: 'File',
      },
    },
    afterSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-attachment-redacted',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-attachment-redacted',
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: '#send',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'Search',
        state: 'off',
      },
      fileButton: {
        found: true,
        selector: '[role="button"]',
        label: 'File',
      },
    },
    fileUpload: input.fileUpload,
    assistantText: null,
    assistantTextSource: 'unavailable' as const,
  }
}

function createVisionImageFirstMessageResult(): Omit<DeepSeekFirstMessageResult, 'budget' | 'sessionFile'> {
  return {
    requestedUrl: 'https://chat.deepseek.com/',
    finalUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
    agentId: 'chat',
    sessionId: 'session-vision',
    sessionCreate: {
      sessionId: 'session-vision',
      agentId: 'chat',
      url: 'https://chat.deepseek.com/api/v0/chat_session/create',
      status: 200,
    },
    completionRequestObserved: true,
    generationObservations: [
      {
        endpoint: '/api/v0/chat/completion',
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        status: 200,
        contentType: 'text/event-stream',
        outputTokens: 7,
        requestModelType: 'vision',
        requestRefFileIds: ['file-vision-image'],
      },
    ],
    generationRuns: [
      {
        endpoint: '/api/v0/chat/completion',
        transport: 'sse',
        routeUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
        context: {
          runId: 'run-vision',
          endpoint: '/api/v0/chat/completion',
          transport: 'sse',
          requestUrl: 'https://chat.deepseek.com/api/v0/chat/completion',
          routeUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
          agentId: 'chat',
          sessionId: 'session-vision',
          branchId: 'branch-main',
          parentMessageId: '1',
          assistantMessageId: '2',
          modeFact: {
            sourceLayer: 'canonical-generation-context',
            rawModelType: 'vision',
            resolvedMode: 'vision',
            derivedFromLayer: 'request-payload',
          },
        },
        finalized: {
          status: 'completed',
          finishReason: 'stop',
          outputText: '这是一张白色矩形图片。',
          reasoningText: '',
          reasoningKind: 'unknown',
          citations: [],
          responseReferences: [],
          searches: [],
          usage: {
            inputTokens: null,
            outputTokens: 7,
            totalTokens: null,
            reasoningTokens: null,
          },
          error: null,
          completedAt: '2026-04-29T10:40:43.000Z',
        },
        eventCount: 3,
        unknownObservationCount: 0,
        unknownObservationLabels: [],
      },
    ],
    outputTokensUsed: 7,
    settledAfterMs: 1_500,
    requestedComposerMode: {
      chatMode: 'vision',
      deepThink: 'unchanged',
      search: 'unchanged',
    },
    composerMode: {
      chatMode: 'vision',
      deepThink: 'on',
      search: 'unavailable',
    },
    beforeSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/',
      routeKind: 'home',
      agentId: null,
      sessionId: null,
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: '#send',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: false,
        selector: null,
        label: null,
        state: 'unavailable',
      },
      fileButton: {
        found: true,
        selector: '[role="button"]',
        label: 'File',
      },
    },
    afterSendSnapshot: {
      pageUrl: 'https://chat.deepseek.com/a/chat/s/session-vision',
      routeKind: 'session',
      agentId: 'chat',
      sessionId: 'session-vision',
      composerInput: {
        found: true,
        selector: 'textarea',
        label: 'Message DeepSeek',
      },
      sendOrStopButton: {
        found: true,
        selector: '#send',
        label: 'Send',
        state: 'send',
      },
      deepThinkToggle: {
        found: true,
        selector: '[role="button"]',
        label: 'DeepThink',
        state: 'on',
      },
      searchToggle: {
        found: false,
        selector: null,
        label: null,
        state: 'unavailable',
      },
      fileButton: {
        found: true,
        selector: '[role="button"]',
        label: 'File',
      },
    },
    fileUpload: createVisionImageFileUploadBatch(),
    assistantText: '这是一张白色矩形图片。',
    assistantTextSource: 'generation-stream',
  }
}

function createVisionImageFileUploadBatch(): DeepSeekFileUploadBatchResult {
  return {
    fileInput: {
      found: true,
      selector: 'input[type="file"]',
      accept: '.png,.jpg,.jpeg,.webp',
      acceptedExtensions: ['.jpeg', '.jpg', '.png', '.webp'],
      multiple: true,
      hidden: true,
    },
    requestedPaths: ['/tmp/vision-white-rect.png'],
    acceptedPaths: ['/tmp/vision-white-rect.png'],
    problems: [],
    files: [
      {
        path: '/tmp/vision-white-rect.png',
        fileName: 'vision-white-rect.png',
        extension: '.png',
        sizeBytes: 96,
        acceptedByPreflight: true,
        uploaded: true,
        settled: true,
        mounted: true,
        fileId: 'file-vision-image',
        serverStatus: 'SUCCESS',
        previewable: true,
        tokenUsage: 4,
        previewUrl: 'https://files.example/vision-white-rect.png',
        errorCode: null,
        errorMessage: null,
        upload: null,
        fetched: null,
        preview: null,
        problems: [],
      },
    ],
    fetches: [],
    settled: true,
    blockingIssues: false,
  }
}

function createAttachmentFileUploadBatch(input: {
  fileId: string
  previewUrl: string
}) {
  return {
    fileInput: {
      found: true,
      selector: 'input[type="file"]',
      accept: '.md',
      acceptedExtensions: ['.md'],
      multiple: true,
      hidden: true,
    },
    requestedPaths: ['./README.md'],
    acceptedPaths: ['./README.md'],
    problems: [],
    files: [
      {
        path: './README.md',
        fileName: 'README.md',
        extension: '.md',
        sizeBytes: 4676,
        acceptedByPreflight: true,
        uploaded: true,
        settled: true,
        mounted: true,
        fileId: input.fileId,
        serverStatus: 'SUCCESS',
        previewable: true,
        tokenUsage: 1391,
        previewUrl: input.previewUrl,
        errorCode: null,
        errorMessage: null,
        upload: null,
        fetched: null,
        preview: null,
        problems: [],
      },
    ],
    fetches: [],
    settled: true,
    blockingIssues: false,
  }
}

async function loadHistoryFixtureSession(fileName: string) {
  const fixture = JSON.parse(
    await readFile(
      join(process.cwd(), 'test/fixtures/deepseek-history-messages', fileName),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }

  return mapHistoryMessagesEnvelopeToSession(JSON.parse(fixture.response.bodyText) as unknown)
}
