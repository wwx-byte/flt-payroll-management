import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { fixture } from './server-fixture.mjs'
import { join } from 'node:path'

test('新旧页面布局和主要薪资业务流程', { timeout: 100_000 }, async (t) => {
  const { launch, password, root } = await fixture(t)
  const [oldUrl, url] = await Promise.all([launch(true), launch()])
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  })
  t.after(() => browser.close())
  const baseline = await browser.newPage(),
    page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Content Security Policy'))
      errors.push(m.text())
  })
  for (const [p, origin] of [
    [baseline, oldUrl],
    [page, url],
  ]) {
    await p.goto(origin)
    await p.getByLabel('账号').fill('admin')
    await p.getByLabel('密码').fill(password)
    await p.getByRole('button', { name: '登录', exact: true }).click()
    await expect(p.locator('h1')).toHaveText('薪酬总览')
  }
  // Compare geometry at the original desktop and mobile breakpoints.
  for (const width of [1280, 900, 700, 390]) {
    for (const p of [baseline, page])
      await p.setViewportSize({ width, height: 820 })
    for (const selector of [
      '.sidebar',
      '.brand',
      '.top',
      '.content',
      '.page-head',
      '.cards',
      '.kpi',
      '.columns',
      '.panel',
      'table',
    ]) {
      const [a, b] = await Promise.all(
        [baseline, page].map((p) => p.locator(selector).first().boundingBox()),
      )
      for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(
          Math.abs(a[key] - b[key]) < 1.5,
          `${width} ${selector} ${key}: ${a[key]} vs ${b[key]}`,
        )
    }
  }
  // The same page text can mask a lost color, typographic rule or responsive override.
  const appearance = (p) =>
    p
      .locator('#app, #app *, .sidebar, .sidebar *, .top, .top *')
      .evaluateAll((nodes) =>
        nodes.map((el) => {
          const css = getComputedStyle(el)
          return [
            el.tagName,
            ...[
              'color',
              'backgroundColor',
              'backgroundImage',
              'fontSize',
              'fontWeight',
              'borderRadius',
              'boxShadow',
              'display',
              'textAlign',
            ].map((key) => css[key]),
          ]
        }),
      )
  assert.deepEqual(await appearance(page), await appearance(baseline))
  await page.setViewportSize({ width: 1280, height: 820 })
  for (const title of [
    '员工薪资档案',
    '月度薪资台账',
    '工资条与签收',
    '薪酬分析',
  ]) {
    for (const p of [baseline, page])
      await p
        .getByRole('navigation')
        .getByRole('button', { name: title })
        .click()
    assert.equal(
      (await page.locator('#app').innerText()).replace(/\s+/g, ''),
      (await baseline.locator('#app').innerText()).replace(/\s+/g, ''),
    )
  }
  const nav = (title) =>
    page.getByRole('navigation').getByRole('button', { name: title }).click()
  const button = (name) => page.getByRole('button', { name, exact: true })
  const dialog = page.getByRole('dialog')
  const close = () =>
    dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByLabel('分析周期').selectOption('year')
  await page.getByLabel('分析周期').selectOption('custom')
  await expect(page.getByLabel('起始月份')).toHaveValue('2026-01')
  await expect(page.getByLabel('结束月份')).toHaveValue('2026-12')
  await expect(page.locator('#app')).toContainText('有记录 1 / 12 个月')
  const firstDownload = page.waitForEvent('download')
  await button('导出分析').click()
  assert.match(
    (await firstDownload).suggestedFilename(),
    /2026-01至2026-12.xlsx/,
  )
  await nav('员工薪资档案')
  await button('新增员工').click()
  for (const [label, val] of [
    ['工号', 'T2'],
    ['姓名', '新员工'],
    ['部门', '新部门'],
  ])
    await dialog.getByLabel(label, { exact: true }).fill(val)
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
  await page.getByPlaceholder('输入工号').fill('T2')
  await expect(page.locator('.search-count')).toContainText('找到 1 位员工')
  await button('查看薪资记录').click()
  await button('新增薪资记录').click()
  await dialog.getByLabel('生效日期').fill('2026-10-01')
  await dialog.getByLabel('月薪（元）').fill('4300.01')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toContainText('4,300.01')
  await close()
  await expect(page.getByPlaceholder('输入工号')).toHaveValue('T2')
  await button('清空').click()
  await page.getByPlaceholder('输入工号').fill('TEST-001')
  await page
    .getByRole('button', { name: '测试员工的部门：测试部门，点击编辑' })
    .click()
  await page.locator('.inline-dept-form input').fill('新档案部门')
  await page
    .locator('.inline-dept-form')
    .getByRole('button', { name: '保存' })
    .click()
  await expect(
    page.getByRole('button', { name: '测试员工的部门：新档案部门，点击编辑' }),
  ).toBeVisible()
  await button('薪资汇总').click()
  await expect(dialog).toContainText('有记录 1 个月，缺记录 11 个月')
  await dialog.locator('[data-edit-field=gross]').click()
  await dialog.getByLabel('应发（元）', { exact: true }).fill('1300')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toContainText('第 2 版')
  const rangeExport = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出 Excel' }).click()
  assert.match(
    (await rangeExport).suggestedFilename(),
    /TEST-001.*2026-10.xlsx/,
  )
  await close()
  await nav('月度薪资台账')
  await page
    .getByRole('button', { name: '测试员工的部门：测试部门，点击编辑' })
    .click()
  await page.locator('.inline-dept-form input').fill('工资表部门')
  await page
    .locator('.inline-dept-form')
    .getByRole('button', { name: '保存' })
    .click()
  await expect(
    page.getByRole('button', { name: '测试员工的部门：工资表部门，点击编辑' }),
  ).toBeVisible()
  await button('查看历史版本').click()
  await dialog.getByRole('button', { name: '查看员工工资条' }).first().click()
  await dialog.getByRole('button', { name: '查看详情' }).click()
  await expect(dialog).toContainText('历史工资条')
  await expect(dialog).toContainText('1,234.56')
  await close()
  await button('导入工资表').click()
  await dialog.getByLabel('工资表文件').setInputFiles({
    name: '无效.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('a,b,c\n1,2,3'),
  })
  await expect(dialog).toContainText('找不到表头')
  const sample = page.waitForEvent('download')
  await button('下载虚拟样表').click()
  const file = join(root, '2026年11月样表.xlsx')
  await (await sample).saveAs(file)
  await dialog.getByLabel('工资表文件').setInputFiles(file)
  await expect(dialog).toContainText('待新建档案 2 人')
  await button('保存至月度台账').click()
  await expect(page.locator('#month')).toHaveValue('2026-11')
  await expect(page.locator('#app')).toContainText('DEMO-001')
  await nav('工资条与签收')
  await page.getByLabel('签收状态').selectOption('historical')
  await expect(page.locator('#app')).toContainText('没有符合条件的工资条')
  await page.getByLabel('签收状态').selectOption('draft')
  await page.getByRole('button', { name: '查看工资明细' }).first().click()
  await expect(dialog.getByRole('button', { name: '提交签收' })).toBeDisabled()
  await close()
  await page.reload()
  await expect(page.locator('h1')).toHaveText('薪酬总览')
  await expect(page.locator('#month')).toHaveValue('2026-11')
  await button('退出登录').click()
  await expect(page.getByLabel('账号')).toBeVisible()
  assert.deepEqual(errors, [])
})
