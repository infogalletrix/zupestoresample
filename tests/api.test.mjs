import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { openDb, insert, id, now } from '../server/db.mjs';
import { createOrder, recordCredit, useCredit, today } from '../server/domain.mjs';
import { hashPassword } from '../server/security.mjs';
import ExcelJS from 'exceljs';
const header = { 'X-Requested-With': 'CommerceWorkspace' };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-test-'));
  const db = openDb(':memory:'),
    demoDb = openDb(':memory:');
  const result = createApp({ db, demoDb, dataDir: dir, seed: false });
  t.after(() => {
    db.close();
    demoDb.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...result, dir };
}
async function owner(app) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/setup')
    .set(header)
    .send({
      name: 'Test Owner',
      email: 'owner@example.com',
      password: 'A secure test password 42!',
    })
    .expect(201);
  return agent;
}

test('remittance upload preview is read-only, posting is idempotent and automation credentials are admin-only', async (t) => {
  const { app, db, reports } = fixture(t),
    admin = await owner(app);
  insert(db, 'products', {
    id: 'report-product',
    name: 'Test product',
    sku: 'REPORT-TEST',
    cost: 50000,
    price: 100000,
    stock: 10,
  });
  const order = createOrder(
    db,
    {
      date: today(),
      customer: 'Report buyer',
      method: 'COD',
      status: 'Delivered',
      items: [{ product_id: 'report-product', quantity: 1, price: 100000 }],
    },
    'owner',
  );
  const csv = `Order ID,UTR,Remittance Date,COD Amount,Payment Status\n${order.number},REPORT-UTR,${today()},1000,Remitted`;
  const body = {
    filename: 'report.csv',
    content: Buffer.from(csv).toString('base64'),
    mapping: {},
  };
  await request(app).post('/api/remittances/import').set(header).send(body).expect(401);
  const preview = await admin.post('/api/remittances/import').set(header).send(body).expect(200);
  assert.equal(preview.body.totals.Ready, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payments WHERE kind='COD remittance'").get().n,
    0,
  );
  const posted = await admin
    .post('/api/remittances/import')
    .set(header)
    .send({ ...body, preview: false })
    .expect(200);
  assert.equal(posted.body.posted, 1);
  assert.equal(
    (
      await admin
        .post('/api/remittances/import')
        .set(header)
        .send({ ...body, preview: false })
        .expect(200)
    ).body.duplicate,
    1,
  );
  const config = await admin
    .post('/api/remittances/config')
    .set(header)
    .send({ enabled: true })
    .expect(200);
  assert.match(config.body.webhookUrl, /remittance-report\/[a-f0-9]{64}$/);
  await request(app)
    .post(new URL(config.body.webhookUrl).pathname)
    .set('Content-Type', 'text/csv')
    .send(csv)
    .expect(202);
  await reports.process();
  const exported = await admin.get('/api/export/settlements?format=csv').expect(200);
  assert.match(exported.text, /REPORT-UTR/);
  await admin
    .post('/api/users')
    .set(header)
    .send({
      name: 'Report viewer',
      email: 'report-viewer@example.com',
      password: 'A secure viewer password',
      role: 'viewer',
    })
    .expect(201);
  const viewer = request.agent(app);
  await viewer
    .post('/api/auth/login')
    .set(header)
    .send({ email: 'report-viewer@example.com', password: 'A secure viewer password' })
    .expect(200);
  await viewer.get('/api/remittances').expect(200);
  await viewer.get('/api/remittances/config').expect(403);
  await viewer.post('/api/remittances/import').set(header).send(body).expect(403);
  await viewer.get('/api/backup/full').expect(403);
});

