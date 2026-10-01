import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insert, now, id } from '../server/db.mjs';
import { createOrder, workspace, today, recordPayment, collectCod } from '../server/domain.mjs';
import {
  importRows,
  previewRows,
  readReport,
  parseMoney,
  retrySettlements,
} from '../server/settlements.mjs';
import { createIntegrationService } from '../server/integrations.mjs';
import { createReportService, downloadReport } from '../server/report-service.mjs';
import ExcelJS from 'exceljs';

function fixture(t, status = 'Delivered') {
  const db = openDb(':memory:');
  t.after(() => db.close());
  insert(db, 'suppliers', { id: 'supplier', name: 'Supplier A', created_at: now() });
  insert(db, 'products', {
    id: 'product',
    name: 'Lamp',
    sku: 'LAMP',
    supplier_id: 'supplier',
    cost: 50000,
    price: 100000,
    stock: 100,
  });
  const order = createOrder(
    db,
    {
      date: today(),
      customer: 'Report Customer',
      method: 'COD',
      status,
      shipping_cost: 10000,
      items: [{ product_id: 'product', quantity: 1, price: 100000 }],
    },
    'owner',
  );
  insert(db, 'shipments', {
    id: id(),
    order_id: order.id,
    awb: '1234567890123',
    status,
    updated_at: now(),
    status_at: now(),
  });
  const row = {
    'Order ID': order.number,
    AWB: '1234567890123',
    UTR: 'BANK-001',
    'Remittance Date': today(),
    'COD Amount': '1000',
    'Bank Amount': '890',
    'Settlement Fees': '10',
    'Shipping Deduction': '100',
    'Payment Status': 'Remitted',
  };
  return { db, order, row };
}
test('COD report clears gross receivable but records net bank and fees exactly once', (t) => {
  const { db, order, row } = fixture(t);
  assert.equal(previewRows(db, [row])[0].status, 'Ready');
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payments WHERE kind='COD remittance'").get().n,
    0,
  );
  assert.deepEqual(importRows(db, [row]), { posted: 1, review: 0, pending: 0, duplicate: 0 });
  assert.equal(importRows(db, [row]).duplicate, 1);
  const data = workspace(db),
    o = data.orders.find((o) => o.id === order.id);
  assert.equal(o.cod_pending, 0);
  assert.equal(data.paymentMetrics.bankReceived, 89000);
  assert.equal(data.paymentMetrics.deductions, 11000);
  assert.equal(o.net_profit, 39000);
  assert.equal(data.metrics.grossProfit, 40000);
  assert.equal(data.metrics.netProfit, 39000);
  assert.equal(data.products[0].profit, 39000);
  assert.equal(data.credit.balance, 0);
});
test('conflicting references, mismatched amounts, AWBs and overpayments require review', (t) => {
  const { db, row } = fixture(t);
  assert.equal(importRows(db, [{ ...row, 'Bank Amount': '900' }]).review, 1);
  assert.equal(importRows(db, [{ ...row, AWB: 'different' }]).review, 1);
  assert.equal(importRows(db, [row]).posted, 1);
  assert.equal(
    importRows(db, [{ ...row, 'Bank Amount': '880', 'Settlement Fees': '20' }]).review,
    1,
  );
  assert.equal(importRows(db, [{ ...row, UTR: 'BANK-002' }]).review, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payments WHERE kind='COD remittance'").get().n,
    1,
  );
});
test('pending manual reservations and unverified deductions are not silently overwritten', (t) => {
  const { db, order, row } = fixture(t);
  recordPayment(
    db,
    {
      order_id: order.id,
      date: today(),
      kind: 'COD remittance',
      amount: 100,
      status: 'Pending',
      reference: 'pending',
      idempotency_key: id(),
    },
    'owner',
  );
  assert.equal(importRows(db, [row]).review, 1);
  db.prepare('UPDATE orders SET shipping_verified=0 WHERE id=?').run(order.id);
  assert.equal(importRows(db, [{ ...row, 'COD Amount': '500', 'Bank Amount': '390' }]).review, 1);
});
test('report arriving before delivery is retried after COD collection', (t) => {
  const { db, order, row } = fixture(t, 'Shipped');
  assert.equal(importRows(db, [row]).review, 1);
  db.prepare("UPDATE orders SET status='Delivered' WHERE id=?").run(order.id);
  collectCod(db, order.id);
  assert.equal(retrySettlements(db).posted, 1);
  assert.equal(retrySettlements(db).posted, 0);
});
test('provider pending state never clears a receivable and missing status requires explicit confirmation', (t) => {
  const { db, row } = fixture(t);
  assert.equal(importRows(db, [{ ...row, 'Payment Status': 'Pending' }]).pending, 1);
  assert.equal(workspace(db).metrics.codPending, 100000);
  const noStatus = { ...row };
  delete noStatus['Payment Status'];
  assert.equal(previewRows(db, [noStatus])[0].status, 'Review');
  assert.equal(importRows(db, [noStatus], { completedOnly: true }).posted, 1);
});
test('CSV and XLSX preserve references, handle quoted fields, require precise INR and valid dates', async (t) => {
  const { db, row } = fixture(t);
  const csv =
    'Order ID,UTR,Remittance Date,COD Amount,Payment Status\r\n"' +
    row['Order ID'] +
    '","BANK,""ONE""",' +
    today() +
    ',"1,000.00",Remitted\r\n';
  const report = await readReport(Buffer.from(csv));
  assert.equal(report.rows[0].UTR, 'BANK,"ONE"');
  assert.equal(previewRows(db, report.rows)[0].gross, 100000);
  await assert.rejects(readReport(Buffer.from('a,a\n1,2')), /unique/);
  await assert.rejects(readReport(Buffer.from('a,b\n"open,2')), /unclosed/);
  assert.throws(() => parseMoney('1e3'));
  assert.throws(() => parseMoney('-10'));
  assert.throws(() => parseMoney('1.001'));
  assert.equal(previewRows(db, [{ ...row, 'Remittance Date': '31/02/2026' }])[0].status, 'Review');
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('Remittances');
  ws.addRow(Object.keys(row));
  ws.addRow(Object.values(row));
  const x = await readReport(Buffer.from(await wb.xlsx.writeBuffer()), 'report.xlsx');
  assert.equal(previewRows(db, x.rows)[0].status, 'Ready');
});
test('native report webhook persists, validates its token, processes asynchronously and deduplicates', async (t) => {
  const { db, row } = fixture(t);
  const crypto = { encrypt: JSON.stringify, decrypt: JSON.parse };
  const integrations = createIntegrationService(db, crypto);
  const service = createReportService(db, integrations);
  const cfg = service.save(
    { enabled: true, mapping: {}, completedOnly: false, dateFormat: 'DMY', allowedHosts: [] },
    'owner',
  );
  const token = cfg.webhookUrl.split('/').pop(),
    body = Buffer.from(JSON.stringify({ rows: [row] }));
  assert.throws(() => service.receive('bad', body, 'application/json'), /Invalid/);
  assert.equal(
    service.receive(token, body, 'application/json'),
    service.receive(token, body, 'application/json'),
  );
  assert.equal(workspace(db).metrics.codPending, 100000);
  await integrations.processWebhooks(); // Tracking worker must not consume report events.
  await service.process();
  assert.equal(workspace(db).metrics.codPending, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM webhook_events WHERE status='processed'").get().n,
    1,
  );
  service.save({ enabled: true, rotateToken: true }, 'owner');
  assert.throws(() => service.receive(token, body), /Invalid/);
});
test('report download rejects non-HTTPS, private hosts and unapproved origins before fetching', async () => {
  await assert.rejects(
    downloadReport('http://example.com/file.csv', ['example.com']),
    /not approved/,
  );
  await assert.rejects(downloadReport('https://127.0.0.1/file.csv', []), /not approved/);
  await assert.rejects(
    downloadReport('https://127.0.0.1/file.csv', ['127.0.0.1']),
    /public internet/,
  );
  await assert.rejects(
    downloadReport('https://user:pass@example.com/file.csv', ['example.com']),
    /not approved/,
  );
});

