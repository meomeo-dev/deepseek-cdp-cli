import type {
  CliEffectiveReplyOptions,
  CliPreferenceDiffEntry,
  CliPreferenceKey,
  CliPreferenceSource,
  CliPreferences,
  CliPreferencesDocument,
  CliPreferenceValue,
  CliReplyPreferences,
  CliResolvedReplyPreferences,
} from '../../types/cli-preferences.types.js'

export interface CliPreferenceDescriptor {
  key: CliPreferenceKey
  property: keyof CliReplyPreferences
  builtInValue: CliPreferenceValue | undefined
  valueType: 'boolean' | 'enum'
  choices?: readonly string[] | undefined
}

export const CLI_REPLY_BUILT_INS: Readonly<CliEffectiveReplyOptions> = {
  quiet: false,
  headless: false,
  stream: false,
  format: 'text',
  jsonShape: undefined,
  chatMode: 'expert',
  deepThink: 'on',
  search: 'off',
  new: false,
  citations: true,
}

export const CLI_PREFERENCE_CATALOG: readonly CliPreferenceDescriptor[] = [
  booleanPreference('reply.quiet', 'quiet', false),
  booleanPreference('reply.headless', 'headless', false),
  booleanPreference('reply.stream', 'stream', false),
  enumPreference(
    'reply.format',
    'format',
    'text',
    ['text', 'json', 'stream-json'],
  ),
  enumPreference(
    'reply.jsonShape',
    'jsonShape',
    undefined,
    ['native', 'openai-responses', 'openai-chat-completions'],
  ),
  enumPreference(
    'reply.chatMode',
    'chatMode',
    'expert',
    ['instant', 'expert', 'vision'],
  ),
  enumPreference(
    'reply.deepThink',
    'deepThink',
    'on',
    ['on', 'off', 'unchanged'],
  ),
  enumPreference(
    'reply.search',
    'search',
    'off',
    ['on', 'off', 'unchanged'],
  ),
  booleanPreference('reply.new', 'new', false),
  booleanPreference('reply.citations', 'citations', true),
]

export function createEmptyCliPreferencesDocument(
  now = new Date(),
): CliPreferencesDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now.toISOString(),
    preferences: { reply: {} },
  }
}

export function parseCliPreferenceValue(
  key: string,
  rawValue: string,
): CliPreferenceValue {
  const descriptor = findPreferenceDescriptor(key)
  if (descriptor.valueType === 'boolean') {
    if (rawValue === 'true') {
      return true
    }
    if (rawValue === 'false') {
      return false
    }
  } else if (descriptor.choices?.includes(rawValue)) {
    return rawValue as CliPreferenceValue
  }

  const expected = descriptor.valueType === 'boolean'
    ? 'true or false'
    : descriptor.choices?.join(', ')
  throw new Error(`Invalid value for ${key}: ${rawValue}. Expected ${expected}.`)
}

export function setCliPreferenceValue(
  preferences: CliPreferences,
  key: CliPreferenceKey,
  value: CliPreferenceValue,
): CliPreferences {
  const descriptor = findPreferenceDescriptor(key)
  assertPreferenceValue(descriptor, value, key)
  return {
    reply: {
      ...preferences.reply,
      [descriptor.property]: value,
    },
  }
}

export function resetCliPreferenceValue(
  preferences: CliPreferences,
  key: CliPreferenceKey,
): CliPreferences {
  const descriptor = findPreferenceDescriptor(key)
  const reply: CliReplyPreferences = { ...preferences.reply }
  delete reply[descriptor.property]
  return { reply }
}

export function resolveCliReplyPreferences(input: {
  saved?: CliPreferences | undefined
  explicit?: Partial<CliEffectiveReplyOptions> | undefined
}): CliResolvedReplyPreferences {
  const saved = input.saved?.reply ?? {}
  const explicit = input.explicit ?? {}
  const sources = {} as Record<CliPreferenceKey, CliPreferenceSource>

  const resolveValue = (key: CliPreferenceKey): CliPreferenceValue | undefined => {
    const descriptor = findPreferenceDescriptor(key)
    if (hasOwn(explicit, descriptor.property)) {
      const value = explicit[descriptor.property]
      if (value !== undefined) {
        assertPreferenceValue(descriptor, value, key)
        sources[key] = 'explicit'
        return value
      }
    }

    const savedValue = saved[descriptor.property]
    if (savedValue !== undefined) {
      assertPreferenceValue(descriptor, savedValue, key)
      sources[key] = 'saved'
      return savedValue
    }

    sources[key] = 'built-in'
    return descriptor.builtInValue
  }

  return {
    options: {
      quiet: resolveValue('reply.quiet') as boolean,
      headless: resolveValue('reply.headless') as boolean,
      stream: resolveValue('reply.stream') as boolean,
      format: resolveValue('reply.format') as CliEffectiveReplyOptions['format'],
      jsonShape: resolveValue('reply.jsonShape') as
        CliEffectiveReplyOptions['jsonShape'],
      chatMode: resolveValue('reply.chatMode') as
        CliEffectiveReplyOptions['chatMode'],
      deepThink: resolveValue('reply.deepThink') as
        CliEffectiveReplyOptions['deepThink'],
      search: resolveValue('reply.search') as CliEffectiveReplyOptions['search'],
      new: resolveValue('reply.new') as boolean,
      citations: resolveValue('reply.citations') as boolean,
    },
    sources,
  }
}

