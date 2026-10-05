// Production baseline: service-data v7 / 047c9df60a983d4d13308be331e4a9f982e94261a1f2e42667c327de19cb4e23
// Mirrored on 2026-10-05. Learn changes must preserve YEOYU and Pantry routes.
const SERVICE_CONTRACT_VERSION = 'EF-SERVICE-0.1.0'
const AUTH_CONTRACT_VERSION = 'EF-TWO-DB-1.0'
const AUTH_ISSUER = 'https://bkypuccodgojhjyzbhjt.supabase.co/auth/v1'
const AUTH_CONTEXT_URL = 'https://secret-key-beta.vercel.app/api/auth/context'
const FUNCTION_NAME = 'service-data'
const MAX_BODY_BYTES = 1_100_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/
const COURSE_SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/
const YEOYU_ENTITIES = new Set([
  'preferences',
  'accounts',
  'categories',
  'category_budgets',
  'card_statements',
  'recurring_rules',
  'financial_products',
  'transactions',
  'installments',
  'savings_goals',
])
const PANTRY_MARKETPLACES = new Set(['coupang', 'toss', 'naver', 'kurly', 'ssg', 'other'])

declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

type JsonObject = Record<string, unknown>
type AppId = 'learn' | 'yeoyu' | 'pantry'
type AuthContext = {
  contractVersion: string
  identity: {
    issuer: string
    subject: string
    commonUserId: string
  }
  app: {
    appId: AppId
    role: 'app_user' | 'org_admin'
    status: 'active'
    scope: { type: 'personal' | 'organization'; id: string }
  }
  token: { audience: string; expiresAt: string }
}

class ApiError extends Error {
  status: number
  code: string
  details?: JsonObject

  constructor(status: number, code: string, message: string, details?: JsonObject) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

Deno.serve(async (request) => {
  const requestId = resolveRequestId(request)
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders(requestId) })
    }
    const response = await route(request, requestId)
    if (response instanceof Response) return response
    return jsonResponse(response.status, response.body, requestId, response.extraHeaders)
  } catch (error) {
    const apiError = normalizeError(error)
    return jsonResponse(
      apiError.status,
      {
        contractVersion: SERVICE_CONTRACT_VERSION,
        requestId,
        error: {
          code: apiError.code,
          message: apiError.message,
          ...(apiError.details ? { details: apiError.details } : {}),
        },
      },
      requestId,
    )
  }
})

