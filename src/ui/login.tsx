import * as stylex from '@stylexjs/stylex'
import { classes as c } from './styles'
const styles = stylex.create({
  main: { width: 'min(440px,calc(100% - 32px))', margin: '12vh auto' },
  description: { margin: '10px 0 20px' },
})
export function Login({ error }: { error: string }) {
  return (
    <main {...stylex.props(styles.main)}>
      <section className={c('panel')}>
        <h1>薪酬工作台</h1>
        <p className={'muted ' + stylex.props(styles.description).className}>
          使用管理员账号登录本机薪资系统。
        </p>
        {['401', '429'].includes(error) && (
          <p className={c('statusline error')}>
            {error === '429'
              ? '尝试次数过多，请一分钟后再试。'
              : '账号或密码不正确。'}
          </p>
        )}
        <form method="post" action="/login" className={c('form-grid')}>
          <label>
            账号
            <input name="username" required autoComplete="username" autoFocus />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button className={c('btn primary')}>登录</button>
        </form>
      </section>
    </main>
  )
}
