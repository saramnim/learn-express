import { useState } from 'react'
import { beginSsoLogin, type SsoProvider } from '../lib/auth'

type Props = {
  configured: boolean
}

export function AuthPanel({ configured }: Props) {
  const [busy, setBusy] = useState<SsoProvider | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function signIn(provider: SsoProvider) {
    setBusy(provider)
    setMessage(null)
    try {
      await beginSsoLogin(provider)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '공통 로그인으로 이동하지 못했어요.')
      setBusy(null)
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
        <p className="eyebrow">ENCOREFLARE SSO</p>
        <h2 id="auth-title">공통 계정으로 계속해요</h2>
        <p className="muted">한 번 만든 Encoreflare 계정으로 강의와 다른 서비스를 함께 이용할 수 있습니다.</p>

        {!configured ? (
          <div className="alert danger" role="alert">
            <b>배포 설정이 필요합니다.</b>
            <span>DB1 공개 키가 연결되지 않았어요. 운영 환경 변수를 확인해 주세요.</span>
          </div>
        ) : (
          <div className="sso-options">
            <button className="sso-button" disabled={busy !== null} onClick={() => void signIn('google')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
                <path fill="currentColor" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
                <path fill="currentColor" d="M6.39 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.48l3.35-2.62Z" />
                <path fill="currentColor" d="M12 6.01c1.47 0 2.78.5 3.82 1.49l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
              </svg>
              <span>{busy === 'google' ? 'Google로 이동 중…' : 'Google로 계속'}</span>
            </button>
            <button className="sso-button kakao" disabled={busy !== null} onClick={() => void signIn('kakao')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 3C6.48 3 2 6.58 2 11c0 2.88 1.9 5.4 4.74 6.81l-1.21 3.05a.56.56 0 0 0 .8.68l3.56-2.1c.68.1 1.38.16 2.11.16 5.52 0 10-3.58 10-8.6S17.52 3 12 3Z" />
              </svg>
              <span>{busy === 'kakao' ? '카카오로 이동 중…' : '카카오로 계속'}</span>
            </button>
            {message && <div className="alert danger" role="alert">{message}</div>}
          </div>
        )}
        <p className="fine-print">인증은 Encoreflare 공통 계정에서 처리되며 로그인 정보는 강의 DB에 저장되지 않습니다.</p>
      </section>
    </main>
  )
}