async function route(request: Request, requestId: string) {
  const url = new URL(request.url)
  const path = functionPath(url.pathname)

  if (request.method === 'GET' && path === '/v1/health') {
    const data = await callRpc('service_v1_health', {})
    return ok(data, requestId)
  }

  const redirectMatch = path.match(/^\/v1\/pantry\/r\/([0-9a-f-]{36})$/i)
  if (request.method === 'GET' && redirectMatch && UUID.test(redirectMatch[1])) {
    const result = asObject(await callRpc('service_v1_pantry_outbound_consume', {
      p_token: redirectMatch[1],
    }))
    const targetUrl = String(result.targetUrl ?? '')
    if (!isHttpsUrl(targetUrl, 4096)) {
      throw new ApiError(502, 'OUTBOUND_TARGET_INVALID', '구매 이동 주소를 확인할 수 없습니다.')
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: targetUrl,
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  const appId = appFromPath(path)
  assertContractHeaders(request, appId)
  const context = await authorize(request, appId)
  await bindContext(context)

  if (appId === 'learn') return routeLearn(request, url, path, context, requestId)
  if (appId === 'yeoyu') return routeYeoyu(request, url, path, context, requestId)
  return routePantry(request, url, path, context, requestId)
}

async function routeLearn(
  request: Request,
  url: URL,
  path: string,
  context: AuthContext,
  requestId: string,
) {
  if (request.method === 'GET' && path === '/v1/learn/courses') {
    const cursor = decodeCursor(url.searchParams.get('cursor'), 'learn-catalog')
    const limit = parseLimit(url.searchParams.get('limit'), 50, 100)
    const result = asObject(await callRpc('service_v1_learn_catalog', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_after_slug: typeof cursor?.after === 'string' ? cursor.after : null,
      p_limit: limit,
    }))
    const nextAfter = typeof result.nextAfter === 'string' ? result.nextAfter : null
    return ok(result.items ?? [], requestId, {
      page: {
        nextCursor: nextAfter
          ? encodeCursor({ v: 1, kind: 'learn-catalog', after: nextAfter })
          : null,
      },
    })
  }

  if (request.method === 'GET' && path === '/v1/learn/admin/courses') {
    requireLearnAdmin(context)
    const data = await callRpc('service_v1_learn_admin_catalog', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
    })
    return ok(data, requestId)
  }

  const adminCourseMatch = path.match(/^\/v1\/learn\/admin\/courses\/([^/]+)$/)
  if (adminCourseMatch) {
    requireLearnAdmin(context)
    const slug = decodePathPart(adminCourseMatch[1])
    if (!COURSE_SLUG.test(slug)) {
      throw new ApiError(400, 'COURSE_SLUG_INVALID', '강의 주소를 확인하세요.')
    }

    if (request.method === 'GET') {
      const data = await callRpc('service_v1_learn_admin_course', {
        p_common_user_id: context.identity.commonUserId,
        p_scope_id: context.app.scope.id,
        p_slug: slug,
      })
      if (data === null) throw new ApiError(404, 'COURSE_NOT_FOUND', '강의를 찾을 수 없습니다.')
      return ok(data, requestId)
    }

    if (request.method === 'PUT') {
      const idempotencyKey = requireIdempotencyKey(request)
      const baseVersion = requireBaseVersion(request)
      const body = await readJsonBody(request)
      const requestHash = await sha256Hex('learn.admin.course.save\n' + baseVersion + '\n' + body.raw)
      const result = asObject(await callRpc('service_v1_learn_admin_save_course', {
        p_common_user_id: context.identity.commonUserId,
        p_scope_id: context.app.scope.id,
        p_slug: slug,
        p_course: body.value,
        p_base_version: baseVersion,
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
      }))
      if (result.accepted !== true) {
        throw new ApiError(409, 'VERSION_CONFLICT', '다른 관리자에 의해 강의가 변경됐어요.', {
          version: result.version,
          current: isObject(result.current) ? result.current : {},
        })
      }
      return ok(result, requestId)
    }
  }

  const courseMatch = path.match(/^\/v1\/learn\/courses\/([^/]+)$/)
  if (request.method === 'GET' && courseMatch) {
    const slug = decodePathPart(courseMatch[1])
    if (!COURSE_SLUG.test(slug)) throw new ApiError(400, 'COURSE_SLUG_INVALID', '강의 주소를 확인하세요.')
    const data = await callRpc('service_v1_learn_course', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_slug: slug,
    })
    if (data === null) throw new ApiError(404, 'COURSE_NOT_FOUND', '강의를 찾을 수 없습니다.')
    return ok(data, requestId)
  }

  if (request.method === 'GET' && path === '/v1/learn/progress') {
    const cursor = decodeCursor(url.searchParams.get('cursor'), 'learn-progress')
    const after = typeof cursor?.after === 'string' && UUID.test(cursor.after) ? cursor.after : null
    if (cursor && !after) throw new ApiError(400, 'CURSOR_INVALID', '페이지 커서를 확인하세요.')
    const limit = parseLimit(url.searchParams.get('limit'), 100, 100)
    const result = asObject(await callRpc('service_v1_learn_progress_list', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_after_lesson_id: after,
      p_limit: limit,
    }))
    const nextAfter = typeof result.nextAfter === 'string' ? result.nextAfter : null
    return ok(result.items ?? [], requestId, {
      page: {
        nextCursor: nextAfter
          ? encodeCursor({ v: 1, kind: 'learn-progress', after: nextAfter })
          : null,
      },
    })
  }

  const progressMatch = path.match(/^\/v1\/learn\/progress\/([^/]+)$/)
  if (request.method === 'PUT' && progressMatch) {
    const lessonId = decodePathPart(progressMatch[1])
    if (!UUID.test(lessonId)) throw new ApiError(400, 'LESSON_ID_INVALID', '레슨 ID를 확인하세요.')
    const idempotencyKey = requireIdempotencyKey(request)
    const baseVersion = requireBaseVersion(request)
    const body = await readJsonBody(request)
    const state = body.value.state
    const percent = body.value.percent
    const lastPosition = body.value.lastPosition ?? {}
    if (!['not_started', 'in_progress', 'completed'].includes(String(state))) {
      throw new ApiError(400, 'STATE_INVALID', '학습 상태를 확인하세요.')
    }
    if (!Number.isInteger(percent) || Number(percent) < 0 || Number(percent) > 100) {
      throw new ApiError(400, 'PERCENT_INVALID', '진도율을 확인하세요.')
    }
    if (!isObject(lastPosition)) {
      throw new ApiError(400, 'POSITION_INVALID', '마지막 학습 위치를 확인하세요.')
    }
    const requestHash = await sha256Hex(`learn.progress.apply\n${baseVersion}\n${body.raw}`)
    const result = asObject(await callRpc('service_v1_learn_progress_apply', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_lesson_id: lessonId,
      p_state: state,
      p_percent: percent,
      p_last_position: lastPosition,
      p_base_version: baseVersion,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    }))
    if (result.accepted !== true) {
      throw new ApiError(409, 'VERSION_CONFLICT', '다른 기기에서 진도가 변경됐어요.', {
        version: result.version,
        current: isObject(result.current) ? result.current : {},
      })
    }
    return ok(result, requestId)
  }

  throw methodOrRouteError(request.method, path)
}

