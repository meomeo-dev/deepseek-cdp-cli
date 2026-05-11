import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  exportSessionBranchToJson,
  exportSessionBranchToMarkdown,
  exportSessionToJson,
  exportSessionToMarkdown,
} from '../../domain/session/sessionExport.js'
import {
  exportSessionBranchToText,
  exportSessionToText,
} from '../../domain/session/sessionTextExport.js'
import { buildDeepSeekSessionExportSnapshot } from '../../domain/session/sessionExportSnapshot.js'
import { resolveDeepSeekSessionSource } from '../../infrastructure/deepseek/deepSeekSessionSource.js'

export interface ExportConversationInput {
  sessionFile?: string | undefined
  sessionId?: string | undefined
  sessionStoreDir?: string | undefined
  branchId?: string | undefined
  format: 'text' | 'markdown' | 'json'
  outputFile: string
}

export async function exportConversation(input: ExportConversationInput): Promise<{
  sessionId: string
  exportScope: 'branch' | 'session'
  branchId: string | null
  outputFile: string
  format: 'text' | 'markdown' | 'json'
}> {
  const source = await resolveDeepSeekSessionSource({
    sessionFile: input.sessionFile,
    sessionId: input.sessionId,
    sessionStoreDir: input.sessionStoreDir,
  })
  const snapshot = buildDeepSeekSessionExportSnapshot({ source })

  if (!input.branchId) {
    const content = renderSessionExportContent(input.format, snapshot)

    await mkdir(dirname(input.outputFile), { recursive: true })
    await writeFile(input.outputFile, content, 'utf8')

    return {
      sessionId: snapshot.session.id,
      exportScope: 'session',
      branchId: null,
      outputFile: input.outputFile,
      format: input.format,
    }
  }

  const branchSnapshot = snapshot.branches.find(candidate => candidate.branchId === input.branchId) ?? null
  if (!branchSnapshot) {
    const availableBranchIds =
      snapshot.branches.length > 0
        ? snapshot.branches.map(candidate => candidate.branchId).join(', ')
        : 'none'
    throw new Error(
      `Branch not found in export snapshot: ${input.branchId}. Available branches: ${availableBranchIds}.`,
    )
  }

  const content = renderBranchExportContent(input.format, snapshot, branchSnapshot)

  await mkdir(dirname(input.outputFile), { recursive: true })
  await writeFile(input.outputFile, content, 'utf8')

  return {
    sessionId: snapshot.session.id,
    exportScope: 'branch',
    branchId: branchSnapshot.branchId,
    outputFile: input.outputFile,
    format: input.format,
  }
}

function renderSessionExportContent(
  format: ExportConversationInput['format'],
  snapshot: ReturnType<typeof buildDeepSeekSessionExportSnapshot>,
): string {
  switch (format) {
    case 'text':
      return exportSessionToText(snapshot)
    case 'markdown':
      return exportSessionToMarkdown(snapshot)
    case 'json':
      return exportSessionToJson(snapshot)
  }
}

function renderBranchExportContent(
  format: ExportConversationInput['format'],
  snapshot: ReturnType<typeof buildDeepSeekSessionExportSnapshot>,
  branchSnapshot: ReturnType<typeof buildDeepSeekSessionExportSnapshot>['branches'][number],
): string {
  switch (format) {
    case 'text':
      return exportSessionBranchToText(snapshot, branchSnapshot)
    case 'markdown':
      return exportSessionBranchToMarkdown(snapshot, branchSnapshot)
    case 'json':
      return exportSessionBranchToJson(snapshot, branchSnapshot)
  }
}
