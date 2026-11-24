import type {
  PayrollState,
  Slip,
  Employee,
  Standard,
  Version,
} from '../api/contract'
export const pages = {
  home: ['薪酬总览', '▦'],
  employees: ['员工薪资档案', '♙'],
  ledger: ['月度薪资台账', '▤'],
  delivery: ['工资条与签收', '✎'],
  analysis: ['薪酬分析', '▥'],
} as const
export type Page = keyof typeof pages
export const statuses = {
  draft: '待发放',
  sent: '待签收',
  signed: '已签收',
  historical: '历史导入',
}
export const money = (value: number) =>
  '¥' +
  (value / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
export const period = (value: string) =>
  value.slice(0, 4) + ' 年 ' + Number(value.slice(5)) + ' 月'
export const dateTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
export const standardAmount = (record: Standard) =>
  record.amount == null ? '待确认' : money(record.amount)
export function recentStandard(employee: Employee) {
  const recent = employee.history.reduce<Standard | undefined>(
    (best, r) => (r.date && (!best?.date || r.date >= best.date) ? r : best),
    undefined,
  )
  return recent
    ? standardAmount(recent)
    : employee.history.length
      ? '待确认'
      : '—'
}
export function shift(month: string, offset: number) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7)
}
export const latest = (state: PayrollState, month: string) =>
  state.batches.find((b) => b.month === month)?.versions.at(-1)
export function periods(state: PayrollState, start: string, end: string) {
  const result: { month: string; version?: Version }[] = []
  for (let month = start; month <= end; month = shift(month, 1))
    result.push({ month, version: latest(state, month) })
  return result
}
export type Amounts = Pick<Slip, 'gross' | 'withheld' | 'net'>
export const sum = (rows: Amounts[], field: keyof Amounts) =>
  rows.reduce((n, row) => n + row[field], 0)
export function departments(rows: Slip[]) {
  const groups = new Map<string, Slip[]>()
  for (const r of rows) {
    const group = groups.get(r.dept) || []
    group.push(r)
    groups.set(r.dept, group)
  }
  return Array.from(groups, ([name, slips]) => ({
    name,
    count: new Set(slips.map((r) => r.id)).size,
    gross: sum(slips, 'gross'),
    withheld: sum(slips, 'withheld'),
    net: sum(slips, 'net'),
    n: slips.length,
  })).sort((a, b) => b.gross - a.gross)
}
export function revise(
  state: PayrollState,
  month: string,
  id: string,
  change: { dept: string } | Amounts,
) {
  const next = structuredClone(state),
    batch = next.batches.find((b) => b.month === month)!
  const last = batch.versions.at(-1)!,
    slips = structuredClone(last.slips),
    slip = slips.find((s) => s.id === id)!
  const now = new Date().toISOString()
  if ('gross' in change)
    slip.correction = {
      at: now,
      previousVersion: last.number,
      gross: slip.gross,
      withheld: slip.withheld,
      net: slip.net,
    }
  Object.assign(slip, change)
  if (slip.status !== 'historical') slip.status = 'draft'
  delete slip.signature
  delete slip.sentAt
  batch.versions.push({
    number: last.number + 1,
    source: ('dept' in change ? '修改工资条部门' : '修改工资金额') + ' · ' + id,
    createdAt: now,
    slips,
  })
  return next
}