async function routeYeoyu(
  request: Request,
  url: URL,
  path: string,
  context: AuthContext,
  requestId: string,
) {
  if (request.method === 'GET' && path === '/v1/yeoyu/changes') {
    const cursor = decodeCursor(url.searchParams.get('cursor'), 'yeoyu-changes')
    const after = parseCursorInteger(cursor?.after, 0)
    const watermark = cursor?.watermark == null ? null : parseCursorInteger(cursor.watermark, null)
    const limit = parseLimit(url.searchParams.get('limit'), 100, 200)
    const result = asObject(await callRpc('service_v1_yeoyu_pull', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_after_seq: after,
      p_watermark: watermark,
      p_limit: limit,
    }))
    const resultWatermark = parseCursorInteger(result.watermark, after)
    const nextAfter = result.nextAfter == null ? null : parseCursorInteger(result.nextAfter, null)
    const nextCursor = nextAfter == null
      ? null
      : encodeCursor({ v: 1, kind: 'yeoyu-changes', after: nextAfter, watermark: resultWatermark })
    const syncCursor = encodeCursor({
      v: 1,
      kind: 'yeoyu-changes',
      after: resultWatermark,
      watermark: null,
    })
    return ok(
      { items: Array.isArray(result.items) ? result.items : [], syncCursor },
      requestId,
      { page: { nextCursor } },
    )
  }

  const recordMatch = path.match(/^\/v1\/yeoyu\/records\/([^/]+)\/([^/]+)$/)
  if (request.method === 'PUT' && recordMatch) {
    const entity = decodePathPart(recordMatch[1])
    const recordId = decodePathPart(recordMatch[2])
    if (!YEOYU_ENTITIES.has(entity)) throw new ApiError(400, 'ENTITY_INVALID', '동기화 항목 종류를 확인하세요.')
    if (recordId.length < 1 || recordId.length > 200) {
      throw new ApiError(400, 'RECORD_ID_INVALID', '레코드 ID를 확인하세요.')
    }
    const idempotencyKey = requireIdempotencyKey(request)
    const baseVersion = requireBaseVersion(request)
    const body = await readJsonBody(request)
    const payload = Object.hasOwn(body.value, 'payload') ? body.value.payload : undefined
    if (payload !== null && !isObject(payload)) {
      throw new ApiError(400, 'PAYLOAD_INVALID', '동기화 데이터 형식을 확인하세요.')
    }
    const requestHash = await sha256Hex(`yeoyu.records.apply\n${baseVersion}\n${body.raw}`)
    const result = asObject(await callRpc('service_v1_yeoyu_apply_change', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_entity: entity,
      p_record_id: recordId,
      p_payload: payload,
      p_base_version: baseVersion,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    }))
    if (result.accepted !== true) {
      throw new ApiError(409, 'VERSION_CONFLICT', '다른 기기에서 기록이 변경됐어요.', {
        version: result.version,
        payload: result.payload ?? null,
        deletedAt: result.deletedAt ?? null,
      })
    }
    return ok(result, requestId)
  }

  throw methodOrRouteError(request.method, path)
}

