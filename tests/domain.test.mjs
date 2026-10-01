import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insert, id, now } from '../server/db.mjs';
import {
  recordCredit,
  useCredit,
  supplierBalance,
  createOrder,
  recordPayment,
  completePayment,
  cancelPayment,
  allocatePaise,
  workspace,
  collectCod,
  today,
} from '../server/domain.mjs';
import { normalizeShopify, normalizeShipment, mapShipmentStatus } from '../server/integrations.mjs';

function fixture() {
  const db = openDb(':memory:');
  for (const sid of ['A', 'B'])
    insert(db, 'suppliers', { id: sid, name: `Supplier ${sid}`, created_at: now() });
  for (const [pid, sid, cost] of [
    ['p500', 'A', 50000],
    ['p300', 'A', 30000],
    ['p700', 'A', 70000],
    ['pB', 'B', 30000],
  ])
    insert(db, 'products', {
      id: pid,
      name: pid,
      sku: pid,
      supplier_id: sid,
      cost,
      price: cost * 2,
      stock: 100,
    });
  return db;
}
function order(db, product = 'p500', status = 'Confirmed', method = 'COD') {
  return createOrder(
    db,
    {
      date: today(),
      customer: 'Test Customer',
      method,
      status,
      items: [{ product_id: product, quantity: 1, price: 100000 }],
      shipping_cost: 10000,
    },
    'owner',
  );
}
function credit(db, o, amount = 50000, supplier = 'A', key = id()) {
  return recordCredit(
    db,
    {
      supplier_id: supplier,
      order_id: o.id,
      amount,
      date: today(),
      reference: key,
      notes: 'Confirmed return',
      received: true,
      idempotency_key: key,
    },
    'owner',
  );
}
function apply(db, o, amount, supplier = 'A', key = id()) {
  return useCredit(
    db,
    {
      supplier_id: supplier,
      order_id: o.id,
      amount,
      date: today(),
      reference: key,
      notes: 'Purchase',
      idempotency_key: key,
    },
    'owner',
  );
}
function pay(db, o, kind, amount, extra = {}) {
  return recordPayment(
    db,
    {
      order_id: o.id,
      supplier_id: null,
      date: today(),
      kind,
      amount,
      status: 'Completed',
      reference: id(),
      idempotency_key: id(),
      ...extra,
    },
    'owner',
  );
}

