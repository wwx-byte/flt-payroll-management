import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { Login } from '../ui/login'

const loginError = createServerFn({ method: 'GET' }).handler(
  () => getRequestHeader('x-payroll-login-error') ?? '',
)
export const Route = createFileRoute('/login')({
  loader: () => loginError(),
  head: () => ({ meta: [{ title: '登录薪酬工作台' }] }),
  component: () => <Login error={Route.useLoaderData()} />,
})
