import type {
  DeepSeekAttachment,
  DeepSeekBranch,
  DeepSeekCitation,
  DeepSeekMessage,
  DeepSeekMessageResponseReference,
  DeepSeekSession,
} from '../../types/deepseek-session.types.js'
import { buildDeepSeekChatModeFact } from './deepSeekChatModeSignal.js'
import { extractDeepSeekMessageSearchesFromHistoryRecord } from './deepSeekSessionSearchMapping.js'

type JsonRecord = Record<string, unknown>

const DEFAULT_BRANCH_ID = 'branch-main'

export function isDeepSeekSession(value: unknown): value is DeepSeekSession {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['agentId'] === 'string' &&
    typeof value['title'] === 'string' &&
    Array.isArray(value['branches'])
  )
}

export function mapHistoryMessagesEnvelopeToSession(raw: unknown): DeepSeekSession {
  if (!isRecord(raw) && !Array.isArray(raw)) {
    throw new Error('history_messages payload must be a JSON object or array.')
  }

  const data = resolveDataContainer(raw)
  const sessionContainer = firstRecord([
    getRecord(data, 'chat_session'),
    getRecord(data, 'session'),
    getRecord(data, 'chat_session'),
    getRecord(data, 'conversation'),
    isRecord(raw) ? getRecord(raw, 'session') : undefined,
  ])

  const rawMessages = extractRawMessages(data, raw)
  if (rawMessages.length === 0) {
    throw new Error('Could not find any messages in the history_messages payload.')
  }

  const sessionId =
    firstString([
      sessionContainer?.['id'],
      data['session_id'],
      data['chat_session_id'],
      data['conversation_id'],
      data['sessionId'],
    ]) ?? 'session-unknown'
  const agentId =
    firstString([
      sessionContainer?.['agent_id'],
      sessionContainer?.['agentId'],
      data['agent_id'],
      data['agentId'],
      isRecord(raw) ? raw['agent_id'] : undefined,
    ]) ?? 'chat'
  const title =
    firstString([
      sessionContainer?.['title'],
      sessionContainer?.['name'],
      data['title'],
      data['session_title'],
      data['conversation_title'],
    ]) ?? `DeepSeek Session ${sessionId}`
  const modeFact = buildDeepSeekChatModeFact({
    sourceLayer: 'history-messages-mapped-session',
    rawModelType: firstString([
      sessionContainer?.['model_type'],
      sessionContainer?.['modelType'],
      data['model_type'],
      data['modelType'],
    ]),
    derivedFromLayer: 'history-messages-raw',
  })

  const normalizedMessages = rawMessages
    .map((message, index) => normalizeMessage(message, index))

  const branchMetadata = extractBranchMetadata(data)
  const groupedMessages = new Map<string, DeepSeekMessage[]>()

  for (const message of normalizedMessages) {
    const collection = groupedMessages.get(message.branchId) ?? []
    collection.push(message)
    groupedMessages.set(message.branchId, collection)
  }

  if (!groupedMessages.has(DEFAULT_BRANCH_ID) && branchMetadata.size === 0) {
    groupedMessages.set(DEFAULT_BRANCH_ID, [])
  }

  const branchIds = new Set<string>([
    ...groupedMessages.keys(),
    ...branchMetadata.keys(),
  ])

  const createdAt = normalizedMessages[0]?.createdAt ?? new Date(0).toISOString()

  const branches: DeepSeekBranch[] = [...branchIds]
    .sort()
    .map(branchId => {
      const metadata = branchMetadata.get(branchId)
      const messages = groupedMessages.get(branchId) ?? []
      return {
        id: branchId,
        sessionId,
        title: metadata?.title ?? inferBranchTitle(branchId, messages),
        createdAt: metadata?.createdAt ?? messages[0]?.createdAt ?? createdAt,
        sourceMessageId: metadata?.sourceMessageId,
        messages,
      }
    })

  return {
    id: sessionId,
    agentId,
    title,
    createdAt,
    ...(modeFact ? { modeFact } : {}),
    branches,
  }
}

