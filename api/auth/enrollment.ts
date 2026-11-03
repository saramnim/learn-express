import { proxyCommonAuth } from '../../server/auth-proxy.js'

export default {
  fetch(request: Request) {
    return proxyCommonAuth(request, {
      method: 'POST',
      path: '/api/auth/apps/learn/enrollment',
    })
  },
}
