import type {
  DeepSeekRenderedSearchPrompt,
  DeepSeekSearchPromptSample,
  DeepSeekSearchPromptSource,
  DeepSeekSearchPromptValidationResult,
  DeepSeekSearchRequiredComposerMode,
  DeepSeekSearchVerificationScript,
} from '../../types/deepseek-search-prompt.types.js'

export const DEEPSEEK_SEARCH_REQUIRED_COMPOSER_MODE: DeepSeekSearchRequiredComposerMode = {
  deepThink: 'on',
  search: 'on',
}

export const DEEPSEEK_SEARCH_PROMPT_INTRO =
  '深度研究一下, 从互联网中收集所需的多个维度信息:'

export const DEEPSEEK_SEARCH_EXPECTED_OPENING_PREFIX = '让我先搜索资料...'

const DEEPSEEK_SEARCH_SAMPLE_POOL: DeepSeekSearchPromptSample[] = [
  {
    id: 'browser-automation-stack-2026q2',
    title: '2026Q2 浏览器自动化与 agent-browser 技术栈对比',
    dimensions: [
      '收集 Playwright、Puppeteer、browser-use / agent-browser 类方案在最新官方文档中的定位、支持浏览器与 CDP 能力',
      '比较这些方案在登录态复用、用户 profile / persistent context、无头与有头运行上的说明',
      '收集它们的许可证、维护活跃度与近期版本发布信号',
    ],
    task:
      '输出一张对比表，并给出对“复用本机 Chrome 登录态驱动 DeepSeek 网页自动化 CLI”最合适的主方案与备选方案。',
    rationale: '需要交叉比对多套官方文档、版本信息与使用限制，单页资料不足以给出结论。',
    tags: ['browser-automation', 'cdp', 'tooling', 'real-search'],
  },
  {
    id: 'openai-compatible-output-2026q2',
    title: 'OpenAI 兼容输出协议研究',
    dimensions: [
      '收集 OpenAI 官方关于 `/v1/responses` 与 `/v1/chat/completions` 的文本对话与流式输出要求',
      '收集常见 OpenAI-compatible 服务在 responses / chat completions 两类接口上的兼容范围与已知差异',
      '收集 streaming 事件、finish reason、citation / annotation 表达上的兼容注意点',
    ],
    task: '整理一个适合 CLI / RPC 适配层的兼容性清单，指出最需要防漂移的字段、事件与失败边界。',
    rationale: '该主题需要同时对照官方规范与第三方兼容说明，适合作为多维度联网检索样本。',
    tags: ['openai-compatible', 'streaming', 'adapter', 'api'],
  },
  {
    id: 'search-evidence-export-2026q2',
    title: '搜索结果、引用与导出保真研究',
    dimensions: [
      '收集主流 AI 搜索或深度研究产品如何展示引用、来源卡片与检索过程',
      '收集这些产品是否输出显式 citations、search evidence、source cards 或 timeline',
      '收集 Markdown / JSON 导出时如何保留来源信息、引用与 provenance 的做法',
    ],
    task: '为一个基于浏览器自动化的 DeepSeek CLI 制定搜索结果导出字段建议，要求明确区分 citations、search evidence 与 provenance。',
    rationale: '需要多来源样本支撑导出设计，不能只依赖单一产品页面或模型记忆。',
    tags: ['search', 'citations', 'export', 'provenance'],
  },
]

export function listDeepSeekSearchPromptSamples(): DeepSeekSearchPromptSample[] {
  return DEEPSEEK_SEARCH_SAMPLE_POOL.map(cloneSearchPromptSample)
}

export function findDeepSeekSearchPromptSampleById(
  sampleId: string,
): DeepSeekSearchPromptSample | null {
  const match = DEEPSEEK_SEARCH_SAMPLE_POOL.find(sample => sample.id === sampleId)
  return match ? cloneSearchPromptSample(match) : null
}

