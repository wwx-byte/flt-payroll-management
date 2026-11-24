import { useState, useRef, useEffect, type ReactNode } from 'react'
import { classes as c } from './styles'
import { money, statuses, type Amounts } from './model'
import { useWorkspace } from './context'

export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={c(primary ? 'btn primary' : 'btn')}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
export function Link({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" className={c('link')} onClick={onClick}>
      {children}
    </button>
  )
}
export function Badge({ status }: { status: keyof typeof statuses }) {
  return <span className={c('pill ' + status)}>{statuses[status]}</span>
}
export function Heading({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className={c('page-head')}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className={c('actions')}>{children}</div>
    </div>
  )
}
export function Panel({
  title,
  sub,
  actions,
  children,
}: {
  title: string
  sub?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={c('panel')}>
      <div className={c('section-head')}>
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        <div className={c('actions')}>{actions}</div>
      </div>
      {children}
    </section>
  )
}
export function Table({
  headers,
  rows,
  empty = '当前月份暂无记录',
  region,
}: {
  headers: string[]
  rows: ReactNode[][]
  empty?: string
  region?: string
}) {
  if (!rows.length) return <p className={c('empty')}>{empty}</p>
  return (
    <div
      className={c('tablebox')}
      role={region ? 'region' : undefined}
      tabIndex={region ? 0 : undefined}
      aria-label={region}
    >
      <table>
        <thead>
          <tr>
            {headers.map((s, i) => (
              <th scope="col" key={i}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function Month() {
  const { month, setMonth } = useWorkspace()
  return (
    <label>
      <span className={c('sr')}>薪资月份</span>
      <input
        type="month"
        id="month"
        min="2000-01"
        max="2099-12"
        value={month}
        onChange={(e) => {
          if (e.target.value && e.target.validity.valid)
            setMonth(e.target.value)
        }}
      />
    </label>
  )
}
export function Totals({ row }: { row?: Amounts }) {
  return (
    <dl className={c('slip-totals')}>
      {(['gross', 'withheld', 'net'] as const).map((key, i) => (
        <div key={key}>
          <dt>{['应发合计', '应发后扣款', '实发合计'][i]}</dt>
          <dd>{row ? money(row[key]) : '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
export function Department({
  dept,
  name,
  onSave,
}: {
  dept: string
  name: string
  onSave: (value: string) => Promise<boolean>
}) {
  const [editing, edit] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const button = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])
  function close() {
    edit(false)
    setError('')
    requestAnimationFrame(() => button.current?.focus())
  }
  return editing ? (
    <form
      className={c('inline-dept-form')}
      onSubmit={async (e) => {
        e.preventDefault()
        const value = input.current!.value.trim()
        if (!value) {
          setError('请输入部门。')
          return
        }
        setBusy(true)
        if (value === dept || (await onSave(value))) close()
        setBusy(false)
      }}
    >
      <input
        ref={input}
        name="dept"
        aria-label="部门"
        required
        maxLength={60}
        defaultValue={dept}
        disabled={busy}
      />
      <button className={c('link')} disabled={busy}>
        保存
      </button>
      <button
        type="button"
        className={c('link')}
        disabled={busy}
        onClick={close}
      >
        取消
      </button>
      <span className={c('pay-edit-error')} role="alert">
        {error}
      </span>
    </form>
  ) : (
    <button
      ref={button}
      className={c('link')}
      aria-label={name + '的部门：' + dept + '，点击编辑'}
      onClick={(e) => {
        const active = e.currentTarget
          .closest('dialog,.tablebox')
          ?.querySelector<HTMLInputElement>('.inline-dept-form input')
        if (active) active.focus()
        else edit(true)
      }}
    >
      {dept}
    </button>
  )
}
