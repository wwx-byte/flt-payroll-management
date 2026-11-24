import {
  createRootRoute,
  HeadContent,
  Scripts,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import css from '../ui/workplace.css?url'
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width,initial-scale=1' },
      { name: 'color-scheme', content: 'light' },
      { title: '薪酬工作台' },
    ],
    links: [
      { rel: 'stylesheet', href: css },
      ...(import.meta.env.DEV
        ? [{ rel: 'stylesheet', href: '/virtual:stylex.css' }]
        : []),
    ],
  }),
  component: Document,
})
function Document() {
  const signedIn = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.routeId === '/' && match.loaderData === true,
      ),
  })
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body data-mode={signedIn ? 'production' : 'login'}>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