function resolveDataContainer(raw: unknown): JsonRecord {
  if (Array.isArray(raw)) {
    return {
      messages: raw,
    }
  }

  return (
    firstRecord([
      isRecord(raw) ? getRecord(getRecord(raw, 'data') ?? {}, 'biz_data') : undefined,
      isRecord(raw) ? getRecord(raw, 'data') : undefined,
      isRecord(raw) ? getRecord(raw, 'result') : undefined,
      isRecord(raw) ? getRecord(raw, 'payload') : undefined,
      isRecord(raw) ? raw : undefined,
    ]) ?? {}
  )
}

function extractRawMessages(data: JsonRecord, raw: unknown): unknown[] {
  const candidates: unknown[] = [
    data['chat_messages'],
    data['messages'],
    data['history_messages'],
    data['items'],
    data['list'],
    isRecord(raw) ? getRecord(getRecord(getRecord(raw, 'data') ?? {}, 'biz_data') ?? {}, 'chat_messages') : undefined,
    isRecord(raw) ? raw['messages'] : undefined,
    isRecord(raw) ? raw['history_messages'] : undefined,
    raw,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  const messageMap = firstRecord([
    getRecord(data, 'message_map'),
    getRecord(data, 'messages_map'),
    isRecord(raw) ? getRecord(raw, 'message_map') : undefined,
  ])
  if (messageMap) {
    return Object.values(messageMap)
  }

  return []
}

function normalizeMessage(raw: unknown, index: number): DeepSeekMessage {
  const record = isRecord(raw) ? raw : {}
  const branchId =
    firstString([
      record['branch_id'],
      record['branchId'],
      record['conversation_branch_id'],
    ]) ?? DEFAULT_BRANCH_ID
  const responseReferences = extractMessageResponseReferences(record)

  return {
    id:
      firstIdentifierString([
        record['id'],
        record['message_id'],
        record['messageId'],
        record['uuid'],
      ]) ?? `message-${index + 1}`,
    role: normalizeRole(
      firstString([
        record['role'],
        record['message_role'],
        record['author_role'],
        record['sender_role'],
        record['type'],
      ]),
    ),
    text: extractMessageText(record),
    createdAt: normalizeTimestamp(
      firstDateLike([
        record['inserted_at'],
        record['created_at'],
        record['createdAt'],
        record['ctime'],
        record['time'],
        record['timestamp'],
      ]),
    ),
    parentId: firstIdentifierString([
      record['parent_id'],
      record['parentId'],
      record['parent_message_id'],
    ]),
    branchId,
    attachments: extractAttachments(record),
    citations: extractCitations(record),
    ...(responseReferences.length > 0 ? { responseReferences } : {}),
    searches: extractDeepSeekMessageSearchesFromHistoryRecord(record),
  }
}

function extractMessageResponseReferences(
  record: JsonRecord,
): DeepSeekMessageResponseReference[] {
  return extractFragmentResponseReferences(record['fragments'])
}

function extractBranchMetadata(data: JsonRecord): Map<string, {
  title?: string | undefined
  createdAt?: string | undefined
  sourceMessageId?: string | undefined
}> {
  const branchMap = new Map<string, {
    title?: string | undefined
    createdAt?: string | undefined
    sourceMessageId?: string | undefined
  }>()

  const branchCollections: unknown[] = [
    data['branches'],
    data['conversation_branches'],
    data['branch_list'],
  ]

  for (const collection of branchCollections) {
    if (!Array.isArray(collection)) {
      continue
    }

    for (const item of collection) {
      if (!isRecord(item)) {
        continue
      }

      const branchId = firstString([item['id'], item['branch_id'], item['branchId']])
      if (!branchId) {
        continue
      }

      branchMap.set(branchId, {
        title: firstString([item['title'], item['name']]),
        createdAt: normalizeTimestamp(
          firstDateLike([item['created_at'], item['createdAt'], item['ctime']]),
        ),
        sourceMessageId: firstString([
          item['source_message_id'],
          item['sourceMessageId'],
          item['forked_from_message_id'],
        ]),
      })
    }
  }

  return branchMap
}

function extractMessageText(record: JsonRecord): string {
  const fragmentText = extractFragmentText(record['fragments'])
  if (fragmentText) {
    return fragmentText
  }

  const directText = firstString([
    record['text'],
    record['message'],
    record['query'],
    record['answer'],
    record['content'],
  ])
  if (directText) {
    return directText
  }

  return stringifyContent(record['content']) || stringifyContent(record['contents']) || ''
}

function extractFragmentText(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  const responseText = joinFragmentContents(value, ['RESPONSE'])
  if (responseText) {
    return responseText
  }

  const requestText = joinFragmentContents(value, ['REQUEST'])
  if (requestText) {
    return requestText
  }

  return joinFragmentContents(value, [])
}

function joinFragmentContents(
  fragments: unknown[],
  preferredTypes: string[],
): string {
  const normalizedPreferredTypes = preferredTypes.map(type => type.toUpperCase())
  const selected = fragments
    .filter(isRecord)
    .filter(fragment => {
      if (normalizedPreferredTypes.length === 0) {
        return true
      }
      const type = typeof fragment['type'] === 'string' ? fragment['type'].toUpperCase() : ''
      return normalizedPreferredTypes.includes(type)
    })
    .map(fragment => stringifyContent(fragment['content']))
    .filter(Boolean)

  return selected.join('').trim()
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map(item => stringifyContent(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  if (!isRecord(value)) {
    return ''
  }

  return (
    firstString([
      value['text'],
      value['content'],
      value['body'],
      value['message'],
      value['answer'],
      value['result'],
    ]) ??
    stringifyContent(value['parts']) ??
    ''
  )
}

function extractAttachments(record: JsonRecord): DeepSeekAttachment[] {
  const collections: unknown[] = [
    record['attachments'],
    record['files'],
    record['uploaded_files'],
  ]

  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue
    }

    return collection
      .map(item => normalizeAttachment(item))
      .filter((item): item is DeepSeekAttachment => item !== null)
  }

  return []
}

function normalizeAttachment(value: unknown): DeepSeekAttachment | null {
  if (!isRecord(value)) {
    return null
  }

  const id = firstString([value['id'], value['file_id'], value['fileId']])
  const name = firstString([value['name'], value['file_name'], value['filename']])
  if (!id && !name) {
    return null
  }

  const size = firstNumber([value['size'], value['size_bytes'], value['file_size']])

  return {
    id: id ?? name ?? 'attachment-unknown',
    name: name ?? id ?? 'attachment',
    mimeType: firstString([value['mime_type'], value['mimeType'], value['content_type']]),
    sizeBytes: size,
    url: firstString([value['url'], value['download_url'], value['preview_url']]),
  }
}

function extractCitations(record: JsonRecord): DeepSeekCitation[] {
  const collections: unknown[] = [
    record['citations'],
    record['references'],
    record['search_results'],
    record['sources'],
    getRecord(record, 'search_info')?.['results'],
  ]

  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue
    }

    const normalized = collection
      .map(item => normalizeCitation(item))
      .filter((item): item is DeepSeekCitation => item !== null)
    if (normalized.length > 0) {
      return normalized
    }
  }

  return extractFragmentCitations(record['fragments'])
}

