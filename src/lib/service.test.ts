import type { Session } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { learnApi, ServiceError } from './service'

const session = { access_token: 'test-access-token' } as Session

afterEach(() => vi.unstubAllGlobals())

describe('learnApi', () => {
  it('sends the DB1 bearer and fixed service contract headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contractVersion: 'EF-SERVICE-0.1.0',
      requestId: 'request-1234',
      data: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await learnApi.courses(session)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/learn/courses')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-access-token')
    expect(new Headers(init.headers).get('X-Encoreflare-App-Id')).toBe('learn')
    expect(new Headers(init.headers).get('X-Encoreflare-Contract-Version')).toBe('EF-SERVICE-0.1.0')
  })

  it('uses optimistic concurrency and an idempotency key for progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contractVersion: 'EF-SERVICE-0.1.0',
      requestId: 'request-1234',
      data: { accepted: true, version: 4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await learnApi.saveProgress(session, '11111111-1111-4111-8111-111111111111', 3, {
      state: 'completed',
      percent: 100,
      lastPosition: { block: 5 },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(init.method).toBe('PUT')
    expect(headers.get('If-Match')).toBe('3')
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('surfaces the stable service error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VERSION_CONFLICT', message: '최신 진도를 확인하세요.' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    await expect(learnApi.progress(session)).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
    } satisfies Partial<ServiceError>)
  })
})
