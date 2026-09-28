import { createClient, type Session } from '@supabase/supabase-js'
import type { AuthContext, ApiErrorPayload } from './types'

export type SsoProvider = 'google' | 'kakao'

const authUrl = import.meta.env.VITE_AUTH_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_AUTH_SUPABASE_PUBLISHABLE_KEY?.trim()
const authAppUrl = (import.meta.env.VITE_AUTH_APP_URL || 'https://auth-app.invalid').replace(/\/$/, '')

export const authConfigured = Boolean(
  authUrl
  && authAppUrl !== 'https://auth-app.invalid'
  && publishableKey
  && !publishableKey.includes('replace-with'),
)

export const authClient = authConfigured
  ? createClient(authUrl, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

export async function beginSsoLogin(provider: SsoProvider) {
  if (!authClient) throw new Error('공통 로그인이 아직 연결되지 않았어요.')

  const redirectTo = new URL('/auth/callback', window.location.origin).toString()
  const { error } = await authClient.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  })

  if (error) throw error
}

export function finishSsoCallback() {
  if (window.location.pathname !== '/auth/callback') return
  window.history.replaceState({}, document.title, '/')
}

export class AuthAppError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function authAppFetch(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${authAppUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload = (await response.json().catch(() => ({}))) as AuthContext & ApiErrorPayload
  if (!response.ok) {
    throw new AuthAppError(
      response.status,
      payload.error?.code || 'AUTH_APP_ERROR',
      payload.error?.message || '앱 이용 권한을 확인하지 못했어요.',
    )
  }
  return payload
}

export function getLearnContext(session: Session) {
  return authAppFetch('/api/auth/context?app_id=learn', session.access_token) as Promise<AuthContext>
}

export async function enrollLearn(session: Session) {
  await authAppFetch('/api/auth/apps/learn/enrollment', session.access_token, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return getLearnContext(session)
}
