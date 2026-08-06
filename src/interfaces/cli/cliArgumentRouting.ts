const ROOT_BOOLEAN_OPTIONS = new Set([
  '--quiet',
  '--no-quiet',
  '--verbose',
])
const ROOT_META_OPTIONS = new Set([
  '--help',
  '-h',
  '--version',
  '-V',
])

export function routeCliArgumentsToReply(
  arguments_: readonly string[],
  knownCommands: readonly string[],
): string[] {
  if (arguments_.length === 0) {
    return []
  }

  const firstRoutable = arguments_.find(
    argument => !ROOT_BOOLEAN_OPTIONS.has(argument),
  )
  if (!firstRoutable || ROOT_META_OPTIONS.has(firstRoutable)) {
    return [...arguments_]
  }
  if (knownCommands.includes(firstRoutable)) {
    return [...arguments_]
  }
  return ['reply', ...arguments_]
}
