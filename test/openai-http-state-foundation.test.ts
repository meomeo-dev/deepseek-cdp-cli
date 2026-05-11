import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import {
  cleanupOpenAIHttpStagedInputFile,
  cleanupOpenAIHttpStagedInputFiles,
  loadOpenAIHttpStagedInputFile,
  stageOpenAIHttpInputFile,
  stageOpenAIHttpInputFiles,
} from '../src/infrastructure/openai/openaiHttpInputFileStaging.js'
import { stageOpenAIHttpHistoryBootstrapArtifact } from '../src/infrastructure/openai/openaiHttpHistoryBootstrapArtifacts.js'
import {
  buildOpenAIHttpChatCompletionFilePath,
  buildOpenAIHttpResponseHandleFilePath,
  resolveOpenAIHttpArtifactsRootDir,
} from '../src/infrastructure/openai/openaiHttpPersistencePaths.js'
import {
  createOpenAIHttpResponseHandleRecord,
  createOpenAIHttpResponseHandleRecordFromReply,
  deleteOpenAIHttpResponseHandleRecord,
  loadOpenAIHttpResponseHandleRecord,
  saveOpenAIHttpResponseHandleRecord,
} from '../src/infrastructure/openai/openaiHttpResponseHandleRegistry.js'
import {
  createOpenAIHttpChatCompletionRecordFromReply,
  deleteOpenAIHttpChatCompletionRecord,
  listOpenAIHttpChatCompletionRecords,
  loadOpenAIHttpChatCompletionRecord,
  saveOpenAIHttpChatCompletionRecord,
  updateOpenAIHttpChatCompletionRecordMetadata,
} from '../src/infrastructure/openai/openaiHttpChatCompletionRegistry.js'

void test('OpenAI HTTP response handle registry persists minimal handle records under the session store root', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-handles-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const record = createOpenAIHttpResponseHandleRecord({
      responseId: 'resp_123',
      model: 'deepseek-chat-browser',
      sessionId: 'session-123',
      sessionFile: '/tmp/session-123.json',
      branchId: 'branch-main',
      agentId: 'chat',
      store: true,
      metadata: {
        topic: 'demo',
      },
      requestId: 'req-123',
      requestClassification: 'new-turn',
      response: {
        id: 'resp_123',
        object: 'response',
        created_at: 1_744_880_000,
        completed_at: 1_744_880_001,
        status: 'completed',
        error: null,
        incomplete_details: null,
        instructions: null,
        model: 'deepseek-chat-browser',
        output: [],
        output_text: 'hello',
        usage: null,
        previous_response_id: null,
        store: true,
        reasoning: null,
        background: null,
        max_output_tokens: null,
        max_tool_calls: null,
        text: {
          format: {
            type: 'text',
          },
        },
        tools: [],
        tool_choice: 'auto',
        truncation: 'disabled',
        parallel_tool_calls: true,
        conversation: null,
        temperature: null,
        top_p: null,
        prompt: null,
        metadata: {
          topic: 'demo',
        },
      },
      inputItems: [
        {
          id: 'msg_123',
          type: 'message',
          role: 'user',
          status: 'completed',
          content: [
            {
              type: 'input_text',
              text: 'hello',
            },
          ],
        },
      ],
      createdAt: '2026-04-15T03:40:00.000Z',
    })

    const filePath = await saveOpenAIHttpResponseHandleRecord(record, {
      sessionStoreDir,
    })
    assert.equal(
      filePath,
      buildOpenAIHttpResponseHandleFilePath('resp_123', sessionStoreDir),
    )
    assert.match(
      filePath,
      /openai-http\/response-handles\/resp_123\.json$/u,
    )

    const loaded = await loadOpenAIHttpResponseHandleRecord('resp_123', {
      sessionStoreDir,
    })
    assert.deepEqual(loaded, record)

    const deleted = await deleteOpenAIHttpResponseHandleRecord('resp_123', {
      sessionStoreDir,
    })
    assert.equal(deleted, true)
    assert.equal(
      await loadOpenAIHttpResponseHandleRecord('resp_123', { sessionStoreDir }),
      null,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP response handle helper snapshots the latest observed branch from a reply result', () => {
  const record = createOpenAIHttpResponseHandleRecordFromReply({
    responseId: 'resp_branch',
    model: 'deepseek-expert-browser',
    store: false,
    requestId: 'req-branch',
    requestClassification: 'session-continuation',
    createdAt: '2026-04-15T03:41:00.000Z',
    result: {
      agentId: 'chat',
      sessionId: 'session-branch',
      sessionFile: '/tmp/session-branch.json',
      generationRuns: [
        {
          context: {
            branchId: null,
          },
        },
        {
          context: {
            branchId: 'branch-followup',
          },
        },
      ] as never,
    },
  })

  assert.equal(record.branchId, 'branch-followup')
  assert.equal(record.store, false)
  assert.deepEqual(record.metadata, {})
  assert.equal(record.requestClassification, 'session-continuation')
  assert.equal(record.response, null)
  assert.equal(record.inputItems, null)
})

