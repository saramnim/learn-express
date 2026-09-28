import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { learnApi, ServiceError } from '../lib/service'
import { formatRelease, seoulLocalToIso, toDateTimeLocal } from '../lib/format'
import type { Course, CourseDraft, CourseSummary, LessonBlock } from '../lib/types'

type Props = { session: Session }

const starterBlocks: LessonBlock[] = [
  { position: 1, type: 'key_point', body: { eyebrow: '오늘의 핵심', title: '핵심을 한 문장으로', text: '이 레슨에서 꼭 기억할 내용을 적어주세요.' } },
  { position: 2, type: 'explanation', body: { title: '왜 필요한가요?', text: '개념을 쉽게 설명해 주세요.' } },
  { position: 3, type: 'interactive', body: { title: '10분 실행', prompt: '지금 바로 해볼 행동을 적어보세요.', placeholder: '나의 실행 메모' } },
  { position: 4, type: 'callout', body: { tone: 'info', title: '기억하기', text: '완벽보다 작은 확인을 먼저 만드세요.' } },
]

function courseToDraft(course: Course): CourseDraft {
  return {
    title: course.title,
    summary: course.summary,
    level: course.level,
    status: course.status || 'draft',
    publishedAt: course.publishedAt,
    lessons: course.lessons.map((lesson) => ({
      slug: lesson.slug,
      title: lesson.title,
      summary: lesson.summary,
      estimatedMinutes: lesson.estimatedMinutes,
      status: lesson.status || 'draft',
      publishAt: lesson.publishAt,
      blocks: lesson.blocks.map((block) => ({ ...block, body: { ...block.body } })),
    })),
  }
}

