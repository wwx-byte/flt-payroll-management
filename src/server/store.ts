import { DatabaseSync } from 'node:sqlite'
import {
  existsSync,
  openSync,
  closeSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ORPCError } from '@orpc/server'
import type { PayrollState } from '../api/contract'

export function passwordHash(password: string, salt: Uint8Array) {
  return scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
}
let connection: DatabaseSync | undefined
export function database() {
  if (connection) return connection
  const directory = resolve(process.env.PAYROLL_DATA_DIR || 'data')
  const file = join(directory, 'payroll.sqlite3')
  if (
    !process.env.PAYROLL_DATA_DIR &&
    !existsSync(file) &&
    (existsSync(resolve('payroll-data/payroll.sqlite3')) ||
      existsSync(resolve('../payroll-data/payroll.sqlite3')))
  ) {
    throw new Error('发现旧版薪资数据库，请先迁移至项目内的 data。')
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  closeSync(openSync(file, 'a', 0o600))
  const db = new DatabaseSync(file, { timeout: 10_000 })
  try {
    db.exec('BEGIN IMMEDIATE')
    db.exec(
      'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1),rev INTEGER NOT NULL,value TEXT NOT NULL)',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1),salt BLOB NOT NULL,digest BLOB NOT NULL)',
    )
    db.prepare('INSERT OR IGNORE INTO state VALUES(1,0,?)').run(
      JSON.stringify({ employees: [], batches: [] }),
    )
    if (!db.prepare('SELECT id FROM account WHERE id=1').get()) {
      const login = join(directory, 'initial-login.txt')
      const password = existsSync(login)
        ? readFileSync(login, 'utf8').trimEnd().split(/\r?\n/).at(-1)!
        : randomBytes(24).toString('base64url')
      if (!existsSync(login))
        writeFileSync(login, 'admin\n' + password + '\n', {
          mode: 0o600,
          flag: 'wx',
        })
      const salt = randomBytes(16)
      db.prepare('INSERT INTO account VALUES(1,?,?)').run(
        salt,
        passwordHash(password, salt),
      )
    }
    db.exec('COMMIT')
    connection = db
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
export function readState(): { rev: number; state: PayrollState } {
  const row = database()
    .prepare('SELECT rev,value FROM state WHERE id=1')
    .get()!
  return { rev: Number(row.rev), state: JSON.parse(String(row.value)) }
}
export function saveState(rev: number, state: PayrollState) {
  const db = database()
  db.exec('BEGIN IMMEDIATE')
  try {
    const old = readState()
    if (rev !== old.rev)
      throw new ORPCError('CONFLICT', {
        message: '数据已在其他窗口更新，请刷新后重试。',
      })
    const months = new Map(state.batches.map((b) => [b.month, b.versions]))
    for (const batch of old.state.batches) {
      if (
        !isDeepStrictEqual(
          months.get(batch.month)?.slice(0, batch.versions.length),
          batch.versions,
        )
      ) {
        throw new ORPCError('BAD_REQUEST', {
          message: '已保存的工资条版本必须保留。',
        })
      }
    }
    db.prepare('UPDATE state SET rev=?,value=? WHERE id=1').run(
      rev + 1,
      JSON.stringify(state),
    )
    db.exec('COMMIT')
    return { rev: rev + 1 }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
