import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

export const DEFAULT_IGNORED_PATHS = [
  '.git/**',
  '.playwright/**',
  '.playwright-report/**',
  'artifacts/**',
  'coverage/**',
  'dist/**',
  'node_modules/**',
  'playwright-report/**',
  'test-results/**',
  '*.log',
  '*.tgz',
]

export function normalizePath(value) {
  return value.replaceAll('\\', '/')
}

export function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback
  }

  return JSON.parse(readFileSync(filePath, 'utf8'))
}

export function globToRegExp(glob) {
  let pattern = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const current = glob[index]
    const next = glob[index + 1]
    if (current === '*' && next === '*') {
      pattern += '.*'
      index += 1
      continue
    }
    if (current === '*') {
      pattern += '[^/]*'
      continue
    }
    if (current === '?') {
      pattern += '.'
      continue
    }
    if ('\\.[]{}()+-^$|'.includes(current)) {
      pattern += `\\${current}`
      continue
    }
    pattern += current
  }
  pattern += '$'
  return new RegExp(pattern)
}

export function pathMatchesAny(path, globs) {
  return globs.some(glob => globToRegExp(normalizePath(glob)).test(normalizePath(path)))
}

function listFilesRecursively(rootDir, currentDir, accumulator) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = join(currentDir, entry.name)
    const relativePath = normalizePath(absolutePath.slice(rootDir.length + 1))
    if (entry.isDirectory()) {
      accumulator.push(...listFilesRecursively(rootDir, absolutePath, []))
      continue
    }
    if (entry.isFile()) {
      accumulator.push(relativePath)
    }
  }
  return accumulator
}

export function listRepositoryFiles(rootDir, ignoredPaths = DEFAULT_IGNORED_PATHS) {
  const normalizedRoot = resolve(rootDir)
  const gitResult = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: normalizedRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  const candidates =
    gitResult.status === 0
      ? gitResult.stdout
          .split('\u0000')
          .filter(Boolean)
          .map(normalizePath)
      : listFilesRecursively(normalizedRoot, normalizedRoot, [])

  return [...new Set(candidates)].filter(path => !pathMatchesAny(path, ignoredPaths))
}

export function readTextFileIfSafe(filePath) {
  const buffer = readFileSync(filePath)
  for (const value of buffer) {
    if (value === 0) {
      return null
    }
  }
  return buffer.toString('utf8')
}

export function maskSecret(value) {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

export function parsePackJson(rawOutput) {
  const trimmed = rawOutput.trim()
  const arrayIndex = trimmed.indexOf('[')
  if (arrayIndex === -1) {
    throw new Error(`Expected npm pack JSON output, received:\n${rawOutput}`)
  }
  return JSON.parse(trimmed.slice(arrayIndex))
}

export function ensureFileExists(filePath) {
  const stats = statSync(filePath, { throwIfNoEntry: false })
  return Boolean(stats?.isFile())
}
