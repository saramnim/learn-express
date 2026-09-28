export type AuthContext = {
  contractVersion: 'EF-TWO-DB-1.0'
  identity: {
    issuer: string
    subject: string
    commonUserId: string
  }
  app: {
    appId: 'learn'
    role: 'app_user' | 'org_admin'
    status: 'active'
    scope: { type: 'personal' | 'organization'; id: string }
  }
  token: { audience: 'authenticated'; expiresAt: string }
}

export type BlockType = 'key_point' | 'visual' | 'explanation' | 'interactive' | 'quiz' | 'callout'

export type LessonBlock = {
  id?: string
  position: number
  type: BlockType
  body: Record<string, unknown>
}

export type Lesson = {
  id: string
  slug: string
  position: number
  title: string
  summary: string
  estimatedMinutes: number
  version: number
  status?: 'draft' | 'published' | 'archived'
  publishAt?: string | null
  blocks: LessonBlock[]
}

export type CourseSummary = {
  id: string
  slug: string
  title: string
  summary: string
  level: 'beginner' | 'intermediate' | 'advanced'
  status?: 'draft' | 'published' | 'archived'
  version: number
  publishedAt?: string | null
  lessonCount: number
  nextLessonAt?: string | null
}

export type Course = Omit<CourseSummary, 'lessonCount'> & {
  lessons: Lesson[]
}

export type Progress = {
  lessonId: string
  state: 'not_started' | 'in_progress' | 'completed'
  percent: number
  lastPosition: Record<string, unknown>
  version: number
  updatedAt?: string
  deletedAt?: string | null
}

export type CourseDraft = {
  title: string
  summary: string
  level: 'beginner' | 'intermediate' | 'advanced'
  status: 'draft' | 'published' | 'archived'
  publishedAt?: string | null
  lessons: Array<{
    slug: string
    title: string
    summary: string
    estimatedMinutes: number
    status: 'draft' | 'published' | 'archived'
    publishAt?: string | null
    blocks: LessonBlock[]
  }>
}

export type ApiErrorPayload = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> }
}