test('user example: ₹500 returned → ₹300 purchase → ₹700 purchase with ₹500 payable', () => {
  const db = fixture();
  const returned = order(db, 'p500', 'RTO');
  credit(db, returned);
  assert.equal(supplierBalance(db, 'A'), 50000);
  const purchase300 = order(db, 'p300');
  apply(db, purchase300, 30000);
  assert.equal(supplierBalance(db, 'A'), 20000);
  let state = workspace(db);
  assert.equal(state.orders.find((o) => o.id === purchase300.id).payable, 0);
  const purchase700 = order(db, 'p700');
  apply(db, purchase700, 20000);
  state = workspace(db);
  assert.equal(state.orders.find((o) => o.id === purchase700.id).payable, 50000);
  assert.equal(state.credit.balance, 0);
  assert.equal(state.metrics.prepaid, 0);
  assert.equal(state.metrics.codRemitted, 0);
  db.close();
});
test('supplier credit cannot cross supplier boundaries, exceed balance, or overpay a purchase', () => {
  const db = fixture(),
    returned = order(db, 'p500', 'RTO');
  credit(db, returned);
  const other = order(db, 'pB');
  assert.throws(() => apply(db, other, 10000, 'A'), /unpaid purchase/);
  assert.throws(() => apply(db, other, 10000, 'B'), /Insufficient credit/);
  const small = order(db, 'p300');
  assert.throws(() => apply(db, small, 40000), /unpaid purchase/);
  assert.equal(supplierBalance(db, 'A'), 50000);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE type='Credit used'").get().n,
    0,
  );
  db.close();
});
test('credits require supplier receipt, actual RTO status and uncredited supplier cost', () => {
  const db = fixture(),
    confirmed = order(db);
  assert.throws(() => credit(db, confirmed), /only be received/);
  const returned = order(db, 'p500', 'RTO');
  assert.throws(() => credit(db, returned, 60000), /exceeds/);
  credit(db, returned, 20000);
  credit(db, returned, 30000);
  assert.throws(() => credit(db, returned, 1), /exceeds/);
  assert.throws(() =>
    recordCredit(
      db,
      {
        supplier_id: 'A',
        order_id: returned.id,
        amount: 100,
        date: today(),
        reference: 'CN',
        received: false,
        idempotency_key: id(),
      },
      'owner',
    ),
  );
  db.close();
});
test('replaying credit and purchase requests does not duplicate transactions', () => {
  const db = fixture(),
    returned = order(db, 'p500', 'RTO'),
    key = id();
  const a = credit(db, returned, 50000, 'A', key),
    b = credit(db, returned, 50000, 'A', key);
  assert.equal(a.id, b.id);
  assert.equal(supplierBalance(db, 'A'), 50000);
  assert.throws(() => credit(db, returned, 30000, 'A', key), /different ledger/);
  const purchase = order(db, 'p300'),
    useKey = id();
  assert.equal(
    apply(db, purchase, 20000, 'A', useKey).id,
    apply(db, purchase, 20000, 'A', useKey).id,
  );
  assert.equal(supplierBalance(db, 'A'), 30000);
  db.close();
});
test('supplier credit use does not change contribution or add cash', () => {
  const db = fixture(),
    returned = order(db, 'p500', 'RTO');
  const beforeCredit = workspace(db).metrics.netProfit;
  credit(db, returned);
  assert.equal(workspace(db).metrics.netProfit - beforeCredit, 50000);
  const purchase = order(db, 'p300', 'Delivered', 'Prepaid');
  const before = workspace(db);
  apply(db, purchase, 30000);
  const after = workspace(db);
  assert.equal(before.metrics.netProfit, after.metrics.netProfit);
  assert.equal(after.metrics.prepaid, 0);
  assert.equal(after.orders.find((o) => o.id === purchase.id).product_cost, 30000);
  assert.equal(after.orders.find((o) => o.id === purchase.id).profit, 60000);
  db.close();
});
test('COD delivery collects exactly once and does not imply a bank remittance', () => {
  const db = fixture(),
    delivered = order(db, 'p500', 'Delivered');
  collectCod(db, delivered.id);
  collectCod(db, delivered.id);
  let metrics = workspace(db).metrics;
  assert.equal(metrics.codCollected, 100000);
  assert.equal(metrics.codRemitted, 0);
  assert.equal(metrics.codPending, 100000);
  pay(db, delivered, 'COD remittance', 40000);
  metrics = workspace(db).metrics;
  assert.equal(metrics.codPending, 60000);
  assert.equal(metrics.codRemitted, 40000);
  assert.throws(() => pay(db, delivered, 'COD remittance', 60001), /exceeds/);
  pay(db, delivered, 'COD remittance', 60000);
  assert.equal(workspace(db).metrics.codPending, 0);
  db.close();
});
test('pending payments reserve the payable and never inflate completed payments', () => {
  const db = fixture(),
    o = order(db, 'p500', 'Delivered');
  pay(db, o, 'COD remittance', 90000, { status: 'Pending' });
  assert.equal(workspace(db).metrics.codRemitted, 0);
  assert.throws(() => pay(db, o, 'COD remittance', 20000), /exceeds/);
  pay(db, o, 'Supplier payment', 40000, { supplier_id: 'A' });
  const returned = order(db, 'p500', 'RTO');
  credit(db, returned);
  assert.throws(() => apply(db, o, 20000), /unpaid purchase/);
  apply(db, o, 10000);
  assert.equal(workspace(db).orders.find((x) => x.id === o.id).payable, 0);
  db.close();
});
test('expense overhead is allocated exactly, including remainder paise', () => {
  const db = fixture();
  order(db, 'p500', 'Delivered');
  order(db, 'p300', 'Delivered');
  order(db, 'p700', 'Delivered');
  insert(db, 'expenses', {
    id: id(),
    date: today(),
    category: 'Meta Ads',
    amount: 10001,
    created_at: now(),
  });
  const data = workspace(db);
  assert.equal(
    data.orders.reduce((s, o) => s + o.allocated_expense, 0),
    10001,
  );
  assert.equal(
    data.orders.reduce((s, o) => s + o.net_profit, 0),
    data.metrics.netProfit,
  );
  const none = workspace(db, '2020-01-01', '2020-01-31');
  assert.equal(none.metrics.sales, 0);
  assert.equal(none.metrics.expenseTotal, 0);
  db.close();
});
test('multiple suppliers on an order have independent eligible costs', () => {
  const db = fixture();
  const o = createOrder(
    db,
    {
      date: today(),
      customer: 'Multi supplier',
      method: 'COD',
      status: 'RTO',
      items: [
        { product_id: 'p500', quantity: 2, price: 100000 },
        { product_id: 'pB', quantity: 1, price: 70000 },
      ],
    },
    'owner',
  );
  credit(db, o, 100000, 'A');
  credit(db, o, 30000, 'B');
  assert.equal(supplierBalance(db, 'A'), 100000);
  assert.equal(supplierBalance(db, 'B'), 30000);
  assert.throws(() => credit(db, o, 1, 'B'), /exceeds/);
  db.close();
});
test('backdated or future credits cannot invalidate running balances', () => {
  const db = fixture(),
    o = order(db, 'p500', 'RTO');
  const d = {
    supplier_id: 'A',
    order_id: o.id,
    amount: 50000,
    date: '2099-01-01',
    reference: 'future',
    received: true,
    idempotency_key: id(),
  };
  assert.throws(() => recordCredit(db, d, 'owner'), /between/);
  d.date = '2000-01-01';
  assert.throws(() => recordCredit(db, d, 'owner'), /between/);
  db.close();
});
test('Shiprocket mapping distinguishes undelivered from delivered and RTO delivered', () => {
  assert.equal(mapShipmentStatus('UNDELIVERED'), 'NDR');
  assert.equal(mapShipmentStatus('RTO DELIVERED'), 'RTO');
  assert.equal(mapShipmentStatus('DELIVERED'), 'Delivered');
  assert.equal(mapShipmentStatus('OUT FOR DELIVERY'), 'Shipped');
  assert.equal(mapShipmentStatus('CANCELED'), 'Cancelled');
});
test('shipment reconciliation is idempotent and stale events cannot regress delivery', () => {
  const db = fixture(),
    o = order(db);
  normalizeShipment(
    db,
    {
      id: 's1',
      awb: 'AWB1',
      status: 'Delivered',
      raw_status: 'DELIVERED',
      status_at: '2026-08-10T11:00:00Z',
    },
    o.id,
  );
  normalizeShipment(
    db,
    {
      id: 's1',
      awb: 'AWB1',
      status: 'NDR',
      raw_status: 'UNDELIVERED',
      status_at: '2026-08-09T11:00:00Z',
    },
    o.id,
  );
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status, 'Delivered');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 1);
  db.close();
});
test('split shipments only recognize revenue after all packages are delivered', () => {
  const db = fixture(),
    o = order(db);
  normalizeShipment(db, { id: 's1', awb: 'AWB1', status: 'Shipped', status_at: now() }, o.id);
  normalizeShipment(db, { id: 's2', awb: 'AWB2', status: 'Shipped', status_at: now() }, o.id);
  normalizeShipment(db, { id: 's1', awb: 'AWB1', status: 'Delivered', status_at: now() }, o.id);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status, 'Shipped');
  assert.equal(workspace(db).metrics.sales, 0);
  normalizeShipment(db, { id: 's2', awb: 'AWB2', status: 'Delivered', status_at: now() }, o.id);
  assert.equal(workspace(db).metrics.sales, 100000);
  db.close();
});
function remote(overrides = {}) {
  return {
    id: 'gid://shopify/Order/1',
    name: '#10001',
    createdAt: now(),
    updatedAt: now(),
    currencyCode: 'INR',
    paymentGatewayNames: ['Razorpay'],
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    totalPriceSet: { shopMoney: { amount: '1000', currencyCode: 'INR' } },
    totalTaxSet: { shopMoney: { amount: '0' } },
    customer: { displayName: 'Online Customer' },
    lineItems: {
      nodes: [
        {
          id: 'gid://shopify/LineItem/1',
          name: 'Lamp',
          sku: 'p500',
          quantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: '1000' } },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    transactions: [
      {
        id: 'gid://shopify/OrderTransaction/1',
        kind: 'SALE',
        status: 'SUCCESS',
        processedAt: now(),
        amountSet: { shopMoney: { amount: '1000', currencyCode: 'INR' } },
      },
    ],
    ...overrides,
  };
}
test('Shopify re-sync preserves historical cost and deduplicates prepaid payments', () => {
  const db = fixture();
  const input = remote();
  const oid = normalizeShopify(db, input);
  db.prepare("UPDATE products SET cost=90000 WHERE id='p500'").run();
  normalizeShopify(db, input);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 1);
  assert.equal(db.prepare('SELECT cost FROM order_items WHERE order_id=?').get(oid).cost, 50000);
  assert.equal(workspace(db).metrics.prepaid, 100000);
  db.close();
});
test('foreign currency is rejected instead of silently treating it as INR', () => {
  const db = fixture();
  assert.throws(() => normalizeShopify(db, remote({ currencyCode: 'USD' })), /not in INR/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  db.close();
});

test('pending cancellation releases the reserved balance and preserves its audit history', () => {
  const db = fixture(),
    o = order(db, 'p500', 'Confirmed', 'Prepaid');
  const pending = pay(db, o, 'Prepaid payment', 40000, { status: 'Pending' });
  cancelPayment(db, pending.id, 'Payment was never sent', 'owner');
  pay(db, o, 'Prepaid payment', 100000);
  const state = workspace(db);
  assert.equal(state.orders[0].prepaid, 100000);
  assert.equal(state.payments.find((p) => p.id === pending.id).status, 'Cancelled');
  assert.equal(
    state.payments.find((p) => p.id === pending.id).void_reason,
    'Payment was never sent',
  );
  assert.throws(() => completePayment(db, pending.id, today(), 'owner'), /cancelled payment/);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='Pending payment cancelled'").get().n,
    1,
  );
  cancelPayment(db, pending.id, 'Retried cancellation', 'owner');
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='Pending payment cancelled'").get().n,
    1,
  );
  db.close();
});

