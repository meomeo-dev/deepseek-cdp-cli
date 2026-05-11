import type {
  DeepSeekAttachment,
  DeepSeekBranch,
  DeepSeekCitation,
  DeepSeekMessageResponseReference,
  DeepSeekMessage,
} from '../../types/deepseek-session.types.js'
import {
  cloneDeepSeekMessageSearches,
  mergeDeepSeekMessageSearches,
} from './sessionSearchArtifacts.js'

export function cloneDeepSeekBranch(
  branch: DeepSeekBranch,
): DeepSeekBranch {
  return {
    ...branch,
    messages: branch.messages.map(message => cloneDeepSeekMessage(message)),
  }
}

export function cloneDeepSeekMessage(
  message: DeepSeekMessage,
): DeepSeekMessage {
  return {
    ...message,
    attachments: (message.attachments ?? []).map(attachment => ({ ...attachment })),
    citations: (message.citations ?? []).map(citation => ({ ...citation })),
    ...(message.responseReferences
      ? { responseReferences: cloneDeepSeekMessageResponseReferences(message.responseReferences) }
      : {}),
    ...(message.searches ? { searches: cloneDeepSeekMessageSearches(message.searches) } : {}),
  }
}

export function mergeDeepSeekMessage(
  current: DeepSeekMessage,
  incoming: DeepSeekMessage,
): DeepSeekMessage {
  const responseReferences = mergeDeepSeekMessageResponseReferences(
    current.responseReferences,
    incoming.responseReferences,
  )
  const searches = mergeDeepSeekMessageSearches(current.searches, incoming.searches)

  return {
    ...current,
    role: incoming.role,
    text: pickPreferredMessageText(current.text, incoming.text),
    createdAt: pickEarlierTimestamp(current.createdAt, incoming.createdAt),
    parentId: incoming.parentId ?? current.parentId,
    branchId: incoming.branchId || current.branchId,
    attachments: mergeDeepSeekAttachments(current.attachments ?? [], incoming.attachments ?? []),
    citations: mergeDeepSeekCitations(current.citations ?? [], incoming.citations ?? []),
    ...(responseReferences.length > 0 ? { responseReferences } : {}),
    ...(searches.length > 0 ? { searches } : {}),
  }
}

export function cloneDeepSeekMessageResponseReferences(
  responseReferences: DeepSeekMessageResponseReference[] | null | undefined,
): DeepSeekMessageResponseReference[] {
  return (responseReferences ?? []).map(cloneDeepSeekMessageResponseReference)
}

export function mergeDeepSeekMessageResponseReferences(
  current: DeepSeekMessageResponseReference[] | null | undefined,
  incoming: DeepSeekMessageResponseReference[] | null | undefined,
): DeepSeekMessageResponseReference[] {
  const currentReferences = current ?? []
  const incomingReferences = incoming ?? []

  if (incomingReferences.length === 0) {
    return cloneDeepSeekMessageResponseReferences(currentReferences)
  }

  if (currentReferences.length === 0) {
    return cloneDeepSeekMessageResponseReferences(incomingReferences)
  }

  if (haveSameOrderedResponseReferences(currentReferences, incomingReferences)) {
    return cloneDeepSeekMessageResponseReferences(incomingReferences)
  }

  const preferred =
    incomingReferences.length >= currentReferences.length
      ? incomingReferences
      : currentReferences

  return cloneDeepSeekMessageResponseReferences(preferred)
}

export function mergeDeepSeekAttachments(
  current: DeepSeekAttachment[],
  incoming: DeepSeekAttachment[],
): DeepSeekAttachment[] {
  const merged = new Map<string, DeepSeekAttachment>()

  for (const attachment of current) {
    merged.set(pickAttachmentStableId(attachment), { ...attachment })
  }

  for (const attachment of incoming) {
    const stableId = pickAttachmentStableId(attachment)
    const previous = merged.get(stableId)
    merged.set(
      stableId,
      previous ? mergeDeepSeekAttachment(previous, attachment) : { ...attachment },
    )
  }

  return [...merged.values()]
}

export function mergeDeepSeekCitations(
  current: DeepSeekCitation[],
  incoming: DeepSeekCitation[],
): DeepSeekCitation[] {
  return mergeByStableId(current, incoming, citation => citation.id || citation.url)
}

function mergeByStableId<T>(
  current: T[],
  incoming: T[],
  pickId: (item: T) => string,
): T[] {
  const merged = new Map<string, T>()
  for (const item of current) {
    merged.set(pickId(item), { ...item })
  }

  for (const item of incoming) {
    merged.set(pickId(item), { ...item })
  }

  return [...merged.values()]
}

function buildResponseReferenceIdentity(
  reference: DeepSeekMessageResponseReference,
): string {
  return `${reference.referenceType}::${reference.referenceId}`
}

function haveSameOrderedResponseReferences(
  left: DeepSeekMessageResponseReference[],
  right: DeepSeekMessageResponseReference[],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((reference, index) => {
    const counterpart = right[index]
    return (
      counterpart !== undefined &&
      buildResponseReferenceIdentity(reference) ===
        buildResponseReferenceIdentity(counterpart)
    )
  })
}

function cloneDeepSeekMessageResponseReference(
  reference: DeepSeekMessageResponseReference,
): DeepSeekMessageResponseReference {
  return {
    referenceId: reference.referenceId,
    referenceType: reference.referenceType,
  }
}

function mergeDeepSeekAttachment(
  current: DeepSeekAttachment,
  incoming: DeepSeekAttachment,
): DeepSeekAttachment {
  return {
    id: incoming.id || current.id,
    name: pickPreferredOptionalString(current.name, incoming.name) ?? current.name ?? incoming.name,
    mimeType: pickPreferredOptionalString(current.mimeType, incoming.mimeType),
    sizeBytes:
      typeof incoming.sizeBytes === 'number'
        ? incoming.sizeBytes
        : current.sizeBytes,
    url: pickPreferredOptionalString(current.url, incoming.url),
  }
}

function pickAttachmentStableId(
  attachment: DeepSeekAttachment,
): string {
  return attachment.id || attachment.name
}

function pickPreferredMessageText(currentText: string, incomingText: string): string {
  const current = currentText.trim()
  const incoming = incomingText.trim()
  if (!current) {
    return incomingText
  }

  if (!incoming) {
    return currentText
  }

  return incoming.length >= current.length ? incomingText : currentText
}

function pickEarlierTimestamp(left: string, right: string): string {
  if (!left.trim()) {
    return right
  }

  if (!right.trim()) {
    return left
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right
}

function pickPreferredOptionalString(
  current: string | null | undefined,
  incoming: string | null | undefined,
): string | undefined {
  const normalizedIncoming = incoming?.trim()
  if (normalizedIncoming) {
    return normalizedIncoming
  }

  const normalizedCurrent = current?.trim()
  return normalizedCurrent || undefined
}
