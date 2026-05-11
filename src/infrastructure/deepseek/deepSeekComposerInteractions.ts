import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, Page } from 'puppeteer-core'
import type { DeepSeekComposerToggleName } from '../../types/deepseek-composer-mode.types.js'
import type { SendButtonMode } from '../../types/deepseek-controls.types.js'

const DEEPSEEK_COMPOSER_DOM_HELPERS = `
const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim()
const isVisible = element => {
  if (!(element instanceof HTMLElement)) {
    return true
  }

  if (
    element.hidden ||
    element.closest('[hidden], [inert], [aria-hidden="true"]')
  ) {
    return false
  }

  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
    return false
  }

  if (Number.parseFloat(style.opacity || '1') === 0) {
    return false
  }

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
const collectVisibleCandidates = root =>
  Array.from(root.querySelectorAll('button, [role="button"], label')).filter(isVisible)
const findVisibleComposerInput = () =>
  Array.from(
    document.querySelectorAll(
      [
        'textarea:not([disabled])',
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        '[role="textbox"]',
      ].join(','),
    ),
  ).find(isVisible) ?? null
const findComposerRoot = inputElement => {
  let current = inputElement?.parentElement ?? null
  while (current) {
    if (collectVisibleCandidates(current).length >= 2) {
      return current
    }
    current = current.parentElement
  }
  return document.body
}
const inferButtonLabel = element =>
  normalize(
    [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.textContent,
      element.querySelector('svg title')?.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase()
const isIconOnlyButton = element =>
  !inferButtonLabel(element) &&
  element.getAttribute('role') === 'button' &&
  normalize(element.getAttribute('class')).toLowerCase().includes('icon-button')
const findButtonMatch = (buttons, matcher) => {
  for (const button of buttons) {
    if (matcher(inferButtonLabel(button), button)) {
      return button
    }
  }
  return null
}
const resolveComposerButtons = () => {
  const input = findVisibleComposerInput()
  const root = findComposerRoot(input)
  const buttons = collectVisibleCandidates(root)
  const iconButtons = buttons.filter(
    button =>
      isIconOnlyButton(button) &&
      !/(deepthink|深度思考|thinking|reason|search|联网搜索|智能搜索|web search|smart search|browse)/.test(
        inferButtonLabel(button),
      ),
  )
  return { input, buttons, iconButtons }
}
`

const FIND_COMPOSER_INPUT_HANDLE_SOURCE = `
(() => {
  ${DEEPSEEK_COMPOSER_DOM_HELPERS}
  return resolveComposerButtons().input
})()
`

const FIND_COMPOSER_SEND_BUTTON_HANDLE_SOURCE = `
(() => {
  ${DEEPSEEK_COMPOSER_DOM_HELPERS}
  const { buttons, iconButtons } = resolveComposerButtons()
  return (
    findButtonMatch(
      buttons,
      (label, element) =>
        /(send|stop|发送|停止|paper plane|arrow up|square|submit|continue)/.test(label) ||
        /(send|submit|stop)/.test(normalize(element.getAttribute('data-testid')).toLowerCase()),
    ) ?? iconButtons.at(-1) ?? null
  )
})()
`

const FIND_COMPOSER_TOGGLE_HANDLE_SOURCE = `
(toggleName => {
  ${DEEPSEEK_COMPOSER_DOM_HELPERS}
  const { buttons } = resolveComposerButtons()
  if (toggleName === 'deepThink') {
    return findButtonMatch(buttons, label => /(deepthink|深度思考|thinking|reason)/.test(label))
  }
  if (toggleName === 'search') {
    return findButtonMatch(
      buttons,
      label => /(search|联网搜索|智能搜索|web search|smart search|browse)/.test(label),
    )
  }
  return null
})
`

export async function focusAndTypeDeepSeekComposer(page: Page, prompt: string): Promise<void> {
  const inputHandle = await resolveDeepSeekComposerInputHandle(page)
  if (!inputHandle) {
    throw new Error('Could not find a visible DeepSeek composer input.')
  }

  try {
    await inputHandle.focus()
    await clearComposerDraft(page, inputHandle)
    await setComposerDraftViaDom(inputHandle, prompt)

    const finalDraft = (await readComposerDraftFromHandle(inputHandle)) ?? ''
    if (normalizeComposerDraftText(finalDraft) !== normalizeComposerDraftText(prompt)) {
      throw new Error('DeepSeek composer draft did not settle to the requested prompt.')
    }
  } finally {
    await inputHandle.dispose().catch(() => {})
  }
}

export async function readDeepSeekComposerDraftText(page: Page): Promise<string | null> {
  const inputHandle = await resolveDeepSeekComposerInputHandle(page)
  if (!inputHandle) {
    return null
  }

  try {
    return await readComposerDraftFromHandle(inputHandle)
  } finally {
    await inputHandle.dispose().catch(() => {})
  }
}

