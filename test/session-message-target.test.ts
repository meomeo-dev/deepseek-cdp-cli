import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDeepSeekBranchLineage } from '../src/domain/session/sessionBranchLineage.js'
import { buildDeepSeekSessionBranchCatalog } from '../src/domain/session/sessionBranchCatalog.js'
import { resolveDeepSeekSessionMessageTarget } from '../src/domain/session/sessionMessageTarget.js'
import type { DeepSeekSession } from '../src/types/deepseek-session.types.js'

void test('branch catalog keeps default and active branch semantics separated', () => {
  const catalog = buildDeepSeekSessionBranchCatalog(createClearForkSession(), {
    activeBranchId: 'branch-fork',
    activeBranchSource: 'page',
  })

  assert.equal(catalog.defaultBranchId, 'branch-main')
  assert.equal(catalog.activeBranchId, 'branch-fork')
  assert.equal(catalog.activeBranchSource, 'page')
  assert.equal(catalog.branches[1]?.parentBranchId, 'branch-main')
  assert.equal(catalog.branches[1]?.lineageKind, 'fork')
  assert.deepEqual(catalog.branches[1]?.lineagePath, ['branch-main', 'branch-fork'])
})

void test('branch lineage distinguishes root, fork and unresolved branches without guessing', () => {
  const lineage = buildDeepSeekBranchLineage(createAmbiguousForkSession())
  const byBranchId = new Map(lineage.map(item => [item.branchId, item] as const))

  assert.equal(byBranchId.get('branch-main')?.lineageKind, 'root')
  assert.equal(byBranchId.get('branch-fork')?.parentBranchId, null)
  assert.equal(byBranchId.get('branch-fork')?.lineageKind, 'unresolved')
  assert.equal(byBranchId.get('branch-ambiguous')?.parentBranchId, null)
  assert.equal(byBranchId.get('branch-ambiguous')?.lineageKind, 'unresolved')
  assert.deepEqual(byBranchId.get('branch-ambiguous')?.sourceMessageBranchIds, [
    'branch-ambiguous',
    'branch-fork',
    'branch-main',
  ])
})

void test('message target falls back to default branch when no branchId or messageId is provided', () => {
  const result = resolveDeepSeekSessionMessageTarget({
    session: createAmbiguousForkSession(),
    sessionFile: 'fixture.json',
  })

  assert.equal(result.resolvedBranchId, 'branch-main')
  assert.equal(result.resolutionSource, 'default-branch')
  assert.equal(result.message, null)
})

void test('message target prefers the authoritative active branch when provided', () => {
  const result = resolveDeepSeekSessionMessageTarget({
    session: createAmbiguousForkSession(),
    sessionFile: 'fixture.json',
    activeBranchId: 'branch-fork',
    activeBranchSource: 'page',
  })

  assert.equal(result.resolvedBranchId, 'branch-fork')
  assert.equal(result.resolutionSource, 'active-branch')
})

void test('message target resolves a unique messageId to its branch', () => {
  const result = resolveDeepSeekSessionMessageTarget({
    session: createAmbiguousForkSession(),
    sessionFile: 'fixture.json',
    messageId: 'assistant-fork',
    allowedRoles: ['assistant'],
  })

  assert.equal(result.resolvedBranchId, 'branch-fork')
  assert.equal(result.resolutionSource, 'explicit-message')
  assert.equal(result.message?.id, 'assistant-fork')
})

void test('message target rejects ambiguous messageId without authoritative active branch', () => {
  assert.throws(
    () =>
      resolveDeepSeekSessionMessageTarget({
        session: createAmbiguousForkSession(),
        sessionFile: 'fixture.json',
        messageId: 'assistant-main',
      }),
    /ambiguous across branches: branch-ambiguous, branch-fork, branch-main/i,
  )
})

