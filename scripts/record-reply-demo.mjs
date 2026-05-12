#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MESSAGE =
  '为什年轻人都在传 「百万token三毛钱，梁圣恩情还不完」'

function parseArgs(argv) {
  const args = {
    command: '',
    duration: 45,
    fontSize: 16,
    fps: 6,
    gifWidth: 960,
    height: 700,
    maxBytes: 7 * 1024 * 1024,
    outputGif: 'docs/assets/deepseek-reply-demo.gif',
    outputVideo: 'artifacts/demo/deepseek-reply-demo.mov',
    title: 'deepseek-cdp-cli reply demo',
    width: 1080,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (current === '--command') {
      args.command = readRequiredValue(current, next)
      index += 1
      continue
    }
    if (current === '--duration') {
      args.duration = readInteger(current, next)
      index += 1
      continue
    }
    if (current === '--fps') {
      args.fps = readInteger(current, next)
      index += 1
      continue
    }
    if (current === '--font-size') {
      args.fontSize = readInteger(current, next)
      index += 1
      continue
    }
    if (current === '--gif-width') {
      args.gifWidth = readInteger(current, next)
      index += 1
      continue
    }
    if (current === '--height') {
      args.height = readInteger(current, next)
      index += 1
      continue
    }
    if (current === '--max-bytes') {
      args.maxBytes = readInteger(current, next)
      index += 1
      continue
    }
    if (current === '--output-gif') {
      args.outputGif = readRequiredValue(current, next)
      index += 1
      continue
    }
    if (current === '--output-video') {
      args.outputVideo = readRequiredValue(current, next)
      index += 1
      continue
    }
    if (current === '--title') {
      args.title = readRequiredValue(current, next)
      index += 1
      continue
    }
    if (current === '--width') {
      args.width = readInteger(current, next)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${current}`)
  }

  if (!args.command) {
    args.command = buildDefaultReplyCommand()
  }

  return args
}

function readRequiredValue(flag, value) {
  if (!value) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

function readInteger(flag, value) {
  const parsed = Number.parseInt(readRequiredValue(flag, value), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function buildDefaultReplyCommand() {
  return [
    'npm run dev -- reply',
    `--message ${shellQuote(DEFAULT_MESSAGE)}`,
    '--format text',
    '--stream',
    '--headless',
    '--chat-mode unchanged',
    '--deep-think unchanged',
    '--search unchanged',
  ].join(' ')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  })
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(`${options.label ?? command} failed.\n${details}`)
  }
  return result.stdout.trim()
}

function openTerminalWindow(input) {
  const requestedBounds = [
    80,
    80,
    80 + input.width,
    80 + input.height,
  ]
  const script = `
    tell application "Terminal"
      activate
      set demoTab to do script ${appleScriptQuote(buildTerminalScript(input))}
      set current settings of demoTab to settings set "Basic"
      set custom title of demoTab to ${appleScriptQuote(input.title)}
      set background color of demoTab to {65535, 65535, 65535}
      set normal text color of demoTab to {0, 0, 0}
      set font name of demoTab to "SF Mono"
      set font size of demoTab to ${input.fontSize}
      set demoWindow to front window
      set bounds of demoWindow to {${requestedBounds.join(', ')}}
      set number of columns of demoWindow to 88
      set number of rows of demoWindow to 24
      set actualBounds to bounds of demoWindow
      return (id of demoWindow as text) & "|" & item 1 of actualBounds & "," & ¬
        item 2 of actualBounds & "," & item 3 of actualBounds & "," & ¬
        item 4 of actualBounds
    end tell
  `
  const output = run('osascript', ['-e', script], {
    label: 'Open Terminal demo window',
  })
  return parseWindowDescriptor(output)
}

function parseWindowDescriptor(value) {
  const [id, rawBounds] = value.split('|')
  if (!id || !rawBounds) {
    throw new Error(`Could not parse Terminal window descriptor: ${value}`)
  }
  const bounds = rawBounds
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
  if (bounds.length !== 4 || bounds.some(part => !Number.isInteger(part))) {
    throw new Error(`Could not parse Terminal window bounds: ${rawBounds}`)
  }

  const [left, top, right, bottom] = bounds
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  return {
    bounds: {
      height,
      left,
      top,
      width,
    },
    id,
  }
}

function buildTerminalScript(input) {
  return [
    `cd ${shellQuote(process.cwd())}`,
    'clear',
    `printf '%s\\n' ${shellQuote('$ ' + input.command)}`,
    input.command,
    "printf '\\n%s\\n' '[demo] reply command finished.'",
    'sleep 8',
  ].join('; ')
}

function appleScriptQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function recordWindow(input, window) {
  mkdirSync(dirname(input.outputVideo), { recursive: true })
  rmSync(input.outputVideo, { force: true })
  const rect = [
    window.bounds.left,
    window.bounds.top,
    window.bounds.width,
    window.bounds.height,
  ].join(',')
  run(
    'screencapture',
    [
      '-x',
      '-v',
      `-V${input.duration}`,
      `-R${rect}`,
      input.outputVideo,
    ],
    {
      label: 'Record Terminal window rectangle',
      stdio: 'pipe',
    },
  )
  if (!existsSync(input.outputVideo)) {
    throw new Error(`Recording did not create ${input.outputVideo}`)
  }
}

function buildGif(input) {
  mkdirSync(dirname(input.outputGif), { recursive: true })
  const attempts = [
    { fps: input.fps, width: input.gifWidth, colors: 96 },
    { fps: Math.min(input.fps, 7), width: Math.min(input.gifWidth, 820), colors: 80 },
    { fps: Math.min(input.fps, 6), width: Math.min(input.gifWidth, 760), colors: 72 },
    { fps: Math.min(input.fps, 5), width: Math.min(input.gifWidth, 680), colors: 64 },
  ]

  let lastSize = 0
  for (const attempt of attempts) {
    encodeGif(input.outputVideo, input.outputGif, attempt)
    lastSize = statSync(input.outputGif).size
    if (lastSize <= input.maxBytes) {
      return {
        ...attempt,
        size: lastSize,
      }
    }
  }

  return {
    ...attempts.at(-1),
    oversized: true,
    size: lastSize,
  }
}

function encodeGif(videoPath, gifPath, input) {
  const palettePath = `${gifPath}.palette.png`
  rmSync(gifPath, { force: true })
  rmSync(palettePath, { force: true })

  const filter =
    `fps=${input.fps},` +
    `scale=${input.width}:-1:flags=lanczos,` +
    `palettegen=max_colors=${input.colors}:stats_mode=diff`
  run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      videoPath,
      '-vf',
      filter,
      palettePath,
    ],
    { label: 'Generate GIF palette' },
  )

  const useFilter =
    `fps=${input.fps},` +
    `scale=${input.width}:-1:flags=lanczos[x];` +
    '[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
  run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      videoPath,
      '-i',
      palettePath,
      '-lavfi',
      useFilter,
      gifPath,
    ],
    { label: 'Encode GIF' },
  )

  rmSync(palettePath, { force: true })
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('record-reply-demo only supports macOS screencapture.')
  }

  const args = parseArgs(process.argv.slice(2))
  args.outputGif = resolve(args.outputGif)
  args.outputVideo = resolve(args.outputVideo)

  const window = openTerminalWindow(args)
  await new Promise(resolveDelay => setTimeout(resolveDelay, 1200))
  recordWindow(args, window)
  const gif = buildGif(args)

  process.stdout.write(
    `${JSON.stringify({
      gif,
      outputGif: args.outputGif,
      outputVideo: args.outputVideo,
      window,
    }, null, 2)}\n`,
  )
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
