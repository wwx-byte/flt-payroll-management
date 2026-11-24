import { useWorkspace } from './context'
import { Button, Heading, Month, Panel, Table } from './components'
import {
  departments,
  latest,
  money,
  period,
  periods,
  shift,
  sum,
} from './model'
import { classes as c } from './styles'
import { SlipTable } from './payroll-ledger'
import { download } from './excel'

function Card({
  icon,
  title,
  value,
  hint,
}: {
  icon: string
  title: string
  value: string
  hint: string
}) {
  return (
    <article className={c('kpi')}>
      <span className="symbol" aria-hidden="true">
        {icon}
      </span>
      <div className={c('muted')}>{title}</div>
      <strong>{value}</strong>
      <div className={c('muted')}>{hint}</div>
    </article>
  )
}
function Charts({ ordered }: { ordered: ReturnType<typeof departments> }) {
  const { state, month } = useWorkspace()
  const trend = periods(state, shift(month, -5), month).map((p) => ({
    month: p.month,
    value: p.version ? sum(p.version.slips, 'gross') : null,
  }))
  const max = Math.max(1, ...trend.map((p) => Math.abs(p.value ?? 0))),
    deptMax = Math.max(1, ...ordered.map((d) => Math.abs(d.gross)))
  return (
    <div className={c('columns')}>
      <Panel
        title="近 6 个月薪酬趋势"
        sub="按工资条所属月份统计应发薪资 · 万元"
      >
        <div className={c('chart')}>
          {trend.map((p) => (
            <div
              key={p.month}
              className={c('chart-item')}
              title={
                period(p.month) +
                ' ' +
                (p.value === null ? '暂无台账' : money(p.value))
              }
            >
              <span>
                {p.value === null ? '—' : (p.value / 1000000).toFixed(1)}
              </span>
              <div className={c('bar-wrap')}>
                <div
                  className={c('bar')}
                  style={{ height: (Math.abs(p.value ?? 0) / max) * 100 + '%' }}
                />
              </div>
              <span>{Number(p.month.slice(5))} 月</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="部门应发薪酬" sub="按应发金额排序 · 前 6 个部门">
        {ordered.length ? (
          ordered.slice(0, 6).map((d) => (
            <div key={d.name} className={c('dept')}>
              <div>
                <span>{d.name}</span>
                <strong>{money(d.gross)}</strong>
              </div>
              <div className={c('track')}>
                <span
                  style={{ width: (Math.abs(d.gross) / deptMax) * 100 + '%' }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className={c('empty')}>当前月份暂无部门数据</p>
        )}
      </Panel>
    </div>
  )
}
export function Dashboard() {
  const { state, month, show, go } = useWorkspace(),
    version = latest(state, month),
    rows = version?.slips || []
  const gross = sum(rows, 'gross'),
    prev = sum(latest(state, shift(month, -1))?.slips || [], 'gross')
  return (
    <>
      <Heading
        title="薪酬总览"
        description="查看月度发薪数据、工资条进度和员工签收情况。"
      >
        <Month />
        <Button primary onClick={() => show({ kind: 'import' })}>
          导入工资表
        </Button>
      </Heading>
      <div className={c('cards')}>
        <Card
          icon="¥"
          title="应发薪资"
          value={money(gross)}
          hint={
            '环比 ' +
            (version && prev > 0
              ? (((gross - prev) / prev) * 100).toFixed(1) + '%'
              : '—')
          }
        />
        <Card
          icon="¥"
          title="实发薪资"
          value={money(sum(rows, 'net'))}
          hint={'扣款合计 ' + money(sum(rows, 'withheld'))}
        />
        <Card
          icon="♙"
          title="发薪人数"
          value={rows.length + ' 人'}
          hint={
            '人均应发 ' +
            (rows.length ? money(Math.round(gross / rows.length)) : '—')
          }
        />
        <Card
          icon="✓"
          title="签收进度"
          value="0 / 0"
          hint={
            '待签收 0 人 · 待发放 ' +
            rows.filter((r) => r.status === 'draft').length +
            ' 人'
          }
        />
      </div>
      <Charts ordered={departments(rows)} />
      <Panel
        title="工资条发放进度"
        sub={period(month)}
        actions={<Button onClick={() => go('delivery')}>管理发放</Button>}
      >
        <SlipTable rows={rows.slice(0, 6)} version={version} delivery />
      </Panel>
    </>
  )
}
export type AnalysisOptions = { mode: string; start: string; end: string }
const modes = {
  month: '月度',
  quarter: '季度',
  year: '年度',
  custom: '自选区间',
}
export function Analysis({
  options,
  set,
}: {
  options: AnalysisOptions
  set: (o: AnalysisOptions) => void
}) {
  const { state, month } = useWorkspace(),
    { mode } = options,
    offset = Number(month.slice(5)) - 1
  const first =
    mode === 'custom'
      ? options.start
      : shift(
          month,
          mode === 'year' ? -offset : mode === 'quarter' ? -(offset % 3) : 0,
        )
  const last =
    mode === 'custom'
      ? options.end
      : shift(first, mode === 'year' ? 11 : mode === 'quarter' ? 2 : 0)
  const months = periods(state, first, last),
    rows = months.flatMap((m) => m.version?.slips ?? []),
    ordered = departments(rows)
  const heading = (
    <Heading
      title="薪酬分析"
      description="查看所选区间的公司总额、部门分布和逐月明细。"
    >
      <label>
        <span className={c('sr')}>分析周期</span>
        <select
          id="analysis-mode"
          value={mode}
          onChange={(e) =>
            set({
              ...options,
              mode: e.target.value,
              ...(e.target.value === 'custom' && !options.start
                ? { start: first, end: last }
                : {}),
            })
          }
        >
          {Object.entries(modes).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {mode === 'custom' ? (
        (['start', 'end'] as const).map((key, i) => (
          <label key={key} className={c('analysis-month')}>
            {i ? '结束月份' : '起始月份'}
            <input
              id={'analysis-' + key}
              type="month"
              min="2000-01"
              max="2099-12"
              required
              value={options[key]}
              onChange={(e) => {
                if (e.target.validity.valid)
                  set({ ...options, [key]: e.target.value })
              }}
            />
          </label>
        ))
      ) : (
        <Month />
      )}
      <Button
        disabled={!rows.length}
        onClick={() =>
          download(
            '薪酬分析-' + first + (first === last ? '' : '至' + last),
            '部门薪酬',
            [
              [
                '起始月份',
                '结束月份',
                '部门',
                '涉及员工',
                '应发薪资',
                '应发后扣款',
                '实发薪资',
                '平均每人每月应发',
              ],
              ...ordered.map((d) => [
                first,
                last,
                d.name,
                d.count,
                d.gross / 100,
                d.withheld / 100,
                d.net / 100,
                Math.round(d.gross / d.n) / 100,
              ]),
            ],
          )
        }
      >
        导出分析
      </Button>
    </Heading>
  )
  if (first > last)
    return (
      <>
        {heading}
        <p className={c('statusline error')}>起始月份不能晚于结束月份。</p>
      </>
    )
  return (
    <>
      {heading}
      <p className={c('statusline')}>
        {period(first)}
        {first !== last && ' 至 ' + period(last)} · 有记录{' '}
        {months.filter((m) => m.version).length} / {months.length}{' '}
        个月。按每月最新版工资条汇总，含待发放记录。
      </p>
      <div className={c('cards')}>
        <Card
          icon="¥"
          title="应发合计"
          value={rows.length ? money(sum(rows, 'gross')) : '—'}
          hint="按所选区间汇总"
        />
        <Card
          icon="¥"
          title="实发合计"
          value={rows.length ? money(sum(rows, 'net')) : '—'}
          hint={
            '应发后扣款 ' + (rows.length ? money(sum(rows, 'withheld')) : '—')
          }
        />
        <Card
          icon="♙"
          title="涉及员工"
          value={new Set(rows.map((r) => r.id)).size + ' 人'}
          hint={'工资条共 ' + rows.length + ' 条'}
        />
        <Card
          icon="✓"
          title="签收进度"
          value="0 / 0"
          hint={
            '待签收 0 条 · 待发放 ' +
            rows.filter((r) => r.status === 'draft').length +
            ' 条'
          }
        />
      </div>
      {mode === 'month' && <Charts ordered={ordered} />}
      <Panel
        title="部门薪酬明细"
        sub="员工按工号去重，部门按工资条所属部门统计。"
      >
        <Table
          headers={[
            '部门',
            '涉及员工',
            '应发薪资',
            '应发后扣款',
            '实发薪资',
            '平均每人每月应发',
          ]}
          rows={ordered.map((d) => [
            d.name,
            d.count,
            money(d.gross),
            money(d.withheld),
            money(d.net),
            money(Math.round(d.gross / d.n)),
          ])}
          empty="所选区间暂无部门记录"
        />
      </Panel>
      <Panel title="逐月薪酬明细">
        <Table
          headers={['工资所属月', '人数', '应发薪资', '应发后扣款', '实发薪资']}
          rows={months.map((m) => [
            period(m.month),
            m.version?.slips.length ?? '无记录',
            ...(['gross', 'withheld', 'net'] as const).map((k) =>
              m.version ? money(sum(m.version.slips, k)) : '—',
            ),
          ])}
        />
      </Panel>
    </>
  )
}
