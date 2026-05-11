import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

function runCli(args: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
  })
}

void test('lists branches through the CLI command', () => {
  const result = runCli([
    'list-branches',
    '--session-file',
    'test/fixtures/sample-history-messages.json',
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    catalog: { branchCount: number; defaultBranchId: string; branches: Array<{ branchId: string }> }
  }
  assert.equal(output.catalog.branchCount, 2)
  assert.equal(output.catalog.defaultBranchId, 'branch-main')
  assert.deepEqual(
    output.catalog.branches.map(branch => branch.branchId),
    ['branch-main', 'branch-alt'],
  )
})

void test('lists branches through the JSON-RPC stdio transport', () => {
  const result = runCli(
    ['serve', '--transport', 'stdio'],
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'session.listBranches',
      params: {
        sessionFile: 'test/fixtures/sample-history-messages.json',
      },
    })}\n`,
  )

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    jsonrpc: '2.0'
    id: number
    result: { catalog: { branchCount: number; branches: Array<{ branchId: string }> } }
  }
  assert.equal(output.id, 1)
  assert.equal(output.result.catalog.branchCount, 2)
  assert.deepEqual(
    output.result.catalog.branches.map(branch => branch.branchId),
    ['branch-main', 'branch-alt'],
  )
})