export async function replaceDeepSeekComposerDraftText(
  page: Page,
  input: {
    prompt: string
    expectedPrefill?: string | null | undefined
  },
): Promise<string> {
  const inputHandle = await resolveDeepSeekComposerInputHandle(page)
  if (!inputHandle) {
    throw new Error('Could not find a visible DeepSeek composer input.')
  }

  try {
    const observedPrefill = (await readComposerDraftFromHandle(inputHandle)) ?? ''
    if (
      input.expectedPrefill !== undefined &&
      normalizeComposerDraftText(observedPrefill) !== normalizeComposerDraftText(input.expectedPrefill ?? '')
    ) {
      throw new Error(
        'DeepSeek composer prefill did not match the expected edit-mode draft.',
      )
    }

    await inputHandle.focus()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.down(modifier)
    await page.keyboard.press('KeyA')
    await page.keyboard.up(modifier)
    await page.keyboard.press('Backspace')
    await delay(100)

    const afterKeyboardClear = normalizeComposerDraftText(
      (await readComposerDraftFromHandle(inputHandle)) ?? '',
    )
    if (afterKeyboardClear !== '') {
      await setComposerDraftViaDom(inputHandle, '')
    }

    const clearedDraft = normalizeComposerDraftText((await readComposerDraftFromHandle(inputHandle)) ?? '')
    if (clearedDraft !== '') {
      throw new Error('DeepSeek composer draft could not be cleared in edit-mode.')
    }

    await setComposerDraftViaDom(inputHandle, input.prompt)
    const finalDraft = (await readComposerDraftFromHandle(inputHandle)) ?? ''
    if (normalizeComposerDraftText(finalDraft) !== normalizeComposerDraftText(input.prompt)) {
      throw new Error('DeepSeek composer draft did not settle to the requested replacement prompt.')
    }

    return observedPrefill
  } finally {
    await inputHandle.dispose().catch(() => {})
  }
}

export async function waitForDeepSeekSendButtonEnabled(
  page: Page,
  options: {
    timeoutMs: number
    pollIntervalMs?: number
  },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs
  const pollIntervalMs = options.pollIntervalMs ?? 100

  while (Date.now() < deadline) {
    const sendButtonHandle = await resolveDeepSeekSendButtonHandle(page)
    if (sendButtonHandle) {
      const enabled = await sendButtonHandle.evaluate(
        element =>
          element.getAttribute('aria-disabled') !== 'true' &&
          !String(element.getAttribute('class') ?? '')
            .toLowerCase()
            .includes('disabled'),
      )
      await sendButtonHandle.dispose().catch(() => {})
      if (enabled) {
        return
      }
    }

    await delay(pollIntervalMs)
  }

  throw new Error('Timed out waiting for the DeepSeek send button to become enabled.')
}

export async function waitForDeepSeekSendButtonMode(
  page: Page,
  options: {
    mode: Extract<SendButtonMode, 'send' | 'stop'>
    timeoutMs: number
    pollIntervalMs?: number
  },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs
  const pollIntervalMs = options.pollIntervalMs ?? 100

  while (Date.now() < deadline) {
    const sendButtonHandle = await resolveDeepSeekSendButtonHandle(page)
    if (sendButtonHandle) {
      const mode = await resolveSendButtonMode(sendButtonHandle)
      await sendButtonHandle.dispose().catch(() => {})
      if (mode === options.mode) {
        return
      }
    }

    await delay(pollIntervalMs)
  }

  throw new Error(`Timed out waiting for the DeepSeek ${options.mode} button mode.`)
}

export async function clickDeepSeekSendButton(page: Page): Promise<void> {
  const sendButtonHandle = await resolveDeepSeekSendButtonHandle(page)
  if (!sendButtonHandle) {
    throw new Error('Could not find the DeepSeek send button.')
  }

  try {
    const enabled = await sendButtonHandle.evaluate(
      element =>
        element.getAttribute('aria-disabled') !== 'true' &&
        !String(element.getAttribute('class') ?? '')
          .toLowerCase()
          .includes('disabled'),
    )
    if (!enabled) {
      throw new Error('The DeepSeek send button is still disabled.')
    }
    const mode = await resolveSendButtonMode(sendButtonHandle)
    if (mode !== 'send') {
      throw new Error(`Expected the DeepSeek composer button to be in send mode, but got ${mode}.`)
    }

    await sendButtonHandle.click()
  } finally {
    await sendButtonHandle.dispose().catch(() => {})
  }
}

export async function clickDeepSeekStopButton(page: Page): Promise<void> {
  const sendButtonHandle = await resolveDeepSeekSendButtonHandle(page)
  if (!sendButtonHandle) {
    throw new Error('Could not find the DeepSeek stop button.')
  }

  try {
    const enabled = await sendButtonHandle.evaluate(
      element =>
        element.getAttribute('aria-disabled') !== 'true' &&
        !String(element.getAttribute('class') ?? '')
          .toLowerCase()
          .includes('disabled'),
    )
    if (!enabled) {
      throw new Error('The DeepSeek stop button is disabled.')
    }

    const mode = await resolveSendButtonMode(sendButtonHandle)
    if (mode !== 'stop') {
      throw new Error(`Expected the DeepSeek composer button to be in stop mode, but got ${mode}.`)
    }

    await sendButtonHandle.click()
  } finally {
    await sendButtonHandle.dispose().catch(() => {})
  }
}

