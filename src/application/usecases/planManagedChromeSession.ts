import { planManagedChromeExecution } from '../../domain/browser/managedChrome.js'
import type { ManagedChromeOptions } from '../../types/managed-chrome.types.js'

export function planManagedChromeSession(options: ManagedChromeOptions) {
  return planManagedChromeExecution(options)
}
