import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  copyFile,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((r) => server.close(r))
  return port
}
export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'flt-payroll-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'scripts'))
  for (const name of [
    'storage.py',
    'server.py',
    'scripts/import-payroll-batches.py',
  ])
    await copyFile(name, join(root, name))
  await symlink(resolve('dist'), join(root, 'dist'))
  const data = join(root, 'payroll-data')
  const python = execFileSync('uv', ['python', 'find', '3.12'], {
    encoding: 'utf8',
  }).trim()
  function sync(batches) {
    return JSON.parse(
      execFileSync(python, ['scripts/import-payroll-batches.py'], {
        cwd: root,
        input: JSON.stringify(batches),
        encoding: 'utf8',
      }),
    )
  }
  const slip = {
    id: 'TEST-001',
    name: '测试员工',
    dept: '测试部门',
    gross: 123456,
    withheld: 23456,
    net: 100000,
    details: [['基本工资', 1234.56]],
    status: 'historical',
  }
  sync([
    { month: '2026-10', source: 'test.xlsx', checksum: 'test', slips: [slip] },
  ])
  const password = (await readFile(join(data, 'initial-login.txt'), 'utf8'))
    .trim()
    .split('\n')[1]
  async function launch(legacy = false) {
    const port = await freePort(),
      origin = 'http://127.0.0.1:' + port
    const child = legacy
      ? spawn(python, ['server.py', '--port', String(port)], {
          cwd: root,
          stdio: ['ignore', 'ignore', 'inherit'],
        })
      : spawn(process.execPath, ['scripts/start.mjs'], {
          env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            PAYROLL_ORIGIN: origin,
            PAYROLL_DATA_DIR: data,
          },
          stdio: ['ignore', 'ignore', 'inherit'],
        })
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const end = once(child, 'exit')
        child.kill()
        await end
      }
    })
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error('测试服务启动失败')
      try {
        const res = await fetch(origin)
        if (!res.ok) throw Error('HTTP ' + res.status)
        return origin
      } catch {
        await delay(50)
      }
    }
    throw Error('测试服务未就绪')
  }
  return { launch, password, sync, root }
}
