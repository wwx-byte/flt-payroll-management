import type { Slip } from '../api/contract'
import workbookUrl from '../../dist/xlsx.js?url'
import parserUrl from '../../dist/import.js?url'
type ParsedSlip = Pick<
  Slip,
  'name' | 'dept' | 'id' | 'gross' | 'withheld' | 'net' | 'details'
>
interface Workbook {
  SheetNames: string[]
  Sheets: Record<string, unknown>
}
declare global {
  const XLSX: {
    read(bytes: ArrayBuffer, options: { type: 'array' }): Workbook
    utils: {
      book_new(): Workbook
      sheet_to_json(sheet: unknown, options: object): unknown[][]
      aoa_to_sheet(rows: unknown[][]): unknown
      book_append_sheet(book: Workbook, sheet: unknown, title: string): void
    }
    writeFile(book: Workbook, name: string): void
  }
  const PayrollImport: {
    parse(rows: unknown[][]): { rows: ParsedSlip[]; errors: string[] }
    groupDetails(details: Slip['details']): {
      title: string
      items: {
        title: string
        value: string | number | null
        unit: string
        subtotal: boolean
      }[]
    }[]
    cents(value: string): number
  }
}
function script(url: string) {
  return new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script')
    tag.onload = () => resolve()
    tag.onerror = () => {
      tag.remove()
      reject(new Error('工资表组件加载失败。'))
    }
    tag.src = url
    document.head.append(tag)
  })
}
let loading: Promise<void> | undefined
export function loadExcel() {
  return (loading ??= Promise.all([
    typeof XLSX === 'undefined' && script(workbookUrl),
    typeof PayrollImport === 'undefined' && script(parserUrl),
  ])
    .then(() => {})
    .catch((error) => {
      loading = undefined
      throw error
    }))
}
export function download(name: string, title: string, rows: unknown[][]) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), title)
  XLSX.writeFile(book, name + '.xlsx')
}
