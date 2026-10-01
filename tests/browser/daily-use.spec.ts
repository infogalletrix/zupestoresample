import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test('daily workflows, responsive screens, search, dates, payments and theme', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Hosting setup token')).toBeVisible();
  await page.getByRole('button', { name: 'Explore demo workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your store, at a glance.' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const folder = `artifacts/browser-screenshots/${info.project.name}`;
  mkdirSync(folder, { recursive: true });
  for (const route of [
    'dashboard',
    'orders',
    'shipments',
    'products',
    'suppliers',
    'expenses',
    'payments',
    'rto',
    'reports',
    'customers',
    'settings',
  ]) {
    await page.evaluate((route) => {
      location.hash = `#/${route}`;
    }, route);
    const label =
      ({ dashboard: 'Overview', rto: 'RTO refund balance' } as Record<string, string>)[route] ||
      route[0].toUpperCase() + route.slice(1);
    await expect(page.locator('.breadcrumb strong')).toHaveText(label);
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('main .skeleton-layout')).toHaveCount(0);
    if (route === 'settings') await expect(page.getByText('Loading settings…')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBeTruthy();
    await page.screenshot({ path: `${folder}/${route}.png` });
  }
  const workspace = await (await page.request.get('/api/workspace')).json();
  const product = workspace.products[0];
  const search = page.getByRole('combobox', { name: 'Search workspace' });
  await search.fill(product.name);
  await page
    .getByRole('option')
    .filter({ hasText: product.name })
    .filter({ hasText: 'Product' })
    .click();
  await expect(page.locator('.table-toolbar input').first()).toHaveValue(product.sku);
  await page.locator('.table-toolbar input').first().fill('');
  await expect(page.locator('tbody tr')).toHaveCount(workspace.products.length);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `${folder}/dark-products.png` });
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Light mode', exact: true }).click();
  await page.evaluate(() => {
    location.hash = '#/dashboard';
  });
  await page.getByRole('button', { name: /Delivery issues/ }).click();
  await expect(page.getByRole('button', { name: 'All time' })).toBeVisible();
  await expect(page.locator('main .active-search')).toContainText('Delivery issues');
  const order = workspace.orders.find(
    (o: { method: string; cod_pending: number }) => o.method === 'COD' && o.cod_pending > 100,
  );
  const headers = { 'X-Requested-With': 'CommerceWorkspace', Origin: 'http://127.0.0.1:3006' };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await page.evaluate(() => {
    location.hash = '#/payments';
  });
  for (const action of ['complete', 'cancel']) {
    const reference = `Browser-${info.project.name}-${action}-${Date.now()}`;
    const response = await page.request.post('/api/payments', {
      headers,
      data: {
        order_id: order.id,
        date,
        kind: 'COD remittance',
        amount: 1,
        status: 'Pending',
        reference,
        idempotency_key: reference,
      },
    });
    expect(response.status()).toBe(201);
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await page.locator('.tabs').getByRole('button', { name: 'Pending', exact: true }).click();
    await page.locator('.table-toolbar input').fill(reference);
    const row = page.locator('tbody tr').filter({ hasText: reference });
    if (action === 'complete') {
      await row.getByRole('button', { name: 'Complete', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('₹0.01');
      await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
    } else {
      await row.getByRole('button', { name: `Cancel pending payment ${reference}` }).click();
      await page.getByLabel('Reason for cancellation').fill('Browser test: payment was never sent');
      await page.getByRole('button', { name: 'Cancel this payment' }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page
      .locator('.tabs')
      .getByRole('button', { name: action === 'complete' ? 'Completed' : 'Cancelled', exact: true })
      .click();
    await expect(page.locator('tbody tr').filter({ hasText: reference })).toBeVisible();
  }
  await page.getByRole('button', { name: 'All time' }).click();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await page.locator('.date-button').click();
  const from = page.getByLabel('From', { exact: true });
  expect(await from.inputValue()).not.toBe('2000-01-01');
  await page.keyboard.press('Escape');
  await expect(page.locator('.date-popover')).toHaveCount(0);
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  }
  await page.evaluate(() => {
    location.hash = '#/payments';
  });
  await page.locator('.tabs').getByRole('button', { name: 'Reconciliation', exact: true }).click();
  await page.getByRole('button', { name: 'Import report', exact: true }).click();
  const ref = `REPORT-${info.project.name}-${Date.now()}`;
  const csv = `Order ID,UTR,Remittance Date,COD Amount,Payment Status\n${order.number},${ref},${date},0.01,Remitted`;
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'remittances.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Preview and validate', exact: true }).click();
  await expect(page.getByText('1 ready.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 rows', exact: true }).click();
  await expect(page.getByText('1 payments posted', { exact: false })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: ref })).toContainText('Posted');
  await page.locator('.report-toolbar').scrollIntoViewIfNeeded();
  const reportLayout = await page.locator('.report-toolbar').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth };
  });
  expect(reportLayout.left).toBeGreaterThanOrEqual(0);
  expect(reportLayout.right).toBeLessThanOrEqual(reportLayout.width);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBeTruthy();
  await page.screenshot({ path: `${folder}/reconciliation.png` });
  expect(errors).toEqual([]);
});
