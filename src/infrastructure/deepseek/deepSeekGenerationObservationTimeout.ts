export interface ResolveDeepSeekGenerationObservationTimeoutInput {
  timeoutMs: number
  startedAt: number
  minimumTimeoutMs?: number | undefined
  now?: number | undefined
}

export function resolveDeepSeekGenerationObservationTimeoutMs(
  input: ResolveDeepSeekGenerationObservationTimeoutInput,
): number {
  const minimumTimeoutMs = Math.max(0, Math.floor(input.minimumTimeoutMs ?? 1_000))
  const now = Math.max(input.startedAt, Math.floor(input.now ?? Date.now()))
  const elapsedMs = Math.max(0, now - input.startedAt)
  const remainingMs = Math.max(0, Math.floor(input.timeoutMs) - elapsedMs)
  return Math.max(minimumTimeoutMs, remainingMs)
}
