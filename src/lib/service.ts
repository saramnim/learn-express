import type { Session } from '@supabase/supabase-js'
import type { ApiErrorPayload, Course, CourseDraft, CourseSummary, Progress } from './types'

const configuredApiBase = import.meta.env.VITE_SERVICE_DATA_URL?.trim()
const apiBase = (configuredApiBase || 'https://service.invalid/v1').replace(/\/$/, '')

export const serviceConfigured = Boolean(configuredApiBase)

type Envelope<T> = {
  contractVersion: 'EF-SERVICE-0.1.0'
  learnContractVersion?: 'EF-LEARN-DAILY-1.0'
  requestId: string
  data: T
}

export class ServiceError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function serviceFetch<T>(session: Session, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      'X-Encoreflare-App-Id': 'learn',
      'X-Encoreflare-Contract-Version': 'EF-SERVICE-0.1.0',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload = (await response.json().catch(() => ({}))) as Envelope<T> & ApiErrorPayload
  if (!response.ok) {
    throw new ServiceError(
      response.status,
      payload.error?.code || 'SERVICE_ERROR',
      payload.error?.message || '학습 데이터를 불러오지 못했어요.',
      payload.error?.details,
    )
  }
  return payload.data
}

export const learnApi = {
  courses: (session: Session) => serviceFetch<CourseSummary[]>(session, '/learn/courses'),
  course: (session: Session, slug: string) => serviceFetch<Course>(session, `/learn/courses/${encodeURIComponent(slug)}`),
  progress: (session: Session) => serviceFetch<Progress[]>(session, '/learn/progress'),
  saveProgress: (
    session: Session,
    lessonId: string,
    currentVersion: number,
    update: Pick<Progress, 'state' | 'percent' | 'lastPosition'>,
  ) => serviceFetch<{ accepted: true; version: number }>(
    session,
    `/learn/progress/${lessonId}`,
    {
      method: 'PUT',
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': String(currentVersion),
      },
      body: JSON.stringify(update),
    },
  ),
  adminCourses: (session: Session) => serviceFetch<CourseSummary[]>(session, '/learn/admin/courses'),
  adminCourse: (session: Session, slug: string) => serviceFetch<Course>(session, `/learn/admin/courses/${encodeURIComponent(slug)}`),
  saveAdminCourse: (session: Session, slug: string, version: number, draft: CourseDraft) =>
    serviceFetch<{ accepted: true; slug: string; version: number }>(
      session,
      `/learn/admin/courses/${encodeURIComponent(slug)}`,
      {
        method: 'PUT',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
          'If-Match': String(version),
        },
        body: JSON.stringify(draft),
      },
    ),
}
