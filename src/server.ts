import { randomBytes } from 'node:crypto'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { authenticated, login, logout } from './server/auth'
import { handler } from './server/api'
import { limitedBody } from './server/body'
import { database } from './server/store'

const render = createStartHandler(defaultStreamHandler)
const origin = new URL(
  process.env.PAYROLL_ORIGIN ||
    'http://127.0.0.1:' + (process.env.PORT || '8765'),
)
async function dispatch(request: Request, nonce: string) {
  request.headers.delete('x-payroll-login-error')
  request.headers.set('x-payroll-render-nonce', nonce)
  const url = new URL(request.url)
  if (
    (request.headers.get('host') || url.host) !== origin.host ||
    (request.method === 'POST' &&
      request.headers.get('origin') !== origin.origin)
  ) {
    return new Response('请求来源无效。', { status: 403 })
  }
  if (url.pathname === '/login' && request.method === 'POST') {
    const result = await login(request)
    if (result instanceof Response) return result
    const retry = new URL('/login', origin)
    const page = await render(
      new Request(retry, {
        headers: {
          accept: 'text/html',
          'x-payroll-render-nonce': nonce,
          'x-payroll-login-error': String(result),
        },
      }),
      { context: { nonce } },
    )
    return new Response(page.body, { headers: page.headers, status: result })
  }
  if (url.pathname === '/logout' || url.pathname.startsWith('/api/')) {
    if (!authenticated(request))
      return new Response('请重新登录。', { status: 401 })
    if (url.pathname === '/logout' && request.method === 'POST')
      return logout(request)
    let apiRequest = request
    if (request.method === 'POST') {
      if (
        request.headers.get('content-type')?.split(';')[0] !==
        'application/json'
      )
        return new Response('请求接口无效。', { status: 404 })
      const body = await limitedBody(request, 40 * 1024 * 1024)
      if (!body?.length) return new Response('请求大小无效。', { status: 400 })
      apiRequest = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body,
      })
    }
    const { response } = await handler.handle(apiRequest, { prefix: '/api' })
    return response || new Response('页面不存在。', { status: 404 })
  }
  if (url.pathname === '/') database()
  return render(request, { context: { nonce } })
}
export default {
  async fetch(request: Request) {
    const nonce = randomBytes(18).toString('base64')
    const response = await dispatch(request, nonce)
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'same-origin')
    if (import.meta.env.PROD)
      headers.set(
        'Content-Security-Policy',
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      )
    return new Response(response.body, { status: response.status, headers })
  },
}
