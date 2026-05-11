import type {
  DeepSeekSessionBranchExportDocument,
  DeepSeekSessionExportBranchDocument,
  DeepSeekSessionExportBranchSnapshot,
  DeepSeekSessionExportDocument,
  DeepSeekSessionExportSnapshot,
} from '../../types/deepseek-export.types.js'
import type {
  DeepSeekAttachment,
  DeepSeekMessage,
} from '../../types/deepseek-session.types.js'
import type { DeepSeekChatModeFact } from '../../types/deepseek-chat-mode.types.js'
import { buildDeepSeekTextArtifactsTextAppendix } from './textArtifactsAppendix.js'
import {
  buildDeepSeekSessionBranchExportDocument,
  buildDeepSeekSessionExportDocument,
} from './sessionExport.js'

export function exportSessionBranchToText(
  snapshot: DeepSeekSessionExportSnapshot,
  branchSnapshot: DeepSeekSessionExportBranchSnapshot,
): string {
  const document = buildDeepSeekSessionBranchExportDocument(snapshot, branchSnapshot)
  return renderBranchTextDocument(document)
}

export function exportSessionToText(snapshot: DeepSeekSessionExportSnapshot): string {
  const document = buildDeepSeekSessionExportDocument(snapshot)
  return renderSessionTextDocument(document)
}

function renderBranchTextDocument(document: DeepSeekSessionBranchExportDocument): string {
  const lines: string[] = [
    `DeepSeek Session: ${formatSessionTitle(document.session.title, document.session.sessionId)}`,
    `Session ID: ${document.session.sessionId}`,
    `Branch: ${formatBranchHeading(document.branch)}`,
  ]

  appendOptionalLine(lines, 'Mode', formatModeFactText(document.session.modeFact))
  appendOptionalLine(
    lines,
    'Branch Context',
    formatBranchContextText(document.branch),
  )
  lines.push('')
  appendBranchTranscript(lines, document.branch)
  appendSessionFooter(lines, {
    authority: document.authority,
    exportedAt: document.exportedAt,
    activeBranchId: document.session.activeBranchId,
    activeBranchSource: document.session.activeBranchSource,
    transcriptRecovery: formatTranscriptRecoveryText(document.session.transcriptRecovery),
  })

  return `${lines.join('\n').trimEnd()}\n`
}

function renderSessionTextDocument(document: DeepSeekSessionExportDocument): string {
  const lines: string[] = [
    `DeepSeek Session: ${formatSessionTitle(document.session.title, document.session.sessionId)}`,
    `Session ID: ${document.session.sessionId}`,
    `Branch Count: ${document.session.branchCount}`,
  ]

  appendOptionalLine(lines, 'Mode', formatModeFactText(document.session.modeFact))
  lines.push('')

  if (document.branches.length === 0) {
    lines.push('<empty session>')
    lines.push('')
  } else {
    for (const [index, branch] of document.branches.entries()) {
      if (index > 0) {
        lines.push('='.repeat(72))
        lines.push('')
      }
      lines.push(`Branch: ${formatBranchHeading(branch)}`)
      appendOptionalLine(lines, 'Branch Context', formatBranchContextText(branch))
      lines.push('')
      appendBranchTranscript(lines, branch)
    }
  }

  appendSessionFooter(lines, {
    authority: document.authority,
    exportedAt: document.exportedAt,
    activeBranchId: document.session.activeBranchId,
    activeBranchSource: document.session.activeBranchSource,
    transcriptRecovery: formatTranscriptRecoveryText(document.session.transcriptRecovery),
  })

  return `${lines.join('\n').trimEnd()}\n`
}

function appendBranchTranscript(
  lines: string[],
  branch: DeepSeekSessionExportBranchDocument,
): void {
  if (branch.messages.length === 0) {
    lines.push('<empty transcript>')
    lines.push('')
    return
  }

  for (const [index, message] of branch.messages.entries()) {
    if (index > 0) {
      lines.push('')
    }
    appendMessageText(lines, message)
  }
  lines.push('')
}

