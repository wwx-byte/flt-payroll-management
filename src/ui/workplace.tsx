import { useState, useEffect, useRef } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { PayrollState } from '../api/contract'
import { payrollClient } from '../api/client'
import { type DialogView, WorkspaceContext } from './context'
import { pages, type Page } from './model'
import { loadExcel } from './excel'
import { classes as c } from './styles'
import { Dialogs } from './dialogs'
import { Dashboard, Analysis, type AnalysisOptions } from './reports'
import { Employees } from './employees'
import { Ledger } from './payroll-ledger'
import { emptySearch } from './employee-search'

export function Workplace() {
  const [cache] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  )
  return (
    <QueryClientProvider client={cache}>
      <PayrollWorkspace />
    </QueryClientProvider>
  )
}

const snapshotKey = ['payroll', 'state'] as const

function PayrollWorkspace() {
  const cache = useQueryClient()
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: async () => {
      const [data] = await Promise.all([
        payrollClient(location.origin).read(),
        loadExcel(),
      ])
      return data
    },
  })
  const write = useMutation({
    mutationFn: (input: { rev: number; state: PayrollState }) =>
      payrollClient(location.origin).save(input),
  })
  const state = snapshot.data?.state
  const failed = snapshot.isError
  const saving = useRef(false)
  const [page, setPage] = useState<Page>('home'),
    [selectedMonth, setMonth] = useState<string>(),
    [filter, setFilter] = useState('')
  const [employees, searchEmployees] = useState(emptySearch),
    [slips, searchSlips] = useState(emptySearch)
  const [analysis, setAnalysis] = useState<AnalysisOptions>({
    mode: 'month',
    start: '',
    end: '',
  })
  const [view, setView] = useState<DialogView | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const month =
    selectedMonth ??
    state?.batches
      .map((batch) => batch.month)
      .sort()
      .at(-1) ??
    '2026-10'
  useEffect(() => {
    if (
      snapshot.error &&
      'status' in snapshot.error &&
      snapshot.error.status === 401
    )
      location.reload()
  }, [snapshot.error])
  useEffect(() => () => clearTimeout(timer.current), [])
  function notify(s: string) {
    setMessage(s)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 4600)
  }
  function go(p: Page) {
    setPage(p)
    setFilter('')
  }
  function show(v: DialogView | null) {
    setError('')
    setView(v)
  }
  async function save(next: PayrollState) {
    if (saving.current || !snapshot.data) return false
    saving.current = true
    try {
      const { rev } = await write.mutateAsync({
        rev: snapshot.data.rev,
        state: next,
      })
      cache.setQueryData(snapshotKey, { rev, state: next })
      setError('')
      return true
    } catch (e) {
      const status =
        typeof e === 'object' && e && 'status' in e ? e.status : undefined
      const text =
        status === 401
          ? '请重新登录。'
          : status === 400
            ? '保存失败，请核对工资表和员工档案后重试。'
            : e instanceof Error
              ? e.message
              : '无法保存，请检查本机服务后重试。'
      if (view) setError(text)
      else notify(text)
      return false
    } finally {
      saving.current = false
    }
  }
  const content = state ? (
    <WorkspaceContext.Provider
      value={{ state, month, setMonth, page, go, save, show, notify }}
    >
      {page === 'home' ? (
        <Dashboard />
      ) : page === 'employees' ? (
        <Employees search={employees} setSearch={searchEmployees} />
      ) : page === 'analysis' ? (
        <Analysis options={analysis} set={setAnalysis} />
      ) : (
        <Ledger
          delivery={page === 'delivery'}
          search={slips}
          setSearch={searchSlips}
          filter={filter}
          setFilter={setFilter}
        />
      )}
      {view && <Dialogs view={view} error={error} />}
    </WorkspaceContext.Provider>
  ) : (
    <p className={c('statusline' + (failed ? ' error' : ''))}>
      {failed
        ? '本机台账暂时无法读取。请检查服务并刷新页面。'
        : '正在读取本机薪资台账…'}
    </p>
  )
  return (
    <>
      <aside className={c('sidebar')}>
        <div className={c('brand')}>
          <span className={c('brandmark')} aria-hidden="true">
            ▥
          </span>
          <span>薪酬工作台</span>
        </div>
        <nav aria-label="主导航" id="nav">
          {state &&
            (Object.keys(pages) as Page[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-current={page === k ? 'page' : undefined}
                onClick={() => go(k)}
              >
                <span className={c('navicon')} aria-hidden="true">
                  {pages[k][1]}
                </span>
                {pages[k][0]}
              </button>
            ))}
        </nav>
        <div className={c('profile')}>
          <span className={c('avatar')}>HR</span>
          <div>
            <strong>人事管理员</strong>
          </div>
        </div>
      </aside>
      <main>
        <header className={c('top')}>
          <div className="breadcrumb">
            人力资源 <span aria-hidden="true">/</span>{' '}
            <strong id="crumb">{state ? pages[page][0] : ''}</strong>
          </div>
          <form method="post" action="/logout">
            <button className={c('btn logout')}>退出登录</button>
          </form>
        </header>
        <div className={c('content')} id="app">
          {content}
        </div>
      </main>
      <div id="notice" role="status" aria-live="polite">
        {message}
      </div>
    </>
  )
}
