type BrowserRuntimeProcessCleanup = () => Promise<void>

const registeredBrowserRuntimeProcessCleanups = new Set<BrowserRuntimeProcessCleanup>()
let runningBrowserRuntimeProcessCleanup: Promise<void> | null = null

export function registerBrowserRuntimeProcessCleanup(
  cleanup: BrowserRuntimeProcessCleanup,
): () => void {
  registeredBrowserRuntimeProcessCleanups.add(cleanup)

  let unregistered = false
  return () => {
    if (unregistered) {
      return
    }
    unregistered = true
    registeredBrowserRuntimeProcessCleanups.delete(cleanup)
  }
}

export async function runBrowserRuntimeProcessCleanup(): Promise<void> {
  if (runningBrowserRuntimeProcessCleanup) {
    return runningBrowserRuntimeProcessCleanup
  }

  runningBrowserRuntimeProcessCleanup = runBrowserRuntimeProcessCleanupInternal().finally(() => {
    runningBrowserRuntimeProcessCleanup = null
  })

  return runningBrowserRuntimeProcessCleanup
}

async function runBrowserRuntimeProcessCleanupInternal(): Promise<void> {
  const failures: unknown[] = []

  while (registeredBrowserRuntimeProcessCleanups.size > 0) {
    const cleanups = [...registeredBrowserRuntimeProcessCleanups]
    registeredBrowserRuntimeProcessCleanups.clear()
    const results = await Promise.allSettled(cleanups.map(cleanup => cleanup()))

    for (const result of results) {
      if (result.status === 'rejected') {
        failures.push(result.reason)
      }
    }
  }

  if (failures.length === 0) {
    return
  }

  if (failures.length === 1) {
    throw normalizeCleanupFailure(failures[0])
  }

  throw new AggregateError(
    failures.map(normalizeCleanupFailure),
    'Browser runtime process cleanup failed.',
  )
}

function normalizeCleanupFailure(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(`Browser runtime process cleanup failed: ${String(error)}`)
}