async function routePantry(
  request: Request,
  url: URL,
  path: string,
  context: AuthContext,
  requestId: string,
) {
  if (request.method === 'GET' && path === '/v1/pantry/state') {
    const data = await callRpc('service_v1_pantry_state_get', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
    })
    return ok(data, requestId)
  }

  if (request.method === 'PUT' && path === '/v1/pantry/state') {
    const idempotencyKey = requireIdempotencyKey(request)
    const baseVersion = requireBaseVersion(request)
    const body = await readJsonBody(request)
    const state = body.value.state
    if (!isObject(state)) {
      throw new ApiError(400, 'PANTRY_STATE_INVALID', '냉장고 데이터 형식을 확인하세요.')
    }
    const requestHash = await sha256Hex(`pantry.state.put\n${baseVersion}\n${body.raw}`)
    const result = asObject(await callRpc('service_v1_pantry_state_put', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
      p_state: state,
      p_base_version: baseVersion,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    }))
    if (result.accepted !== true) {
      throw new ApiError(409, 'VERSION_CONFLICT', '다른 기기에서 냉장고가 변경됐어요.', {
        version: result.version,
        current: isObject(result.current) ? result.current : {},
        updatedAt: result.updatedAt ?? null,
      })
    }
    return ok(result, requestId)
  }

  if (request.method === 'GET' && path === '/v1/pantry/catalog') {
    const limit = parseLimit(url.searchParams.get('limit'), 100, 200)
    const data = await callRpc('service_v1_pantry_catalog', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
      p_limit: limit,
    })
    return ok(data, requestId)
  }

  if (request.method === 'POST' && path === '/v1/pantry/submissions') {
    const body = await readJsonBody(request)
    const ingredientId = String(body.value.ingredientId ?? '')
    const marketplace = String(body.value.marketplace ?? '')
    const sourceUrl = String(body.value.sourceUrl ?? '').trim()
    if (!UUID.test(ingredientId)) throw new ApiError(400, 'INGREDIENT_ID_INVALID', '재료를 다시 선택해 주세요.')
    if (!PANTRY_MARKETPLACES.has(marketplace)) throw new ApiError(400, 'MARKETPLACE_INVALID', '판매처를 확인해 주세요.')
    if (!isHttpsUrl(sourceUrl, 4096)) throw new ApiError(400, 'SOURCE_URL_INVALID', 'https 상품 주소를 확인해 주세요.')
    const data = await callRpc('service_v1_pantry_submit_product', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
      p_ingredient_id: ingredientId,
      p_marketplace: marketplace,
      p_source_url: sourceUrl,
    })
    return ok(data, requestId)
  }

  const outboundMatch = path.match(/^\/v1\/pantry\/products\/([0-9a-f-]{36})\/outbound$/i)
  if (request.method === 'POST' && outboundMatch) {
    const productId = outboundMatch[1]
    if (!UUID.test(productId)) throw new ApiError(400, 'PRODUCT_ID_INVALID', '상품을 다시 선택해 주세요.')
    const body = await readJsonBody(request)
    const purpose = String(body.value.purpose ?? '')
    if (!['purchase', 'share'].includes(purpose)) throw new ApiError(400, 'PURPOSE_INVALID', '링크 용도를 확인해 주세요.')
    const data = asObject(await callRpc('service_v1_pantry_outbound_create', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
      p_product_id: productId,
      p_purpose: purpose,
    }))
    const token = String(data.token ?? '')
    if (!UUID.test(token)) throw new ApiError(502, 'OUTBOUND_TOKEN_INVALID', '구매 이동 주소를 만들지 못했어요.')
    return ok({
      url: `${functionBaseUrl(url)}/v1/pantry/r/${token}`,
      expiresAt: data.expiresAt,
    }, requestId)
  }

  if (request.method === 'GET' && path === '/v1/pantry/admin/dashboard') {
    requirePantryAdmin(context)
    const data = await callRpc('service_v1_pantry_admin_dashboard', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
    })
    return ok(data, requestId)
  }

  const linkMatch = path.match(/^\/v1\/pantry\/admin\/submissions\/([0-9a-f-]{36})\/link$/i)
  if (request.method === 'POST' && linkMatch) {
    requirePantryAdmin(context)
    const submissionId = linkMatch[1]
    if (!UUID.test(submissionId)) throw new ApiError(400, 'SUBMISSION_ID_INVALID', '등록 요청을 다시 선택해 주세요.')
    const body = await readJsonBody(request)
    const name = boundedText(body.value.name, 1, 300, 'PRODUCT_NAME_INVALID', '상품명을 확인해 주세요.')
    const variantLabel = boundedText(body.value.variantLabel ?? '', 0, 200, 'VARIANT_INVALID', '상품 옵션을 확인해 주세요.')
    const externalProductId = boundedText(body.value.externalProductId ?? '', 0, 240, 'EXTERNAL_ID_INVALID', '판매처 상품 ID를 확인해 주세요.')
    const canonicalUrl = String(body.value.canonicalUrl ?? '').trim()
    const affiliateUrl = String(body.value.affiliateUrl ?? '').trim()
    const imageUrl = String(body.value.imageUrl ?? '').trim()
    const currentPrice = Number(body.value.currentPrice ?? 0)
    if (canonicalUrl && !isHttpsUrl(canonicalUrl, 2048)) throw new ApiError(400, 'CANONICAL_URL_INVALID', '원본 상품 주소를 확인해 주세요.')
    if (!isHttpsUrl(affiliateUrl, 4096)) throw new ApiError(400, 'AFFILIATE_URL_INVALID', '관리자 제휴 주소를 확인해 주세요.')
    if (imageUrl && !isHttpsUrl(imageUrl, 2048)) throw new ApiError(400, 'IMAGE_URL_INVALID', '상품 이미지 주소를 확인해 주세요.')
    if (!Number.isSafeInteger(currentPrice) || currentPrice < 0) throw new ApiError(400, 'PRICE_INVALID', '현재 가격을 확인해 주세요.')
    const data = await callRpc('service_v1_pantry_admin_link_product', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
      p_submission_id: submissionId,
      p_name: name,
      p_variant_label: variantLabel,
      p_external_product_id: externalProductId,
      p_canonical_url: canonicalUrl,
      p_affiliate_url: affiliateUrl,
      p_image_url: imageUrl,
      p_current_price: currentPrice,
    })
    return ok(data, requestId)
  }

  const programMatch = path.match(/^\/v1\/pantry\/admin\/programs\/([a-z]+)$/)
  if (request.method === 'PUT' && programMatch) {
    requirePantryAdmin(context)
    const marketplace = programMatch[1]
    if (!PANTRY_MARKETPLACES.has(marketplace)) throw new ApiError(400, 'MARKETPLACE_INVALID', '제휴 판매처를 확인해 주세요.')
    const body = await readJsonBody(request)
    const conversionMode = String(body.value.conversionMode ?? '')
    const accountLabel = boundedText(body.value.accountLabel ?? '', 0, 120, 'ACCOUNT_LABEL_INVALID', '제휴 계정 이름을 확인해 주세요.')
    const status = String(body.value.status ?? '')
    const secretConfigured = body.value.secretConfigured === true
    if (!['api', 'manual', 'disabled'].includes(conversionMode)) throw new ApiError(400, 'CONVERSION_MODE_INVALID', '링크 처리 방식을 확인해 주세요.')
    if (!['setup_required', 'active', 'paused'].includes(status)) throw new ApiError(400, 'PROGRAM_STATUS_INVALID', '제휴 상태를 확인해 주세요.')
    const data = await callRpc('service_v1_pantry_admin_update_program', {
      p_common_user_id: context.identity.commonUserId,
      p_scope_id: context.app.scope.id,
      p_role: context.app.role,
      p_marketplace: marketplace,
      p_conversion_mode: conversionMode,
      p_account_label: accountLabel,
      p_status: status,
      p_secret_configured: secretConfigured,
    })
    return ok(data, requestId)
  }

  throw methodOrRouteError(request.method, path)
}

