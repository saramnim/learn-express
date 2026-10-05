# Encoreflare Learn

하루 한 강씩 공개되는 실행형 학습 PWA입니다. 공통 계정(DB1)으로 로그인하고, 강의·진도·발행 데이터(DB2)는 `service-data` Edge Function을 통해서만 사용합니다.

## 제공 기능

- DB1 공통 Google·카카오 SSO 및 Learn 셀프 등록
- 서울 시간 오전 9시 기준 일일 레슨 공개
- 텍스트·단계 시각화·실행 메모 콘텐츠 블록
- 버전 충돌과 중복 요청을 막는 진도 저장
- `org_admin` 전용 강의 편집·예약 발행 스튜디오
- 라이트/다크 테마, 모바일 레이아웃, 키보드 포커스, reduced-motion
- 설치 가능한 PWA 셸

## 로컬 실행

```bash
cp .env.example .env.local
npm install
npm run dev
```

Auth 프로젝트의 활성 publishable key를 `VITE_AUTH_SUPABASE_PUBLISHABLE_KEY`에 넣습니다. 서비스 역할 키나 다른 비밀키는 브라우저 환경 변수에 넣지 않습니다. OAuth 공급자는 DB1에서만 관리하며 운영 배포 주소의 `/auth/callback`을 Auth Redirect URLs에 정확히 등록합니다.

## 검증

```bash
npm test
npm run typecheck
npm run build
```

DB 계약 검증은 `supabase/tests/`에 있습니다. 모든 DDL은 `supabase/migrations/`에, 되돌리기 절차는 `supabase/rollbacks/`에 보관합니다.

## 배포 구조

| 구분 | 책임 | 런타임 |
|---|---|---|
| DB1 | Auth, 공통 사용자, 앱 권한 | Auth 프로젝트 |
| DB2 | 강의, 레슨, 진도, 발행 API | Service-data 프로젝트 |
| Web | Vite 정적 PWA | Vercel |

고정 계약은 `EF-TWO-DB-1.0`, `EF-SERVICE-0.1.0`, `EF-LEARN-DAILY-1.0`입니다. 브라우저는 DB2 테이블이나 RPC를 직접 호출하지 않습니다.

## 운영 메모

- 공개 예약은 cron이 아니라 API 조회 시점의 `publish_at <= now()` 조건으로 평가합니다.
- 편집 저장은 `If-Match`와 `Idempotency-Key`가 필수입니다.
- 편집본에서 제외한 레슨은 삭제하지 않고 `archived`로 보존합니다.
- 최초 과정은 `solo-founder-7-day-system`이며 7일 동안 하루 한 강씩 공개됩니다.
- 자세한 인수인계는 [`docs/HANDOFF.md`](docs/HANDOFF.md)를 참고하세요.
- 공식 소스와 운영 대상의 대응표는 [`docs/SOURCE_OF_TRUTH.md`](docs/SOURCE_OF_TRUTH.md)에 있습니다.
- 배포 해시와 운영 권한 현황은 비공개 운영 기록에서 관리합니다.
