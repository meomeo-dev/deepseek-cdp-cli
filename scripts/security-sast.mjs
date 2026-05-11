#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_IGNORED_PATHS,
  listRepositoryFiles,
  normalizePath,
  pathMatchesAny,
  readJsonFile,
  readTextFileIfSafe,
} from './security-lib.mjs'

export const SAST_RULES = [
  {
    id: 'child-process-spawn',
    description: 'Child process spawn/spawnSync usage must be explicitly allowlisted.',
    pattern: /\bspawn(?:Sync)?\s*\(/g,
  },
  {
    id: 'child-process-exec',
    description: 'exec/execSync usage must be explicitly allowlisted.',
    pattern: /(?<![\w.])exec(?:Sync)?\s*\(/g,
  },
  {
    id: 'browser-window-eval',
    description: 'window.eval usage must be explicitly allowlisted.',
    pattern: /window\.eval\s*\(/g,
  },
  {
    id: 'dynamic-function-constructor',
    description: 'new Function usage must be explicitly allowlisted.',
    pattern: /\bnew\s+Function\s*\(/g,
  },
  {
    id: 'bare-eval',
    description: 'bare eval usage must be explicitly allowlisted.',
    pattern: /(^|[^.\w])eval\s*\(/g,
  },
]

export function loadSastConfig(rootDir, explicitConfigPath = null) {
  const configPath = explicitConfigPath
    ? resolve(rootDir, explicitConfigPath)
    : resolve(rootDir, '.security/sast-allowlist.json')
  const fileConfig = readJsonFile(configPath, {
    ignoredPaths: [],
    allowedFindings: [],
  })

  return {
    ignoredPaths: [...DEFAULT_IGNORED_PATHS, ...(fileConfig.ignoredPaths ?? [])],
    allowedFindings: fileConfig.allowedFindings ?? [],
  }
}

function isAllowedFinding(config, ruleId, relativePath) {
  return config.allowedFindings.some(entry => {
    return entry.ruleId === ruleId && pathMatchesAny(relativePath, [entry.path])
  })
}

export function scanTextForSast(relativePath, content, config) {
  const findings = []
  const lines = content.split(/\r?\n/)

  lines.forEach((line, lineIndex) => {
    for (const rule of SAST_RULES) {
      rule.pattern.lastIndex = 0
      let match = rule.pattern.exec(line)
      while (match) {
        if (!isAllowedFinding(config, rule.id, relativePath)) {
          findings.push({
            ruleId: rule.id,
            description: rule.description,
            relativePath,
            line: lineIndex + 1,
            column: match.index + 1,
            excerpt: line.trim(),
          })
        }
        match = rule.pattern.exec(line)
      }
    }
  })

  return findings
}

export function scanRepositoryForSast(rootDir, config = loadSastConfig(rootDir)) {
  const findings = []
  const filePaths = listRepositoryFiles(rootDir, config.ignoredPaths)
  for (const relativePath of filePaths) {
    const normalizedPath = normalizePath(relativePath)
    if (pathMatchesAny(normalizedPath, config.ignoredPaths)) {
      continue
    }
    const content = readTextFileIfSafe(resolve(rootDir, normalizedPath))
    if (content === null) {
      continue
    }
    findings.push(...scanTextForSast(normalizedPath, content, config))
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
  const config = loadSastConfig(args.rootDir, args.configPath)
  const findings = scanRepositoryForSast(args.rootDir, config)
  if (findings.length === 0) {
    process.stdout.write('security:sast passed with no unallowlisted findings.\n')
    return
  }

  process.stderr.write('security:sast found unallowlisted dangerous API usage:\n')
  for (const finding of findings) {
    process.stderr.write(
      `- [${finding.ruleId}] ${finding.relativePath}:${finding.line}:${finding.column} ${finding.excerpt}\n`,
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