async function authorize(request: Request, appId: AppId): Promise<AuthContext> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || authorization.length > 16_384) {
    throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.')
  }
  let response: Response
  try {
    response = await fetch(`${AUTH_CONTEXT_URL}?app_id=${encodeURIComponent(appId)}`, {
      method: 'GET',
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    throw new ApiError(503, 'AUTHORIZATION_UNAVAILABLE', '앱 이용 권한을 확인할 수 없습니다.')
  }

  const payload = await response.json().catch(() => ({})) as JsonObject
  if (!response.ok) {
    const code = upstreamCode(payload)
    if (response.status === 401) throw new ApiError(401, code ?? 'TOKEN_INVALID', '인증 토큰을 확인할 수 없습니다.')
    if (response.status === 403) throw new ApiError(403, code ?? 'APP_NOT_ENTITLED', '이 앱을 이용할 권한이 없습니다.')
    if (response.status === 429) throw new ApiError(429, 'AUTH_RATE_LIMITED', '잠시 후 다시 시도하세요.')
    throw new ApiError(503, 'AUTHORIZATION_UNAVAILABLE', '앱 이용 권한을 확인할 수 없습니다.')
  }

  const context = validateContext(payload, appId)
  return context
}

function validateContext(payload: JsonObject, appId: AppId): AuthContext {
  const identity = isObject(payload.identity) ? payload.identity : {}
  const app = isObject(payload.app) ? payload.app : {}
  const scope = isObject(app.scope) ? app.scope : {}
  const token = isObject(payload.token) ? payload.token : {}
  const commonUserId = String(identity.commonUserId ?? '')
  const subject = String(identity.subject ?? '')
  const scopeId = String(scope.id ?? '')
  const scopeType = String(scope.type ?? '')
  const role = String(app.role ?? '')
  const expiresAt = Date.parse(String(token.expiresAt ?? ''))

  if (
    payload.contractVersion !== AUTH_CONTRACT_VERSION ||
    identity.issuer !== AUTH_ISSUER ||
    !UUID.test(commonUserId) ||
    !UUID.test(subject) ||
    !UUID.test(scopeId) ||
    app.appId !== appId ||
    app.status !== 'active' ||
    !['app_user', 'org_admin'].includes(role) ||
    !['personal', 'organization'].includes(scopeType) ||
    token.audience !== 'authenticated' ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new ApiError(502, 'AUTH_CONTEXT_INVALID', '인증 서버 응답을 확인할 수 없습니다.')
  }
  if (scopeType === 'personal' && scopeId !== commonUserId) {
    throw new ApiError(502, 'AUTH_CONTEXT_INVALID', '개인 데이터 범위를 확인할 수 없습니다.')
  }

  return payload as unknown as AuthContext
}

async function bindContext(context: AuthContext) {
  await callRpc('service_v1_bind_context', {
    p_common_user_id: context.identity.commonUserId,
    p_issuer: context.identity.issuer,
    p_subject: context.identity.subject,
    p_app_id: context.app.appId,
    p_role: context.app.role,
    p_scope_type: context.app.scope.type,
    p_scope_id: context.app.scope.id,
  })
}

async function callRpc(name: string, body: JsonObject): Promise<unknown> {
  const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ApiError(503, 'SERVICE_DATABASE_UNAVAILABLE', '서비스 데이터베이스에 연결할 수 없습니다.')
  }

  const payload = await response.json().catch(() => ({})) as JsonObject
  if (!response.ok) {
    const databaseCode = typeof payload.code === 'string' ? payload.code : ''
    const messageCode = typeof payload.message === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(payload.message)
      ? payload.message
      : ''
    const code = messageCode || mapDatabaseCode(databaseCode)
    const status = databaseCode === 'P0002'
      ? 404
      : databaseCode === '28000'
      ? 403
      : databaseCode === '22023'
      ? 400
      : databaseCode === '23514'
      ? 409
      : databaseCode.startsWith('PGRST')
      ? 503
      : 500
    throw new ApiError(status, code, databaseMessage(status))
  }
  return payload
}