export function validateDeepSeekSearchPromptSource(
  source: DeepSeekSearchPromptSource,
): DeepSeekSearchPromptValidationResult {
  const issues: string[] = []
  const dimensions = source.dimensions.map(normalizeSingleLineText).filter(Boolean)
  const task = normalizeBlockText(source.task)

  if (dimensions.length < 2) {
    issues.push('Search prompt source must contain at least two research dimensions.')
  }

  if (source.dimensions.some(dimension => normalizeSingleLineText(dimension).length === 0)) {
    issues.push('Search prompt source cannot contain empty research dimensions.')
  }

  if (task.length === 0) {
    issues.push('Search prompt source must contain a non-empty task.')
  }

  if ('id' in source && normalizeSingleLineText(source.id).length === 0) {
    issues.push('Search prompt sample must contain a non-empty id.')
  }

  if ('rationale' in source && normalizeSingleLineText(source.rationale).length === 0) {
    issues.push('Search prompt sample must contain a non-empty rationale.')
  }

  if ('tags' in source) {
    if (source.tags.length === 0) {
      issues.push('Search prompt sample must contain at least one tag.')
    }
    if (source.tags.some(tag => normalizeSingleLineText(tag).length === 0)) {
      issues.push('Search prompt sample cannot contain empty tags.')
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

export function buildDeepSeekSearchPrompt(
  source: DeepSeekSearchPromptSource,
): DeepSeekRenderedSearchPrompt {
  assertValidSearchPromptSource(source)

  const dimensions = source.dimensions.map(normalizeSingleLineText).filter(Boolean)
  const task = normalizeBlockText(source.task)

  const prompt = [
    DEEPSEEK_SEARCH_PROMPT_INTRO,
    ...dimensions.map((dimension, index) => `${index + 1}. ${dimension}`),
    '',
    '任务:',
    task,
    '',
    `回复开头为“${DEEPSEEK_SEARCH_EXPECTED_OPENING_PREFIX}”`,
  ]
    .join('\n')
    .trimEnd()

  return {
    prompt,
    expectedOpeningPrefix: DEEPSEEK_SEARCH_EXPECTED_OPENING_PREFIX,
    requiredComposerMode: cloneRequiredComposerMode(),
    dimensionCount: dimensions.length,
  }
}

export function buildDeepSeekSearchVerificationScript(
  source: DeepSeekSearchPromptSource,
): DeepSeekSearchVerificationScript {
  const renderedPrompt = buildDeepSeekSearchPrompt(source)
  const title = normalizeSingleLineText(source.title ?? '')

  return {
    sampleId: 'id' in source ? source.id : null,
    title: title.length > 0 ? title : null,
    preconditions: {
      composerMode: cloneRequiredComposerMode(),
    },
    prompt: renderedPrompt.prompt,
    expectedOpeningPrefix: renderedPrompt.expectedOpeningPrefix,
    checklist: [
      '发送前确认 DeepThink=on。',
      '发送前确认 Search=on。',
      `assistant 首句以“${renderedPrompt.expectedOpeningPrefix}”开头。`,
      'prompt 含编号维度列表与 `任务:` 段落。',
    ],
    promptShape: {
      dimensionCount: renderedPrompt.dimensionCount,
      hasTaskSection: true,
    },
  }
}

export function renderDeepSeekSearchVerificationScript(
  script: DeepSeekSearchVerificationScript,
): string {
  const lines = ['前置条件:']

  if (script.sampleId) {
    lines.unshift(`样本 ID: ${script.sampleId}`)
  }
  if (script.title) {
    lines.splice(script.sampleId ? 1 : 0, 0, `样本标题: ${script.title}`)
  }

  lines.push(`- DeepThink=${script.preconditions.composerMode.deepThink}`)
  lines.push(`- Search=${script.preconditions.composerMode.search}`)
  lines.push('')
  lines.push('Prompt:')
  lines.push('```text')
  lines.push(script.prompt)
  lines.push('```')
  lines.push('')
  lines.push('预期校验:')

  for (const item of script.checklist) {
    lines.push(`- ${item}`)
  }

  lines.push(`- 编号维度数: ${script.promptShape.dimensionCount}`)
  lines.push(`- 含任务段落: ${script.promptShape.hasTaskSection ? 'yes' : 'no'}`)

  return `${lines.join('\n').trimEnd()}\n`
}

export function matchesDeepSeekSearchOpeningPrefix(text: string | null | undefined): boolean {
  if (!text) {
    return false
  }
  return text.trimStart().startsWith(DEEPSEEK_SEARCH_EXPECTED_OPENING_PREFIX)
}

function assertValidSearchPromptSource(source: DeepSeekSearchPromptSource): void {
  const validation = validateDeepSeekSearchPromptSource(source)
  if (!validation.valid) {
    throw new Error(`Invalid DeepSeek search prompt source: ${validation.issues.join(' ')}`)
  }
}

function cloneSearchPromptSample(sample: DeepSeekSearchPromptSample): DeepSeekSearchPromptSample {
  return {
    id: sample.id,
    title: sample.title,
    dimensions: [...sample.dimensions],
    task: sample.task,
    rationale: sample.rationale,
    tags: [...sample.tags],
  }
}

function cloneRequiredComposerMode(): DeepSeekSearchRequiredComposerMode {
  return {
    deepThink: DEEPSEEK_SEARCH_REQUIRED_COMPOSER_MODE.deepThink,
    search: DEEPSEEK_SEARCH_REQUIRED_COMPOSER_MODE.search,
  }
}

function normalizeSingleLineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeBlockText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim()
}
