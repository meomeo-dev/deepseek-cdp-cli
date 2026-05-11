import { resolveBrowserRuntimeOptions } from '../../domain/browser/browserRuntimeResolver.js'
import type { OpenAIHttpExecutionEnvironment } from '../../types/openai-http-service.types.js'
import type { WaitUntil } from '../../types/managed-chrome.types.js'

export const DEFAULT_OPENAI_HTTP_CDP_URL = 'http://127.0.0.1:9222'
export const DEFAULT_OPENAI_HTTP_TIMEOUT_MS = 30_000
export const DEFAULT_OPENAI_HTTP_TARGET_URL = 'https://chat.deepseek.com/'
export const DEFAULT_OPENAI_HTTP_WAIT_UNTIL: WaitUntil = 'domcontentloaded'
export const DEFAULT_OPENAI_HTTP_SESSION_STORE_DIR = '.deepseek-cdp-cli/sessions'

export function createDefaultOpenAIHttpExecutionEnvironment(): OpenAIHttpExecutionEnvironment {
  return {
    managedChromeOptions: resolveBrowserRuntimeOptions(
      {
        cdpUrl: DEFAULT_OPENAI_HTTP_CDP_URL,
        timeoutMs: DEFAULT_OPENAI_HTTP_TIMEOUT_MS,
        cloneChromeProfile: false,
        headless: false,
        keepTempChromeProfile: false,
      },
      { entrypoint: 'rpc' },
    ),
    waitUntil: DEFAULT_OPENAI_HTTP_WAIT_UNTIL,
    url: DEFAULT_OPENAI_HTTP_TARGET_URL,
    sessionStoreDir: DEFAULT_OPENAI_HTTP_SESSION_STORE_DIR,
  }
}