export function readCliPreferenceValue(
  preferences: CliPreferences,
  key: CliPreferenceKey,
): CliPreferenceValue | undefined {
  const descriptor = findPreferenceDescriptor(key)
  return preferences.reply[descriptor.property]
}

export function diffCliPreferences(
  before: CliPreferences,
  after: CliPreferences,
): CliPreferenceDiffEntry[] {
  return CLI_PREFERENCE_CATALOG.flatMap(descriptor => {
    const beforeValue = readCliPreferenceValue(before, descriptor.key)
    const afterValue = readCliPreferenceValue(after, descriptor.key)
    return Object.is(beforeValue, afterValue)
      ? []
      : [{ key: descriptor.key, before: beforeValue, after: afterValue }]
  })
}

export function formatCliPreferenceValue(
  value: CliPreferenceValue | undefined,
): string {
  return value === undefined ? '<unset>' : String(value)
}

export function parseCliPreferencesDocument(
  value: unknown,
): CliPreferencesDocument {
  assertRecord(value, 'preferences document')
  assertExactKeys(
    value,
    ['schemaVersion', 'revision', 'updatedAt', 'preferences'],
    'preferences document',
  )
  if (value['schemaVersion'] !== 1) {
    throw new Error('schemaVersion must be 1.')
  }
  if (!Number.isInteger(value['revision']) || Number(value['revision']) < 0) {
    throw new Error('revision must be a non-negative integer.')
  }
  assertIsoTimestamp(value['updatedAt'], 'updatedAt')
  const preferences = parseCliPreferences(value['preferences'])
  return {
    schemaVersion: 1,
    revision: Number(value['revision']),
    updatedAt: String(value['updatedAt']),
    preferences,
  }
}

export function isCliPreferenceKey(value: string): value is CliPreferenceKey {
  return CLI_PREFERENCE_CATALOG.some(descriptor => descriptor.key === value)
}

function parseCliPreferences(value: unknown): CliPreferences {
  assertRecord(value, 'preferences')
  assertExactKeys(value, ['reply'], 'preferences')
  const replyValue = value['reply']
  assertRecord(replyValue, 'preferences.reply')
  const allowedProperties = CLI_PREFERENCE_CATALOG.map(
    descriptor => descriptor.property,
  )
  assertExactKeys(replyValue, allowedProperties, 'preferences.reply')

  let preferences: CliPreferences = { reply: {} }
  for (const descriptor of CLI_PREFERENCE_CATALOG) {
    const candidate = replyValue[descriptor.property]
    if (candidate === undefined) {
      continue
    }
    assertPreferenceValue(descriptor, candidate, descriptor.key)
    preferences = setCliPreferenceValue(
      preferences,
      descriptor.key,
      candidate,
    )
  }
  return preferences
}

function findPreferenceDescriptor(key: string): CliPreferenceDescriptor {
  const descriptor = CLI_PREFERENCE_CATALOG.find(entry => entry.key === key)
  if (!descriptor) {
    throw new Error(`Unknown configurable preference: ${key}`)
  }
  return descriptor
}

function assertPreferenceValue(
  descriptor: CliPreferenceDescriptor,
  value: unknown,
  key: string,
): asserts value is CliPreferenceValue {
  const valid = descriptor.valueType === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && descriptor.choices?.includes(value) === true
  if (!valid) {
    throw new Error(`Invalid value for ${key}: ${String(value)}.`)
  }
}

function booleanPreference(
  key: CliPreferenceKey,
  property: keyof CliReplyPreferences,
  builtInValue: boolean,
): CliPreferenceDescriptor {
  return { key, property, builtInValue, valueType: 'boolean' }
}

function enumPreference(
  key: CliPreferenceKey,
  property: keyof CliReplyPreferences,
  builtInValue: CliPreferenceValue | undefined,
  choices: readonly string[],
): CliPreferenceDescriptor {
  return { key, property, builtInValue, valueType: 'enum', choices }
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly (string | number | symbol)[],
  label: string,
): void {
  const unknownKeys = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`${label} has unknown fields: ${unknownKeys.join(', ')}.`)
  }
  for (const key of allowed) {
    if (label === 'preferences.reply') {
      continue
    }
    if (!hasOwn(value, key)) {
      throw new Error(`${label} is missing required field: ${String(key)}.`)
    }
  }
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be an ISO timestamp.`)
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