test('payment completion revalidates a changed balance and is idempotent', () => {
  const db = fixture(),
    o = order(db, 'p500', 'Confirmed', 'Prepaid');
  const pending = pay(db, o, 'Prepaid payment', 40000, { status: 'Pending' });
  db.prepare('UPDATE orders SET total=30000 WHERE id=?').run(o.id);
  assert.throws(() => completePayment(db, pending.id, today(), 'owner'), /outstanding balance/);
  assert.equal(
    db.prepare('SELECT status FROM payments WHERE id=?').get(pending.id).status,
    'Pending',
  );
  db.prepare('UPDATE orders SET total=100000 WHERE id=?').run(o.id);
  completePayment(db, pending.id, today(), 'owner');
  completePayment(db, pending.id, today(), 'owner');
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='Payment completed'").get().n,
    1,
  );
  assert.throws(
    () => cancelPayment(db, pending.id, 'Wrong payment', 'owner'),
    /Completed payments cannot/,
  );
  db.close();
});

test('cancelled supplier reservations no longer block eligible credit use', () => {
  const db = fixture(),
    returned = order(db, 'p500', 'RTO'),
    purchase = order(db, 'p300');
  credit(db, returned);
  const pending = pay(db, purchase, 'Supplier payment', 30000, {
    supplier_id: 'A',
    status: 'Pending',
  });
  assert.throws(() => apply(db, purchase, 30000), /unpaid purchase/);
  cancelPayment(db, pending.id, 'Use supplier credit instead', 'owner');
  apply(db, purchase, 30000);
  assert.equal(supplierBalance(db, 'A'), 20000);
  assert.throws(() => completePayment(db, pending.id, today(), 'owner'), /cancelled payment/);
  db.close();
});

