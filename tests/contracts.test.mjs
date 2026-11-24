import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './server-fixture.mjs'

test('Python / Node SQLite、认证、版本和事务兼容', async (t) => {
  const { launch, password, sync } = await fixture(t)
  const origin = await launch()
  const form = (path, fields, cookie, originHeader = origin) =>
    fetch(origin + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: originHeader, cookie: cookie || '' },
      body: new URLSearchParams(fields),
    })
  assert.equal((await fetch(origin + '/api/state')).status, 401)
  assert.equal(
    (
      await form(
        '/login',
        { username: 'admin', password },
        '',
        'https://invalid.example',
      )
    ).status,
    403,
  )
  const alternate = new URL(origin)
  alternate.hostname = 'localhost'
  for (const scheme of ['http:', 'https:']) {
    const browserOrigin = scheme + '//' + alternate.host
    const response = await fetch(new URL('/login', alternate), {
      method: 'POST',
      redirect: 'manual',
      headers: {
        origin: browserOrigin,
        'x-forwarded-proto': scheme.slice(0, -1),
      },
      body: new URLSearchParams({ username: 'admin', password }),
    })
    assert.equal(response.status, 303)
    assert.equal(
      response.headers.get('set-cookie').includes('; Secure'),
      scheme === 'https:',
    )
  }
  const denied = await form('/login', {
    username: 'admin',
    password: 'invalid',
  })
  assert.equal(denied.status, 401)
  assert.match(await denied.text(), /账号或密码不正确/)
  const login = await form('/login', { username: 'admin', password })
  assert.equal(login.status, 303)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const read = async () =>
    (await fetch(origin + '/api/state', { headers: { cookie } })).json()
  const save = (body) =>
    fetch(origin + '/api/state', {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const original = await read()
  assert.equal(original.rev, 1)
  assert.equal(original.state.batches[0].versions[0].slips[0].net, 100000)
  const bad = structuredClone(original)
  bad.state.batches[0].versions[0].slips[0].dept = '错误的历史修改'
  assert.equal((await save(bad)).status, 400)
  const invalid = structuredClone(original)
  invalid.state.employees.push(invalid.state.employees[0])
  assert.equal((await save(invalid)).status, 400)
  const next = structuredClone(original)
  next.state.employees[0].history.push({
    type: '初始标准',
    date: null,
    amount: null,
    source: { file: 'test.xlsx', row: 3 },
    details: [['补贴', null]],
  })
  const writes = await Promise.all([save(next), save(next)])
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409])
  assert.equal((await read()).rev, 2)
  const slip = original.state.batches[0].versions[0].slips[0]
  const batch = {
    month: '2026-11',
    source: 'test2.xlsx',
    checksum: 'test2',
    slips: [slip],
  }
  assert.equal(sync([batch]).imported.length, 1)
  assert.equal(sync([batch]).imported.length, 0)
  assert.equal((await read()).state.batches.length, 2)
  assert.equal((await form('/logout', {}, cookie)).status, 303)
  assert.equal(
    (await fetch(origin + '/api/state', { headers: { cookie } })).status,
    401,
  )
})
