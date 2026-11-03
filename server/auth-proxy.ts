const AUTH_APP_ORIGIN = 'https://secret-key-beta.vercel.app'
const MAX_AUTHORIZATION_LENGTH = 16_384
const UPSTREAM_TIMEOUT_MS = 8_000

type ProxyOptions = {
  method: 'GET' | 'POST'
  path: string
}

type ErrorPayload = {
  error: {
    code: string
    message: string
  }
}

function responseHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }
}

function jsonError(status: number, code: string, message: string) {
  const payload: ErrorPayload = { error: { code, message } }
  return Response.json(
    payload,
    { status, headers: responseHeaders() },
  )
}

function authorizationHeader(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  if (
    !authorization.startsWith('Bearer ')
    || authorization.length > MAX_AUTHORIZATION_LENGTH
    || authorization.slice('Bearer '.length).trim().length === 0
  ) {
    return null
  }
  return authorization
}

export async function proxyCommonAuth(request: Request, options: ProxyOptions) {
  if (request.method !== options.method) {
    return new Response(null, {
      status: 405,
      headers: { ...responseHeaders(), Allow: options.method },
    })
  }

  const authorization = authorizationHeader(request)
  if (!authorization) {
    return jsonError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.')
  }

  let upstream: Response
  try {
    upstream = await fetch(`${AUTH_APP_ORIGIN}${options.path}`, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.method === 'POST' ? { body: '{}' } : {}),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return jsonError(503, 'AUTHORIZATION_UNAVAILABLE', '앱 이용 권한을 확인할 수 없습니다.')
  }

  const payload = await upstream.json().catch(() => null) as unknown
  if (payload === null || typeof payload !== 'object') {
    return jsonError(502, 'AUTH_RESPONSE_INVALID', '인증 서비스 응답을 확인할 수 없습니다.')
  }

  return Response.json(payload, {
    status: upstream.status,
    headers: responseHeaders(),
  })
}
