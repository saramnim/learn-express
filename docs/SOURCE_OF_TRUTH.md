# Learn source of truth

`saramnim/learn-express`의 `main` 브랜치가 Encoreflare Learn의 공식 소스입니다.

## 운영 대응표

| 운영 구성 | 공식 소스 | 운영 대상 |
|---|---|---|
| Learn 웹/PWA | `src/`, `public/`, `vercel.json` | `https://learn-express-tau.vercel.app/` |
| Learn DB 계약 | `supabase/migrations/`, `supabase/rollbacks/`, `supabase/tests/` | DB2 `ftvkahkubsmzplczpvxv` |
| Learn API 라우트 | `supabase/functions/service-data/index.ts`의 `/v1/learn/*` | DB2 Edge Function `service-data` |
| 공통 로그인 클라이언트 | `src/lib/auth.ts` | DB1 `bkypuccodgojhjyzbhjt` |
| 고정 계약 | `contracts/` | `EF-TWO-DB-1.0`, `EF-SERVICE-0.1.0`, `EF-LEARN-DAILY-1.0` |

공개 프로젝트 식별자와 URL은 비밀값이 아닙니다. publishable key는 Vercel 환경 변수로만 주입하고, service-role·secret·coordinator 자격 증명은 저장소와 브라우저 코드에 두지 않습니다.

## 공유 Edge Function 경계

`service-data`는 DB2에서 여러 앱이 함께 사용하는 런타임입니다. 이 저장소는 배포된 런타임 소스를 보관하지만 Learn 작업 범위는 `/v1/learn/*`뿐입니다. Learn 변경 시 `/v1/yeoyu/*`와 `/v1/pantry/*` 구현을 수정하지 않고, 기존 `EF-SERVICE-0.1.0` 응답 계약을 유지합니다.

## 배포 규칙

1. PR에서 `npm test`, `npm run typecheck`, `npm run build`, `npm audit --omit=dev`를 통과합니다.
2. `main` 병합으로 Vercel 운영 배포를 생성합니다.
3. DB 변경은 타임스탬프 마이그레이션과 안전한 롤백을 함께 보관합니다.
4. Edge Function은 이 저장소의 `supabase/functions/service-data/index.ts`에서만 배포합니다.
5. 배포 후 public `401`, 학습자, 관리자, 예약 공개, 진도 충돌 경계를 다시 검증합니다.

기계 판독 가능한 운영 대응 정보는 [`contracts/production.json`](../contracts/production.json)에 있습니다.
