import {
  DEFAULT_REQUEST_BUDGET_POLICY,
  RequestBudgetGate,
} from '../../shared/rate-limit/requestBudget.js'
import { buildDeepSeekGenerationBudgetStateFilePath } from '../../shared/runtime/runtimePaths.js'

export const deepSeekGenerationBudgetGate = new RequestBudgetGate(DEFAULT_REQUEST_BUDGET_POLICY, {
  stateFilePath: buildDeepSeekGenerationBudgetStateFilePath(),
})
