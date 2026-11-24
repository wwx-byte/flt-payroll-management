import { createRouter } from '@tanstack/react-router'
import { routeTree } from './route-tree.gen'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
const getNonce = createIsomorphicFn()
  .server(() => getRequestHeader('x-payroll-render-nonce'))
  .client(
    () =>
      document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')
        ?.content,
  )
export function getRouter() {
  return createRouter({ routeTree, ssr: { nonce: getNonce() } })
}
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
