import { useState, useRef } from 'react'
import type { Employee } from '../api/contract'
import { useWorkspace } from './context'
import { Badge, Table, Totals } from './components'
import { money, period, periods, shift, revise, sum, statuses } from './model'
import { download } from './excel'
import { classes as c } from './styles'

export function PayRange({ employee }: { employee: Employee }) {
  const { state, month, save, notify } = useWorkspace()
  const [mode, setMode] = useState('recent'),
    [start, setStart] = useState(shift(month, -11)),
    [end, setEnd] = useState(month)
  const [[first, last], setRange] = useState([start, end])
  const [edit, setEdit] = useState<{
      month: string
      inputsValid: boolean
      field: string
      gross: string
      withheld: string
    } | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const output = useRef<HTMLDivElement>(null)
  function report(first: string, last: string) {
    const rows = periods(state, first, last).map((p) => ({
      ...p,
      slip: p.version?.slips.find((s) => s.id === employee.id),
    }))
    const saved = rows.flatMap((r) => (r.slip ? [r.slip] : []))
    const totals = saved.length
      ? {
          gross: sum(saved, 'gross'),
          withheld: sum(saved, 'withheld'),
          net: sum(saved, 'net'),
        }
      : undefined
    return { rows, saved, totals, missing: rows.length - saved.length }
  }
  const { rows, saved, totals, missing } = report(first, last)
  const scope = '按每月最新版工资条汇总，包含待发放记录。'
  function calculate(exportExcel = false) {
    const from = mode === 'recent' ? shift(end, -11) : start
    setRange([from, end])
    if (!exportExcel || from > end) return
    const data = report(from, end)
    const amounts = (r?: typeof totals) =>
      r ? [r.gross / 100, r.withheld / 100, r.net / 100] : [null, null, null]
    const cols = ['应发（元）', '应发后扣款（元）', '实发（元）']
    download(
      '员工薪资汇总-' +
        // oxlint-disable-next-line no-control-regex -- Strip control bytes from the exported filename.
        employee.id.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 40) +
        '-' +
        from +
        '至' +
        end,
      '员工薪资汇总',
      [
        [
          '姓名',
          '工号',
          '档案部门',
          '起始月份',
          '结束月份',
          '有记录月数',
          '缺记录月数',
        ],
        [
          employee.name,
          employee.id,
          employee.dept,
          from,
          end,
          data.saved.length,
          data.missing,
        ],
        ['统计口径', scope],
        [],
        ['汇总', ...cols],
        ['合计', ...amounts(data.totals)],
        [],
        ['工资所属月', ...cols, '工资条状态', '版本'],
        ...data.rows.map((r) => [
          r.month,
          ...amounts(r.slip),
          r.slip ? statuses[r.slip.status] : '无记录',
          r.slip ? r.version!.number : null,
        ]),
      ],
    )
  }
  function finish() {
    const old = edit
    setEdit(null)
    setMessage('')
    requestAnimationFrame(() =>
      output.current
        ?.querySelector<HTMLButtonElement>(
          '[data-edit-month="' +
            old?.month +
            '"][data-edit-field="' +
            old?.field +
            '"]',
        )
        ?.focus(),
    )
  }
  const gross = PayrollImport.cents(edit?.gross || ''),
    withheld = PayrollImport.cents(edit?.withheld || ''),
    net = gross - withheld
  const valid =
    [gross, withheld, net].every(Number.isSafeInteger) && edit?.inputsValid
  return (
    <>
      <p className={c('muted')}>
        {employee.id} / {employee.dept}
      </p>
      <form
        className={c('range-form')}
        id="pay-range-form"
        onSubmit={(e) => {
          e.preventDefault()
          calculate(
            (e.nativeEvent as SubmitEvent).submitter?.id === 'export-pay-range',
          )
        }}
      >
        <label>
          统计范围
          <select
            name="mode"
            value={mode}
            disabled={!!edit}
            onChange={(e) => {
              setMode(e.target.value)
              if (end && (e.target.value === 'recent' || start))
                setRange([
                  e.target.value === 'recent' ? shift(end, -11) : start,
                  end,
                ])
            }}
          >
            <option value="recent">近 12 个月（含截止月）</option>
            <option value="custom">自选起止月份</option>
          </select>
        </label>
        <label hidden={mode === 'recent'}>
          起始月份
          <input
            type="month"
            min="1999-02"
            max="2099-12"
            name="start"
            required
            disabled={!!edit || mode === 'recent'}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {mode === 'recent' ? '截止月份' : '结束月份'}
          <input
            type="month"
            name="end"
            min="2000-01"
            max="2099-12"
            required
            disabled={!!edit}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button className={c('btn primary')} disabled={!!edit}>
          计算
        </button>
        <button className={c('btn')} id="export-pay-range" disabled={!!edit}>
          导出 Excel
        </button>
      </form>
      <div ref={output} id="pay-range-result" aria-live="polite">
        {first > last ? (
          <p className={c('statusline error')}>起始月份不能晚于结束月份。</p>
        ) : (
          <>
            <h3>
              {period(first)} 至 {period(last)}
            </h3>
            <p className={c('muted')}>
              共 {rows.length} 个月，有记录 {saved.length} 个月，缺记录{' '}
              {missing} 个月。{scope}
            </p>
            <Totals row={totals} />
            {!!saved.length && (
              <p className={c('muted pay-edit-hint')}>
                点击应发或应发后扣款金额即可修改，实发会自动重算。
              </p>
            )}
            <Table
              headers={['工资所属月', '应发', '应发后扣款', '实发', '工资条']}
              rows={rows.map(({ month: m, slip, version }) => {
                const editing = edit?.month === m
                return [
                  <>
                    {period(m)}
                    {editing && (
                      <>
                        <div className={c('pay-edit-controls')}>
                          <button
                            disabled={busy}
                            className={c('link')}
                            onClick={async () => {
                              if (!valid) {
                                setMessage('请输入有效金额，最多两位小数。')
                                return
                              }
                              if (
                                gross === slip?.gross &&
                                withheld === slip.withheld
                              ) {
                                finish()
                                return
                              }
                              setBusy(true)
                              if (
                                await save(
                                  revise(state, m, employee.id, {
                                    gross,
                                    net,
                                    withheld,
                                  }),
                                )
                              ) {
                                finish()
                                notify('工资金额已保存。')
                              }
                              setBusy(false)
                            }}
                          >
                            保存
                          </button>
                          <button
                            disabled={busy}
                            className={c('link')}
                            onClick={finish}
                          >
                            取消
                          </button>
                        </div>
                        <p className={c('pay-edit-error')} role="alert">
                          {message}
                        </p>
                      </>
                    )}
                  </>,
                  ...(['gross', 'withheld'] as const).map((k, i) =>
                    !slip ? (
                      '—'
                    ) : editing ? (
                      <input
                        key={k}
                        className={c('pay-edit-amount')}
                        type="number"
                        step="0.01"
                        required
                        disabled={busy}
                        autoFocus={edit.field === k}
                        name={k}
                        aria-label={(i ? '应发后扣款' : '应发') + '（元）'}
                        value={edit[k]}
                        onChange={(e) => {
                          setEdit({
                            ...edit,
                            [k]: e.target.value,
                            inputsValid: !e.currentTarget
                              .closest('tr')
                              ?.querySelector('input:invalid'),
                          })
                          setMessage('')
                        }}
                      />
                    ) : (
                      <button
                        key={k}
                        disabled={!!edit}
                        className={c('link')}
                        data-edit-month={m}
                        data-edit-field={k}
                        aria-label={
                          period(m) +
                          ' ' +
                          (i ? '应发后扣款' : '应发') +
                          ' ' +
                          money(slip[k]) +
                          '，点击编辑'
                        }
                        onClick={() =>
                          setEdit({
                            inputsValid: true,
                            month: m,
                            field: k,
                            gross: (slip.gross / 100).toFixed(2),
                            withheld: (slip.withheld / 100).toFixed(2),
                          })
                        }
                      >
                        {money(slip[k])}
                      </button>
                    ),
                  ),
                  editing
                    ? valid
                      ? money(net)
                      : '—'
                    : slip
                      ? money(slip.net)
                      : '—',
                  slip ? (
                    <>
                      <Badge status={slip.status} />{' '}
                      <span className={c('muted')}>
                        第 {version!.number} 版
                      </span>
                    </>
                  ) : (
                    <span className={c('muted')}>无记录</span>
                  ),
                ]
              })}
            />
          </>
        )}
      </div>
    </>
  )
}
