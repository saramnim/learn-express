// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import contextRoute from '../api/auth/context'
import enrollmentRoute from '../api/auth/enrollment'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Learn common-auth proxy', () => {
  it('rejects requests without a bearer token before contacting DB1', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await contextRoute.fetch(new Request('https://learn.example/api/auth/context?app_id=learn'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' },
    })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('forwards the Learn context request server-side with only the bearer token', async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({
      contractVersion: 'EF-TWO-DB-1.0',
      app: { appId: 'learn', status: 'active' },
    }))
    vi.stubGlobal('fetch', upstream)

    const response = await contextRoute.fetch(new Request(
      'https://learn.example/api/auth/context?app_id=learn',
      { headers: { Authorization: 'Bearer test-access-token' } },
    ))

    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledOnce()
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://secret-key-beta.vercel.app/api/auth/context?app_id=learn')
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer test-access-token',
    })
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0')
  })

  it('does not let the public proxy request another app context', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await contextRoute.fetch(new Request(
      'https://learn.example/api/auth/context?app_id=yeoyu',
      { headers: { Authorization: 'Bearer test-access-token' } },
    ))

    expect(response.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('forwards Learn self-enrollment without cookies or caller-controlled body', async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({
      contractVersion: 'EF-TWO-DB-1.0',
      app: { appId: 'learn', status: 'active' },
    }))
    vi.stubGlobal('fetch', upstream)

    const response = await enrollmentRoute.fetch(new Request(
      'https://learn.example/api/auth/enrollment',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-access-token',
          Cookie: 'must-not-forward=true',
        },
        body: JSON.stringify({ appId: 'locksmith' }),
      },
    ))

    expect(response.status).toBe(200)
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://secret-key-beta.vercel.app/api/auth/apps/learn/enrollment')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
    })
  })
})