test('first-owner setup, secure cookies, authentication, and logout', async (t) => {
  const { app } = fixture(t);
  await request(app).get('/api/workspace').expect(401);
  const a = request.agent(app);
  const result = await a
    .post('/api/auth/setup')
    .set(header)
    .send({ name: 'Owner', email: 'owner@example.com', password: 'a long secure password' })
    .expect(201);
  assert.match(result.headers['set-cookie'][0], /HttpOnly/);
  assert.match(result.headers['set-cookie'][0], /SameSite=Strict/);
  await a.get('/api/workspace').expect(200);
  await a
    .post('/api/auth/setup')
    .set(header)
    .send({ name: 'Other', email: 'other@example.com', password: 'another long password' })
    .expect(409);
  await a.post('/api/auth/logout').set(header).expect(200);
  await a.get('/api/workspace').expect(401);
  await a
    .post('/api/auth/login')
    .set(header)
    .send({ email: 'owner@example.com', password: 'a long secure password' })
    .expect(200);
});
test('CSRF guard rejects cross-site mutations and missing verification header', async (t) => {
  const { app } = fixture(t);
  await request(app).post('/api/auth/demo').send({}).expect(403);
  await request(app)
    .post('/api/auth/demo')
    .set(header)
    .set('Origin', 'https://evil.example')
    .send({})
    .expect(403);
});
test('trusted reverse proxy applies authentication limits per client IP', async (t) => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  let app;
  try {
    ({ app } = fixture(t));
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  }
  for (let i = 0; i < 20; i++) {
    await request(app)
      .get('/api/auth/session')
      .set('X-Forwarded-For', '203.0.113.1, 198.51.100.1')
      .expect(200);
  }
  // Changing an untrusted earlier address cannot evade this client's limit.
  await request(app)
    .get('/api/auth/session')
    .set('X-Forwarded-For', '203.0.113.2, 198.51.100.1')
    .expect(429);
  await request(app).get('/api/auth/session').set('X-Forwarded-For', '198.51.100.2').expect(200);
});
test('viewer can read/export but cannot write or manage settings', async (t) => {
  const { app, db } = fixture(t);
  await owner(app);
  insert(db, 'users', {
    id: id(),
    name: 'Viewer',
    email: 'viewer@example.com',
    password: await hashPassword('viewer long password'),
    role: 'viewer',
    created_at: now(),
  });
  const viewer = request.agent(app);
  await viewer
    .post('/api/auth/login')
    .set(header)
    .send({ email: 'viewer@example.com', password: 'viewer long password' })
    .expect(200);
  await viewer.get('/api/workspace').expect(200);
  await viewer.get('/api/export/orders').expect(200);
  await viewer.post('/api/expenses').set(header).send({}).expect(403);
  await viewer.patch('/api/settings/business').set(header).send({ name: 'Hacked' }).expect(403);
  await viewer.get('/api/backup').expect(403);
});
test('demo writes stay isolated and cannot configure live credentials', async (t) => {
  const { app, db, demoDb } = fixture(t);
  const a = request.agent(app);
  await a.post('/api/auth/demo').set(header).expect(200);
  await a
    .post('/api/expenses')
    .set(header)
    .send({ date: today(), category: 'Meta Ads', amount: 12345, notes: 'Demo expense' })
    .expect(201);
  assert.equal(demoDb.prepare('SELECT COUNT(*) AS n FROM expenses').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n, 0);
  await a
    .post('/api/settings/integrations/shopify')
    .set(header)
    .send({ shop: 'store.myshopify.com', token: 'secret' })
    .expect(403);
});
test('integration secrets are encrypted and never returned in settings', async (t) => {
  const { app, db, integrations } = fixture(t);
  const a = await owner(app);
  await a
    .post('/api/settings/integrations/shopify')
    .set(header)
    .send({
      shop: 'example.myshopify.com',
      token: 'shpat-sensitive-test-token',
      webhookSecret: 'signed-test-secret',
    })
    .expect(200);
  assert.doesNotMatch(
    db.prepare("SELECT value FROM settings WHERE key='integration:shopify'").get().value,
    /sensitive-test|signed-test/,
  );
  const settings = await a.get('/api/settings').expect(200);
  assert.doesNotMatch(JSON.stringify(settings.body), /shpat-sensitive|signed-test/);
  assert.equal(integrations.config('shopify').token, 'shpat-sensitive-test-token');
  await a
    .post('/api/settings/integrations/shopify')
    .set(header)
    .send({ shop: 'localhost:9000' })
    .expect(400);
});
test('Shopify webhook signature verification, durable queue, and event deduplication', async (t) => {
  const { app, db, integrations } = fixture(t);
  integrations.save('shopify', {
    shop: 'example.myshopify.com',
    webhookSecret: 'test-secret',
    token: 'test',
  });
  const body = JSON.stringify({ id: 123, name: '#123' });
  const signature = createHmac('sha256', 'test-secret').update(body).digest('base64');
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Hmac-Sha256': signature,
    'X-Shopify-Shop-Domain': 'example.myshopify.com',
    'X-Shopify-Topic': 'orders/create',
    'X-Shopify-Webhook-Id': 'unique-id',
  };
  await request(app).post('/api/webhooks/store').set(headers).send(body).expect(200);
  await request(app).post('/api/webhooks/store').set(headers).send(body).expect(200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 1);
  await request(app)
    .post('/api/webhooks/store')
    .set({ ...headers, 'X-Shopify-Hmac-Sha256': 'bad' })
    .send(body)
    .expect(401);
  await request(app)
    .post('/api/webhooks/store')
    .set({ ...headers, 'X-Shopify-Shop-Domain': 'other.myshopify.com' })
    .send(body)
    .expect(401);
});
test('signed settlement feed deduplicates and enforces amounts; stale signatures rejected', async (t) => {
  const { app, db, integrations } = fixture(t);
  insert(db, 'suppliers', { id: 'A', name: 'Supplier A', created_at: now() });
  insert(db, 'products', {
    id: 'p1',
    name: 'Lamp',
    sku: 'LAMP',
    supplier_id: 'A',
    cost: 50000,
    price: 100000,
    stock: 1,
  });
  const o = createOrder(
    db,
    {
      date: today(),
      customer: 'Buyer',
      method: 'COD',
      status: 'Delivered',
      items: [{ product_id: 'p1', quantity: 1, price: 100000 }],
    },
    'owner',
  );
  const secret = 'settlement-secret-minimum-24';
  integrations.save('settlements', { secret });
  const body = JSON.stringify({
    event_id: 'payment-event-1',
    order_number: o.number,
    amount: 40000,
    date: today(),
    reference: 'UTR-1',
  });
  const timestamp = String(Math.floor(Date.now() / 1000)),
    signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const h = {
    'Content-Type': 'application/json',
    'X-Settlement-Timestamp': timestamp,
    'X-Settlement-Signature': signature,
  };
  await request(app).post('/api/webhooks/settlements').set(h).send(body).expect(200);
  await request(app).post('/api/webhooks/settlements').set(h).send(body).expect(200);
  assert.equal(
    db.prepare("SELECT SUM(amount) AS n FROM payments WHERE kind='COD remittance'").get().n,
    40000,
  );
  await request(app)
    .post('/api/webhooks/settlements')
    .set({ ...h, 'X-Settlement-Timestamp': '1' })
    .send(body)
    .expect(401);
});
test('CSV mitigates spreadsheet formulas and Excel export is a readable workbook', async (t) => {
  const { app } = fixture(t);
  const a = await owner(app);
  await a
    .post('/api/expenses')
    .set(header)
    .send({
      date: today(),
      category: 'Other expenses',
      amount: 10001,
      notes: '=HYPERLINK("https://evil.example")',
    })
    .expect(201);
  const csv = await a.get('/api/export/expenses?format=csv').expect(200);
  assert.match(csv.text, /'=HYPERLINK/);
  assert.match(csv.text, /100.01/);
  const xlsx = await a
    .get('/api/export/expenses?format=xlsx')
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(xlsx.body);
  const sheet = book.worksheets[0];
  assert.equal(sheet.rowCount, 2);
  assert.ok(sheet.getRow(2).values.some((v) => String(v).includes("'=HYPERLINK")));
});
test('disabled accounts immediately lose session access', async (t) => {
  const { app, db } = fixture(t);
  const a = await owner(app);
  await a
    .post('/api/users')
    .set(header)
    .send({
      name: 'Manager',
      email: 'manager@example.com',
      password: 'manager long password',
      role: 'manager',
    })
    .expect(201);
  const u = db.prepare("SELECT id FROM users WHERE email='manager@example.com'").get();
  const m = request.agent(app);
  await m
    .post('/api/auth/login')
    .set(header)
    .send({ email: 'manager@example.com', password: 'manager long password' })
    .expect(200);
  await a
    .patch(`/api/users/${u.id}`)
    .set(header)
    .send({ role: 'manager', active: false })
    .expect(200);
  await m.get('/api/workspace').expect(401);
  const ownerId = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
  await a
    .patch(`/api/users/${ownerId}`)
    .set(header)
    .send({ role: 'viewer', active: false })
    .expect(400);
});

test('using supplier credit still allows fulfilment; terminal delivery cannot be reversed', async (t) => {
  const { app, db } = fixture(t),
    agent = await owner(app);
  insert(db, 'suppliers', { id: 'A', name: 'Supplier A', created_at: now() });
  insert(db, 'products', {
    id: 'P',
    name: 'Product',
    sku: 'P',
    supplier_id: 'A',
    cost: 10000,
    price: 20000,
    stock: 10,
  });
  const create = (status) =>
    createOrder(
      db,
      {
        date: today(),
        customer: 'Customer',
        method: 'COD',
        status,
        items: [{ product_id: 'P', quantity: 1, price: 20000 }],
      },
      'owner',
    );
  const returned = create('RTO'),
    purchase = create('Confirmed');
  recordCredit(
    db,
    {
      supplier_id: 'A',
      order_id: returned.id,
      date: today(),
      amount: 10000,
      received: true,
      reference: 'CREDIT',
      idempotency_key: 'credit-fulfilment',
    },
    'owner',
  );
  useCredit(
    db,
    {
      supplier_id: 'A',
      order_id: purchase.id,
      date: today(),
      amount: 10000,
      reference: 'PURCHASE',
      idempotency_key: 'use-credit-fulfilment',
    },
    'owner',
  );
  const payload = (status) => ({ status, shipping_cost: 0, rto_cost: 0, notes: '', items: [] });
  await agent.patch(`/api/orders/${purchase.id}`).set(header).send(payload('Shipped')).expect(200);
  await agent
    .patch(`/api/orders/${purchase.id}`)
    .set(header)
    .send(payload('Delivered'))
    .expect(200);
  await agent
    .patch(`/api/orders/${purchase.id}`)
    .set(header)
    .send(payload('Cancelled'))
    .expect(400);
  await agent
    .patch(`/api/orders/${purchase.id}`)
    .set(header)
    .send(payload('Confirmed'))
    .expect(400);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get('P').stock, 8);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE kind='COD collected'").get().n, 1);
});
