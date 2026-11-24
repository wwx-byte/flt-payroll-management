import { useRef, type ReactNode } from 'react'
import { Button } from './components'
import { classes as c } from './styles'

export type Search = { id: string; name: string; dept: string }
export const emptySearch: Search = { id: '', name: '', dept: '' }
const fields = { name: '姓名', id: '工号', dept: '部门' } as const
export function matching<T extends Search>(rows: T[], search: Search) {
  const normalized = (s: string) => s.normalize('NFKC').trim().toLowerCase()
  return rows.filter((row) =>
    (Object.keys(fields) as (keyof Search)[]).every((k) =>
      normalized(row[k]).includes(normalized(search[k])),
    ),
  )
}
export type SearchProps = { search: Search; setSearch: (value: Search) => void }
export function SearchPanel({
  scope,
  search,
  setSearch,
  count,
  children,
}: SearchProps & { scope: string; count: string; children: ReactNode }) {
  const first = useRef<HTMLInputElement>(null)
  return (
    <>
      <div className={c('employee-search')} role="search" aria-label="员工搜索">
        {(Object.keys(fields) as (keyof Search)[]).map((k) => (
          <label key={k}>
            {fields[k]}
            <input
              id={scope + '-search-' + k}
              aria-controls={scope + '-results'}
              ref={k === 'name' ? first : undefined}
              type="search"
              autoComplete="off"
              placeholder={'输入' + fields[k]}
              value={search[k]}
              onChange={(e) => setSearch({ ...search, [k]: e.target.value })}
            />
          </label>
        ))}
        <Button
          disabled={!Object.values(search).some(Boolean)}
          onClick={() => {
            setSearch(emptySearch)
            first.current?.focus()
          }}
        >
          清空
        </Button>
      </div>
      <p className={c('muted search-count')} role="status">
        {count}
      </p>
      <div id={scope + '-results'}>{children}</div>
    </>
  )
}