async function readJsonBody(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 데이터가 너무 큽니다.')
  }
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 데이터가 너무 큽니다.')
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new ApiError(400, 'JSON_INVALID', '요청 데이터 형식을 확인하세요.')
  }
  if (!isObject(value)) throw new ApiError(400, 'JSON_INVALID', '요청 데이터 형식을 확인하세요.')
  return { raw, value }
}

function assertContractHeaders(request: Request, appId: AppId) {
  const requestedApp = request.headers.get('x-encoreflare-app-id')
  if (requestedApp && requestedApp !== appId) {
    throw new ApiError(400, 'APP_ID_MISMATCH', '요청 앱과 API 경로가 일치하지 않습니다.')
  }
  const contract = request.headers.get('x-encoreflare-contract-version')
  if (contract && contract !== SERVICE_CONTRACT_VERSION) {
    throw new ApiError(409, 'CONTRACT_VERSION_UNSUPPORTED', '지원하지 않는 서비스 계약 버전입니다.', {
      supported: SERVICE_CONTRACT_VERSION,
    })
  }
}

function appFromPath(path: string): AppId {
  if (path.startsWith('/v1/learn/')) return 'learn'
  if (path.startsWith('/v1/yeoyu/')) return 'yeoyu'
  if (path.startsWith('/v1/pantry/')) return 'pantry'
  throw new ApiError(404, 'ROUTE_NOT_FOUND', 'API 경로를 찾을 수 없습니다.')
}

