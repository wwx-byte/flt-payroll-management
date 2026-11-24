import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { authenticated } from '../server/auth'
import { Workplace } from '../ui/workplace'
import { Login } from '../ui/login'

const session = createServerFn({ method: 'GET' }).handler(() =>
  authenticated(getRequest()),
)
export const Route = createFileRoute('/')({
  loader: () => session(),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? '薪酬工作台' : '登录薪酬工作台' }],
  }),
  component: Index,
})
function Index() {
  const signedIn = Route.useLoaderData()
  return signedIn ? <Workplace /> : <Login error="" />
}
