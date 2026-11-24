import { randomBytes, timingSafeEqual } from 'node:crypto'
import { database, passwordHash } from './store'

import { limitedBody } from './body'

const sessions = new Map<string, number>()
let attempts: number[] = []
function token(request: Request) {
  return (
    /(?:^|;\s*)payroll_session=([^;]+)/.exec(
      request.headers.get('cookie') || '',
    )?.[1] || ''
  )
}
export function authenticated(request: Request) {
  return (sessions.get(token(request)) || 0) > Date.now()
}
function redirect(cookie: string, secure: boolean) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie':
        'payroll_session=' +
        cookie +
        '; Path=/; HttpOnly; SameSite=Strict' +
        (secure ? '; Secure' : ''),
    },
  })
}
export async function login(
  request: Request,
  secure: boolean,
): Promise<Response | 401 | 429> {
  const now = Date.now()
  attempts = attempts.filter((t) => now - t < 60_000)
  if (attempts.length >= 8) return 429
  attempts.push(now)
  const body = await limitedBody(request, 4096)
  if (!body?.length) return new Response('请求大小无效。', { status: 400 })
  const fields = new URLSearchParams(body.toString())
  const account = database()
    .prepare('SELECT salt,digest FROM account WHERE id=1')
    .get()!
  const actual = passwordHash(
    fields.get('password') || '',
    account.salt as Uint8Array,
  )
  if (
    !timingSafeEqual(actual, account.digest as Uint8Array) ||
    fields.get('username') !== 'admin'
  )
    return 401
  attempts = []
  for (const [id, end] of sessions) if (end <= now) sessions.delete(id)
  const id = randomBytes(32).toString('base64url')
  sessions.set(id, now + 8 * 3600_000)
  return redirect(id, secure)
}
export function logout(request: Request, secure: boolean) {
  sessions.delete(token(request))
  return redirect('; Max-Age=0', secure)
}
