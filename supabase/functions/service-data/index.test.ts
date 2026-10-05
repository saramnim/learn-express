import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (request: Request) => Promise<Response>

let handler: Handler

const baseContext = {
  contractVersion: 'EF-TWO-DB-1.0',
  identity: {
    issuer: 'https://bkypuccodgojhjyzbhjt.supabase.co/auth/v1',
    subject: '11111111-1111-4111-8111-111111111111',
    commonUserId: '11111111-1111-4111-8111-111111111111',
  },
  app: {
    appId: 'learn',
    role: 'app_user',
    status: 'active',
    scope: { type: 'personal', id: '11111111-1111-4111-8111-111111111111' },
  },
  token: {
    audience: 'authenticated',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
}

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    serve: (candidate: Handler) => { handler = candidate },
    env: {
      get: (name: string) => name === 'SUPABASE_URL'
        ? 'https://data.example'
        : name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-test-key' : undefined,
    },
  })
  await import('./index')
})

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('Deno', {
    serve: () => undefined,
    env: {
      get: (name: string) => name === 'SUPABASE_URL'
        ? 'https://data.example'
        : name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-test-key' : undefined,
    },
  })
})

function request(path: string) {
  return new Request(`https://data.example/functions/v1/service-data${path}`, {
    headers: {
      Authorization: 'Bearer test-token',
      'X-Encoreflare-App-Id': 'learn',
      'X-Encoreflare-Contract-Version': 'EF-SERVICE-0.1.0',
    },
  })
}

function mockUpstreams(role: 'app_user' | 'org_admin') {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith('https://secret-key-beta.vercel.app/')) {
      return new Response(JSON.stringify({
        ...baseContext,
        app: { ...baseContext.app, role },
      }), { status: 200 })
    }
    if (url.endsWith('/rpc/service_v1_bind_context')) {
      return new Response(JSON.stringify({ accepted: true }), { status: 200 })
    }
    if (url.endsWith('/rpc/service_v1_learn_admin_catalog')) {
      return new Response(JSON.stringify([{ slug: 'solo-founder-7-day-system' }]), { status: 200 })
    }
    return new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('service-data Learn admin boundary', () => {
  it('denies the admin catalog to a normal Learn user', async () => {
    const fetchMock = mockUpstreams('app_user')
    const response = await handler(request('/v1/learn/admin/courses'))
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('LEARN_ADMIN_REQUIRED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('routes an org_admin through the protected admin RPC', async () => {
    const fetchMock = mockUpstreams('org_admin')
    const response = await handler(request('/v1/learn/admin/courses'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toEqual([{ slug: 'solo-founder-7-day-system' }])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
