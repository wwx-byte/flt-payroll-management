import { oc } from '@orpc/contract'
import { z } from 'zod'

const cents = z.int()
const month = z.string().regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/)
const text = z.string().refine((value) => value.trim().length > 0)
const details = z.array(
  z.tuple([z.string(), z.union([z.string(), z.number(), z.null()])]),
)
const source = z.looseObject({ file: z.string(), row: z.int().min(3) })
const standard = z
  .looseObject({
    type: z.enum(['试用期', '转正', '调薪', '初始标准']),
    date: z.string().nullable(),
    amount: cents.nonnegative().nullable(),
    source: source.optional(),
    details: details.optional(),
    note: z.string().optional(),
  })
  .refine((record) => {
    if (record.source && !record.details) return false
    if (record.amount === null && !record.source) return false
    if (record.date === null) return Boolean(record.source)
    return (
      z.iso.date().safeParse(record.date).success ||
      Boolean(record.source && month.safeParse(record.date).success)
    )
  })
const employee = z.looseObject({
  id: text,
  name: text,
  dept: text,
  history: z.array(standard),
})
const slip = z
  .looseObject({
    id: text,
    name: text,
    dept: z.string(),
    gross: cents,
    withheld: cents,
    net: cents,
    status: z.enum(['draft', 'historical']),
    details,
    sourceEmployeeId: z.string().optional(),
    correction: z
      .looseObject({
        previousVersion: cents,
        gross: cents,
        withheld: cents,
        net: cents,
        at: z.string(),
        reason: z.string().optional(),
      })
      .optional(),
  })
  .refine((row) => {
    const difference =
      BigInt(row.gross) - BigInt(row.withheld) - BigInt(row.net)
    return difference >= -1n && difference <= 1n
  })

const version = z.looseObject({
  number: z.int().positive(),
  slips: z.array(slip).min(1),
  source: z.string(),
  createdAt: z.string(),
})
const batch = z.looseObject({ month, versions: z.array(version).min(1) })
export const payrollState = z
  .looseObject({ employees: z.array(employee), batches: z.array(batch) })
  .refine((state) => {
    const names = new Map(state.employees.map((row) => [row.id, row.name]))
    return (
      names.size === state.employees.length &&
      new Set(state.batches.map((row) => row.month)).size ===
        state.batches.length &&
      state.batches.every((b) =>
        b.versions.every(
          (v, i) =>
            v.number === i + 1 &&
            new Set(v.slips.map((row) => row.id)).size === v.slips.length &&
            v.slips.every((row) => names.get(row.id) === row.name),
        ),
      )
    )
  })
export type PayrollState = z.infer<typeof payrollState>
export type Employee = PayrollState['employees'][number]
export type Version = PayrollState['batches'][number]['versions'][number]
export type Slip = Version['slips'][number]
export type Standard = Employee['history'][number]
const revision = z.object({ rev: z.int().nonnegative() })
const snapshot = revision.extend({ state: payrollState })
const operation = oc.errors({
  UNAUTHORIZED: { status: 401 },
  SERVICE_UNAVAILABLE: { status: 503 },
})
export const contract = {
  read: operation.route({ method: 'GET', path: '/state' }).output(snapshot),
  save: operation
    .errors({ CONFLICT: { status: 409 }, BAD_REQUEST: { status: 400 } })
    .route({ method: 'POST', path: '/state' })
    .input(snapshot)
    .output(revision),
}