function extractFragmentCitations(value: unknown): DeepSeekCitation[] {
  const citations = new Map<string, DeepSeekCitation>()
  for (const citation of extractResolvedFragmentCitations(value)) {
    citations.set(citation.id, { ...citation })
  }
  for (const citation of extractFragmentSearchResultCitations(value)) {
    citations.set(citation.id, { ...citation })
  }
  return [...citations.values()]
}

function extractResolvedFragmentCitations(value: unknown): DeepSeekCitation[] {
  if (!Array.isArray(value)) {
    return []
  }

  const toolOpenCitations = new Map<string, DeepSeekCitation>()
  const citations = new Map<string, DeepSeekCitation>()

  for (const fragment of value) {
    if (!isRecord(fragment) || fragment['type'] !== 'TOOL_OPEN') {
      continue
    }

    const fragmentId = firstIdentifierString([fragment['id']])
    const citation = normalizeCitation(fragment['result'])
    if (!fragmentId || !citation) {
      continue
    }

    toolOpenCitations.set(fragmentId, citation)
  }

  for (const fragment of value) {
    if (!isRecord(fragment) || fragment['type'] !== 'RESPONSE') {
      continue
    }

    const references = fragment['references']
    if (!Array.isArray(references)) {
      continue
    }

    for (const reference of references) {
      if (!isRecord(reference)) {
        continue
      }

      const type = firstString([reference['type']])
      const referenceId = firstIdentifierString([reference['id']])
      if (type !== 'TOOL_OPEN' || !referenceId) {
        continue
      }

      const citation = toolOpenCitations.get(referenceId)
      if (!citation) {
        continue
      }

      citations.set(citation.id, { ...citation })
    }
  }

  return [...citations.values()]
}

