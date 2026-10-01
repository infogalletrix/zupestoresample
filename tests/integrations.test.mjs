import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insert, now, id, setting } from '../server/db.mjs';
import { createIntegrationService, normalizeShopify } from '../server/integrations.mjs';
import { workspace, today, createOrder, recordPayment } from '../server/domain.mjs';
import { performanceRows } from '../server/reports.mjs';
const crypto = { encrypt: (v) => JSON.stringify(v), decrypt: (v) => JSON.parse(v) };
const response = (value) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => value,
});
function baseOrder(n = 1) {
  return {
    id: `gid://shopify/Order/${n}`,
    name: `#${1000 + n}`,
    createdAt: now(),
    updatedAt: now(),
    currencyCode: 'INR',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    paymentGatewayNames: ['Razorpay'],
    totalPriceSet: { shopMoney: { amount: '1180', currencyCode: 'INR' } },
    totalTaxSet: { shopMoney: { amount: '180' } },
    currentTotalTaxSet: { shopMoney: { amount: '180' } },
    customer: { displayName: 'Customer' },
    lineItems: {
      nodes: [
        {
          id: `gid://shopify/LineItem/${n}`,
          name: 'Lamp',
          sku: 'LAMP',
          quantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: '1000' } },
          variant: { id: 'gid://shopify/ProductVariant/1' },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    transactions: [],
  };
}
test('Shopify follows product/order/line-item pagination and updates its cursor only on success', async () => {
  const db = openDb(':memory:');
  const calls = [];
  const fetcher = async (url, init) => {
    assert.match(url, /https:\/\/shop.myshopify.com\/admin\/api\/2026-07\/graphql.json/);
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (query.includes('query Products'))
      return response({
        data: {
          productVariants: {
            nodes: [
              {
                id: 'gid://shopify/ProductVariant/1',
                displayName: 'Lamp',
                sku: 'LAMP',
                price: '1000',
                inventoryQuantity: 10,
                inventoryItem: { unitCost: { amount: '500', currencyCode: 'INR' } },
                product: { productType: 'Home' },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      });
    if (query.includes('query MoreLines'))
      return response({
        data: {
          order: {
            lineItems: {
              nodes: [{ ...baseOrder(3).lineItems.nodes[0], quantity: 2 }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
    const o = baseOrder(variables.after ? 2 : 1);
    if (!variables.after) o.lineItems.pageInfo = { hasNextPage: true, endCursor: 'line-cursor' };
    return response({
      data: {
        orders: {
          nodes: [o],
          pageInfo: { hasNextPage: !variables.after, endCursor: 'order-cursor' },
        },
      },
    });
  };
  const service = createIntegrationService(db, crypto, fetcher);
  service.save('shopify', { shop: 'shop.myshopify.com', token: 'test-token' });
  const r = await service.sync('shopify');
  assert.equal(r.count, 2);
  assert.equal(workspace(db).orders.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n, 3);
  assert.ok(calls.some((c) => c.variables.after === 'order-cursor'));
  assert.ok(calls.some((c) => c.variables.after === 'line-cursor'));
  assert.ok(setting(db, 'lastSync:shopify'));
  assert.equal(db.prepare('SELECT status FROM sync_runs').get().status, 'Success');
  db.close();
});
test('a failed provider request records a failure and does not advance the sync cursor', async () => {
  const db = openDb(':memory:');
  const service = createIntegrationService(db, crypto, async () => ({
    ok: false,
    status: 403,
    headers: new Headers(),
  }));
  service.save('shopify', { shop: 'shop.myshopify.com', token: 'bad' });
  await assert.rejects(service.sync('shopify'), /403/);
  assert.equal(setting(db, 'lastSync:shopify'), null);
  assert.equal(db.prepare('SELECT status FROM sync_runs').get().status, 'Failed');
  db.close();
});
test('Shiprocket pagination and split-package import do not collect COD prematurely', async () => {
  const db = openDb(':memory:');
  const first = baseOrder();
  first.paymentGatewayNames = ['Cash on Delivery (COD)'];
  normalizeShopify(db, first);
  const second = baseOrder(2);
  second.paymentGatewayNames = ['COD'];
  normalizeShopify(db, second);
  let orderPages = 0;
  const service = createIntegrationService(db, crypto, async (url) => {
    if (url.endsWith('/auth/login')) return response({ token: 'test' });
    orderPages++;
    const page = new URL(url).searchParams.get('page');
    return response({
      data: [
        page === '1'
          ? {
              channel_order_id: '1001',
              status: 'SHIPPED',
              shipments: [
                { id: 1, awb: 'A1', status: 'DELIVERED', courier: 'Test' },
                { id: 2, awb: 'A2', status: 'IN TRANSIT', courier: 'Test' },
              ],
            }
          : {
              channel_order_id: '1002',
              status: 'UNDELIVERED',
              shipments: [{ id: 3, awb: 'A3', courier: 'Test' }],
            },
      ],
      meta: { pagination: { total_pages: 2 } },
    });
  });
  service.save('shiprocket', { email: 'api@example.com', password: 'test' });
  const result = await service.sync('shiprocket');
  assert.equal(result.count, 3);
  assert.equal(orderPages, 2);
  const data = workspace(db);
  assert.equal(data.orders.find((o) => o.number === '#1001').status, 'Shipped');
  assert.equal(data.orders.find((o) => o.number === '#1002').status, 'NDR');
  assert.equal(data.metrics.codCollected, 0);
  assert.equal(data.metrics.codRemitted, 0);
  db.close();
});
test('unknown shipping cost is flagged, never silently represented as verified zero', () => {
  const db = openDb(':memory:');
  const remote = baseOrder();
  remote.displayFulfillmentStatus = 'FULFILLED';
  normalizeShopify(db, remote);
  assert.equal(workspace(db).metrics.missingCosts, 1);
  db.close();
});
test('Shopify partial refunds use the adjusted tax amount and deduplicate refund transactions', () => {
  const db = openDb(':memory:');
  const remote = baseOrder();
  remote.currentTotalTaxSet.shopMoney.amount = '90';
  remote.transactions = [
    {
      id: 'pay',
      kind: 'SALE',
      status: 'SUCCESS',
      processedAt: now(),
      amountSet: { shopMoney: { amount: '1180', currencyCode: 'INR' } },
    },
    {
      id: 'refund',
      kind: 'REFUND',
      status: 'SUCCESS',
      processedAt: now(),
      amountSet: { shopMoney: { amount: '590', currencyCode: 'INR' } },
    },
  ];
  const oid = normalizeShopify(db, remote);
  db.prepare("UPDATE orders SET status='Delivered' WHERE id=?").run(oid);
  assert.equal(workspace(db).metrics.sales, 50000);
  normalizeShopify(db, remote);
  db.prepare("UPDATE orders SET status='Delivered' WHERE id=?").run(oid);
  assert.equal(workspace(db).metrics.sales, 50000);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM payments WHERE kind='Customer refund'").get().n,
    1,
  );
  db.close();
});
test('manual partial refunds preserve net-of-tax revenue and stock updates are transactional', () => {
  const db = openDb(':memory:');
  insert(db, 'suppliers', { id: 's', name: 'Supplier', created_at: now() });
  insert(db, 'products', {
    id: 'p',
    name: 'Lamp',
    sku: 'LAMP',
    supplier_id: 's',
    cost: 50000,
    price: 100000,
    stock: 1,
  });
  const o = createOrder(
    db,
    {
      date: today(),
      customer: 'Buyer',
      method: 'Prepaid',
      status: 'Delivered',
      tax: 18000,
      items: [{ product_id: 'p', quantity: 1, price: 100000 }],
    },
    'owner',
  );
  const common = { order_id: o.id, supplier_id: null, date: today(), status: 'Completed' };
  recordPayment(
    db,
    { ...common, kind: 'Prepaid payment', amount: 118000, reference: 'PAY', idempotency_key: id() },
    'owner',
  );
  recordPayment(
    db,
    {
      ...common,
      kind: 'Customer refund',
      amount: 59000,
      tax_amount: 9000,
      reference: 'REFUND',
      idempotency_key: id(),
    },
    'owner',
  );
  assert.equal(workspace(db).metrics.sales, 50000);
  assert.equal(db.prepare('SELECT stock FROM products').get().stock, 0);
  assert.throws(
    () =>
      createOrder(
        db,
        {
          date: today(),
          customer: 'Other Buyer',
          method: 'COD',
          items: [{ product_id: 'p', quantity: 1, price: 100000 }],
        },
        'owner',
      ),
    /Insufficient/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  db.close();
});
test('weekly/monthly/annual exports aggregate the selected timeline in INR', () => {
  const data = [
    { date: '2026-09-28', sales: 10001, profit: 5001, orders: 1 },
    { date: '2026-10-01', sales: 20002, profit: 6002, orders: 2 },
  ];
  const weekly = performanceRows(data, 'Weekly');
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].Orders, 3);
  assert.equal(weekly[0].Sales_INR, 300.03);
  assert.equal(performanceRows(data, 'Monthly').length, 2);
  assert.equal(performanceRows(data, 'Annual').length, 1);
});
