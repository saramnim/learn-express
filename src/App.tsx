import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AdminStudio } from './components/AdminStudio'
import { AuthPanel } from './components/AuthPanel'
import { LearningWorkspace } from './components/LearningWorkspace'
import { authClient, authConfigured, AuthAppError, enrollLearn, finishSsoCallback, getLearnContext } from './lib/auth'
import { serviceConfigured } from './lib/service'
import type { AuthContext } from './lib/types'

type View = 'learn' | 'admin'

function AppHeader({
  context,
  view,
  theme,
  onView,
  onTheme,
  onSignOut,
}: {
  context: AuthContext
  view: View
  theme: 'light' | 'dark'
  onView: (view: View) => void
  onTheme: () => void
  onSignOut: () => void
}) {
  return (
    <header className="app-header">
      <button className="wordmark" onClick={() => onView('learn')} aria-label="Encoreflare Learn 홈">
        <span className="brand-mark">E</span>
        <span><b>Learn</b><small>by Encoreflare</small></span>
      </button>
      <nav aria-label="주요 메뉴">
        <button className={view === 'learn' ? 'active' : ''} aria-current={view === 'learn' ? 'page' : undefined} onClick={() => onView('learn')}>학습</button>
        {context.app.role === 'org_admin' && (
          <button className={view === 'admin' ? 'active' : ''} aria-current={view === 'admin' ? 'page' : undefined} onClick={() => onView('admin')}>운영</button>
        )}
      </nav>
      <div className="header-actions">
        <span className="role-label">{context.app.role === 'org_admin' ? '관리자' : '학습자'}</span>
        <button className="icon-button" onClick={onTheme} aria-label={`${theme === 'light' ? '어두운' : '밝은'} 테마로 변경`}>
          {theme === 'light' ? '◐' : '○'}
        </button>
        <button className="text-button" onClick={onSignOut}>로그아웃</button>
      </div>
    </header>
  )
}

export default function App() {
  const runtimeConfigured = authConfigured && serviceConfigured
  const [session, setSession] = useState<Session | null>(null)
  const [context, setContext] = useState<AuthContext | null>(null)
  const [contextError, setContextError] = useState<AuthAppError | Error | null>(null)
  const [loading, setLoading] = useState(runtimeConfigured)
  const [enrolling, setEnrolling] = useState(false)
  const [view, setView] = useState<View>('learn')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('learn-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('learn-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!authClient || !runtimeConfigured) {
      setLoading(false)
      return
    }
    void authClient.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) finishSsoCallback()
      setLoading(false)
    })
    const { data } = authClient.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      if (event === 'SIGNED_IN' && nextSession) finishSsoCallback()
      if (!nextSession) {
        setContext(null)
        setContextError(null)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function loadContext(activeSession: Session) {
    setLoading(true)
    setContextError(null)
    try {
      const nextContext = await getLearnContext(activeSession)
      setContext(nextContext)
    } catch (caught) {
      setContext(null)
      setContextError(caught instanceof Error ? caught : new Error('이용 권한을 확인하지 못했어요.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) void loadContext(session)
  }, [session?.access_token])

  async function enroll() {
    if (!session) return
    setEnrolling(true)
    setContextError(null)
    try {
      const nextContext = await enrollLearn(session)
      setContext(nextContext)
    } catch (caught) {
      setContextError(caught instanceof Error ? caught : new Error('학습 이용 신청을 완료하지 못했어요.'))
    } finally {
      setEnrolling(false)
    }
  }

  if (loading) {
    return <main id="main" className="center-state"><span className="loader" /><p>계정과 학습 공간을 연결하고 있어요.</p></main>
  }

  if (!session) return <AuthPanel configured={runtimeConfigured} />

  if (!context) {
    const canEnroll = contextError instanceof AuthAppError && contextError.status === 403
    return (
      <main id="main" className="access-layout">
        <section className="access-card">
          <span className="brand-mark large">E</span>
          <p className="eyebrow">ENCOREFLARE LEARN</p>
          <h1>{canEnroll ? '학습 공간을 열어볼까요?' : '연결을 확인해 주세요'}</h1>
          <p>{canEnroll ? '공통 계정은 확인됐어요. Learn 이용 권한만 활성화하면 바로 첫 강을 시작할 수 있습니다.' : contextError?.message}</p>
          <div className="button-row center">
            {canEnroll ? (
              <button className="button primary" disabled={enrolling} onClick={() => void enroll()}>{enrolling ? '여는 중…' : '무료로 학습 시작'}</button>
            ) : (
              <button className="button primary" onClick={() => void loadContext(session)}>다시 확인</button>
            )}
            <button className="button" onClick={() => void authClient?.auth.signOut()}>다른 계정으로 로그인</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="app-frame">
      <AppHeader
        context={context}
        view={view}
        theme={theme}
        onView={setView}
        onTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        onSignOut={() => void authClient?.auth.signOut()}
      />
      {view === 'admin' && context.app.role === 'org_admin'
        ? <AdminStudio session={session} />
        : <LearningWorkspace session={session} />}
    </div>
  )
}