void test('message target can disambiguate messageId through authoritative active branch', () => {
  const result = resolveDeepSeekSessionMessageTarget({
    session: createAmbiguousForkSession(),
    sessionFile: 'fixture.json',
    messageId: 'assistant-main',
    activeBranchId: 'branch-fork',
    activeBranchSource: 'page',
  })

  assert.equal(result.resolvedBranchId, 'branch-fork')
  assert.equal(result.message?.id, 'assistant-main')
})

void test('message target rejects role mismatches after resolution', () => {
  assert.throws(
    () =>
      resolveDeepSeekSessionMessageTarget({
        session: createAmbiguousForkSession(),
        sessionFile: 'fixture.json',
        branchId: 'branch-main',
        messageId: 'assistant-main',
        allowedRoles: ['user'],
      }),
    /not allowed/i,
  )
})

function createClearForkSession(): DeepSeekSession {
  return {
    id: 'session-message-target',
    agentId: 'chat',
    title: 'Message Target Fixture',
    createdAt: '2026-04-05T00:00:00.000Z',
    branches: [
      {
        id: 'branch-main',
        sessionId: 'session-message-target',
        title: 'Main Branch',
        createdAt: '2026-04-05T00:00:00.000Z',
        messages: [
          {
            id: 'user-main',
            role: 'user',
            text: '主分支问题',
            createdAt: '2026-04-05T00:00:00.000Z',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
          {
            id: 'assistant-main',
            role: 'assistant',
            text: '主分支回答',
            createdAt: '2026-04-05T00:00:01.000Z',
            parentId: 'user-main',
            branchId: 'branch-main',
            attachments: [],
            citations: [],
          },
        ],
      },
      {
        id: 'branch-fork',
        sessionId: 'session-message-target',
        title: 'Fork Branch',
        createdAt: '2026-04-05T00:01:00.000Z',
        sourceMessageId: 'assistant-main',
        messages: [
          {
            id: 'user-fork',
            role: 'user',
            text: '分叉问题',
            createdAt: '2026-04-05T00:01:00.000Z',
            parentId: 'assistant-main',
            branchId: 'branch-fork',
            attachments: [],
            citations: [],
          },
          {
            id: 'assistant-fork',
            role: 'assistant',
            text: '分叉回答',
            createdAt: '2026-04-05T00:01:01.000Z',
            parentId: 'user-fork',
            branchId: 'branch-fork',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
  }
}

function createAmbiguousForkSession(): DeepSeekSession {
  const session = createClearForkSession()
  return {
    ...session,
    branches: [
      session.branches[0]!,
      {
        ...session.branches[1]!,
        messages: [
          {
            id: 'user-main',
            role: 'user',
            text: '主分支问题',
            createdAt: '2026-04-05T00:00:00.000Z',
            branchId: 'branch-fork',
            attachments: [],
            citations: [],
          },
          {
            id: 'assistant-main',
            role: 'assistant',
            text: '主分支回答',
            createdAt: '2026-04-05T00:00:01.000Z',
            parentId: 'user-main',
            branchId: 'branch-fork',
            attachments: [],
            citations: [],
          },
          ...session.branches[1]!.messages,
        ],
      },
      {
        id: 'branch-ambiguous',
        sessionId: 'session-message-target',
        title: 'Ambiguous Branch',
        createdAt: '2026-04-05T00:02:00.000Z',
        sourceMessageId: 'assistant-main',
        messages: [
          {
            id: 'user-main',
            role: 'user',
            text: '主分支问题',
            createdAt: '2026-04-05T00:00:00.000Z',
            branchId: 'branch-ambiguous',
            attachments: [],
            citations: [],
          },
          {
            id: 'assistant-main',
            role: 'assistant',
            text: '主分支回答',
            createdAt: '2026-04-05T00:00:01.000Z',
            parentId: 'user-main',
            branchId: 'branch-ambiguous',
            attachments: [],
            citations: [],
          },
          {
            id: 'user-ambiguous',
            role: 'user',
            text: '歧义分支问题',
            createdAt: '2026-04-05T00:02:00.000Z',
            parentId: 'assistant-main',
            branchId: 'branch-ambiguous',
            attachments: [],
            citations: [],
          },
        ],
      },
    ],
  }
}