export async function clickDeepSeekComposerToggle(
  page: Page,
  toggleName: DeepSeekComposerToggleName,
): Promise<void> {
  const toggleHandle = await resolveDeepSeekComposerToggleHandle(page, toggleName)
  if (!toggleHandle) {
    throw new Error(`Could not find the DeepSeek ${toggleName} toggle.`)
  }

  try {
    const enabled = await isComposerControlEnabled(toggleHandle)
    if (!enabled) {
      throw new Error(`The DeepSeek ${toggleName} toggle is disabled.`)
    }

    await toggleHandle.click()
  } finally {
    await toggleHandle.dispose().catch(() => {})
  }
}

async function resolveDeepSeekComposerInputHandle(
  page: Page,
): Promise<ElementHandle<Element> | null> {
  return resolveElementHandle(page, FIND_COMPOSER_INPUT_HANDLE_SOURCE)
}

async function resolveDeepSeekSendButtonHandle(
  page: Page,
): Promise<ElementHandle<Element> | null> {
  return resolveElementHandle(page, FIND_COMPOSER_SEND_BUTTON_HANDLE_SOURCE)
}

async function resolveDeepSeekComposerToggleHandle(
  page: Page,
  toggleName: DeepSeekComposerToggleName,
): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    ({ source, requestedToggleName }) => {
      const resolver = window.eval(source) as (toggleName: string) => Element | null
      return resolver(requestedToggleName)
    },
    {
      source: FIND_COMPOSER_TOGGLE_HANDLE_SOURCE,
      requestedToggleName: toggleName,
    },
  )
  const element = handle.asElement()
  if (!element) {
    await handle.dispose().catch(() => {})
    return null
  }
  return element as ElementHandle<Element>
}

async function resolveElementHandle(
  page: Page,
  source: string,
): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    script => window.eval(script) as Element | null,
    source,
  )
  const element = handle.asElement()
  if (!element) {
    await handle.dispose().catch(() => {})
    return null
  }
  return element as ElementHandle<Element>
}

async function isComposerControlEnabled(handle: ElementHandle<Element>): Promise<boolean> {
  return handle.evaluate(
    element =>
      element.getAttribute('aria-disabled') !== 'true' &&
      !String(element.getAttribute('class') ?? '')
        .toLowerCase()
        .includes('disabled'),
  )
}

async function resolveSendButtonMode(handle: ElementHandle<Element>): Promise<SendButtonMode> {
  return handle.evaluate(element => {
    const normalizedLabel = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.textContent,
      element.querySelector('svg title')?.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

    let svgSignature = ''
    for (const path of Array.from(element.querySelectorAll('svg path'))) {
      const segment = path.getAttribute('d')
      if (segment) {
        svgSignature += `${segment} `
      }
    }
    svgSignature = svgSignature.replace(/\s+/g, ' ').trim().toLowerCase()
    const isRoundedSquareStopIcon =
      svgSignature.includes('m2 4.88c2 3.68009') &&
      svgSignature.includes('h11.12') &&
      svgSignature.includes('v11.12')

    if (
      /(stop|停止|square|cancel|暂停|终止)/.test(normalizedLabel) ||
      String(element.getAttribute('data-testid') ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .includes('stop') ||
      /m4(?:\.\d+)? 4(?:\.\d+)?h12/.test(svgSignature) ||
      isRoundedSquareStopIcon
    ) {
      return 'stop'
    }

    return 'send'
  })
}

async function readComposerDraftFromHandle(
  handle: ElementHandle<Element>,
): Promise<string | null> {
  return handle.evaluate(element => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.value
    }

    if (element instanceof HTMLElement) {
      return element.textContent ?? ''
    }

    return null
  })
}

async function clearComposerDraft(
  page: Page,
  handle: ElementHandle<Element>,
): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.down(modifier)
  await page.keyboard.press('KeyA')
  await page.keyboard.up(modifier)
  await page.keyboard.press('Backspace')
  await delay(100)

  const afterKeyboardClear = normalizeComposerDraftText(
    (await readComposerDraftFromHandle(handle)) ?? '',
  )
  if (afterKeyboardClear !== '') {
    await setComposerDraftViaDom(handle, '')
  }

  const clearedDraft = normalizeComposerDraftText((await readComposerDraftFromHandle(handle)) ?? '')
  if (clearedDraft !== '') {
    throw new Error('DeepSeek composer draft could not be cleared before typing.')
  }
}

async function setComposerDraftViaDom(
  handle: ElementHandle<Element>,
  prompt: string,
): Promise<void> {
  await handle.evaluate((element, value) => {
    if (element instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        ?.set?.call(element, value)
    } else if (element instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        ?.set?.call(element, value)
    } else if (element instanceof HTMLElement) {
      element.textContent = value
    } else {
      return
    }

    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: value ? 'insertText' : 'deleteContentBackward',
        data: value,
      }),
    )
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, prompt)
  await delay(50)
}

function normalizeComposerDraftText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}
