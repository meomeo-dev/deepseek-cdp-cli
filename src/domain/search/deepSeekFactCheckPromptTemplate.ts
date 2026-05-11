import type {
  DeepSeekFactCheckPromptSample,
  DeepSeekFactCheckPromptSource,
  DeepSeekFactCheckPromptValidationResult,
  DeepSeekFactCheckRequiredComposerMode,
  DeepSeekFactCheckVerificationScript,
  DeepSeekRenderedFactCheckPrompt,
} from '../../types/deepseek-fact-check-prompt.types.js'

export const DEEPSEEK_FACT_CHECK_REQUIRED_COMPOSER_MODE: DeepSeekFactCheckRequiredComposerMode =
  {
    deepThink: 'on',
    search: 'on',
  }

export const DEEPSEEK_FACT_CHECK_PROMPT_INTRO = '请对以下待核查陈述做联网事实核查:'

export const DEEPSEEK_FACT_CHECK_EXPECTED_OPENING_PREFIX = '让我先核查资料...'

export const DEEPSEEK_FACT_CHECK_PROBABILITY_BUCKETS = [
  '事实',
  '谣言',
  '无法证伪',
] as const

const DEEPSEEK_FACT_CHECK_SAMPLE_POOL: DeepSeekFactCheckPromptSample[] = [
  {
    id: 'deepseek-model-switching-claim-2026q2',
    title: '核查 DeepSeek Chat 是否支持多模型切换',
    claim: '这个版本的 DeepSeek Chat 支持多种模型切换（默认 / 视觉 / 专家）。',
    context:
      '要求优先核查 DeepSeek 官方页面、官方帮助中心、官方公告与真实产品入口，不要把社区猜测当成事实。',
    rationale: '这是一个典型的产品能力真假判断，容易被二手内容和 UI 幻觉误导。',
    tags: ['fact-check', 'product-claim', 'ui-capability'],
  },
  {
    id: 'company-funding-rumor-2026q2',
    title: '核查公司融资传闻',
    claim: '某 AI 创业公司已经完成了 10 亿美元的新一轮融资。',
    context:
      '要求区分“官方确认”“媒体援引匿名消息”“投资意向/谈判中”“旧闻复述”这几类证据，不把传闻写成既成事实。',
    rationale: '融资相关说法常见“接近完成”“正在洽谈”“已完成”混写，适合做谣言/事实边界验证。',
    tags: ['fact-check', 'funding', 'rumor'],
  },
  {
    id: 'policy-rumor-2026q2',
    title: '核查政策谣言',
    claim: '某地已经正式禁止个人使用生成式 AI 工具。',
    context:
      '要求核查正式法规、监管公告、实施时间、适用主体与处罚边界；若只有征求意见稿、地方通知或机构内部政策，必须明确降级。',
    rationale: '政策类传言常有时间、地域、主体适用范围错配，需要显式处理“无法证伪”与“局部事实被泛化”。',
    tags: ['fact-check', 'policy', 'regulation'],
  },
]

export function listDeepSeekFactCheckPromptSamples(): DeepSeekFactCheckPromptSample[] {
  return DEEPSEEK_FACT_CHECK_SAMPLE_POOL.map(cloneDeepSeekFactCheckPromptSample)
}

export function findDeepSeekFactCheckPromptSampleById(
  sampleId: string,
): DeepSeekFactCheckPromptSample | null {
  const match = DEEPSEEK_FACT_CHECK_SAMPLE_POOL.find(sample => sample.id === sampleId)
  return match ? cloneDeepSeekFactCheckPromptSample(match) : null
}

