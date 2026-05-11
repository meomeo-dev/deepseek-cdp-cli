import type {
  DeepSeekBranchExportSearchEvidence,
  DeepSeekSessionBranchExportDocument,
  DeepSeekSessionExportBranchDocument,
  DeepSeekSessionExportBranchIndexEntry,
  DeepSeekSessionExportBranchSnapshot,
  DeepSeekSessionExportDocument,
  DeepSeekSessionExportSnapshot,
} from '../../types/deepseek-export.types.js'
import type {
  DeepSeekAttachment,
  DeepSeekCitation,
  DeepSeekInlineCitationObservation,
  DeepSeekMessageSearch,
  DeepSeekSearchResult,
} from '../../types/deepseek-session.types.js'
import type { DeepSeekChatModeFact } from '../../types/deepseek-chat-mode.types.js'
import { observeDeepSeekInlineCitations } from './inlineReferenceTokens.js'
import { cloneDeepSeekMessageResponseReferences } from './sessionMessageArtifacts.js'
import {
  cloneDeepSeekMessageSearches,
  cloneDeepSeekSearchResult,
  collectUniqueDeepSeekSearchResults,
  mergeDeepSeekMessageSearches,
} from './sessionSearchArtifacts.js'
import {
  pickLatestDeepSeekChatModeFact,
  rebindDeepSeekChatModeFact,
} from '../deepseek/deepSeekChatModeFact.js'

export function exportSessionBranchToMarkdown(
  snapshot: DeepSeekSessionExportSnapshot,
  branchSnapshot: DeepSeekSessionExportBranchSnapshot,
): string {
  const document = buildDeepSeekSessionBranchExportDocument(snapshot, branchSnapshot)
  const lines = [
    `# ${document.session.title || `DeepSeek Session ${document.session.sessionId}`}`,
    '',
    '- Export Type: `deepseek-session-branch-export`',
    `- Exported At: \`${document.exportedAt}\``,
    '',
    '## Session',
    '',
    ...renderSessionMarkdownLines(document.session, document.authority),
    '',
  ]

  appendBranchMarkdownSections(lines, document.branch, 2)
  return `${lines.join('\n').trimEnd()}\n`
}

export function exportSessionBranchToJson(
  snapshot: DeepSeekSessionExportSnapshot,
  branchSnapshot: DeepSeekSessionExportBranchSnapshot,
): string {
  return `${JSON.stringify(
    buildDeepSeekSessionBranchExportDocument(snapshot, branchSnapshot),
    null,
    2,
  )}\n`
}

