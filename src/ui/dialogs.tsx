import { useEffect, useRef, type ReactNode, type PointerEvent } from 'react'
import type { Slip, Version } from '../api/contract'
import { type DialogView, useWorkspace } from './context'
import { Badge, Button, Link, Table, Totals } from './components'
import { EmployeeForm, History } from './employee-dialogs'
import { ImportDialog } from './import-dialog'
import { PayRange } from './pay-range'
import { classes as c } from './styles'
import { dateTime, latest, money, period } from './model'

function SignaturePreview() {
  const canvas = useRef<HTMLCanvasElement>(null),
    pointer = useRef<number | null>(null)
  function stroke(e: PointerEvent<HTMLCanvasElement>, begin: boolean) {
    const el = e.currentTarget,
      ctx = el.getContext('2d')
    if (!ctx) return
    const bounds = el.getBoundingClientRect(),
      x = ((e.clientX - bounds.left) * el.width) / bounds.width,
      y = ((e.clientY - bounds.top) * el.height) / bounds.height
    if (begin) {
      if (e.button !== 0 || pointer.current !== null) return
      pointer.current = e.pointerId
      el.setPointerCapture(e.pointerId)
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#172d54'
      ctx.beginPath()
      ctx.moveTo(x, y)
    } else if (pointer.current === e.pointerId) {
      ctx.lineTo(x, y)
      ctx.stroke()
    }
  }
  return (
    <>
      <hr />
      <h3>手写签字</h3>
      <p className={c('muted')}>员工端签字区域预览。接入钉钉后可提交。</p>
      <canvas
        ref={canvas}
        className={c('signature')}
        aria-label="手写签字区"
        width={720}
        height={240}
        onPointerDown={(e) => stroke(e, true)}
        onPointerMove={(e) => stroke(e, false)}
        onLostPointerCapture={() => {
          pointer.current = null
        }}
      />
      <div className={c('actions signature-actions')}>
        <Button
          onClick={() =>
            canvas.current?.getContext('2d')?.clearRect(0, 0, 720, 240)
          }
        >
          清空重签
        </Button>
        <Button primary disabled onClick={() => {}}>
          提交签收
        </Button>
      </div>
    </>
  )
}
function SlipPreview({
  version,
  row,
  archived,
}: {
  version: Version
  row: Slip
  archived: boolean
}) {
  const { month } = useWorkspace(),
    groups = PayrollImport.groupDetails(row.details),
    correction = row.correction
  return (
    <>
      <p className={c('muted')}>
        {period(month)} · 第 {version.number} 版{archived ? ' · 历史版本' : ''}{' '}
        · {row.name} / {row.id} · {row.dept}
      </p>
      {row.sourceEmployeeId && (
        <p className={c('muted')}>原表工号 {row.sourceEmployeeId}</p>
      )}
      <Totals row={row} />
      {correction?.reason && (
        <div className={c('statusline')}>
          <strong>金额更正</strong>
          <br />
          原为第 {correction.previousVersion} 版：应发 {money(correction.gross)}{' '}
          · 应发后扣款 {money(correction.withheld)} · 实发{' '}
          {money(correction.net)}
          <br />
          更正时间 {dateTime(correction.at)}
          <br />
          原因：{correction.reason}
        </div>
      )}
      {correction && <h3>原工资表分项</h3>}
      {groups.length ? (
        <div className={c('slip-groups')}>
          {groups.map((g) => (
            <section key={g.title} className={c('slip-group')}>
              <h3>{g.title}</h3>
              <dl className={c('slip-fields')}>
                {g.items.map((item, i) => (
                  <div
                    key={i}
                    className={item.subtotal ? 'subtotal' : undefined}
                  >
                    <dt>{item.title}</dt>
                    <dd>
                      {typeof item.value === 'number'
                        ? item.unit === '元'
                          ? money(Math.round(item.value * 100))
                          : item.value.toLocaleString('zh-CN', {
                              maximumFractionDigits: 4,
                            }) + (item.unit ? ' ' + item.unit : '')
                        : (item.value ?? '—')}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : (
        <p className={c('muted')}>该工资条没有保存分项明细。</p>
      )}
      {typeof row.sentAt === 'string' && (
        <p className={c('muted')}>模拟发放时间 {dateTime(row.sentAt)}</p>
      )}
      {!archived && <SignaturePreview />}
    </>
  )
}
export function Dialogs({ view, error }: { view: DialogView; error: string }) {
  const { state, month, show } = useWorkspace()
  const modal = useRef<HTMLDialogElement>(null),
    alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = modal.current!
    el.showModal()
    return () => el.close()
  }, [])
  useEffect(() => {
    if (error) alert.current?.scrollIntoView({ block: 'nearest' })
  }, [error])
  let title: string, content: ReactNode
  switch (view.kind) {
    case 'import':
      title = '导入本地工资表'
      content = <ImportDialog />
      break
    case 'addEmployee':
      title = '新增员工'
      content = <EmployeeForm />
      break
    case 'addHistory':
    case 'history':
    case 'range': {
      const employee = state.employees.find((e) => e.id === view.id)!
      title =
        view.kind === 'history'
          ? '薪资档案 · ' + employee.name
          : view.kind === 'range'
            ? '薪资汇总 · ' + employee.name
            : '新增薪资记录'
      content =
        view.kind === 'history' ? (
          <History employee={employee} />
        ) : view.kind === 'range' ? (
          <PayRange employee={employee} />
        ) : (
          <EmployeeForm employee={employee} />
        )
      break
    }
    case 'versions': {
      title = '历史工资条版本'
      const versions = state.batches.find((b) => b.month === month)!.versions
      content = (
        <Table
          headers={['版本', '保存时间', '来源', '操作']}
          rows={versions.map((v) => [
            '第 ' + v.number + ' 版',
            dateTime(v.createdAt),
            v.source,
            <Link
              key="version"
              onClick={() => show({ kind: 'version', version: v })}
            >
              查看员工工资条
            </Link>,
          ])}
        />
      )
      break
    }
    case 'version':
      title = '第 ' + view.version.number + ' 版 · 工资条'
      content = (
        <Table
          headers={['员工', '工号', '实发合计', '签收情况', '操作']}
          rows={view.version.slips.map((r, index) => [
            r.name,
            r.id,
            money(r.net),
            <Badge key="status" status={r.status} />,
            <Link
              key="detail"
              onClick={() =>
                show({ kind: 'slip', version: view.version, index })
              }
            >
              查看详情
            </Link>,
          ])}
        />
      )
      break
    case 'slip': {
      const archived = latest(state, month)?.number !== view.version.number
      title = archived ? '历史工资条' : '手机签字页预览'
      content = (
        <SlipPreview
          version={view.version}
          row={view.version.slips[view.index]}
          archived={archived}
        />
      )
    }
  }
  return (
    <dialog
      id="modal"
      ref={modal}
      aria-labelledby="modal-title"
      onCancel={() => show(null)}
    >
      <div className={c('dialog-head')}>
        <h2 id="modal-title">{title}</h2>
        <Button onClick={() => show(null)}>关闭</Button>
      </div>
      <div className={c('dialog-body')}>
        {error && (
          <p
            ref={alert}
            className={c('statusline error save-error')}
            role="alert"
          >
            {error}
          </p>
        )}
        {content}
      </div>
    </dialog>
  )
}