export function validateDeepSeekFactCheckPromptSource(
  source: DeepSeekFactCheckPromptSource,
): DeepSeekFactCheckPromptValidationResult {
  const issues: string[] = []
  const claim = normalizeBlockText(source.claim)
  const context = normalizeBlockText(source.context ?? '')
  const constraints = normalizeStringArray(source.constraints ?? [])

  if (claim.length === 0) {
    issues.push('Fact-check prompt source must contain a non-empty claim.')
  }

  if ('id' in source && normalizeSingleLineText(source.id).length === 0) {
    issues.push('Fact-check prompt sample must contain a non-empty id.')
  }

  if ('rationale' in source && normalizeSingleLineText(source.rationale).length === 0) {
    issues.push('Fact-check prompt sample must contain a non-empty rationale.')
  }

  if ('tags' in source) {
    if (source.tags.length === 0) {
      issues.push('Fact-check prompt sample must contain at least one tag.')
    }
    if (source.tags.some(tag => normalizeSingleLineText(tag).length === 0)) {
      issues.push('Fact-check prompt sample cannot contain empty tags.')
    }
  }

  if (source.context !== undefined && context.length === 0) {
    issues.push('Fact-check prompt source cannot contain an empty context block.')
  }

  if (source.constraints !== undefined && constraints.length !== source.constraints.length) {
    issues.push('Fact-check prompt source cannot contain empty constraints.')
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

export function buildDeepSeekFactCheckPrompt(
  source: DeepSeekFactCheckPromptSource,
): DeepSeekRenderedFactCheckPrompt {
  assertValidDeepSeekFactCheckPromptSource(source)

  const claim = normalizeBlockText(source.claim)
  const context = normalizeBlockText(source.context ?? '')
  const constraints = normalizeStringArray(source.constraints ?? [])

  const promptLines = [
    DEEPSEEK_FACT_CHECK_PROMPT_INTRO,
    '',
    '待核查陈述:',
    claim,
  ]

  if (context.length > 0) {
    promptLines.push('')
    promptLines.push('补充上下文:')
    promptLines.push(context)
  }

  promptLines.push('')
  promptLines.push('任务:')
  promptLines.push('1. 优先检索官方来源、一手资料与高可信公开来源，并明确证据日期与适用范围。')
  promptLines.push(
    `2. 判断该陈述更可能是：${DEEPSEEK_FACT_CHECK_PROBABILITY_BUCKETS.join(' / ')}，并给出三者概率，合计 100%。`,
  )
  promptLines.push(
    '3. 无论最终结论偏向哪一类，三者概率都必须同时出现，且必须显式写出百分比；不得只给定性结论，不得省略某一桶。',
  )
  promptLines.push(
    '4. 回复开头之后，必须先按如下两行格式输出，再进入正文分析；不要把这两行改写成段落，也不要延后到文末。',
  )
  promptLines.push('   - Verdict: <一句话结论>')
  promptLines.push('   - Probabilities: 事实 XX% / 谣言 YY% / 无法证伪 ZZ%')
  promptLines.push(
    '5. 概率桶名称必须原样使用“事实 / 谣言 / 无法证伪”，总和必须是 100%。若当前证据不足，也必须给出三桶概率。',
  )
  promptLines.push('6. 分列：已确认事实、反证/辟谣证据、仍无法确认点、相互冲突来源。')
  promptLines.push(
    '7. 若结论依赖时间、地区、版本、主体或前置条件，必须写清边界，不得把局部情况泛化成普遍事实。',
  )
  promptLines.push('8. 若证据不足以证实或证伪，必须明确说明“当前证据不足”，不能强行下结论。')

  if (constraints.length > 0) {
    promptLines.push('')
    promptLines.push('附加约束:')
    for (const constraint of constraints) {
      promptLines.push(`- ${constraint}`)
    }
  }

  promptLines.push('')
  promptLines.push('输出结构:')
  promptLines.push('- 开头固定先输出两行：Verdict / Probabilities')
  promptLines.push('- Verdict')
  promptLines.push('- Probabilities: 事实 / 谣言 / 无法证伪')
  promptLines.push('- Evidence Grade')
  promptLines.push('- Confirmed Facts')
  promptLines.push('- Counter Evidence')
  promptLines.push('- Unconfirmed / Unfalsifiable Points')
  promptLines.push('- Conflicts')
  promptLines.push('- Final Conclusion')
  promptLines.push('')
  promptLines.push(`回复开头为“${DEEPSEEK_FACT_CHECK_EXPECTED_OPENING_PREFIX}”`)

  return {
    prompt: promptLines.join('\n').trimEnd(),
    expectedOpeningPrefix: DEEPSEEK_FACT_CHECK_EXPECTED_OPENING_PREFIX,
    requiredComposerMode: cloneRequiredComposerMode(),
    probabilityBuckets: cloneProbabilityBuckets(),
  }
}

export function buildDeepSeekFactCheckVerificationScript(
  source: DeepSeekFactCheckPromptSource,
): DeepSeekFactCheckVerificationScript {
  const renderedPrompt = buildDeepSeekFactCheckPrompt(source)
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
      'assistant 在开头之后必须立刻给出 Verdict 与 Probabilities 两行，不能拖到文末。',
      '输出必须包含事实 / 谣言 / 无法证伪 三个概率桶，且总和为 100%。',
      '概率桶名称必须保持“事实 / 谣言 / 无法证伪”，不能改写成别的标签。',
      '输出必须显式区分已确认事实、反证与仍无法确认点。',
    ],
    probabilityBuckets: cloneProbabilityBuckets(),
  }
}

export function renderDeepSeekFactCheckVerificationScript(
  script: DeepSeekFactCheckVerificationScript,
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

  lines.push(`- 概率桶: ${script.probabilityBuckets.join(' / ')}`)

  return `${lines.join('\n').trimEnd()}\n`
}

export function matchesDeepSeekFactCheckOpeningPrefix(
  text: string | null | undefined,
): boolean {
  if (!text) {
    return false
  }

  return text.trimStart().startsWith(DEEPSEEK_FACT_CHECK_EXPECTED_OPENING_PREFIX)
}

function assertValidDeepSeekFactCheckPromptSource(
  source: DeepSeekFactCheckPromptSource,
): void {
  const validation = validateDeepSeekFactCheckPromptSource(source)
  if (!validation.valid) {
    throw new Error(`Invalid DeepSeek fact-check prompt source: ${validation.issues.join(' ')}`)
  }
}

function cloneDeepSeekFactCheckPromptSample(
  sample: DeepSeekFactCheckPromptSample,
): DeepSeekFactCheckPromptSample {
  return {
    id: sample.id,
    title: sample.title,
    claim: sample.claim,
    context: sample.context,
    constraints: sample.constraints ? [...sample.constraints] : undefined,
    rationale: sample.rationale,
    tags: [...sample.tags],
  }
}

function cloneRequiredComposerMode(): DeepSeekFactCheckRequiredComposerMode {
  return {
    deepThink: DEEPSEEK_FACT_CHECK_REQUIRED_COMPOSER_MODE.deepThink,
    search: DEEPSEEK_FACT_CHECK_REQUIRED_COMPOSER_MODE.search,
  }
}

function cloneProbabilityBuckets(): [string, string, string] {
  return [
    DEEPSEEK_FACT_CHECK_PROBABILITY_BUCKETS[0],
    DEEPSEEK_FACT_CHECK_PROBABILITY_BUCKETS[1],
    DEEPSEEK_FACT_CHECK_PROBABILITY_BUCKETS[2],
  ]
}

function normalizeStringArray(values: string[]): string[] {
  return values.map(normalizeSingleLineText).filter(Boolean)
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