export function exportSessionToMarkdown(snapshot: DeepSeekSessionExportSnapshot): string {
  const document = buildDeepSeekSessionExportDocument(snapshot)
  const lines = [
    `# ${document.session.title || `DeepSeek Session ${document.session.sessionId}`}`,
    '',
    '- Export Type: `deepseek-session-export`',
    `- Exported At: \`${document.exportedAt}\``,
    '',
    '## Session Overview',
    '',
    ...renderSessionMarkdownLines(document.session, document.authority),
    `- Total Message Count: ${document.session.totalMessageCount}`,
    `- Total User Message Count: ${document.session.totalUserMessageCount}`,
    `- Total Assistant Message Count: ${document.session.totalAssistantMessageCount}`,
    `- Total Attachment Count: ${document.session.totalAttachmentCount}`,
    `- Total Citation Count: ${document.session.totalCitationCount}`,
    '',
    '## Branch Index',
    '',
  ]

  if (document.branchIndex.length === 0) {
    lines.push('_None_')
    lines.push('')
  } else {
    for (const branch of document.branchIndex) {
      lines.push(formatBranchIndexMarkdownLine(branch))
    }
    lines.push('')
  }

  lines.push('## Branches')
  lines.push('')

  if (document.branches.length === 0) {
    lines.push('_None_')
    lines.push('')
  } else {
    for (const branch of document.branches) {
      lines.push(`### ${formatBranchTitleHeading(branch.title, branch.branchId)} (\`${branch.branchId}\`)`)
      lines.push('')
      appendBranchMarkdownSections(lines, branch, 4)
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export function exportSessionToJson(snapshot: DeepSeekSessionExportSnapshot): string {
  return `${JSON.stringify(buildDeepSeekSessionExportDocument(snapshot), null, 2)}\n`
}

export function buildDeepSeekSessionBranchExportDocument(
  snapshot: DeepSeekSessionExportSnapshot,
  branchSnapshot: DeepSeekSessionExportBranchSnapshot,
): DeepSeekSessionBranchExportDocument {
  const exportedAt = new Date().toISOString()

  return {
    kind: 'deepseek-session-branch-export',
    version: 1,
    exportedAt,
    authority: snapshot.authority,
    session: buildSessionExportSessionMetadata(snapshot),
    branch: buildSessionExportBranchDocument(branchSnapshot),
  }
}

export function buildDeepSeekSessionExportDocument(
  snapshot: DeepSeekSessionExportSnapshot,
): DeepSeekSessionExportDocument {
  const exportedAt = new Date().toISOString()
  const branches = snapshot.branches.map(buildSessionExportBranchDocument)
  const branchIndex = snapshot.branches.map(buildSessionExportBranchIndexEntry)

  return {
    kind: 'deepseek-session-export',
    version: 1,
    exportedAt,
    authority: snapshot.authority,
    session: buildSessionExportSessionMetadata(snapshot),
    branchIndex,
    branches,
  }
}

function buildSessionExportBranchDocument(
  branchSnapshot: DeepSeekSessionExportBranchSnapshot,
): DeepSeekSessionExportBranchDocument {
  const attachments = collectUniqueAttachments(branchSnapshot.branch.messages)
  const citations = collectUniqueCitations(branchSnapshot.branch.messages)
  const searchEvidence = buildBranchSearchEvidence(branchSnapshot.branch.messages, citations)

  return {
    branchId: branchSnapshot.branchId,
    title: branchSnapshot.branch.title,
    createdAt: branchSnapshot.branch.createdAt,
    summary: { ...branchSnapshot.summary },
    provenance: { ...branchSnapshot.provenance },
    attachments,
    citations,
    searchEvidence,
    messages: branchSnapshot.branch.messages.map(message => ({
      ...message,
      attachments: message.attachments.map(attachment => ({ ...attachment })),
      citations: message.citations.map(citation => ({ ...citation })),
      ...(message.responseReferences
        ? { responseReferences: cloneDeepSeekMessageResponseReferences(message.responseReferences) }
        : {}),
      ...(message.searches ? { searches: cloneDeepSeekMessageSearches(message.searches) } : {}),
    })),
  }
}

function buildSessionExportBranchIndexEntry(
  branchSnapshot: DeepSeekSessionExportBranchSnapshot,
): DeepSeekSessionExportBranchIndexEntry {
  return {
    branchId: branchSnapshot.branchId,
    title: branchSnapshot.branch.title,
    createdAt: branchSnapshot.branch.createdAt,
    summary: { ...branchSnapshot.summary },
    provenance: { ...branchSnapshot.provenance },
  }
}

function buildSessionExportSessionMetadata(snapshot: DeepSeekSessionExportSnapshot) {
  const totals = snapshot.catalog.branches.reduce(
    (accumulator, branch) => ({
      totalMessageCount: accumulator.totalMessageCount + branch.messageCount,
      totalUserMessageCount: accumulator.totalUserMessageCount + branch.userMessageCount,
      totalAssistantMessageCount:
        accumulator.totalAssistantMessageCount + branch.assistantMessageCount,
      totalAttachmentCount: accumulator.totalAttachmentCount + branch.attachmentCount,
      totalCitationCount: accumulator.totalCitationCount + branch.citationCount,
    }),
    {
      totalMessageCount: 0,
      totalUserMessageCount: 0,
      totalAssistantMessageCount: 0,
      totalAttachmentCount: 0,
      totalCitationCount: 0,
    },
  )

  return {
    sessionId: snapshot.session.id,
    agentId: snapshot.session.agentId,
    title: snapshot.session.title,
    createdAt: snapshot.session.createdAt,
    branchCount: snapshot.catalog.branchCount,
    defaultBranchId: snapshot.catalog.defaultBranchId,
    activeBranchId: snapshot.catalog.activeBranchId,
    activeBranchSource: snapshot.catalog.activeBranchSource,
    transcriptRecovery: snapshot.transcriptRecovery,
    modeFact: buildExportSessionModeFact(snapshot),
    ...totals,
  }
}

function appendBranchMarkdownSections(
  lines: string[],
  branch: DeepSeekSessionExportBranchDocument,
  sectionLevel: number,
): void {
  const sectionHeading = '#'.repeat(sectionLevel)
  const messageHeading = '#'.repeat(Math.min(sectionLevel + 1, 6))
  const messageDetailHeading = '#'.repeat(Math.min(sectionLevel + 2, 6))

  lines.push(`${sectionHeading} Branch Summary`)
  lines.push('')
  lines.push(`- Branch ID: \`${branch.branchId}\``)
  lines.push(`- Branch Title: ${renderBranchTitleMarkdownValue(branch.title)}`)
  lines.push(`- Created At: \`${branch.createdAt}\``)
  lines.push(`- Lineage Kind: \`${branch.summary.lineageKind}\``)
  lines.push(`- Parent Branch ID: ${renderMarkdownValue(branch.summary.parentBranchId)}`)
  lines.push(`- Source Message ID: ${renderMarkdownValue(branch.summary.sourceMessageId)}`)
  lines.push(
    `- Source Message Branch IDs: ${renderMarkdownStringList(branch.summary.sourceMessageBranchIds)}`,
  )
  lines.push(`- Lineage Path: ${renderMarkdownStringList(branch.summary.lineagePath)}`)
  lines.push(`- Message Count: ${branch.summary.messageCount}`)
  lines.push(`- User Message Count: ${branch.summary.userMessageCount}`)
  lines.push(`- Assistant Message Count: ${branch.summary.assistantMessageCount}`)
  lines.push(`- Attachment Count: ${branch.summary.attachmentCount}`)
  lines.push(`- Citation Count: ${branch.summary.citationCount}`)
  lines.push('')

  lines.push(`${sectionHeading} Transcript Provenance`)
  lines.push('')
  lines.push(`- Source: \`${branch.provenance.source}\``)
  lines.push(`- Transcript Shape: \`${branch.provenance.transcriptShape}\``)
  lines.push(
    `- Transcript Recovery Status: \`${branch.provenance.transcriptRecoveryStatus}\``,
  )
  lines.push(
    `- Assistant Text Source: ${renderMarkdownValue(branch.provenance.assistantTextSource)}`,
  )
  lines.push(`- Last Updated By: \`${branch.provenance.lastUpdatedBy}\``)
  lines.push(`- Updated At: \`${branch.provenance.updatedAt}\``)
  lines.push(`- Source Branch ID: ${renderMarkdownValue(branch.provenance.sourceBranchId)}`)
  lines.push(`- Source Message ID: ${renderMarkdownValue(branch.provenance.sourceMessageId)}`)
  lines.push('')

  lines.push(`${sectionHeading} Branch Attachments`)
  lines.push('')
  if (branch.attachments.length === 0) {
    lines.push('_None_')
    lines.push('')
  } else {
    for (const attachment of branch.attachments) {
      lines.push(formatAttachmentMarkdownLine(attachment))
    }
    lines.push('')
  }

  lines.push(`${sectionHeading} Search Evidence`)
  lines.push('')
  lines.push(
    branch.searchEvidence.available
      ? `- Derived From: \`${branch.searchEvidence.derivedFrom}\``
      : '- Derived From: `none`',
  )
  lines.push(`- Query Count: ${branch.searchEvidence.queryCount}`)
  lines.push(`- Result Count: ${branch.searchEvidence.resultCount}`)
  lines.push('')
  if (branch.searchEvidence.results.length === 0) {
    lines.push('_None_')
    lines.push('')
  } else {
    if (branch.searchEvidence.searches.length > 0) {
      for (const search of branch.searchEvidence.searches) {
        lines.push(formatSearchMarkdownLine(search))
        for (const result of search.results) {
          lines.push(formatSearchResultMarkdownLine(result))
        }
      }
    } else {
      for (const result of branch.searchEvidence.results) {
        lines.push(formatSearchResultMarkdownLine(result))
      }
    }
    lines.push('')
  }

  lines.push(`${sectionHeading} Messages`)
  lines.push('')
  if (branch.messages.length === 0) {
    lines.push('_None_')
    lines.push('')
    return
  }

  for (const message of branch.messages) {
    lines.push(`${messageHeading} ${message.role.toUpperCase()} · ${message.id}`)
    lines.push('')
    lines.push(`- Created At: \`${message.createdAt}\``)
    lines.push(`- Parent ID: ${renderMarkdownValue(message.parentId)}`)
    lines.push(`- Branch ID: \`${message.branchId}\``)
    lines.push(`- Attachment Count: ${message.attachments.length}`)
    lines.push(`- Citation Count: ${message.citations.length}`)
    lines.push(`- Search Count: ${message.searches?.length ?? 0}`)
    lines.push('')
    lines.push(message.text || '_Empty message_')
    lines.push('')

    const inlineCitationObservations = observeDeepSeekInlineCitations({
      text: message.text,
      responseReferences: message.responseReferences,
    })
    if (inlineCitationObservations.length > 0) {
      lines.push(`${messageDetailHeading} Inline References Observed`)
      lines.push('')
      for (const observation of inlineCitationObservations) {
        lines.push(formatInlineCitationObservationMarkdownLine(observation))
      }
      appendInlineCitationObservationMarkdownNotes(lines, inlineCitationObservations)
      lines.push('')
    }

    if ((message.responseReferences?.length ?? 0) > 0) {
      lines.push(`${messageDetailHeading} Structured Response References`)
      lines.push('')
      for (const reference of message.responseReferences ?? []) {
        lines.push(`- \`${reference.referenceType}#${reference.referenceId}\``)
      }
      lines.push('')
    }

    if (message.attachments.length > 0) {
      lines.push(`${messageDetailHeading} Attachments`)
      lines.push('')
      for (const attachment of message.attachments) {
        lines.push(formatAttachmentMarkdownLine(attachment))
      }
      lines.push('')
    }

    if (message.citations.length > 0) {
      lines.push(`${messageDetailHeading} Citations / Search Evidence`)
      lines.push('')
      for (const citation of message.citations) {
        lines.push(formatCitationMarkdownLine(citation))
      }
      lines.push('')
    }

    if ((message.searches?.length ?? 0) > 0) {
      lines.push(`${messageDetailHeading} Search Results / Reference Mapping`)
      lines.push('')
      for (const search of message.searches ?? []) {
        lines.push(formatSearchMarkdownLine(search))
        for (const result of search.results) {
          lines.push(formatSearchResultMarkdownLine(result))
        }
      }
      lines.push('')
    }
  }
}

function renderSessionMarkdownLines(
  session: DeepSeekSessionBranchExportDocument['session'],
  authority: DeepSeekSessionBranchExportDocument['authority'],
): string[] {
  return [
    `- Session ID: \`${session.sessionId}\``,
    `- Agent ID: \`${session.agentId}\``,
    `- Final URL: ${authority.finalUrl ? `\`${authority.finalUrl}\`` : '_Unknown_'}`,
    `- Stored Session File: \`${authority.sessionFile}\``,
    `- Branch Count: ${session.branchCount}`,
    `- Default Branch ID: ${renderMarkdownValue(session.defaultBranchId)}`,
    `- Active Branch ID: ${renderMarkdownValue(session.activeBranchId)}`,
    `- Active Branch Source: \`${session.activeBranchSource}\``,
    `- Mode Fact: ${formatModeFactMarkdown(session.modeFact)}`,
    `- Transcript Recovery: ${formatTranscriptRecovery(session.transcriptRecovery)}`,
  ]
}

function formatBranchIndexMarkdownLine(
  branch: DeepSeekSessionExportBranchIndexEntry,
): string {
  return [
    `- \`${branch.branchId}\``,
    `title=${renderInlineBranchTitlePreview(branch.title)}`,
    `lineage=\`${branch.summary.lineageKind}\``,
    `parent=${formatInlineMarkdownValue(branch.summary.parentBranchId)}`,
    `sourceMessage=${formatInlineMarkdownValue(branch.summary.sourceMessageId)}`,
    `provenance=\`${branch.provenance.source}/${branch.provenance.transcriptShape}\``,
    `messages=${branch.summary.messageCount}`,
    `attachments=${branch.summary.attachmentCount}`,
    `citations=${branch.summary.citationCount}`,
  ].join(' · ')
}

function buildBranchSearchEvidence(
  messages: DeepSeekSessionExportBranchSnapshot['branch']['messages'],
  citations: DeepSeekCitation[],
): DeepSeekBranchExportSearchEvidence {
  const searches = collectUniqueSearches(messages)
  const searchResults = collectUniqueDeepSeekSearchResults(searches)

  if (searchResults.length > 0) {
    return {
      available: true,
      derivedFrom: 'message-searches',
      queryCount: searches.length,
      resultCount: searchResults.length,
      searches: cloneDeepSeekMessageSearches(searches),
      results: searchResults.map(result => cloneDeepSeekSearchResult(result)),
    }
  }

  if (citations.length === 0) {
    return {
      available: false,
      derivedFrom: 'none',
      queryCount: 0,
      resultCount: 0,
      searches: [],
      results: [],
    }
  }

  return {
    available: true,
    derivedFrom: 'citations',
    queryCount: 0,
    resultCount: citations.length,
    searches: [],
    results: citations.map(mapCitationToSearchResult),
  }
}

function collectUniqueAttachments(
  messages: DeepSeekSessionExportBranchSnapshot['branch']['messages'],
): DeepSeekAttachment[] {
  const attachmentsById = new Map<string, DeepSeekAttachment>()
  for (const message of messages) {
    for (const attachment of message.attachments) {
      const previous = attachmentsById.get(attachment.id)
      attachmentsById.set(
        attachment.id,
        previous ? mergeAttachmentMetadata(previous, attachment) : { ...attachment },
      )
    }
  }

  return [...attachmentsById.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function collectUniqueCitations(
  messages: DeepSeekSessionExportBranchSnapshot['branch']['messages'],
): DeepSeekCitation[] {
  const citationsById = new Map<string, DeepSeekCitation>()
  for (const message of messages) {
    for (const citation of message.citations) {
      citationsById.set(citation.id, { ...citation })
    }
  }

  return [...citationsById.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function collectUniqueSearches(
  messages: DeepSeekSessionExportBranchSnapshot['branch']['messages'],
): DeepSeekMessageSearch[] {
  return messages.reduce<DeepSeekMessageSearch[]>(
    (merged, message) => mergeDeepSeekMessageSearches(merged, message.searches),
    [],
  )
}

function mapCitationToSearchResult(citation: DeepSeekCitation): DeepSeekSearchResult {
  return {
    id: citation.id,
    title: citation.title,
    url: citation.url,
    ...(citation.snippet ? { snippet: citation.snippet } : {}),
  }
}

function formatTranscriptRecovery(
  recovery: DeepSeekSessionBranchExportDocument['session']['transcriptRecovery'],
): string {
  if (!recovery) {
    return '_Unavailable_'
  }

  return `\`${recovery.status}\` via \`${recovery.source}\``
}

function buildExportSessionModeFact(
  snapshot: DeepSeekSessionExportSnapshot,
): DeepSeekChatModeFact | null {
  return rebindDeepSeekChatModeFact({
    fact: pickLatestDeepSeekChatModeFact(
      snapshot.session.modeFact,
      snapshot.storedSession.session.modeFact,
      snapshot.storedSession.metadata?.modeFact,
    ),
    sourceLayer: 'export-document',
  })
}

function formatModeFactMarkdown(modeFact: DeepSeekChatModeFact | null): string {
  if (!modeFact) {
    return '_Unavailable_'
  }

  const segments = [
    `mode=${modeFact.resolvedMode ? `\`${modeFact.resolvedMode}\`` : '_Unknown_'}`,
    `model_type=\`${modeFact.rawModelType}\``,
    `source=\`${modeFact.sourceLayer}\``,
  ]
  if (modeFact.derivedFromLayer) {
    segments.push(`derivedFrom=\`${modeFact.derivedFromLayer}\``)
  }

  return segments.join(' · ')
}

function formatAttachmentMarkdownLine(attachment: DeepSeekAttachment): string {
  const segments = [`- ${attachment.name} (\`${attachment.id}\`)`]
  if (attachment.mimeType) {
    segments.push(`mime=\`${attachment.mimeType}\``)
  }
  if (typeof attachment.sizeBytes === 'number') {
    segments.push(`size=${attachment.sizeBytes}`)
  }
  if (attachment.url) {
    segments.push(`url=${attachment.url}`)
  }

  return segments.join(' · ')
}

function mergeAttachmentMetadata(
  current: DeepSeekAttachment,
  incoming: DeepSeekAttachment,
): DeepSeekAttachment {
  return {
    id: incoming.id || current.id,
    name: incoming.name || current.name,
    mimeType: incoming.mimeType ?? current.mimeType,
    sizeBytes:
      typeof incoming.sizeBytes === 'number'
        ? incoming.sizeBytes
        : current.sizeBytes,
    url: incoming.url ?? current.url,
  }
}

function formatCitationMarkdownLine(citation: DeepSeekCitation): string {
  const segments = [`- [${citation.title}](${citation.url})`]
  if (!isRedundantUrlIdentifier(citation.id, citation.url)) {
    segments.push(`id=\`${citation.id}\``)
  }
  const lines = [segments.join(' · ')]
  if (citation.snippet) {
    lines.push(`  snippet=${formatMarkdownPreview(citation.snippet, 220)}`)
  }
  return lines.join('\n')
}

function formatSearchMarkdownLine(search: DeepSeekMessageSearch): string {
  return [
    `- Query: ${renderMarkdownValue(search.query)}`,
    `status=\`${search.status}\``,
    `results=${search.results.length}`,
  ].join(' · ')
}

function formatSearchResultMarkdownLine(result: DeepSeekSearchResult): string {
  const segments = [`- [${result.title}](${result.url})`]
  if (!isRedundantUrlIdentifier(result.id, result.url)) {
    segments.push(`id=\`${result.id}\``)
  }
  if (result.source) {
    segments.push(`source=\`${result.source}\``)
  }
  if (result.publishedAt) {
    segments.push(`publishedAt=\`${result.publishedAt}\``)
  }
  if (result.toolSearchFragmentId) {
    segments.push(`toolSearch=\`${result.toolSearchFragmentId}\``)
  }
  if (result.toolOpenFragmentIds?.length) {
    segments.push(
      `toolOpen=${result.toolOpenFragmentIds.map(id => `\`${id}\``).join(', ')}`,
    )
  }
  const lines = [segments.join(' · ')]
  if (result.responseReferences?.length) {
    lines.push(
      `  references=${result.responseReferences
        .map(reference => {
          const parts = [`${reference.referenceType}#${reference.referenceId}`, reference.resolution]
          if (reference.toolOpenFragmentId) {
            parts.push(`open=${reference.toolOpenFragmentId}`)
          }
          if (reference.toolSearchFragmentId) {
            parts.push(`search=${reference.toolSearchFragmentId}`)
          }
          return parts.join('/')
        })
        .join(', ')}`,
    )
  }
  if (result.snippet) {
    lines.push(`  snippet=${formatMarkdownPreview(result.snippet, 220)}`)
  }
  return lines.join('\n')
}

function formatInlineCitationObservationMarkdownLine(
  observation: DeepSeekInlineCitationObservation,
): string {
  const segments = [
    `- \`${observation.token}\``,
    `kind=\`${observation.kind}\``,
    `status=\`${observation.verificationStatus}\``,
    `resolution=\`${observation.resolution}\``,
  ]
  if (typeof observation.ordinal === 'number') {
    segments.push(`ordinal=\`${observation.ordinal}\``)
  }
  if (observation.responseReference) {
    const ordinal =
      typeof observation.ordinal === 'number' ? observation.ordinal : '?'
    segments.push(
      `mapped=\`RESPONSE.references[${ordinal}]=${observation.responseReference.referenceType}#${observation.responseReference.referenceId}\``,
    )
  }
  return segments.join(' · ')
}

function appendInlineCitationObservationMarkdownNotes(
  lines: string[],
  observations: DeepSeekInlineCitationObservation[],
): void {
  if (
    observations.some(
      observation =>
        observation.kind === 'reference-ordinal' &&
        observation.verificationStatus === 'verified',
    )
  ) {
    lines.push(
      '_Verified `[reference:n]` tokens map by occurrence order to DeepSeek `RESPONSE.references[n]`._',
    )
  }

  if (
    observations.some(
      observation => observation.verificationStatus === 'suspected-generated-citation',
    )
  ) {
    lines.push(
      '_Citation-like tokens without structured DeepSeek `RESPONSE.references[]` are treated as suspected generated citations._',
    )
  }
}

function renderMarkdownValue(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? `\`${normalized}\`` : '_None_'
}

function formatInlineMarkdownValue(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? `\`${normalized}\`` : '_None_'
}

function renderMarkdownStringList(values: string[]): string {
  return values.length > 0
    ? values.map(value => `\`${value}\``).join(', ')
    : '_None_'
}

function formatBranchTitleHeading(
  title: string | null | undefined,
  fallbackBranchId: string,
): string {
  return formatBranchTitlePreview(title) || fallbackBranchId
}

function renderBranchTitleMarkdownValue(title: string | null | undefined): string {
  const preview = formatBranchTitlePreview(title)
  return preview ? `\`${preview}\`` : '_None_'
}

function renderInlineBranchTitlePreview(title: string | null | undefined): string {
  const preview = formatBranchTitlePreview(title)
  return preview ? `\`${preview}\`` : '_None_'
}

function formatBranchTitlePreview(title: string | null | undefined): string {
  return formatMarkdownPreview(title, 72)
}

function formatMarkdownPreview(value: string | null | undefined, maxLength: number): string {
  const normalized = normalizeInlineWhitespace(value)
  if (!normalized) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function normalizeInlineWhitespace(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\s+/g, ' ').trim()
}

function isRedundantUrlIdentifier(id: string | null | undefined, url: string): boolean {
  const normalizedId = normalizeInlineWhitespace(id)
  return normalizedId !== '' && normalizedId === url
}