function functionPath(pathname: string) {
  const marker = `/${FUNCTION_NAME}`
  const index = pathname.indexOf(marker)
  if (index < 0) return pathname
  const suffix = pathname.slice(index + marker.length)
  return suffix || '/'
}

function functionBaseUrl(url: URL) {
  const marker = `/${FUNCTION_NAME}`
  const index = url.pathname.indexOf(marker)
  if (index < 0) throw new ApiError(500, 'FUNCTION_PATH_INVALID', '구매 이동 주소를 만들지 못했어요.')
  return `${url.origin}${url.pathname.slice(0, index + marker.length)}`
}

function requirePantryAdmin(context: AuthContext) {
  if (context.app.appId !== 'pantry' || context.app.role !== 'org_admin') {
    throw new ApiError(403, 'PANTRY_ADMIN_REQUIRED', '관리자만 사용할 수 있어요.')
  }
}

function requireLearnAdmin(context: AuthContext) {
  if (context.app.appId !== 'learn' || context.app.role !== 'org_admin') {
    throw new ApiError(403, 'LEARN_ADMIN_REQUIRED', 'Learn 관리자만 사용할 수 있어요.')
  }
}

function boundedText(value: unknown, minimum: number, maximum: number, code: string, message: string) {
  const text = String(value ?? '').trim()
  if (text.length < minimum || text.length > maximum) throw new ApiError(400, code, message)
  return text
}

function isHttpsUrl(value: string, maximum: number) {
  if (!value || value.length > maximum || /\s/.test(value)) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function requireIdempotencyKey(request: Request) {
  const key = request.headers.get('idempotency-key') ?? ''
  if (!SAFE_REQUEST_ID.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '변경 요청에는 올바른 Idempotency-Key가 필요합니다.')
  }
  return key
}

