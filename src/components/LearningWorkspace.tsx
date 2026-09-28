import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { learnApi, ServiceError } from '../lib/service'
import type { Course, CourseSummary, Lesson, LessonBlock, Progress } from '../lib/types'
import { formatRelease } from '../lib/format'

type Props = { session: Session }

function blockText(body: Record<string, unknown>, key: string) {
  return typeof body[key] === 'string' ? String(body[key]) : ''
}

function LessonContent({
  lesson,
  progress,
  saving,
  onSave,
}: {
  lesson: Lesson
  progress?: Progress
  saving: boolean
  onSave: (lesson: Lesson, note: string, complete: boolean) => Promise<void>
}) {
  const savedNote = typeof progress?.lastPosition?.note === 'string' ? progress.lastPosition.note : ''
  const [note, setNote] = useState(savedNote)

  useEffect(() => setNote(savedNote), [lesson.id, savedNote])

  return (
    <article className="lesson" aria-labelledby="lesson-title">
      <header className="lesson-heading">
        <div>
          <p className="eyebrow">DAY {lesson.position} · {lesson.estimatedMinutes}분</p>
          <h2 id="lesson-title">{lesson.title}</h2>
          <p>{lesson.summary}</p>
        </div>
        {progress?.state === 'completed' && <span className="badge success">완료</span>}
      </header>

      <div className="lesson-blocks">
        {lesson.blocks.map((block) => (
          <Block key={block.id || `${lesson.id}-${block.position}`} block={block} note={note} onNote={setNote} />
        ))}
      </div>

      <footer className="lesson-actions">
        <div>
          <b>{progress?.state === 'completed' ? '오늘의 실행을 마쳤어요.' : '읽기보다 실행이 오래 남습니다.'}</b>
          <span className="muted">메모와 완료 상태는 계정에 안전하게 저장됩니다.</span>
        </div>
        <button
          className="button primary"
          disabled={saving}
          onClick={() => onSave(lesson, note, progress?.state !== 'completed')}
        >
          {saving ? '저장 중…' : progress?.state === 'completed' ? '메모 저장' : '오늘 학습 완료'}
        </button>
      </footer>
    </article>
  )
}

function Block({ block, note, onNote }: { block: LessonBlock; note: string; onNote: (value: string) => void }) {
  const title = blockText(block.body, 'title')
  const text = blockText(block.body, 'text')
  if (block.type === 'visual') {
    const items = Array.isArray(block.body.items) ? block.body.items.map(String) : []
    return (
      <section className="content-block visual-block">
        <h3>{title}</h3>
        <ol className="steps">
          {items.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>)}
        </ol>
      </section>
    )
  }
  if (block.type === 'interactive') {
    return (
      <section className="content-block exercise-block">
        <p className="eyebrow">직접 해보기</p>
        <h3>{title}</h3>
        <p>{blockText(block.body, 'prompt')}</p>
        <label>
          나의 실행 메모
          <textarea
            value={note}
            onChange={(event) => onNote(event.target.value.slice(0, 2000))}
            placeholder={blockText(block.body, 'placeholder')}
            rows={4}
          />
        </label>
      </section>
    )
  }
  if (block.type === 'callout') {
    return <aside className="content-block callout"><b>{title}</b><p>{text}</p></aside>
  }
  return (
    <section className={`content-block ${block.type === 'key_point' ? 'key-block' : ''}`}>
      {blockText(block.body, 'eyebrow') && <p className="eyebrow">{blockText(block.body, 'eyebrow')}</p>}
      <h3>{title}</h3>
      <p>{text}</p>
    </section>
  )
}