void test('OpenAI HTTP response handle registry upgrades legacy records without metadata to an empty public metadata object', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-handles-legacy-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const filePath = buildOpenAIHttpResponseHandleFilePath('resp_legacy', sessionStoreDir)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(
      filePath,
      `${JSON.stringify({
        kind: 'openai-http-response-handle',
        version: 1,
        responseId: 'resp_legacy',
        endpoint: '/v1/responses',
        model: 'deepseek-chat-browser',
        sessionId: 'session-legacy',
        sessionFile: '/tmp/session-legacy.json',
        branchId: null,
        agentId: 'chat',
        store: true,
        requestId: 'req-legacy',
        requestClassification: 'new-turn',
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf8',
    )

    const loaded = await loadOpenAIHttpResponseHandleRecord('resp_legacy', {
      sessionStoreDir,
    })

    assert.deepEqual(loaded?.metadata, {})
    assert.equal(loaded?.response, null)
    assert.equal(loaded?.inputItems, null)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP chat completion registry persists stored create-side records under the session store root', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-chat-records-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const record = createOpenAIHttpChatCompletionRecordFromReply({
      model: 'deepseek-chat-browser',
      store: true,
      metadata: {
        topic: 'demo',
      },
      requestId: 'req-chat-store',
      requestClassification: 'history-bootstrap',
      messages: [
        {
          role: 'developer',
          content: 'Answer tersely.',
        },
        {
          role: 'user',
          content: 'Write a haiku.',
        },
      ],
      completion: {
        id: 'chatcmpl_123',
        object: 'chat.completion',
        created: 1_744_622_800,
        model: 'deepseek-chat-browser',
        metadata: {
          topic: 'demo',
        },
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Circuits hum softly.',
              refusal: null,
              annotations: [],
            },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
      },
      createdAt: '2026-04-16T03:45:00.000Z',
      result: {
        agentId: 'chat',
        sessionId: 'session-chat-store',
        sessionFile: '/tmp/session-chat-store.json',
        generationRuns: [
          {
            context: {
              branchId: 'branch-chat-store',
            },
          },
        ] as never,
      },
    })

    const filePath = await saveOpenAIHttpChatCompletionRecord(record, {
      sessionStoreDir,
    })
    assert.equal(
      filePath,
      buildOpenAIHttpChatCompletionFilePath('chatcmpl_123', sessionStoreDir),
    )
    assert.match(
      filePath,
      /openai-http\/chat-completions\/chatcmpl_123\.json$/u,
    )

    const loaded = await loadOpenAIHttpChatCompletionRecord('chatcmpl_123', {
      sessionStoreDir,
    })
    assert.deepEqual(loaded, record)

    const deleted = await deleteOpenAIHttpChatCompletionRecord('chatcmpl_123', {
      sessionStoreDir,
    })
    assert.equal(deleted, true)
    assert.equal(
      await loadOpenAIHttpChatCompletionRecord('chatcmpl_123', { sessionStoreDir }),
      null,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP chat completion registry can list records and update stored metadata in place', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-chat-list-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const alpha = createOpenAIHttpChatCompletionRecordFromReply({
      model: 'deepseek-chat-browser',
      store: true,
      metadata: {
        topic: 'alpha',
      },
      requestClassification: 'new-turn',
      messages: [
        {
          role: 'user',
          content: 'alpha',
        },
      ],
      completion: {
        id: 'chatcmpl_alpha',
        object: 'chat.completion',
        created: 1_744_622_801,
        model: 'deepseek-chat-browser',
        metadata: {
          topic: 'alpha',
        },
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'alpha reply',
              refusal: null,
              annotations: [],
            },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
      },
      createdAt: '2026-04-16T03:46:00.000Z',
      result: {
        agentId: 'chat',
        sessionId: 'session-alpha',
        sessionFile: '/tmp/session-alpha.json',
        generationRuns: [
          {
            context: {
              branchId: 'branch-alpha',
            },
          },
        ] as never,
      },
    })
    const beta = createOpenAIHttpChatCompletionRecordFromReply({
      model: 'deepseek-expert-browser',
      store: true,
      metadata: {
        topic: 'beta',
      },
      requestClassification: 'history-bootstrap',
      messages: [
        {
          role: 'developer',
          content: 'be concise',
        },
        {
          role: 'user',
          content: 'beta',
        },
      ],
      completion: {
        id: 'chatcmpl_beta',
        object: 'chat.completion',
        created: 1_744_622_802,
        model: 'deepseek-expert-browser',
        metadata: {
          topic: 'beta',
        },
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'beta reply',
              refusal: null,
              annotations: [],
            },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
      },
      createdAt: '2026-04-16T03:47:00.000Z',
      result: {
        agentId: 'chat',
        sessionId: 'session-beta',
        sessionFile: '/tmp/session-beta.json',
        generationRuns: [
          {
            context: {
              branchId: 'branch-beta',
            },
          },
        ] as never,
      },
    })

    await saveOpenAIHttpChatCompletionRecord(alpha, { sessionStoreDir })
    await saveOpenAIHttpChatCompletionRecord(beta, { sessionStoreDir })

    const listed = await listOpenAIHttpChatCompletionRecords({ sessionStoreDir })
    assert.deepEqual(
      listed.map(record => record.completionId),
      ['chatcmpl_alpha', 'chatcmpl_beta'],
    )

    const updated = await updateOpenAIHttpChatCompletionRecordMetadata(
      'chatcmpl_beta',
      {
        topic: 'beta',
        ticket: '123',
      },
      {
        sessionStoreDir,
        updatedAt: '2026-04-16T04:00:00.000Z',
      },
    )

    assert.deepEqual(updated?.metadata, {
      topic: 'beta',
      ticket: '123',
    })
    assert.deepEqual(updated?.completion.metadata, {
      topic: 'beta',
      ticket: '123',
    })
    assert.equal(updated?.updatedAt, '2026-04-16T04:00:00.000Z')

    const reloaded = await loadOpenAIHttpChatCompletionRecord('chatcmpl_beta', {
      sessionStoreDir,
    })
    assert.deepEqual(reloaded?.metadata, {
      topic: 'beta',
      ticket: '123',
    })
    assert.deepEqual(reloaded?.completion.metadata, {
      topic: 'beta',
      ticket: '123',
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP input file staging decodes base64 into a managed staging directory and manifest', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-stage-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const staged = await stageOpenAIHttpInputFile({
      requestId: 'req-stage-1',
      sessionStoreDir,
      file: {
        type: 'input_file',
        filename: '../brief.txt',
        fileData: Buffer.from('hello from stage', 'utf8').toString('base64'),
      },
      createdAt: '2026-04-15T03:42:00.000Z',
    })

    assert.equal(
      staged.stagingDirectory.startsWith(resolveOpenAIHttpArtifactsRootDir(sessionStoreDir)),
      true,
    )
    assert.equal(staged.originalFilename, '../brief.txt')
    assert.equal(staged.stagedFilename, 'brief.txt')
    assert.equal(staged.endpoint, '/v1/responses')
    assert.equal(staged.source, 'request-input')
    assert.equal(
      await readFile(staged.filePath, 'utf8'),
      'hello from stage',
    )

    const manifest = await loadOpenAIHttpStagedInputFile(staged.stageId, {
      sessionStoreDir,
    })
    assert.deepEqual(manifest, staged)

    const cleaned = await cleanupOpenAIHttpStagedInputFile(staged.stageId, {
      sessionStoreDir,
    })
    assert.equal(cleaned, true)
    assert.equal(
      await loadOpenAIHttpStagedInputFile(staged.stageId, { sessionStoreDir }),
      null,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP input file staging can stage and batch-clean multiple files', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-stage-batch-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const stagedFiles = await stageOpenAIHttpInputFiles({
      requestId: 'req-stage-batch',
      sessionStoreDir,
      files: [
        {
          type: 'input_file',
          filename: 'alpha.md',
          fileData: Buffer.from('# alpha', 'utf8').toString('base64'),
        },
        {
          type: 'input_file',
          filename: 'beta.txt',
          fileData: Buffer.from('beta', 'utf8').toString('base64'),
        },
      ],
      createdAt: '2026-04-15T03:43:00.000Z',
    })

    assert.equal(stagedFiles.length, 2)
    assert.notEqual(stagedFiles[0]?.stageId, stagedFiles[1]?.stageId)

    await cleanupOpenAIHttpStagedInputFiles({
      stagedFiles,
      sessionStoreDir,
    })

    for (const staged of stagedFiles) {
      assert.equal(
        await loadOpenAIHttpStagedInputFile(staged.stageId, { sessionStoreDir }),
        null,
      )
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP history bootstrap artifact staging reuses the shared staged-file seam for chat completions', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-history-artifact-'))
  try {
    const sessionStoreDir = join(tempDir, 'sessions')
    const staged = await stageOpenAIHttpHistoryBootstrapArtifact({
      requestId: 'req-history-artifact',
      sessionStoreDir,
      request: {
        endpoint: '/v1/chat/completions',
        model: 'deepseek-chat-browser',
        messages: [
          {
            role: 'developer',
            content: 'Answer tersely.',
          },
          {
            role: 'user',
            content: 'Summarize this page.',
          },
        ],
        stream: false,
        streamOptions: null,
        n: 1,
        store: null,
        metadata: null,
        deepseekOptions: {},
        requestClassification: 'history-bootstrap',
        historyBootstrap: {
          historyMessages: [
            {
              role: 'developer',
              content: 'Answer tersely.',
            },
          ],
          latestTurnMessages: [
            {
              role: 'user',
              content: 'Summarize this page.',
            },
          ],
          latestActionableUserTurn: {
            itemIndex: 1,
            message: {
              role: 'user',
              content: 'Summarize this page.',
            },
          },
        },
      },
      createdAt: '2026-04-16T02:43:00.000Z',
    })

    assert.notEqual(staged, null)
    assert.equal(staged?.endpoint, '/v1/chat/completions')
    assert.equal(staged?.source, 'history-bootstrap-artifact')
    assert.match(
      await readFile(staged?.filePath ?? '/tmp/missing', 'utf8'),
      /Developer:\nAnswer tersely\./u,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

void test('OpenAI HTTP input file staging rejects invalid base64 file_data fail-closed', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-openai-http-stage-invalid-'))
  try {
    await assert.rejects(
      stageOpenAIHttpInputFile({
        requestId: 'req-invalid',
        sessionStoreDir: join(tempDir, 'sessions'),
        file: {
          type: 'input_file',
          filename: 'bad.txt',
          fileData: 'not base64!',
        },
      }),
      /invalid base64/u,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
