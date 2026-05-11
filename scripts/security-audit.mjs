#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']

export function summarizeAuditReport(report, minimumSeverity = 'high') {
  const counts = report?.metadata?.vulnerabilities ?? {}
  const thresholdIndex = SEVERITY_ORDER.indexOf(minimumSeverity)
  const blockingSeverities = SEVERITY_ORDER.slice(thresholdIndex === -1 ? 3 : thresholdIndex)
  const blockingCount = blockingSeverities.reduce(
    (total, severity) => total + Number(counts[severity] ?? 0),
    0,
  )

  return {
    blockingCount,
    blockingSeverities,
    counts: {
      info: Number(counts.info ?? 0),
      low: Number(counts.low ?? 0),
      moderate: Number(counts.moderate ?? 0),
      high: Number(counts.high ?? 0),
      critical: Number(counts.critical ?? 0),
      total: Number(counts.total ?? 0),
    },
    pass: blockingCount === 0,
  }
}

export function runSecurityAudit(rootDir, minimumSeverity = 'high') {
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', `--audit-level=${minimumSeverity}`, '--json'],
    {
      cwd: resolve(rootDir),
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  const rawJson = result.stdout.trim() || result.stderr.trim()
  if (!rawJson) {
    throw new Error('npm audit did not return JSON output.')
  }

  const report = JSON.parse(rawJson)
  const summary = summarizeAuditReport(report, minimumSeverity)
  return {
    result,
    report,
    summary,
  }
}

function parseArgs(argv) {
  let rootDir = process.cwd()
  let minimumSeverity = 'high'

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (current === '--root') {
      if (!next) {
        throw new Error('Missing value for --root')
      }
      rootDir = next
      index += 1
      continue
    }
    if (current === '--min-severity') {
      if (!next) {
        throw new Error('Missing value for --min-severity')
      }
      minimumSeverity = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${current}`)
  }

  return {
    rootDir,
    minimumSeverity,
  }
}

export function formatAuditSummary(summary) {
  return [
    `security:audit blocking severities: ${summary.blockingSeverities.join(', ')}`,
    `counts: total=${summary.counts.total}, low=${summary.counts.low}, moderate=${summary.counts.moderate}, high=${summary.counts.high}, critical=${summary.counts.critical}`,
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { summary } = runSecurityAudit(args.rootDir, args.minimumSeverity)
  process.stdout.write(`${formatAuditSummary(summary)}\n`)
  if (!summary.pass) {
    process.exitCode = 1
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