test('product contribution uses each product cost and reconciles shared expenses exactly', () => {
  const db = fixture();
  const o = createOrder(
    db,
    {
      date: today(),
      customer: 'Mixed cost customer',
      method: 'COD',
      status: 'Delivered',
      shipping_cost: 101,
      items: [
        { product_id: 'p500', quantity: 1, price: 100000 },
        { product_id: 'p300', quantity: 1, price: 100000 },
      ],
    },
    'owner',
  );
  const state = workspace(db),
    a = state.products.find((p) => p.id === 'p500'),
    b = state.products.find((p) => p.id === 'p300');
  assert.equal(a.profit, 49949);
  assert.equal(b.profit, 69950);
  assert.equal(a.profit + b.profit, state.orders.find((x) => x.id === o.id).profit);
  assert.equal(a.revenue + b.revenue, state.metrics.sales);
  db.close();
});

test('RTO product recovery belongs only to the supplier that issued the credit', () => {
  const db = fixture();
  const o = createOrder(
    db,
    {
      date: today(),
      customer: 'Supplier return',
      method: 'COD',
      status: 'RTO',
      shipping_cost: 10000,
      items: [
        { product_id: 'p500', quantity: 1, price: 100000 },
        { product_id: 'pB', quantity: 1, price: 100000 },
      ],
    },
    'owner',
  );
  credit(db, o, 30000, 'A');
  const state = workspace(db);
  assert.equal(state.products.find((p) => p.id === 'p500').profit, -25000);
  assert.equal(state.products.find((p) => p.id === 'pB').profit, -35000);
  assert.equal(
    state.products.reduce((s, p) => s + p.profit, 0),
    state.metrics.grossProfit,
  );
  db.close();
});

