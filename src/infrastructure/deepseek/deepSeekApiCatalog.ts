const CHAT_ENDPOINTS = [
  '/api/v0/chat/completion',
  '/api/v0/chat/regenerate',
  '/api/v0/chat/continue',
  '/api/v0/chat/edit_message',
  '/api/v0/chat/history_messages',
  '/api/v0/chat/stop_stream',
  '/api/v0/chat/resume_stream',
  '/api/v0/chat/message_feedback',
  '/api/v0/chat/create_pow_challenge',
] as const

const GENERATION_REQUEST_ENDPOINTS = [
  '/api/v0/chat/completion',
  '/api/v0/chat/regenerate',
  '/api/v0/chat/continue',
  '/api/v0/chat/edit_message',
  '/api/v0/chat/resume_stream',
] as const

const CHAT_SESSION_ENDPOINTS = [
  '/api/v0/chat_session/create',
  '/api/v0/chat_session/delete',
  '/api/v0/chat_session/delete_all',
  '/api/v0/chat_session/fetch_page',
  '/api/v0/chat_session/update_pinned',
  '/api/v0/chat_session/update_title',
] as const

const FILE_ENDPOINTS = [
  '/api/v0/file/upload_file',
  '/api/v0/file/preview',
  '/api/v0/file/fetch_files',
] as const

export const DEEPSEEK_CHAT_ROUTE_PATTERNS = ['/', '/a/:agentId', '/a/:agentId/s/:sessionId'] as const

export const DEEPSEEK_CHAT_ENDPOINTS = new Set<string>(CHAT_ENDPOINTS)
export const DEEPSEEK_GENERATION_REQUEST_ENDPOINTS = new Set<string>(GENERATION_REQUEST_ENDPOINTS)
export const DEEPSEEK_CHAT_SESSION_ENDPOINTS = new Set<string>(CHAT_SESSION_ENDPOINTS)
export const DEEPSEEK_FILE_ENDPOINTS = new Set<string>(FILE_ENDPOINTS)

export function describeKnownDeepSeekApiSurface(): {
  routes: readonly string[]
  generationEndpoints: string[]
  sessionEndpoints: string[]
  fileEndpoints: string[]
} {
  return {
    routes: DEEPSEEK_CHAT_ROUTE_PATTERNS,
    generationEndpoints: [...DEEPSEEK_CHAT_ENDPOINTS].sort(),
    sessionEndpoints: [...DEEPSEEK_CHAT_SESSION_ENDPOINTS].sort(),
    fileEndpoints: [...DEEPSEEK_FILE_ENDPOINTS].sort(),
  }
}

export function matchDeepSeekSessionRoute(url: string): {
  routeKind: 'home' | 'landing' | 'session' | 'unknown'
  agentId: string | null
  sessionId: string | null
} {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return {
      routeKind: 'unknown',
      agentId: null,
      sessionId: null,
    }
  }

  const normalizedPathname = parsedUrl.pathname.replace(/\/+$/, '') || '/'

  if (normalizedPathname === '/') {
    return {
      routeKind: 'home',
      agentId: null,
      sessionId: null,
    }
  }

  const sessionMatch = normalizedPathname.match(/^\/a\/([^/]+)\/s\/([^/?#]+)$/)
  if (sessionMatch) {
    return {
      routeKind: 'session',
      agentId: sessionMatch[1] ?? null,
      sessionId: sessionMatch[2] ?? null,
    }
  }

  const landingMatch = normalizedPathname.match(/^\/a\/([^/]+)$/)
  if (landingMatch) {
    return {
      routeKind: 'landing',
      agentId: landingMatch[1] ?? null,
      sessionId: null,
    }
  }

  return {
    routeKind: 'unknown',
    agentId: null,
    sessionId: null,
  }
}