export function LearningWorkspace({ session }: Props) {
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<Course | null>(null)
  const [progress, setProgress] = useState<Progress[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [catalog, saved] = await Promise.all([learnApi.courses(session), learnApi.progress(session)])
      setCourses(catalog)
      setProgress(saved)
      if (catalog[0]) {
        const detail = await learnApi.course(session, catalog[0].slug)
        setCourse(detail)
        const next = detail.lessons.find((lesson) => saved.find((item) => item.lessonId === lesson.id)?.state !== 'completed')
          || detail.lessons.at(-1)
        setActiveId(next?.id || null)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '학습 데이터를 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [session.access_token])

  const progressByLesson = useMemo(
    () => new Map(progress.map((item) => [item.lessonId, item])),
    [progress],
  )
  const activeLesson = course?.lessons.find((lesson) => lesson.id === activeId) || course?.lessons[0]
  const completed = course?.lessons.filter((lesson) => progressByLesson.get(lesson.id)?.state === 'completed').length || 0
  const percent = course?.lessons.length ? Math.round((completed / course.lessons.length) * 100) : 0

  async function save(lesson: Lesson, note: string, complete: boolean) {
    setSavingId(lesson.id)
    setError(null)
    const current = progressByLesson.get(lesson.id)
    try {
      const result = await learnApi.saveProgress(session, lesson.id, current?.version || 0, {
        state: complete ? 'completed' : current?.state || 'in_progress',
        percent: complete ? 100 : current?.percent || 50,
        lastPosition: { block: lesson.blocks.length, note },
      })
      const updated: Progress = {
        lessonId: lesson.id,
        state: complete ? 'completed' : current?.state || 'in_progress',
        percent: complete ? 100 : current?.percent || 50,
        lastPosition: { block: lesson.blocks.length, note },
        version: result.version,
      }
      setProgress((items) => [...items.filter((item) => item.lessonId !== lesson.id), updated])
      if (complete) {
        const next = course?.lessons.find((item) => item.position > lesson.position)
        if (next) setActiveId(next.id)
      }
    } catch (caught) {
      if (caught instanceof ServiceError && caught.code === 'VERSION_CONFLICT') {
        await load()
        setError('다른 기기의 최신 진도를 불러왔어요. 다시 저장해 주세요.')
      } else {
        setError(caught instanceof Error ? caught.message : '진도를 저장하지 못했어요.')
      }
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return <main id="main" className="center-state"><span className="loader" /><p>오늘의 강의를 준비하고 있어요.</p></main>
  if (error && !course) return <main id="main" className="center-state"><div className="alert danger">{error}</div><button className="button" onClick={() => void load()}>다시 시도</button></main>
  if (!course) return <main id="main" className="center-state"><p>아직 공개된 강의가 없어요.</p></main>

  const summary = courses.find((item) => item.slug === course.slug)

  return (
    <main id="main" className="learning-shell">
      <aside className="course-rail" aria-label="강의 목차">
        <div className="course-meta">
          <p className="eyebrow">나의 과정</p>
          <h1>{course.title}</h1>
          <p>{course.summary}</p>
        </div>
        <div className="progress-summary">
          <div><span>현재 진도</span><b>{percent}%</b></div>
          <div className="progress-track" aria-label={`현재 진도 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>
        </div>
        <nav className="lesson-list" aria-label="공개된 레슨">
          {course.lessons.map((lesson) => {
            const item = progressByLesson.get(lesson.id)
            return (
              <button
                key={lesson.id}
                className={activeLesson?.id === lesson.id ? 'active' : ''}
                aria-current={activeLesson?.id === lesson.id ? 'page' : undefined}
                onClick={() => setActiveId(lesson.id)}
              >
                <span className={`day-dot ${item?.state === 'completed' ? 'done' : ''}`}>{item?.state === 'completed' ? '✓' : lesson.position}</span>
                <span><b>{lesson.title}</b><small>{lesson.estimatedMinutes}분</small></span>
              </button>
            )
          })}
        </nav>
        {summary?.nextLessonAt && (
          <div className="next-release">
            <span className="lock-mark" aria-hidden="true">＋</span>
            <div><b>다음 강의</b><span>{formatRelease(summary.nextLessonAt)} 공개</span></div>
          </div>
        )}
      </aside>
      <section className="lesson-pane">
        {error && <div className="alert danger" role="alert">{error}</div>}
        {activeLesson && (
          <LessonContent
            lesson={activeLesson}
            progress={progressByLesson.get(activeLesson.id)}
            saving={savingId === activeLesson.id}
            onSave={save}
          />
        )}
      </section>
    </main>
  )
}
