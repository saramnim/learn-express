import { useState, type FormEvent } from 'react'
import { authClient } from '../lib/auth'

type Props = {
  configured: boolean
}

export function AuthPanel({ configured }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!authClient) return
    setBusy(true)
    setMessage(null)
    const result = mode === 'signin'
      ? await authClient.auth.signInWithPassword({ email, password })
      : await authClient.auth.signUp({ email, password })
    setBusy(false)
    if (result.error) {
      setMessage(result.error.message)
      return
    }
    if (mode === 'signup' && !result.data.session) {
      setMessage('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.')
    }
  }

  return (
    <main id="main" className="auth-layout">
      <section className="auth-story" aria-labelledby="welcome-title">
        <p className="eyebrow">ENCOREFLARE LEARN</p>
        <h1 id="welcome-title">매일 하나.<br />실행은 더 선명하게.</h1>
        <p className="hero-copy">
          긴 강의 목록 대신 오늘 필요한 한 강을 엽니다. 읽고, 직접 적고,
          완료한 흐름은 어느 기기에서든 이어집니다.
        </p>
        <div className="rhythm" aria-label="학습 방식">
          <span><b>10분</b> 핵심 이해</span>
          <span><b>1개</b> 바로 실행</span>
          <span><b>매일</b> 다음 강 공개</span>
        </div>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <div className="segmented" aria-label="계정 메뉴">
          <button
            type="button"
            className={mode === 'signin' ? 'active' : ''}
            aria-pressed={mode === 'signin'}
            onClick={() => { setMode('signin'); setMessage(null) }}
          >로그인</button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            aria-pressed={mode === 'signup'}
            onClick={() => { setMode('signup'); setMessage(null) }}
          >계정 만들기</button>
        </div>
        <h2 id="auth-title">{mode === 'signin' ? '다시 이어서 학습해요' : '첫 강을 시작해요'}</h2>
        <p className="muted">Encoreflare 공통 계정으로 안전하게 연결됩니다.</p>

        {!configured ? (
          <div className="alert danger" role="alert">
            <b>배포 설정이 필요합니다.</b>
            <span>DB1 공개 키가 연결되지 않았어요. 운영 환경 변수를 확인해 주세요.</span>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <label>
              이메일
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {message && <div className="alert" role="status">{message}</div>}
            <button className="button primary full" disabled={busy}>
              {busy ? '확인 중…' : mode === 'signin' ? '학습 이어가기' : '계정 만들기'}
            </button>
          </form>
        )}
        <p className="fine-print">로그인 정보는 강의 데이터 DB에 저장되지 않습니다.</p>
      </section>
    </main>
  )
}
