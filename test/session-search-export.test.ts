import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { exportConversation } from '../src/application/usecases/exportConversation.js'

const SEARCH_HISTORY_FIXTURE = join(
  process.cwd(),
  'test/fixtures/deepseek-history-messages/history-messages.search.real.fixture.json',
)

void test('exports search-enabled history_messages with native search results to branch and full-session json', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-search-export-json-'))

  try {
    const fixture = JSON.parse(await readFile(SEARCH_HISTORY_FIXTURE, 'utf8')) as {
      response: {
        bodyText: string
      }
    }

    const sessionFile = join(outputDir, 'search-history.raw.json')
    const branchOutputFile = join(outputDir, 'search-history.branch.json')
    const sessionOutputFile = join(outputDir, 'search-history.session.json')
    await writeFile(sessionFile, `${fixture.response.bodyText}\n`, 'utf8')

    const branchResult = await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'json',
      outputFile: branchOutputFile,
    })
    const sessionResult = await exportConversation({
      sessionFile,
      format: 'json',
      outputFile: sessionOutputFile,
    })

    const branchContent = JSON.parse(await readFile(branchOutputFile, 'utf8')) as {
      branch: {
        citations: Array<{ title: string }>
        searchEvidence: {
          available: boolean
          derivedFrom: string
          queryCount: number
          resultCount: number
          results: Array<{
            title: string
            toolSearchFragmentId?: string
            toolOpenFragmentIds?: string[]
            responseReferences?: Array<{
              referenceType: string
              referenceId: string
              resolution: string
            }>
          }>
          searches: Array<{
            query: string | null
            status: string
            results: Array<{
              title: string
            }>
          }>
        }
        messages: Array<{
          responseReferences?: Array<{
            referenceId: string
            referenceType: string
          }>
          citations: Array<{ title: string }>
          searches?: Array<{
            query: string | null
            results: Array<{
              title: string
            }>
          }>
        }>
      }
    }
    const sessionContent = JSON.parse(await readFile(sessionOutputFile, 'utf8')) as {
      branches: Array<{
        branchId: string
        searchEvidence: {
          derivedFrom: string
          queryCount: number
          resultCount: number
        }
        messages: Array<{
          searches?: Array<{
            query: string | null
          }>
        }>
      }>
    }

    assert.equal(branchResult.exportScope, 'branch')
    assert.equal(branchContent.branch.citations[0]?.title, 'Agent Streaming Architecture in OpenAI Agents SDK¶')
    assert.equal(branchContent.branch.searchEvidence.available, true)
    assert.equal(branchContent.branch.searchEvidence.derivedFrom, 'message-searches')
    assert.equal(branchContent.branch.searchEvidence.queryCount, 1)
    assert.equal(branchContent.branch.searchEvidence.resultCount, 1)
    assert.deepEqual(branchContent.branch.messages[1]?.responseReferences, [
      {
        referenceId: '4',
        referenceType: 'TOOL_OPEN',
      },
      {
        referenceId: '3',
        referenceType: 'TOOL_SEARCH',
      },
    ])
    assert.equal(
      branchContent.branch.searchEvidence.searches[0]?.query,
      'OpenAI Responses API streaming events data structure official documentation',
    )
    assert.equal(branchContent.branch.searchEvidence.results[0]?.toolSearchFragmentId, '3')
    assert.deepEqual(branchContent.branch.searchEvidence.results[0]?.toolOpenFragmentIds, ['4'])
    assert.deepEqual(
      branchContent.branch.searchEvidence.results[0]?.responseReferences?.map(reference => ({
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
    assert.equal(
      branchContent.branch.messages[1]?.searches?.[0]?.results[0]?.title,
      'Agent Streaming Architecture in OpenAI Agents SDK¶',
    )

    assert.equal(sessionResult.exportScope, 'session')
    assert.equal(sessionContent.branches[0]?.branchId, 'branch-main')
    assert.equal(sessionContent.branches[0]?.searchEvidence.derivedFrom, 'message-searches')
    assert.equal(sessionContent.branches[0]?.searchEvidence.queryCount, 1)
    assert.equal(sessionContent.branches[0]?.searchEvidence.resultCount, 1)
    assert.equal(
      sessionContent.branches[0]?.messages[1]?.searches?.[0]?.query,
      'OpenAI Responses API streaming events data structure official documentation',
    )
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports search-enabled history_messages to markdown with query and reference mapping details', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-search-export-markdown-'))

  try {
    const fixture = JSON.parse(await readFile(SEARCH_HISTORY_FIXTURE, 'utf8')) as {
      response: {
        bodyText: string
      }
    }

    const sessionFile = join(outputDir, 'search-history.raw.json')
    const outputFile = join(outputDir, 'search-history.md')
    await writeFile(sessionFile, `${fixture.response.bodyText}\n`, 'utf8')

    const result = await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.match(content, /## Search Evidence/)
    assert.match(
      content,
      /Query: `OpenAI Responses API streaming events data structure official documentation`/,
    )
    assert.match(content, /#### Inline References Observed/)
    assert.match(content, /`\[reference:0\]` · kind=`reference-ordinal` · status=`verified`/)
    assert.match(content, /RESPONSE\.references\[0\]=TOOL_OPEN#4/)
    assert.match(content, /Verified `\[reference:n\]` tokens map by occurrence order/)
    assert.match(content, /#### Structured Response References/)
    assert.match(content, /`TOOL_OPEN#4`/)
    assert.match(content, /#### Search Results \/ Reference Mapping/)
    assert.match(content, /toolSearch=`3`/)
    assert.match(content, /TOOL_SEARCH#3\/direct-tool-search/)
    assert.match(content, /TOOL_OPEN#4\/via-tool-open/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports search-enabled history_messages to text with human-readable search and citation sections', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-search-export-text-'))

  try {
    const fixture = JSON.parse(await readFile(SEARCH_HISTORY_FIXTURE, 'utf8')) as {
      response: {
        bodyText: string
      }
    }

    const sessionFile = join(outputDir, 'search-history.raw.json')
    const outputFile = join(outputDir, 'search-history.txt')
    await writeFile(sessionFile, `${fixture.response.bodyText}\n`, 'utf8')

    const result = await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'text',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.equal(result.exportScope, 'branch')
    assert.match(content, /DeepSeek Session: OpenAI Anthropic API Streaming Comparison/)
    assert.match(content, /Assistant:\n/)
    assert.match(content, /Citations:/)
    assert.match(
      content,
      /- \[reference:0\] Exact page \| Agent Streaming Architecture in OpenAI Agents SDK¶ \| https:\/\/adalflow\.sylph\.ai\/design\/agent-streaming\.html/,
    )
    assert.match(
      content,
      /- \[reference:1\] Search result set \| query=OpenAI Responses API streaming events data structure official documentation \| candidates=1/,
    )
    assert.match(
      content,
      /candidate 1: Agent Streaming Architecture in OpenAI Agents SDK¶ \| https:\/\/adalflow\.sylph\.ai\/design\/agent-streaming\.html/,
    )
    assert.match(
      content,
      /Note: `\[reference:n\]` backed by `TOOL_SEARCH` denotes a search result set, not a single verified webpage\./,
    )
    assert.doesNotMatch(content, /DeepSeek Session Branch Export/)
    assert.doesNotMatch(content, /Inline References Observed/)
    assert.doesNotMatch(content, /Structured Response References/)
    assert.doesNotMatch(content, /Search Results \/ Reference Mapping/)
    assert.doesNotMatch(content, /^## /m)
    assert.doesNotMatch(content, /\[[^\]]+\]\(https?:\/\//)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports citation-like tokens without structured response references as suspected generated citations', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-inline-citation-export-'))

  try {
    const sessionFile = join(outputDir, 'inline-citation.raw.json')
    const outputFile = join(outputDir, 'inline-citation.md')
    await writeFile(
      sessionFile,
      `${JSON.stringify({
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
      })}\n`,
      'utf8',
    )

    await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'markdown',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.match(content, /`\[15†L11-L12\]` · kind=`line-range` · status=`suspected-generated-citation`/)
    assert.match(content, /no-structured-response-references/)
    assert.match(
      content,
      /Citation-like tokens without structured DeepSeek `RESPONSE\.references\[\]` are treated as suspected generated citations\./,
    )
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

void test('exports citation-like tokens without structured response references to text with a suspected-generated note', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'deepseek-cdp-cli-inline-citation-export-text-'))

  try {
    const sessionFile = join(outputDir, 'inline-citation.raw.json')
    const outputFile = join(outputDir, 'inline-citation.txt')
    await writeFile(
      sessionFile,
      `${JSON.stringify({
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
      })}\n`,
      'utf8',
    )

    await exportConversation({
      sessionFile,
      branchId: 'branch-main',
      format: 'text',
      outputFile,
    })

    const content = await readFile(outputFile, 'utf8')
    assert.match(content, /Citations:\n- No structured citations were returned by DeepSeek\./)
    assert.match(
      content,
      /- Suspected generated citations without structured DeepSeek backing: \[15†L11-L12\]/,
    )
    assert.doesNotMatch(content, /^## /m)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})