function requireBaseVersion(request: Request) {
  const raw = (request.headers.get('if-match') ?? '').replace(/^"|"$/g, '')
  if (!/^\d{1,18}$/.test(raw)) {
    throw new ApiError(428, 'BASE_VERSION_REQUIRED', '변경 요청에는 현재 버전 If-Match가 필요합니다.')
  }
  const version = Number(raw)
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ApiError(400, 'VERSION_INVALID', '현재 버전을 확인하세요.')
  }
  return version
}

function parseLimit(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback
  if (!/^\d{1,3}$/.test(value)) throw new ApiError(400, 'LIMIT_INVALID', '페이지 크기를 확인하세요.')
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ApiError(400, 'LIMIT_INVALID', '페이지 크기를 확인하세요.')
  }
  return parsed
}

function parseCursorInteger(value: unknown, fallback: number | null): number {
  if (value === undefined || value === null) {
    if (fallback === null) throw new ApiError(400, 'CURSOR_INVALID', '페이지 커서를 확인하세요.')
    return fallback
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(400, 'CURSOR_INVALID', '페이지 커서를 확인하세요.')
  }
  return parsed
}

function encodeCursor(value: JsonObject) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeCursor(value: string | null, kind: string): JsonObject | null {
  if (!value) return null
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError(400, 'CURSOR_INVALID', '페이지 커서를 확인하세요.')
  }
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!isObject(parsed) || parsed.v !== 1 || parsed.kind !== kind) throw new Error('invalid')
    return parsed
  } catch {
    throw new ApiError(400, 'CURSOR_INVALID', '페이지 커서를 확인하세요.')
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function resolveRequestId(request: Request) {
  const provided = request.headers.get('x-request-id') ?? ''
  return SAFE_REQUEST_ID.test(provided) ? provided : crypto.randomUUID()
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim() ?? ''
  if (!value) throw new ApiError(503, 'SERVICE_CONFIGURATION_ERROR', '서비스 설정이 완료되지 않았습니다.')
  return value
}

function upstreamCode(payload: JsonObject) {
  if (isObject(payload.data) && typeof payload.data.code === 'string') return payload.data.code
  return typeof payload.code === 'string' ? payload.code : null
}

function mapDatabaseCode(code: string) {
  if (code === '23514') return 'REQUEST_CONFLICT'
  if (code === '22023') return 'REQUEST_INVALID'
  if (code === '28000') return 'ACCESS_DENIED'
  if (code === 'P0002') return 'NOT_FOUND'
  return 'SERVICE_DATABASE_ERROR'
}

function databaseMessage(status: number) {
  if (status === 400) return '요청 데이터를 확인하세요.'
  if (status === 403) return '데이터에 접근할 권한이 없습니다.'
  if (status === 404) return '요청한 데이터를 찾을 수 없습니다.'
  if (status === 409) return '요청이 현재 데이터와 충돌합니다.'
  return '서비스 데이터를 처리하지 못했습니다.'
}

function methodOrRouteError(method: string, path: string) {
  const known = path.startsWith('/v1/learn/') || path.startsWith('/v1/yeoyu/') || path.startsWith('/v1/pantry/')
  return known
    ? new ApiError(405, 'METHOD_NOT_ALLOWED', `${method} 요청은 이 경로에서 지원하지 않습니다.`)
    : new ApiError(404, 'ROUTE_NOT_FOUND', 'API 경로를 찾을 수 없습니다.')
}

function decodePathPart(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ApiError(400, 'PATH_INVALID', 'API 경로를 확인하세요.')
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: unknown): JsonObject {
  if (!isObject(value)) throw new ApiError(502, 'SERVICE_RESPONSE_INVALID', '서비스 응답을 확인할 수 없습니다.')
  return value
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError(500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.')
}

function ok(data: unknown, requestId: string, extra: JsonObject = {}) {
  return {
    status: 200,
    extraHeaders: {},
    body: {
      contractVersion: SERVICE_CONTRACT_VERSION,
      requestId,
      data,
      ...extra,
    },
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(requestId), ...extraHeaders },
  })
}

function responseHeaders(requestId: string) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, content-type, idempotency-key, if-match, x-encoreflare-app-id, x-encoreflare-contract-version, x-request-id',
    'Access-Control-Expose-Headers': 'x-request-id',
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
  }
}