test('paise allocation conserves totals for refunds, zero prices and large unequal weights', () => {
  assert.deepEqual(allocatePaise(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocatePaise(-2, [1, 1, 1]), [-1, -1, 0]);
  assert.deepEqual(allocatePaise(5, [0, 0]), [3, 2]);
  for (const total of [1, 99, 100000000001]) {
    const result = allocatePaise(total, [987654321, 123456789, 777777777]);
    assert.equal(
      result.reduce((a, b) => a + b, 0),
      total,
    );
    assert.ok(result.every(Number.isInteger));
  }
});

test('payment summaries follow settlement dates even for orders outside the selected cohort', () => {
  const db = fixture(),
    o = order(db, 'p500', 'Delivered');
  db.prepare("UPDATE orders SET date='2020-01-01' WHERE id=?").run(o.id);
  pay(db, o, 'COD remittance', 20000);
  const state = workspace(db, today(), today());
  assert.equal(state.metrics.codRemitted, 0);
  assert.equal(state.paymentMetrics.codRemitted, 20000);
  assert.equal(state.paymentMetrics.codPending, 80000);
  db.close();
});

test('provider payments cannot be completed or cancelled manually', () => {
  const db = fixture(),
    o = order(db, 'p500', 'Confirmed', 'Prepaid');
  const pending = pay(db, o, 'Prepaid payment', 10000, { status: 'Pending' });
  db.prepare("UPDATE payments SET source='Shopify' WHERE id=?").run(pending.id);
  assert.throws(
    () => completePayment(db, pending.id, today(), 'owner'),
    /managed by their provider/,
  );
  assert.throws(
    () => cancelPayment(db, pending.id, 'Operator cancellation', 'owner'),
    /managed by their provider/,
  );
  db.close();
});
