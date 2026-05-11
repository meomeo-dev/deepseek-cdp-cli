#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_IGNORED_PATHS,
  listRepositoryFiles,
  maskSecret,
  normalizePath,
  pathMatchesAny,
  readJsonFile,
  readTextFileIfSafe,
} from './security-lib.mjs'

export const SECRET_RULES = [
  { id: 'private-key', description: 'Private key material', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'github-token', description: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { id: 'npm-token', description: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'openai-token', description: 'OpenAI-style API token', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { id: 'aws-access-key', description: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'slack-token', description: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
]

export function loadSecretsConfig(rootDir, explicitConfigPath = null) {
  const configPath = explicitConfigPath
    ? resolve(rootDir, explicitConfigPath)
    : resolve(rootDir, '.security/secrets-allowlist.json')
  const fileConfig = readJsonFile(configPath, {
    ignoredPaths: [],
    allowedMatches: [],
  })

  return {
    ignoredPaths: [...DEFAULT_IGNORED_PATHS, ...(fileConfig.ignoredPaths ?? [])],
    allowedMatches: fileConfig.allowedMatches ?? [],
  }
}

function isAllowedMatch(config, ruleId, relativePath, rawMatch) {
  return config.allowedMatches.some(entry => {
    if (entry.ruleId !== ruleId) {
      return false
    }
    if (!pathMatchesAny(relativePath, [entry.path])) {
      return false
    }
    if (typeof entry.matchContains === 'string' && !rawMatch.includes(entry.matchContains)) {
      return false
    }
    return true
  })
}

export function scanTextForSecrets(relativePath, content, config) {
  const findings = []
  const lines = content.split(/\r?\n/)

  lines.forEach((line, lineIndex) => {
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0
      let match = rule.pattern.exec(line)
      while (match) {
        const rawMatch = match[0]
        if (!isAllowedMatch(config, rule.id, relativePath, rawMatch)) {
          findings.push({
            ruleId: rule.id,
            description: rule.description,
            relativePath,
            line: lineIndex + 1,
            column: match.index + 1,
            match: maskSecret(rawMatch),
          })
        }
        match = rule.pattern.exec(line)
      }
    }
  })

  return findings
}

export function scanRepositoryForSecrets(rootDir, config = loadSecretsConfig(rootDir)) {
  const findings = []
  const filePaths = listRepositoryFiles(rootDir, config.ignoredPaths)

  for (const relativePath of filePaths) {
    const normalizedPath = normalizePath(relativePath)
    if (pathMatchesAny(normalizedPath, config.ignoredPaths)) {
      continue
    }
    const absolutePath = resolve(rootDir, normalizedPath)
    const content = readTextFileIfSafe(absolutePath)
    if (content === null) {
      continue
    }
    findings.push(...scanTextForSecrets(normalizedPath, content, config))
  }

  return findings
}

function parseArgs(argv) {
  let rootDir = process.cwd()
  let configPath = null
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
    if (current === '--config') {
      if (!next) {
        throw new Error('Missing value for --config')
      }
      configPath = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${current}`)
  }
  return { rootDir, configPath }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = loadSecretsConfig(args.rootDir, args.configPath)
  const findings = scanRepositoryForSecrets(args.rootDir, config)
  if (findings.length === 0) {
    process.stdout.write('security:secrets passed with no findings.\n')
    return
  }

  process.stderr.write('security:secrets found potential secrets:\n')
  for (const finding of findings) {
    process.stderr.write(
      `- [${finding.ruleId}] ${finding.relativePath}:${finding.line}:${finding.column} ${finding.match}\n`,
    )
  }
  process.exitCode = 1
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