function extractFragmentSearchResultCitations(value: unknown): DeepSeekCitation[] {
  if (!Array.isArray(value)) {
    return []
  }

  const citations = new Map<string, DeepSeekCitation>()

  for (const fragment of value) {
    if (!isRecord(fragment) || fragment['type'] !== 'TOOL_SEARCH') {
      continue
    }

    const results = fragment['results']
    if (!Array.isArray(results)) {
      continue
    }

    for (const result of results) {
      const citation = normalizeCitation(result)
      if (!citation) {
        continue
      }
      citations.set(citation.id, { ...citation })
    }
  }

  return [...citations.values()]
}

function extractFragmentResponseReferences(
  value: unknown,
): DeepSeekMessageResponseReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  const references: DeepSeekMessageResponseReference[] = []

  for (const fragment of value) {
    if (!isRecord(fragment) || fragment['type'] !== 'RESPONSE') {
      continue
    }

    const fragmentReferences = Array.isArray(fragment['references']) ? fragment['references'] : []
    for (const reference of fragmentReferences) {
      if (!isRecord(reference)) {
        continue
      }

      const referenceType = firstString([reference['type']])
      const referenceId = firstIdentifierString([reference['id']])
      if (!referenceType || !referenceId) {
        continue
      }

      references.push({
        referenceId,
        referenceType,
      })
    }
  }

  return references
}

function normalizeCitation(value: unknown): DeepSeekCitation | null {
  if (!isRecord(value)) {
    return null
  }

  const url = firstString([value['url'], value['link']])
  const title = firstString([value['title'], value['name']])
  const id = firstString([value['id'], value['citation_id'], url, title])
  if (!id || !url || !title) {
    return null
  }

  return {
    id,
    title,
    url,
    snippet: firstString([value['snippet'], value['summary'], value['description']]),
  }
}

function normalizeRole(value: string | undefined): DeepSeekMessage['role'] {
  const normalized = value?.toLowerCase()
  if (normalized === 'system' || normalized === 'user' || normalized === 'assistant' || normalized === 'tool') {
    return normalized
  }

  if (normalized === 'human') {
    return 'user'
  }
  if (normalized === 'bot' || normalized === 'model') {
    return 'assistant'
  }

  return 'assistant'
}

function normalizeTimestamp(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') {
    return new Date(0).toISOString()
  }

  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) {
    const epochMs = asNumber > 1e12 ? asNumber : asNumber * 1000
    return new Date(epochMs).toISOString()
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString()
  }
  return date.toISOString()
}

function inferBranchTitle(branchId: string, messages: DeepSeekMessage[]): string {
  const firstUserMessage = messages.find(message => message.role === 'user')
  if (!firstUserMessage?.text) {
    return branchId
  }
  return firstUserMessage.text.slice(0, 40)
}

function firstRecord(values: Array<JsonRecord | undefined>): JsonRecord | undefined {
  return values.find(value => value !== undefined)
}

function getRecord(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return undefined
}

function firstIdentifierString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value))
    }
  }

  return undefined
}

function firstDateLike(values: unknown[]): string | number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
