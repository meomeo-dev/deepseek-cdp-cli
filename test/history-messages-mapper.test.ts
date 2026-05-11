import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { observeDeepSeekInlineCitations } from '../src/domain/session/inlineReferenceTokens.js'
import { mapHistoryMessagesEnvelopeToSession } from '../src/infrastructure/deepseek/historyMessagesMapper.js'
import { loadSessionFromFile } from '../src/infrastructure/deepseek/fileSystemSessionStore.js'

void test('maps a real audited history_messages payload into a DeepSeekSession', async () => {
  const fixture = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.real.fixture.json',
      ),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }

  const session = mapHistoryMessagesEnvelopeToSession(JSON.parse(fixture.response.bodyText) as unknown)

  assert.equal(session.id, 'session-redacted')
  assert.equal(session.title, 'Exact Reply Request')
  assert.equal(session.modeFact?.rawModelType, 'default')
  assert.equal(session.modeFact?.resolvedMode, 'instant')
  assert.equal(session.branches.length, 1)
  assert.equal(session.branches[0]?.messages[0]?.text, 'Reply with exactly: history probe ok.')
  assert.equal(session.branches[0]?.messages[1]?.text, 'history probe ok.')
})

void test('maps a real attachment-bearing first-message history_messages payload into a DeepSeekSession', async () => {
  const fixture = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.attachments.first-message.real.fixture.json',
      ),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }

  const session = mapHistoryMessagesEnvelopeToSession(JSON.parse(fixture.response.bodyText) as unknown)

  assert.equal(session.id, 'session-attachment-redacted')
  assert.equal(session.branches.length, 1)
  assert.equal(session.branches[0]?.messages.map(message => message.id).join(','), '1,2')
  assert.equal(session.branches[0]?.messages[0]?.attachments[0]?.id, 'file-attachment-first-redacted')
  assert.equal(session.branches[0]?.messages[0]?.attachments[0]?.name, 'README.md')
  assert.equal(session.branches[0]?.messages[0]?.attachments[0]?.sizeBytes, 4676)
})

void test('maps a real attachment-bearing reply MERGE history_messages payload into a DeepSeekSession', async () => {
  const fixture = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.attachments.reply.real.fixture.json',
      ),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }

  const session = mapHistoryMessagesEnvelopeToSession(JSON.parse(fixture.response.bodyText) as unknown)

  assert.equal(session.id, 'session-attachment-redacted')
  assert.equal(session.branches.length, 1)
  assert.equal(session.branches[0]?.messages.map(message => message.id).join(','), '3,4')
  assert.equal(session.branches[0]?.messages[0]?.attachments[0]?.id, 'file-attachment-reply-redacted')
  assert.equal(session.branches[0]?.messages[0]?.attachments[0]?.name, 'README.md')
  assert.equal(session.branches[0]?.messages[0]?.text, '再次阅读附件后，只回复：attachment reply ok。')
})

void test('maps a real search-enabled history_messages payload and resolves citations from RESPONSE references', async () => {
  const fixture = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        'test/fixtures/deepseek-history-messages/history-messages.search.real.fixture.json',
      ),
      'utf8',
    ),
  ) as {
    response: {
      bodyText: string
    }
  }

  const session = mapHistoryMessagesEnvelopeToSession(JSON.parse(fixture.response.bodyText) as unknown)
  const assistantMessage = session.branches[0]?.messages[1]

  assert.equal(session.id, 'session-search-redacted')
  assert.equal(session.title, 'OpenAI Anthropic API Streaming Comparison')
  assert.equal(session.modeFact?.rawModelType, 'default')
  assert.equal(session.branches.length, 1)
  assert.equal(assistantMessage?.text, '让我先搜索资料...[reference:0]')
  assert.equal(assistantMessage?.citations.length, 1)
  assert.equal(assistantMessage?.citations[0]?.title, 'Agent Streaming Architecture in OpenAI Agents SDK¶')
  assert.equal(assistantMessage?.citations[0]?.url, 'https://adalflow.sylph.ai/design/agent-streaming.html')
  assert.deepEqual(assistantMessage?.responseReferences, [
    {
      referenceId: '4',
      referenceType: 'TOOL_OPEN',
    },
    {
      referenceId: '3',
      referenceType: 'TOOL_SEARCH',
    },
  ])
  assert.equal(assistantMessage?.searches?.length, 1)
  assert.equal(
    assistantMessage?.searches?.[0]?.query,
    'OpenAI Responses API streaming events data structure official documentation',
  )
  assert.equal(assistantMessage?.searches?.[0]?.results[0]?.toolSearchFragmentId, '3')
  assert.deepEqual(
    assistantMessage?.searches?.[0]?.results[0]?.toolOpenFragmentIds,
    ['4'],
  )
  assert.deepEqual(
    assistantMessage?.searches?.[0]?.results[0]?.responseReferences?.map(reference => ({
      type: reference.referenceType,
      id: reference.referenceId,
      resolution: reference.resolution,
    })),
    [
      {
        type: 'TOOL_SEARCH',
        id: '3',
        resolution: 'direct-tool-search',
      },
      {
        type: 'TOOL_OPEN',
        id: '4',
        resolution: 'via-tool-open',
      },
    ],
  )
})