function appendMessageText(lines: string[], message: DeepSeekMessage): void {
  lines.push(`${formatRoleLabel(message.role)}:`)
  const textLines = (message.text || '<empty message>').split(/\r?\n/)
  for (const line of textLines) {
    lines.push(line)
  }

  if (message.attachments.length > 0) {
    lines.push('')
    lines.push('Attachments:')
    for (const attachment of message.attachments) {
      lines.push(formatAttachmentTextLine(attachment))
    }
  }

  if (message.role === 'assistant') {
    const appendix = buildDeepSeekTextArtifactsTextAppendix({
      text: message.text,
      citations: message.citations,
      responseReferences: message.responseReferences,
      searches: message.searches,
    })
    if (appendix) {
      lines.push('')
      lines.push(appendix)
    }
  }
}

function appendSessionFooter(
  lines: string[],
  input: {
    authority: DeepSeekSessionBranchExportDocument['authority']
    exportedAt: string
    activeBranchId: string | null
    activeBranchSource: string
    transcriptRecovery: string
  },
): void {
  lines.push('Session Metadata:')
  lines.push(`Final URL: ${input.authority.finalUrl ?? '<unknown>'}`)
  lines.push(`Stored Session File: ${input.authority.sessionFile}`)
  lines.push(`Active Branch: ${input.activeBranchId ?? '<none>'}`)
  lines.push(`Active Branch Source: ${input.activeBranchSource}`)
  lines.push(`Transcript Recovery: ${input.transcriptRecovery}`)
  lines.push(`Exported At: ${input.exportedAt}`)
}

function formatSessionTitle(title: string, sessionId: string): string {
  const normalized = normalizeInlineWhitespace(title)
  return normalized || `DeepSeek Session ${sessionId}`
}

function formatBranchHeading(branch: DeepSeekSessionExportBranchDocument): string {
  const title = normalizeInlineWhitespace(branch.title)
  return title ? `${title} (${branch.branchId})` : branch.branchId
}

function formatBranchContextText(branch: DeepSeekSessionExportBranchDocument): string {
  const segments = [
    `lineage=${branch.summary.lineageKind}`,
    `provenance=${branch.provenance.source}/${branch.provenance.transcriptShape}/${branch.provenance.transcriptRecoveryStatus}`,
  ]
  if (branch.summary.parentBranchId) {
    segments.push(`parent=${branch.summary.parentBranchId}`)
  }
  if (branch.summary.sourceMessageId) {
    segments.push(`sourceMessage=${branch.summary.sourceMessageId}`)
  }
  return segments.join(' | ')
}

function formatModeFactText(modeFact: DeepSeekChatModeFact | null): string | null {
  if (!modeFact) {
    return null
  }

  const segments = [
    `mode=${modeFact.resolvedMode ?? '<unknown>'}`,
    `model_type=${modeFact.rawModelType}`,
    `source=${modeFact.sourceLayer}`,
  ]
  if (modeFact.derivedFromLayer) {
    segments.push(`derivedFrom=${modeFact.derivedFromLayer}`)
  }

  return segments.join(' | ')
}

function formatTranscriptRecoveryText(
  recovery: DeepSeekSessionBranchExportDocument['session']['transcriptRecovery'],
): string {
  if (!recovery) {
    return '<unavailable>'
  }

  return `${recovery.status} via ${recovery.source}`
}

function formatAttachmentTextLine(attachment: DeepSeekAttachment): string {
  const segments = [`- ${attachment.name}`]
  if (attachment.mimeType) {
    segments.push(`mime=${attachment.mimeType}`)
  }
  if (typeof attachment.sizeBytes === 'number') {
    segments.push(`size=${attachment.sizeBytes}`)
  }
  if (attachment.id) {
    segments.push(`id=${attachment.id}`)
  }
  if (attachment.url) {
    segments.push(`url=${attachment.url}`)
  }
  return segments.join(' | ')
}

function formatRoleLabel(role: DeepSeekMessage['role']): string {
  switch (role) {
    case 'user':
      return 'User'
    case 'assistant':
      return 'Assistant'
    case 'system':
      return 'System'
    case 'tool':
      return 'Tool'
  }
}

function appendOptionalLine(lines: string[], label: string, value: string | null): void {
  if (!value) {
    return
  }
  lines.push(`${label}: ${value}`)
}

function normalizeInlineWhitespace(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\s+/g, ' ').trim()
}
