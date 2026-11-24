import type { Slip, Version } from '../api/contract'
import {
  Badge,
  Button,
  Department,
  Heading,
  Link,
  Month,
  Panel,
  Table,
} from './components'
import { matching, SearchPanel, type SearchProps } from './employee-search'
import { latest, money, period, revise, statuses, sum } from './model'
import { classes as c } from './styles'
import { useWorkspace } from './context'

export function SlipTable({
  rows,
  version,
  delivery,
  empty,
}: {
  rows: Slip[]
  version?: Version
  delivery: boolean
  empty?: string
}) {
  const { show, state, month, save, notify } = useWorkspace()
  return (
    <Table
      headers={[
        '员工',
        '工号',
        '部门',
        '应发',
        '应发后扣款',
        '实发',
        '状态',
        '操作',
      ]}
      empty={empty}
      rows={rows.map((row) => [
        row.name,
        row.id,
        delivery ? (
          row.dept
        ) : (
          <Department
            {...row}
            onSave={async (dept) => {
              if (!(await save(revise(state, month, row.id, { dept }))))
                return false
              notify('本月工资条部门已更新。')
              return true
            }}
          />
        ),
        money(row.gross),
        money(row.withheld),
        money(row.net),
        <Badge key="status" status={row.status} />,
        <Link
          key="detail"
          onClick={() =>
            show({
              kind: 'slip',
              version: version!,
              index: version!.slips.indexOf(row),
            })
          }
        >
          查看工资明细
        </Link>,
      ])}
    />
  )
}
export function Ledger({
  delivery,
  search,
  setSearch,
  filter,
  setFilter,
}: SearchProps & {
  delivery: boolean
  filter: string
  setFilter: (s: string) => void
}) {
  const { state, month, show } = useWorkspace(),
    version = latest(state, month),
    all = version?.slips || []
  const rows =
      delivery && filter ? all.filter((r) => r.status === filter) : all,
    found = matching(rows, search)
  const historical = all.filter((r) => r.status === 'historical').length,
    drafts = all.length - historical
  const stats = delivery
    ? '待发放 ' +
      drafts +
      ' 人　·　待签收 0 人　·　已签收 0 人' +
      (historical ? '　·　历史导入 ' + historical + ' 人' : '')
    : version
      ? '第 ' +
        version.number +
        ' 版　·　' +
        all.length +
        ' 人　·　应发 ' +
        money(sum(all, 'gross')) +
        '　·　实发 ' +
        money(sum(all, 'net'))
      : period(month)
  const terms = Object.values(search).some((s) => s.trim())
  return (
    <>
      <Heading
        title={delivery ? '工资条与签收' : '月度薪资台账'}
        description={
          delivery
            ? '查看发放进度、预览手机签字页，并查阅员工手写签名。'
            : '核对每位员工的应发、扣款及实发明细。'
        }
      >
        <Month />
        {!delivery && (
          <Button primary onClick={() => show({ kind: 'import' })}>
            导入工资表
          </Button>
        )}
      </Heading>
      {delivery && (
        <p className={c('statusline')}>
          历史导入保留工资条金额，钉钉推送与员工签收待接入。
        </p>
      )}
      <Panel
        title={delivery ? '签收明细' : '员工工资明细'}
        sub={stats}
        actions={
          <>
            {delivery && (
              <label>
                <span className={c('sr')}>签收状态</span>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">全部状态</option>
                  {Object.entries(statuses).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {version && version.number > 1 && (
              <Button onClick={() => show({ kind: 'versions' })}>
                查看历史版本
              </Button>
            )}
          </>
        }
      >
        <SearchPanel
          {...{ search, setSearch }}
          scope="payslip"
          count={
            terms
              ? '找到 ' + found.length + ' 条工资条，共 ' + rows.length + ' 条'
              : '共 ' + rows.length + ' 条工资条'
          }
        >
          <SlipTable
            rows={found}
            version={version}
            delivery={delivery}
            empty={
              terms || (delivery && filter)
                ? '没有符合条件的工资条'
                : '当前月份暂无记录'
            }
          />
        </SearchPanel>
      </Panel>
    </>
  )
}
