import { proxyCommonAuth } from '../../server/auth-proxy.js'

export default {
  fetch(request: Request) {
    const url = new URL(request.url)
    if (url.searchParams.get('app_id') !== 'learn') {
      return Response.json(
        { error: { code: 'APP_ID_INVALID', message: 'Learn 앱 요청만 지원합니다.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }

    return proxyCommonAuth(request, {
      method: 'GET',
      path: '/api/auth/context?app_id=learn',
    })
  },
}
