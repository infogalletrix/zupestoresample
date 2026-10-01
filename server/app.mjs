import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { randomBytes, createHmac } from 'node:crypto';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { openDb, id, now, insert, setting, setSetting, audit, transaction } from './db.mjs';
import {
  AppError,
  schemas,
  date,
  money,
  text,
  orderStatuses,
  workspace,
  recordCredit,
  useCredit,
  recordPayment,
  createOrder,
  collectCod,
  today,
} from './domain.mjs';
import { encryption, hashPassword, checkPassword, hashToken, safeEqual } from './security.mjs';
import { createIntegrationService } from './integrations.mjs';
import { seedDemo } from './seed.mjs';
import { performanceRows } from './reports.mjs';

export function createApp(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || 'data');
  const db = options.db || openDb(join(dataDir, 'commerce.sqlite'));
  const demoDb = options.demoDb || openDb(join(dataDir, 'demo.sqlite'));
  if (options.seed !== false) seedDemo(demoDb);
  const crypto = options.crypto || encryption(dataDir);
  const integrations = createIntegrationService(db, crypto, options.fetcher);
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              directives: {
                'script-src': ["'self'"],
                'style-src': ["'self'", "'unsafe-inline'"],
                'img-src': ["'self'", 'data:'],
                'connect-src': ["'self'"],
                'upgrade-insecure-requests': null,
              },
            }
          : false,
    }),
  );
  app.use(cookieParser());
  const cookies = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  });
  app.use('/api/auth', authLimit);
  app.use(
    '/api/webhooks',
    rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.post(
    '/api/webhooks/store',
    express.raw({ type: 'application/json', limit: '2mb' }),
    (req, res) => {
      integrations.receiveShopify(req.body, req.headers);
      res.json({ received: true });
    },
  );
  app.post(
    '/api/webhooks/tracking',
    express.raw({ type: 'application/json', limit: '2mb' }),
    (req, res) => {
      integrations.receiveTracking(req.body, req.headers);
      res.json({ received: true });
    },
  );
  // A normalized signed feed bridges account-specific remittance APIs without guessing bank settlement from shipment status.
  app.post(
    '/api/webhooks/settlements',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req, res) => {
      const c = integrations.config('settlements');
      const timestamp = String(req.headers['x-settlement-timestamp'] || '');
      if (
        !c.secret ||
        Math.abs(Date.now() - Number(timestamp) * 1000) > 300000 ||
        !Number.isFinite(Number(timestamp))
      )
        throw new AppError('Invalid settlement timestamp.', 401);
      const signature = createHmac('sha256', c.secret)
        .update(`${timestamp}.`)
        .update(req.body)
        .digest('hex');
      if (!safeEqual(signature, req.headers['x-settlement-signature']))
        throw new AppError('Invalid settlement signature.', 401);
      const input = z
        .object({
          event_id: z.string().min(8),
          order_number: z.string(),
          amount: money.refine((n) => n > 0),
          date,
          reference: text.min(1),
          kind: z
            .enum(['COD remittance', 'Prepaid payment', 'Customer refund'])
            .default('COD remittance'),
        })
        .parse(JSON.parse(req.body.toString()));
      const order = db.prepare('SELECT id FROM orders WHERE number=?').get(input.order_number);
      if (!order) throw new AppError('Order must sync before its settlement.', 409);
      const result = recordPayment(
        db,
        {
          order_id: order.id,
          supplier_id: null,
          date: input.date,
          kind: input.kind,
          amount: input.amount,
          status: 'Completed',
          reference: input.reference,
          idempotency_key: `feed:${input.event_id}`,
        },
        'settlement-feed',
      );
      db.prepare("UPDATE payments SET source='Settlement feed' WHERE id=?").run(result.id);
      setSetting(db, 'lastSync:settlements', now());
      setSetting(db, 'status:settlements', 'Connected');
      res.json({ received: true, id: result.id });
    },
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowed = new Set([
        process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
        'http://localhost:5173',
        `http://127.0.0.1:${process.env.PORT || 3001}`,
        `http://localhost:${process.env.PORT || 3001}`,
      ]);
      if (req.headers.origin && !allowed.has(req.headers.origin))
        return res.status(403).json({ error: 'Origin is not allowed.' });
      if (req.headers['x-requested-with'] !== 'CommerceWorkspace')
        return res.status(403).json({ error: 'Missing request verification header.' });
    }
    next();
  });
  function session(req) {
    const token = req.cookies.nh_session;
    if (!token) return null;
    const s = db
      .prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?')
      .get(hashToken(token), Date.now());
    if (!s) return null;
    const user =
      s.mode === 'demo'
        ? { id: 'demo', name: 'Alex Morgan', email: 'demo@example.com', role: 'admin', active: 1 }
        : db.prepare('SELECT id,name,email,role,active FROM users WHERE id=?').get(s.user_id);
    if (!user?.active) return null;
    return { user, demo: s.mode === 'demo' };
  }
  function issueSession(res, userId, mode = 'live') {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    insert(db, 'sessions', {
      token: hashToken(token),
      user_id: userId,
      mode,
      expires_at: Date.now() + cookies.maxAge,
    });
    res.cookie('nh_session', token, cookies);
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/session', (req, res) =>
    res.json({
      session: session(req),
      needsSetup: !db.prepare('SELECT id FROM users LIMIT 1').get(),
    }),
  );
  const credentials = z.object({
    email: z.email().transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
    name: text.min(2).optional(),
    setupToken: z.string().optional(),
  });
  app.post('/api/auth/setup', async (req, res) => {
    if (db.prepare('SELECT id FROM users LIMIT 1').get())
      throw new AppError('An owner already exists.', 409);
    if (process.env.SETUP_TOKEN && !safeEqual(process.env.SETUP_TOKEN, req.body.setupToken))
      throw new AppError('Invalid setup token.', 403);
    const d = credentials.parse(req.body),
      password = await hashPassword(d.password);
    // Recheck after the asynchronous password hash to prevent concurrent first-owner creation.
    const user = transaction(db, () => {
      if (db.prepare('SELECT id FROM users LIMIT 1').get())
        throw new AppError('An owner already exists.', 409);
      return insert(db, 'users', {
        id: id(),
        name: d.name || 'Owner',
        email: d.email,
        password,
        role: 'admin',
        created_at: now(),
      });
    });
    issueSession(res, user.id);
    audit(db, user.id, 'Owner account created', user.id);
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/login', async (req, res) => {
    const d = z.object({ email: z.email(), password: z.string().min(1).max(128) }).parse(req.body);
    const user = db
      .prepare('SELECT * FROM users WHERE email=? AND active=1')
      .get(d.email.toLowerCase());
    if (!user || !(await checkPassword(d.password, user.password)))
      throw new AppError('Email or password is incorrect.', 401);
    issueSession(res, user.id);
    res.json({ ok: true });
  });
  app.post('/api/auth/demo', (_req, res) => {
    issueSession(res, 'demo', 'demo');
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.cookies.nh_session)
      db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(req.cookies.nh_session));
    res.clearCookie('nh_session', { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    const s = session(req);
    if (!s) return res.status(401).json({ error: 'Please sign in.' });
    req.auth = s;
    req.db = s.demo ? demoDb : db;
    next();
  });
  const write = (req, _res, next) => {
    if (req.auth.user.role === 'viewer') throw new AppError('Your role has read-only access.', 403);
    next();
  };
  const admin = (req, _res, next) => {
    if (req.auth.user.role !== 'admin') throw new AppError('Administrator access required.', 403);
    next();
  };
  const live = (req, _res, next) => {
    if (req.auth.demo)
      throw new AppError(
        'Create your own workspace to configure live integrations or users. Demo data is isolated.',
        403,
      );
    next();
  };
  const bounds = (req) => ({
    from: req.query.from ? date.parse(req.query.from) : '0000-01-01',
    to: req.query.to ? date.parse(req.query.to) : '9999-12-31',
  });
  app.get('/api/workspace', (req, res) => {
    const { from, to } = bounds(req);
    if (from > to) throw new AppError('Start date must be before the end date.');
    res.json(workspace(req.db, from, to));
  });
  app.post('/api/suppliers', write, (req, res) => {
    const d = schemas.supplier.parse(req.body);
    const row = insert(req.db, 'suppliers', { id: id(), ...d, created_at: now() });
    audit(req.db, req.auth.user.id, 'Supplier created', row.id);
    res.status(201).json(row);
  });
  app.patch('/api/suppliers/:id', write, (req, res) => {
    const d = schemas.supplier.parse(req.body);
    if (!req.db.prepare('SELECT id FROM suppliers WHERE id=?').get(req.params.id))
      throw new AppError('Supplier not found.', 404);
    req.db
      .prepare('UPDATE suppliers SET name=?,email=?,phone=?,notes=? WHERE id=?')
      .run(d.name, d.email, d.phone, d.notes, req.params.id);
    audit(req.db, req.auth.user.id, 'Supplier updated', req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/products', write, (req, res) => {
    const d = schemas.product.parse(req.body);
    if (d.supplier_id && !req.db.prepare('SELECT id FROM suppliers WHERE id=?').get(d.supplier_id))
      throw new AppError('Supplier not found.');
    const row = insert(req.db, 'products', { id: id(), ...d });
    audit(req.db, req.auth.user.id, 'Product created', row.id);
    res.status(201).json(row);
  });
  app.patch('/api/products/:id', write, (req, res) => {
    const d = schemas.product.parse(req.body);
    const old = req.db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!old) throw new AppError('Product not found.', 404);
    if (old.external_id && (d.stock !== old.stock || d.price !== old.price))
      throw new AppError(
        'Change synced stock and selling price in Shopify. Supplier costs can be edited here.',
      );
    req.db
      .prepare(
        `UPDATE products SET ${Object.keys(d)
          .map((k) => `${k}=?`)
          .join(',')},cost_verified=1 WHERE id=?`,
      )
      .run(...Object.values(d), req.params.id);
    audit(req.db, req.auth.user.id, 'Product updated', req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/orders', write, (req, res) =>
    res.status(201).json(createOrder(req.db, req.body, req.auth.user.id)),
  );
  app.patch('/api/orders/:id', write, (req, res) => {
    const d = z
      .object({
        status: z.enum(orderStatuses).optional(),
        shipping_cost: money,
        rto_cost: money,
        notes: text,
        items: z.array(
          z.object({ id: z.string(), cost: money, supplier_id: z.string().nullable() }),
        ),
      })
      .parse(req.body);
    transaction(req.db, () => {
      const old = req.db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
      if (!old) throw new AppError('Order not found.', 404);
      const hasCredits = req.db
        .prepare('SELECT id FROM credit_ledger WHERE order_id=? LIMIT 1')
        .get(old.id);
      const hasSupplierPayment = req.db
        .prepare("SELECT id FROM payments WHERE order_id=? AND kind='Supplier payment' LIMIT 1")
        .get(old.id);
      if (hasCredits && d.status && d.status !== old.status)
        throw new AppError('Status is locked after supplier credits are recorded.');
      if (old.source === 'Shopify' && d.status && d.status !== old.status)
        throw new AppError('Synced order status is managed by Shopify and Shiprocket.');
      if (
        old.source === 'Manual' &&
        d.status &&
        d.status !== old.status &&
        (old.status === 'Cancelled' || d.status === 'Cancelled')
      ) {
        const localItems = req.db
          .prepare(
            'SELECT i.product_id,i.quantity,p.external_id FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=?',
          )
          .all(old.id)
          .filter((i) => !i.external_id);
        for (const item of localItems) {
          const delta = d.status === 'Cancelled' ? item.quantity : -item.quantity;
          const available = req.db
            .prepare('SELECT stock FROM products WHERE id=?')
            .get(item.product_id).stock;
          if (available + delta < 0)
            throw new AppError('Not enough local stock to reopen this cancelled order.');
          req.db
            .prepare('UPDATE products SET stock=stock+? WHERE id=?')
            .run(delta, item.product_id);
        }
      }
      for (const line of d.items) {
        const previous = req.db
          .prepare('SELECT * FROM order_items WHERE id=? AND order_id=?')
          .get(line.id, old.id);
        if (!previous) throw new AppError('Order item not found.');
        if (
          (hasCredits || hasSupplierPayment) &&
          (previous.cost !== line.cost || previous.supplier_id !== line.supplier_id)
        )
          throw new AppError(
            'Cost and supplier are locked once a credit or supplier payment is recorded.',
          );
        req.db
          .prepare('UPDATE order_items SET cost=?,supplier_id=?,cost_verified=1 WHERE id=?')
          .run(line.cost, line.supplier_id, line.id);
      }
      req.db
        .prepare(
          'UPDATE orders SET status=?,shipping_cost=?,rto_cost=?,notes=?,updated_at=?,shipping_verified=1,shipping_override=1 WHERE id=?',
        )
        .run(d.status || old.status, d.shipping_cost, d.rto_cost, d.notes, now(), old.id);
      collectCod(req.db, old.id);
      audit(req.db, req.auth.user.id, 'Order costs updated', old.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/expenses', write, (req, res) => {
    const d = schemas.expense.parse(req.body);
    const row = insert(req.db, 'expenses', {
      id: id(),
      ...d,
      created_by: req.auth.user.id,
      created_at: now(),
    });
    audit(req.db, req.auth.user.id, 'Expense recorded', row.id, { amount: d.amount });
    res.status(201).json(row);
  });
  app.delete('/api/expenses/:id', write, (req, res) => {
    const old = req.db.prepare('SELECT * FROM expenses WHERE id=?').get(req.params.id);
    if (!old) throw new AppError('Expense not found.', 404);
    transaction(req.db, () => {
      req.db.prepare('DELETE FROM expenses WHERE id=?').run(old.id);
      audit(req.db, req.auth.user.id, 'Expense removed', old.id, old);
    });
    res.json({ ok: true });
  });
  app.post('/api/payments', write, (req, res) =>
    res.status(201).json(recordPayment(req.db, req.body, req.auth.user.id)),
  );
  app.patch('/api/payments/:id/complete', write, (req, res) => {
    const row = req.db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
    if (!row) throw new AppError('Payment not found.', 404);
    req.db.prepare("UPDATE payments SET status='Completed' WHERE id=?").run(row.id);
    audit(req.db, req.auth.user.id, 'Payment completed', row.id);
    res.json({ ok: true });
  });
  app.post('/api/credits', write, (req, res) =>
    res.status(201).json(recordCredit(req.db, req.body, req.auth.user.id)),
  );
  app.post('/api/credits/use', write, (req, res) =>
    res.status(201).json(useCredit(req.db, req.body, req.auth.user.id)),
  );
  app.get('/api/settings', (req, res) =>
    res.json({
      business: setting(req.db, 'business', {
        name: 'Zupestore',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
      }),
      integrations: req.auth.demo
        ? ['shopify', 'shiprocket', 'settlements'].map((provider) => ({
            provider,
            configured: false,
            status: 'Demo mode',
            enabled: false,
          }))
        : integrations.publicConfig(),
      users:
        req.auth.user.role === 'admin'
          ? req.auth.demo
            ? []
            : db.prepare('SELECT id,name,email,role,active,created_at FROM users').all()
          : [],
      audit:
        req.auth.user.role === 'admin'
          ? req.db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50').all()
          : [],
      webhookFailures: req.auth.demo
        ? []
        : req.auth.user.role === 'admin'
          ? db
              .prepare(
                "SELECT id,provider,status,attempts,error,created_at FROM webhook_events WHERE status!='processed' ORDER BY created_at DESC LIMIT 30",
              )
              .all()
          : [],
    }),
  );
  app.patch('/api/settings/business', admin, (req, res) => {
    const d = z.object({ name: text.min(2).max(60) }).parse(req.body);
    setSetting(req.db, 'business', { ...d, currency: 'INR', timezone: 'Asia/Kolkata' });
    res.json({ ok: true });
  });
  app.post('/api/settings/integrations/:provider', admin, live, (req, res) => {
    const p = z.enum(['shopify', 'shiprocket', 'settlements']).parse(req.params.provider);
    const schema =
      p === 'shopify'
        ? z.object({
            shop: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/),
            token: z.string().max(500).optional(),
            webhookSecret: z.string().max(500).optional(),
            apiVersion: z
              .string()
              .regex(/^20\d{2}-(01|04|07|10)$/)
              .default('2026-07'),
            enabled: z.boolean().default(true),
          })
        : p === 'shiprocket'
          ? z.object({
              email: z.email(),
              password: z.string().max(500).optional(),
              webhookSecret: z.string().max(500).optional(),
              channelId: z.string().regex(/^\d*$/).default(''),
              enabled: z.boolean().default(true),
            })
          : z.object({ secret: z.string().min(24).max(500) });
    const d = schema.parse(req.body),
      old = integrations.config(p);
    if (
      p === 'shopify' &&
      old.shop &&
      old.shop !== d.shop &&
      db.prepare("SELECT id FROM orders WHERE source='Shopify' LIMIT 1").get()
    )
      throw new AppError(
        'This workspace already contains orders for another Shopify store. Use a separate workspace database for a different store.',
      );
    const clean = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''));
    integrations.save(p, {
      ...old,
      ...clean,
      ...(p === 'shiprocket' ? { token: null, tokenExpires: 0 } : {}),
    });
    setSetting(db, `status:${p}`, 'Configured · not verified');
    audit(db, req.auth.user.id, 'Integration settings updated', p);
    res.json({ ok: true });
  });
  app.post('/api/sync/:provider', admin, live, async (req, res) =>
    res.json(await integrations.sync(req.params.provider)),
  );
  app.post('/api/webhook-retry', admin, live, (_req, res) => {
    db.prepare("UPDATE webhook_events SET status='pending',attempts=0 WHERE status='failed'").run();
    res.json({ ok: true });
  });
  app.post('/api/users', admin, live, async (req, res) => {
    const d = credentials
      .extend({ name: text.min(2), role: z.enum(['admin', 'manager', 'viewer']) })
      .parse(req.body);
    const user = insert(db, 'users', {
      id: id(),
      name: d.name,
      email: d.email,
      password: await hashPassword(d.password),
      role: d.role,
      created_at: now(),
    });
    audit(db, req.auth.user.id, 'User created', user.id);
    res.status(201).json({ id: user.id });
  });
  app.patch('/api/users/:id', admin, live, async (req, res) => {
    const d = z
      .object({
        role: z.enum(['admin', 'manager', 'viewer']),
        active: z.boolean(),
        password: z.string().min(12).max(128).optional(),
      })
      .parse(req.body);
    const password = d.password ? await hashPassword(d.password) : null;
    transaction(db, () => {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      if (!u) throw new AppError('User not found.', 404);
      if (u.id === req.auth.user.id && (!d.active || d.role !== 'admin'))
        throw new AppError('You cannot disable or demote your own account.');
      if (
        u.role === 'admin' &&
        u.active &&
        (d.role !== 'admin' || !d.active) &&
        db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1
      )
        throw new AppError('At least one active administrator is required.');
      db.prepare('UPDATE users SET role=?,active=?,password=? WHERE id=?').run(
        d.role,
        d.active ? 1 : 0,
        password || u.password,
        u.id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      audit(db, req.auth.user.id, 'User access updated', u.id);
    });
    res.json({ ok: true });
  });
  app.get('/api/backup', admin, (req, res) => {
    const directory = join(dataDir, 'backups');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `commerce-${Date.now()}-${randomBytes(3).toString('hex')}.sqlite`);
    audit(req.db, req.auth.user.id, 'Database backup exported', 'backup');
    req.db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    res.download(file, `zupestore-backup-${today()}.sqlite`);
  });
  app.get('/api/export/:type', async (req, res) => {
    const { from, to } = bounds(req);
    const data = workspace(req.db, from, to);
    const type = z
      .enum([
        'orders',
        'expenses',
        'payments',
        'products',
        'suppliers',
        'credits',
        'pending-credits',
        'reports',
      ])
      .parse(req.params.type);
    const inPeriod = (r) => r.date >= from && r.date <= to;
    if (req.query.report === 'RTO analysis')
      data.orders = data.orders.filter((o) => o.status === 'RTO');
    if (req.query.supplier && req.query.supplier !== 'all')
      data.ledger = data.ledger.filter((l) => l.supplier_id === req.query.supplier);
    if (req.query.creditType && req.query.creditType !== 'all')
      data.ledger = data.ledger.filter((l) => l.type === req.query.creditType);
    let rows;
    if (type === 'orders')
      rows = data.orders.filter(inPeriod).map((o) => ({
        Order: o.number,
        Shopify_ID: o.external_id || '',
        Date: o.date,
        Customer: o.customer,
        Phone: o.phone,
        Products: o.items.map((i) => `${i.name} ×${i.quantity}`).join('; '),
        Payment_method: o.method,
        Status: o.status,
        Sales_INR: o.total / 100,
        Product_cost_INR: o.product_cost / 100,
        Shipping_INR: o.shipping_cost / 100,
        RTO_charges_INR: o.rto_cost / 100,
        Contribution_INR: o.profit / 100,
        Allocated_overhead_INR: o.allocated_expense / 100,
        Net_profit_INR: o.net_profit / 100,
        AWB: o.shipments.map((s) => s.awb).join('; '),
        NDR: o.shipments
          .map((s) => s.ndr)
          .filter(Boolean)
          .join('; '),
        Payment_status: o.payment_status,
      }));
    else if (type === 'credits')
      rows = data.ledger
        .filter(inPeriod)
        .map((l) => ({
          Date: l.date,
          Supplier: data.suppliers.find((s) => s.id === l.supplier_id)?.name,
          Order: data.orders.find((o) => o.id === l.order_id)?.number,
          Type: l.type,
          Amount_INR: l.amount / 100,
          Reference: l.reference,
          Notes: l.notes,
        }));
    else if (type === 'pending-credits')
      rows = data.orders
        .filter((o) => o.status === 'RTO' && o.product_cost > o.credit_received)
        .map((o) => ({
          Order: o.number,
          Date: o.date,
          Customer: o.customer,
          Product_cost_INR: o.product_cost / 100,
          Received_credit_INR: o.credit_received / 100,
          Pending_credit_INR: (o.product_cost - o.credit_received) / 100,
        }));
    else if (type === 'reports' && req.query.report === 'Performance')
      rows = performanceRows(
        data.timeline,
        z.enum(['Daily', 'Weekly', 'Monthly', 'Annual']).parse(req.query.group || 'Daily'),
      );
    else if (type === 'reports' && req.query.report === 'Ad spend')
      rows = data.expenses
        .filter((e) => inPeriod(e) && e.category === 'Meta Ads')
        .map((e) => ({
          Date: e.date,
          Campaign_notes: e.notes,
          Reference: e.reference,
          Ad_spend_INR: e.amount / 100,
        }));
    else if (type === 'reports')
      rows = Object.entries(data.metrics)
        .filter(([, v]) => typeof v === 'number')
        .map(([metric, value]) => ({
          Metric: metric,
          Value: [
            'sales',
            'productCost',
            'shipping',
            'adSpend',
            'otherExpenses',
            'grossProfit',
            'netProfit',
            'codCollected',
            'codRemitted',
            'codPending',
            'prepaid',
            'expenseTotal',
          ].includes(metric)
            ? Number(value) / 100
            : value,
        }));
    else
      rows = data[type]
        .filter((r) => !r.date || inPeriod(r))
        .map((r) =>
          Object.fromEntries(
            Object.entries(r)
              .filter(
                ([k, v]) =>
                  !['password', 'external_key', 'created_by'].includes(k) && typeof v !== 'object',
              )
              .map(([k, v]) => [
                [
                  'amount',
                  'cost',
                  'price',
                  'revenue',
                  'profit',
                  'balance',
                  'added',
                  'used',
                  'pending',
                ].includes(k)
                  ? `${k}_INR`
                  : k,
                [
                  'amount',
                  'cost',
                  'price',
                  'revenue',
                  'profit',
                  'balance',
                  'added',
                  'used',
                  'pending',
                ].includes(k)
                  ? Number(v) / 100
                  : v,
              ]),
          ),
        );
    const keys = rows.length ? Object.keys(rows[0]) : ['No records'];
    const safeCell = (v) =>
      typeof v === 'string' && /^[\s]*[=+\-@]/.test(v) ? `'${v}` : (v ?? '');
    if (req.query.format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      book.creator = 'Zupestore';
      const sheet = book.addWorksheet(type);
      sheet.columns = keys.map((k) => ({
        header: k,
        key: k,
        width: Math.min(40, Math.max(18, k.length + 4)),
      }));
      rows.forEach((r) =>
        sheet.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)]))),
      );
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5367ED' } };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="zupestore-${type}-${today()}.xlsx"`);
      await book.xlsx.write(res);
      res.end();
    } else {
      const cell = (v) => `"${String(safeCell(v)).replaceAll('"', '""')}"`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="zupestore-${type}-${today()}.csv"`);
      res.send(
        '\uFEFF' +
          [
            keys.map(cell).join(','),
            ...rows.map((r) => keys.map((k) => cell(r[k])).join(',')),
          ].join('\r\n'),
      );
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (String(error.message).includes('UNIQUE constraint'))
      return res
        .status(409)
        .json({
          error: 'This record already exists. Check the SKU, email, order number, or reference.',
        });
    if (String(error.message).includes('FOREIGN KEY constraint'))
      return res
        .status(400)
        .json({ error: 'The selected supplier, product, or order does not exist.' });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON request.' });
    if (!error.status) console.error(error);
    res
      .status(error.status || 500)
      .json({
        error: error.status ? error.message : 'An unexpected error occurred. Please try again.',
      });
  });
  return { app, db, demoDb, integrations };
}
