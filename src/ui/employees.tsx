import type { Employee } from '../api/contract'
import { Button, Department, Heading, Link, Panel, Table } from './components'
import { matching, SearchPanel, type SearchProps } from './employee-search'
import { recentStandard } from './model'
import { useWorkspace } from './context'

export function EmployeeDept({ employee }: { employee: Employee }) {
  const { state, save, notify } = useWorkspace()
  return (
    <Department
      {...employee}
      onSave={async (dept) => {
        const next = structuredClone(state)
        next.employees.find((e) => e.id === employee.id)!.dept = dept
        if (!(await save(next))) return false
        notify('员工部门已更新。')
        return true
      }}
    />
  )
}
export function Employees({ search, setSearch }: SearchProps) {
  const { state, show } = useWorkspace()
  const rows = matching(state.employees, search),
    terms = Object.values(search).some((s) => s.trim())
  return (
    <>
      <Heading
        title="员工薪资档案"
        description="查看试用期、转正和历次调薪记录。"
      >
        <Button primary onClick={() => show({ kind: 'addEmployee' })}>
          新增员工
        </Button>
      </Heading>
      <Panel title="员工列表">
        <SearchPanel
          {...{ search, setSearch }}
          scope="employee"
          count={
            terms
              ? '找到 ' +
                rows.length +
                ' 位员工，共 ' +
                state.employees.length +
                ' 位'
              : '共 ' + rows.length + ' 位员工'
          }
        >
          <Table
            headers={['工号', '姓名', '部门', '最近薪资', '操作']}
            empty="没有找到匹配的员工"
            rows={rows.map((e) => [
              e.id,
              e.name,
              <EmployeeDept key="department" employee={e} />,
              recentStandard(e),
              <>
                <Link onClick={() => show({ kind: 'history', id: e.id })}>
                  查看薪资记录
                </Link>
                　
                <Link onClick={() => show({ kind: 'range', id: e.id })}>
                  薪资汇总
                </Link>
              </>,
            ])}
          />
        </SearchPanel>
      </Panel>
    </>
  )
}