void test('maps TOOL_SEARCH fragment results into citations when explicit RESPONSE references are absent', () => {
  const session = mapHistoryMessagesEnvelopeToSession({
    data: {
      biz_data: {
        chat_session: {
          id: 'session-search-only',
          title: 'Search Only',
          agent: 'chat',
        },
        chat_messages: [
          {
            message_id: 1,
            role: 'USER',
            inserted_at: 1775446562.036,
            fragments: [
              {
                id: 1,
                type: 'REQUEST',
                content: '帮我搜索资料',
              },
            ],
          },
          {
            message_id: 2,
            parent_id: 1,
            role: 'ASSISTANT',
            inserted_at: 1775446562.037,
            fragments: [
              {
                id: 3,
                type: 'TOOL_SEARCH',
                status: 'FINISHED',
                results: [
                  {
                    url: 'https://example.com/search-result',
                    title: 'Example Search Result',
                    snippet: 'search result snippet',
                  },
                ],
              },
              {
                id: 4,
                type: 'RESPONSE',
                content: '让我先搜索资料...',
                references: [],
              },
            ],
          },
        ],
      },
    },
  })

  const assistantMessage = session.branches[0]?.messages[1]
  assert.equal(assistantMessage?.citations.length, 1)
  assert.equal(assistantMessage?.citations[0]?.title, 'Example Search Result')
  assert.equal(assistantMessage?.citations[0]?.url, 'https://example.com/search-result')
  assert.equal(assistantMessage?.searches?.length, 1)
  assert.equal(assistantMessage?.searches?.[0]?.results[0]?.title, 'Example Search Result')
  assert.equal(assistantMessage?.responseReferences?.length ?? 0, 0)
  assert.equal(assistantMessage?.searches?.[0]?.results[0]?.responseReferences?.length ?? 0, 0)
})

void test('maps citation-like inline tokens without structured response references as suspected generated citations', () => {
  const session = mapHistoryMessagesEnvelopeToSession({
    data: {
      biz_data: {
        chat_session: {
          id: 'session-inline-citation',
          title: 'Inline Citation',
          agent: 'chat',
        },
        chat_messages: [
          {
            message_id: 1,
            role: 'USER',
            inserted_at: 1775446562.036,
            fragments: [
              {
                id: 1,
                type: 'REQUEST',
                content: '给我一个引用例子',
              },
            ],
          },
          {
            message_id: 2,
            parent_id: 1,
            role: 'ASSISTANT',
            inserted_at: 1775446562.037,
            fragments: [
              {
                id: 4,
                type: 'RESPONSE',
                content: '这里有引用[15†L11-L12]',
                references: [],
              },
            ],
          },
        ],
      },
    },
  })

  const assistantMessage = session.branches[0]?.messages[1]
  const observations = observeDeepSeekInlineCitations({
    text: assistantMessage?.text,
    responseReferences: assistantMessage?.responseReferences,
  })

  assert.equal(assistantMessage?.responseReferences?.length ?? 0, 0)
  assert.deepEqual(observations, [
    {
      token: '[15†L11-L12]',
      kind: 'line-range',
      verificationStatus: 'suspected-generated-citation',
      resolution: 'no-structured-response-references',
    },
  ])
})

