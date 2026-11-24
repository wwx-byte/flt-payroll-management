import { useRef, useState } from 'react'
import { useWorkspace } from './context'
import { Button, Table } from './components'
import { latest, money, sum } from './model'
import { download } from './excel'
import { classes as c } from './styles'
import { sampleRows } from './sample'

type Preview = ReturnType<typeof PayrollImport.parse> & {
  name: string
  file: string
}
export function ImportDialog() {
  const { state, month, setMonth, go, save, show, notify } = useWorkspace()
  const [chosen, choose] = useState(month),
    [preview, setPreview] = useState<Preview>(),
    [error, setError] = useState('')
  const generation = useRef(0),
    picker = useRef<HTMLInputElement>(null)
  async function read(file?: File) {
    const id = ++generation.current
    setPreview(undefined)
    setError('')
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('文件超过 10 MB。')
      const named = file.name.match(
        /(20\d{2})\s*(?:年|[-_.])\s*(\d{1,2})(?=月|\D|$)/,
      )
      if (named && +named[2] >= 1 && +named[2] <= 12)
        choose(named[1] + '-' + named[2].padStart(2, '0'))
      const bytes = await file.arrayBuffer()
      if (generation.current !== id) return
      const wb = XLSX.read(bytes, { type: 'array' })
      const sheets = wb.SheetNames.map((name) => ({
        name,
        ...PayrollImport.parse(
          XLSX.utils.sheet_to_json(wb.Sheets[name], {
            header: 1,
            raw: true,
            defval: null,
          }),
        ),
      }))
      const candidates = sheets.filter(
        (s) => s.rows.length || !s.errors[0]?.startsWith('找不到表头'),
      )
      if (candidates.length > 1)
        throw Error(
          '文件内有多个工资明细工作表，请保留本次发放的单个工作表后重新导入。',
        )
      const found = candidates[0] || sheets[0]
      if (!found) throw Error('文件没有可读取的工作表。')
      const mismatches = found.rows.filter((row) =>
        state.employees.some((e) => e.id === row.id && e.name !== row.name),
      )
      if (mismatches.length)
        found.errors.push(
          mismatches.length + ' 个工号对应的姓名与档案不一致。请核对文件。',
        )
      if (found.errors.length)
        throw Error(
          found.errors.slice(0, 8).join('\n') +
            (found.errors.length > 8
              ? '\n共 ' + found.errors.length + ' 项错误'
              : ''),
        )
      setPreview({ ...found, file: file.name })
    } catch (e) {
      if (id === generation.current)
        setError(e instanceof Error ? e.message : '无法读取工资表。')
    }
  }
  async function accept() {
    if (!preview || !picker.current?.reportValidity()) return
    const next = structuredClone(state)
    for (const { id, name, dept } of preview.rows)
      if (!next.employees.some((e) => e.id === id))
        next.employees.push({ id, name, dept, history: [] })
    let batch = next.batches.find((b) => b.month === chosen)
    if (!batch) {
      batch = { month: chosen, versions: [] }
      next.batches.push(batch)
    }
    batch.versions.push({
      number: batch.versions.length + 1,
      source: preview.file,
      createdAt: new Date().toISOString(),
      slips: preview.rows.map((row) => ({ ...row, status: 'draft' })),
    })
    if (await save(next)) {
      setMonth(chosen)
      go('ledger')
      show(null)
      notify('已保存 ' + preview.rows.length + ' 条工资条。')
    }
  }
  return (
    <>
      <p className={c('statusline')}>
        适配已导入的工资表结构。核对预览后保存至本机数据库。
      </p>
      <div className={c('form-grid')}>
        <label>
          薪资所属月份
          <input
            ref={picker}
            required
            id="import-month"
            type="month"
            min="2000-01"
            max="2099-12"
            value={chosen}
            onChange={(e) => choose(e.target.value)}
          />
        </label>
        <label>
          工资表文件
          <input
            id="file"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => read(e.target.files?.[0])}
          />
        </label>
      </div>
      <div className={c('actions')}>
        <Button
          onClick={() =>
            download('虚拟工资条样表-2026年11月', '工资条', sampleRows())
          }
        >
          下载虚拟样表
        </Button>
      </div>
      <div id="import-result" aria-live="polite">
        {error && <p className={c('statusline error')}>{error}</p>}
        {preview && (
          <>
            <p className={c('statusline')}>
              工作表 {preview.name} · {preview.rows.length} 人 · 待新建档案{' '}
              {
                preview.rows.filter(
                  (r) => !state.employees.some((e) => e.id === r.id),
                ).length
              }{' '}
              人<br />
              应发 {money(sum(preview.rows, 'gross'))} · 扣款{' '}
              {money(sum(preview.rows, 'withheld'))} · 实发{' '}
              {money(sum(preview.rows, 'net'))}
            </p>
            {latest(state, chosen) && (
              <p className={c('statusline warn')}>
                保存后会生成该月新版，历史工资条和签名可继续查阅。新版需重新发放和签收。
              </p>
            )}
            <Table
              headers={['姓名', '工号', '应发', '实发']}
              rows={preview.rows
                .slice(0, 5)
                .map((r) => [r.name, r.id, money(r.gross), money(r.net)])}
            />
            <div className={c('actions signature-actions')}>
              <Button primary onClick={accept}>
                保存至月度台账
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