export function AdminStudio({ session }: Props) {
  const [catalog, setCatalog] = useState<CourseSummary[]>([])
  const [slug, setSlug] = useState('')
  const [version, setVersion] = useState(0)
  const [draft, setDraft] = useState<CourseDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function loadCatalog() {
    setBusy(true)
    setError(null)
    try {
      const items = await learnApi.adminCourses(session)
      setCatalog(items)
      if (!draft && items[0]) await selectCourse(items[0].slug)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 데이터를 불러오지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function selectCourse(nextSlug: string) {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const course = await learnApi.adminCourse(session, nextSlug)
      setSlug(course.slug)
      setVersion(course.version)
      setDraft(courseToDraft(course))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '강의를 불러오지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void loadCatalog() }, [session.access_token])

  function newCourse() {
    setSlug('')
    setVersion(0)
    setSaved(null)
    setDraft({ title: '', summary: '', level: 'beginner', status: 'draft', lessons: [] })
  }

  function patchLesson(index: number, patch: Partial<CourseDraft['lessons'][number]>) {
    setDraft((current) => current && ({
      ...current,
      lessons: current.lessons.map((lesson, lessonIndex) => lessonIndex === index ? { ...lesson, ...patch } : lesson),
    }))
  }

  function patchBlock(lessonIndex: number, blockIndex: number, key: string, value: string) {
    setDraft((current) => current && ({
      ...current,
      lessons: current.lessons.map((lesson, currentLesson) => currentLesson !== lessonIndex ? lesson : ({
        ...lesson,
        blocks: lesson.blocks.map((block, currentBlock) => currentBlock !== blockIndex ? block : ({
          ...block,
          body: { ...block.body, [key]: value },
        })),
      })),
    }))
  }

  function addLesson() {
    setDraft((current) => {
      if (!current) return current
      const position = current.lessons.length + 1
      const previous = current.lessons.at(-1)?.publishAt
      const release = previous ? new Date(previous) : new Date()
      release.setUTCDate(release.getUTCDate() + (previous ? 1 : 0))
      if (!previous) release.setHours(release.getHours() + 1)
      return {
        ...current,
        lessons: [...current.lessons, {
          slug: `lesson-${position}`,
          title: `새 레슨 ${position}`,
          summary: '',
          estimatedMinutes: 10,
          status: 'draft',
          publishAt: release.toISOString(),
          blocks: starterBlocks.map((block) => ({ ...block, body: { ...block.body } })),
        }],
      }
    })
  }

  async function save() {
    if (!draft || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) {
      setError('영문 소문자, 숫자, 하이픈으로 2자 이상의 강의 주소를 입력해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const result = await learnApi.saveAdminCourse(session, slug, version, draft)
      setVersion(result.version)
      setSaved('변경 사항을 저장했습니다.')
      const items = await learnApi.adminCourses(session)
      setCatalog(items)
    } catch (caught) {
      if (caught instanceof ServiceError && caught.code === 'VERSION_CONFLICT') {
        setError('다른 곳에서 먼저 수정됐어요. 최신 내용을 다시 불러온 뒤 변경해 주세요.')
      } else {
        setError(caught instanceof Error ? caught.message : '강의를 저장하지 못했어요.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="admin-shell">
      <aside className="admin-list" aria-label="강의 운영 목록">
        <div className="admin-list-heading">
          <div><p className="eyebrow">운영</p><h1>강의 스튜디오</h1></div>
          <button className="button compact" onClick={newCourse}>새 강의</button>
        </div>
        {catalog.map((course) => (
          <button key={course.slug} className={slug === course.slug ? 'active' : ''} onClick={() => void selectCourse(course.slug)}>
            <span><b>{course.title}</b><small>{course.lessonCount}개 레슨 · v{course.version}</small></span>
            <span className={`status-dot ${course.status}`} aria-label={course.status} />
          </button>
        ))}
      </aside>

      <section className="admin-editor">
        {!draft ? (
          <div className="center-state"><p>{busy ? '강의를 불러오는 중…' : '편집할 강의를 선택해 주세요.'}</p></div>
        ) : (
          <>
            <header className="editor-heading">
              <div><p className="eyebrow">COURSE EDITOR · VERSION {version}</p><h2>{draft.title || '새 강의'}</h2></div>
              <div className="button-row">
                {version > 0 && <button className="button" onClick={() => void selectCourse(slug)}>되돌리기</button>}
                <button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '변경 저장'}</button>
              </div>
            </header>
            {error && <div className="alert danger" role="alert">{error}</div>}
            {saved && <div className="alert success" role="status">{saved}</div>}

            <div className="editor-section form-grid">
              <label>강의 주소<input value={slug} disabled={version > 0} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="my-course" /></label>
              <label>난이도<select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value as CourseDraft['level'] })}><option value="beginner">입문</option><option value="intermediate">중급</option><option value="advanced">심화</option></select></label>
              <label className="span-2">제목<input value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label className="span-2">설명<textarea rows={3} value={draft.summary} maxLength={1000} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
              <label>상태<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CourseDraft['status'] })}><option value="draft">초안</option><option value="published">공개</option><option value="archived">보관</option></select></label>
            </div>

            <div className="section-title"><div><p className="eyebrow">DAILY RELEASE</p><h3>레슨과 공개 시간</h3></div><button className="button compact" onClick={addLesson}>레슨 추가</button></div>
            <div className="lesson-editor-list">
              {draft.lessons.map((lesson, index) => (
                <details className="lesson-editor" key={`${lesson.slug}-${index}`} open={index === 0}>
                  <summary>
                    <span className="day-dot">{index + 1}</span>
                    <span><b>{lesson.title}</b><small>{formatRelease(lesson.publishAt) || '공개 시간 없음'}</small></span>
                    <span className={`badge ${lesson.status === 'published' ? 'success' : ''}`}>{lesson.status === 'published' ? '공개 예약' : lesson.status === 'draft' ? '초안' : '보관'}</span>
                  </summary>
                  <div className="lesson-editor-body form-grid">
                    <label>레슨 주소<input value={lesson.slug} onChange={(event) => patchLesson(index, { slug: event.target.value.toLowerCase() })} /></label>
                    <label>예상 시간(분)<input type="number" min={1} max={600} value={lesson.estimatedMinutes} onChange={(event) => patchLesson(index, { estimatedMinutes: Number(event.target.value) })} /></label>
                    <label className="span-2">제목<input value={lesson.title} maxLength={160} onChange={(event) => patchLesson(index, { title: event.target.value })} /></label>
                    <label className="span-2">설명<textarea rows={2} value={lesson.summary} maxLength={1000} onChange={(event) => patchLesson(index, { summary: event.target.value })} /></label>
                    <label>상태<select value={lesson.status} onChange={(event) => patchLesson(index, { status: event.target.value as CourseDraft['lessons'][number]['status'] })}><option value="draft">초안</option><option value="published">공개 예약</option><option value="archived">보관</option></select></label>
                    <label>공개 시간 (서울)<input type="datetime-local" value={toDateTimeLocal(lesson.publishAt)} onChange={(event) => patchLesson(index, { publishAt: seoulLocalToIso(event.target.value) })} /></label>
                    <div className="span-2 block-editor">
                      <h4>콘텐츠 블록</h4>
                      {lesson.blocks.map((block, blockIndex) => (
                        <div className="block-row" key={`${block.type}-${blockIndex}`}>
                          <span className="badge">{block.type}</span>
                          <label>제목<input value={String(block.body.title || '')} onChange={(event) => patchBlock(index, blockIndex, 'title', event.target.value)} /></label>
                          {block.type === 'interactive' ? (
                            <label>안내<textarea rows={2} value={String(block.body.prompt || '')} onChange={(event) => patchBlock(index, blockIndex, 'prompt', event.target.value)} /></label>
                          ) : (
                            <label>내용<textarea rows={2} value={String(block.body.text || '')} onChange={(event) => patchBlock(index, blockIndex, 'text', event.target.value)} /></label>
                          )}
                        </div>
                      ))}
                    </div>
                    <button className="text-button danger-text span-2" onClick={() => setDraft({ ...draft, lessons: draft.lessons.filter((_, lessonIndex) => lessonIndex !== index) })}>이 레슨을 편집본에서 제외</button>
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
