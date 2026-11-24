import { useState, type FormEvent } from 'react'
import type { Employee, Standard } from '../api/contract'
import { useWorkspace } from './context'
import { Link, Table } from './components'
import { EmployeeDept } from './employees'
import { money, standardAmount } from './model'
import { classes as c } from './styles'

export function History({ employee }: { employee: Employee }) {
  const { show } = useWorkspace(),
    priced = (s: string) => /工资|补贴|加班基数/.test(s)
  const labels = [
    ...new Set(
      employee.history.flatMap((r) => (r.details || []).map(([k]) => k)),
    ),
  ]
  const details = [
    ...labels.filter(priced),
    ...labels.filter((l) => l !== '综合薪资' && !priced(l)),
  ]
  const sourced = employee.history.some((r) => r.source)
  return (
    <div className={c('standard-history')}>
      <div className={c('muted employee-profile-fields')}>
        <span>工号 {employee.id}</span>
        <div>
          部门 <EmployeeDept employee={employee} />
        </div>
      </div>
      {!!details.length && (
        <p className={c('muted')}>可横向滚动查看全部薪资项。</p>
      )}
      <Table
        region={details.length ? '薪资记录与分项' : undefined}
        empty="暂无薪资变动记录"
        headers={[
          '生效时间',
          '类型',
          '综合薪资',
          ...details,
          '备注',
          ...(sourced ? ['来源'] : []),
        ]}
        rows={employee.history.map((r) => {
          const values = new Map(r.details)
          return [
            r.date?.slice(0, 7) ?? '待确认',
            r.type,
            standardAmount(r),
            ...details.map((l) => {
              const v = values.get(l)
              return typeof v === 'number' && priced(l)
                ? money(Math.round(v * 100))
                : (v ?? '—')
            }),
            r.note ? (
              <span className={c('salary-standard-note')}>{r.note}</span>
            ) : (
              '—'
            ),
            ...(sourced
              ? [
                  r.source ? (
                    <span className={c('salary-standard-note')}>
                      {r.source.file} · 第 {r.source.row} 行
                    </span>
                  ) : (
                    '—'
                  ),
                ]
              : []),
          ]
        })}
      />
      <div className={c('actions signature-actions')}>
        <Link onClick={() => show({ kind: 'addHistory', id: employee.id })}>
          新增薪资记录
        </Link>
        <Link onClick={() => show({ kind: 'range', id: employee.id })}>
          薪资汇总
        </Link>
      </div>
    </div>
  )
}
export function EmployeeForm({ employee }: { employee?: Employee }) {
  const { state, save, show, notify } = useWorkspace(),
    [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget),
      read = (key: string) => String(data.get(key) ?? '').trim()
    const next = structuredClone(state)
    if (!employee) {
      const id = read('id'),
        name = read('name'),
        dept = read('dept')
      if (!id || !name || !dept) {
        setError('工号、姓名和部门均为必填。')
        return
      }
      if (next.employees.some((e) => e.id === id)) {
        setError('工号已存在。')
        return
      }
      next.employees.push({ id, name, dept, history: [] })
      if (await save(next)) {
        show(null)
        notify('员工档案已创建。')
      }
      return
    }
    const history = next.employees.find((e) => e.id === employee.id)!.history,
      date = read('date'),
      type = read('type') as Standard['type']
    const amount = PayrollImport.cents(read('amount'))
    if (!Number.isSafeInteger(amount)) {
      setError('请输入有效的月薪金额。')
      return
    }
    if (history.some((r) => r.date === date && r.type === type)) {
      setError('该生效日期和类型下已经有薪资记录。')
      return
    }
    const index = history.findIndex((r) => r.date && r.date > date)
    history.splice(index < 0 ? history.length : index, 0, {
      date,
      type,
      amount,
      note: read('note'),
    })
    if (await save(next)) {
      show({ kind: 'history', id: employee.id })
      notify('薪资记录已保存。')
    }
  }
  return (
    <form id="edit-form" onSubmit={submit}>
      <div className={c('form-grid')}>
        {employee ? (
          <>
            <label>
              生效类型
              <select name="type">
                {['试用期', '转正', '调薪'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              生效日期
              <input name="date" type="date" required />
            </label>
            <label>
              月薪（元）
              <input
                name="amount"
                type="number"
                min="0"
                max="100000000"
                step="0.01"
                required
              />
            </label>
            <label>
              备注
              <input name="note" maxLength={200} />
            </label>
          </>
        ) : (
          <>
            <label>
              工号
              <input name="id" required maxLength={40} />
            </label>
            <label>
              姓名
              <input name="name" required maxLength={60} />
            </label>
            <label>
              部门
              <input name="dept" required maxLength={60} />
            </label>
          </>
        )}
      </div>
      <p id="form-error" className={c('muted')} role="alert">
        {error}
      </p>
      <button className={c('btn primary')}>保存</button>
    </form>
  )
}