void test('preserves RESPONSE.references occurrence order so repeated inline ordinals stay resolvable', () => {
  const session = mapHistoryMessagesEnvelopeToSession({
    data: {
      biz_data: {
        chat_session: {
          id: 'session-repeated-inline-references',
          title: 'Repeated Inline References',
          agent: 'chat',
        },
        chat_messages: [
          {
            message_id: 1,
            role: 'USER',
            inserted_at: 1775446562.036,
            fragments: [
              {
                id: 1,
                type: 'REQUEST',
                content: '检查 citation 顺序',
              },
            ],
          },
          {
            message_id: 2,
            parent_id: 1,
            role: 'ASSISTANT',
            inserted_at: 1775446562.037,
            fragments: [
              {
                id: 7,
                type: 'TOOL_SEARCH',
                status: 'FINISHED',
                queries: [
                  {
                    query: 'citation ordering example',
                  },
                ],
                results: [
                  {
                    url: 'https://example.com/search-result',
                    title: 'Example Search Result',
                    snippet: 'search result snippet',
                  },
                ],
              },
              {
                id: 8,
                type: 'TOOL_OPEN',
                status: 'FINISHED',
                result: {
                  url: 'https://example.com/open-result',
                  title: 'Opened Example Page',
                  snippet: 'opened page snippet',
                },
                reference: {
                  id: 7,
                  type: 'TOOL_SEARCH',
                },
              },
              {
                id: 9,
                type: 'RESPONSE',
                content:
                  '先看搜索[reference:0]，再看网页[reference:1]，然后重复搜索[reference:2]和网页[reference:3]。',
                references: [
                  {
                    id: 7,
                    type: 'TOOL_SEARCH',
                  },
                  {
                    id: 8,
                    type: 'TOOL_OPEN',
                  },
                  {
                    id: 7,
                    type: 'TOOL_SEARCH',
                  },
                  {
                    id: 8,
                    type: 'TOOL_OPEN',
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  })

  const assistantMessage = session.branches[0]?.messages[1]
  const observations = observeDeepSeekInlineCitations({
    text: assistantMessage?.text,
    responseReferences: assistantMessage?.responseReferences,
  })

  assert.deepEqual(assistantMessage?.responseReferences, [
    {
      referenceId: '7',
      referenceType: 'TOOL_SEARCH',
    },
    {
      referenceId: '8',
      referenceType: 'TOOL_OPEN',
    },
    {
      referenceId: '7',
      referenceType: 'TOOL_SEARCH',
    },
    {
      referenceId: '8',
      referenceType: 'TOOL_OPEN',
    },
  ])
  assert.deepEqual(
    observations.map(observation => ({
      token: observation.token,
      verificationStatus: observation.verificationStatus,
      resolution: observation.resolution,
      ordinal: observation.ordinal,
      responseReference: observation.responseReference
        ? {
            referenceId: observation.responseReference.referenceId,
            referenceType: observation.responseReference.referenceType,
          }
        : undefined,
    })),
    [
      {
        token: '[reference:0]',
        verificationStatus: 'verified',
        resolution: 'response-reference-ordinal',
        ordinal: 0,
        responseReference: {
          referenceId: '7',
          referenceType: 'TOOL_SEARCH',
        },
      },
      {
        token: '[reference:1]',
        verificationStatus: 'verified',
        resolution: 'response-reference-ordinal',
        ordinal: 1,
        responseReference: {
          referenceId: '8',
          referenceType: 'TOOL_OPEN',
        },
      },
      {
        token: '[reference:2]',
        verificationStatus: 'verified',
        resolution: 'response-reference-ordinal',
        ordinal: 2,
        responseReference: {
          referenceId: '7',
          referenceType: 'TOOL_SEARCH',
        },
      },
      {
        token: '[reference:3]',
        verificationStatus: 'verified',
        resolution: 'response-reference-ordinal',
        ordinal: 3,
        responseReference: {
          referenceId: '8',
          referenceType: 'TOOL_OPEN',
        },
      },
    ],
  )
})

void test('maps a history_messages payload into a DeepSeekSession', async () => {
  const fixture = JSON.parse(
    await readFile(join(process.cwd(), 'test/fixtures/sample-history-messages.json'), 'utf8'),
  ) as unknown

  const session = mapHistoryMessagesEnvelopeToSession(fixture)

  assert.equal(session.id, 'session-history-001')
  assert.equal(session.agentId, 'chat')
  assert.equal(session.branches.length, 2)
  assert.equal(session.branches[0]?.id, 'branch-alt')
  assert.equal(session.branches[1]?.id, 'branch-main')
  assert.equal(session.branches[1]?.messages[0]?.attachments[0]?.name, 'brief.pdf')
  assert.equal(session.branches[1]?.messages[1]?.citations[0]?.title, 'Example Search Result')
})

void test('loadSessionFromFile accepts raw history_messages JSON', async () => {
  const session = await loadSessionFromFile(
    join(process.cwd(), 'test/fixtures/sample-history-messages.json'),
  )

  assert.equal(session.id, 'session-history-001')
  assert.equal(session.branches[0]?.id, 'branch-alt')
})