test('a gross-only remittance never invents a bank receipt', (t) => {
  const { db, order } = fixture(t);
  const row = {
    'Order ID': order.number,
    UTR: 'GROSS-ONLY',
    'Remittance Date': today(),
    'Gross Amount': '1000',
    'Payment Status': 'Remitted',
  };
  assert.equal(importRows(db, [row]).posted, 1);
  const data = workspace(db);
  assert.equal(data.metrics.codPending, 0);
  assert.equal(data.paymentMetrics.bankReceived, 0);
  assert.equal(data.paymentMetrics.bankUnverified, 100000);
});

test('partial settlements cannot deduct the same shipping cost twice', (t) => {
  const { db, row } = fixture(t);
  const partial = { ...row, 'COD Amount': '500', 'Bank Amount': '400', 'Settlement Fees': '0' };
  assert.equal(importRows(db, [partial]).posted, 1);
  assert.equal(importRows(db, [{ ...partial, UTR: 'SECOND-PAYOUT' }]).review, 1);
});

test('one UTR can allocate two distinct shipment payouts without losing or duplicating money', (t) => {
  const { db, order, row } = fixture(t);
  insert(db, 'shipments', {
    id: id(),
    order_id: order.id,
    awb: 'SECOND-AWB',
    status: 'Delivered',
    updated_at: now(),
    status_at: now(),
  });
  const first = {
    ...row,
    'COD Amount': '500',
    'Bank Amount': '500',
    'Settlement Fees': '0',
    'Shipping Deduction': '0',
  };
  const second = { ...first, AWB: 'SECOND-AWB' };
  assert.equal(importRows(db, [first, second]).posted, 2);
  assert.equal(importRows(db, [first, second]).duplicate, 2);
  const data = workspace(db);
  assert.equal(data.metrics.codPending, 0);
  assert.equal(data.paymentMetrics.bankReceived, 100000);
  assert.equal(importRows(db, [{ ...first, AWB: '' }]).review, 1);
});
