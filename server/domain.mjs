import { z } from 'zod';
import { id, now, insert, transaction, audit, setting } from './db.mjs';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const money = z.number().int().min(0).max(100000000000);
export const positiveMoney = money.refine((n) => n > 0, 'Amount must be greater than zero');
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s),
    'Invalid date',
  );
export const text = z.string().trim().max(1000);
export const categories = [
  'Meta Ads',
  'Product cost',
  'Shiprocket / shipping',
  'RTO charges',
  'Software / subscriptions',
  'Other expenses',
];
export const orderStatuses = ['Confirmed', 'Shipped', 'Delivered', 'NDR', 'RTO', 'Cancelled'];
export const manualTransitions = {
  Confirmed: ['Shipped', 'Delivered', 'NDR', 'RTO', 'Cancelled'],
  Shipped: ['Delivered', 'NDR', 'RTO'],
  NDR: ['Shipped', 'Delivered', 'RTO'],
  Delivered: [],
  RTO: [],
  Cancelled: [],
};
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const schemas = {
  supplier: z.object({
    name: text.min(2),
    email: z.union([z.email(), z.literal('')]).default(''),
    phone: text.default(''),
    notes: text.default(''),
  }),
  product: z.object({
    name: text.min(2),
    sku: text.min(1),
    supplier_id: z.string().nullable(),
    cost: money,
    price: money,
    stock: z.number().int().min(0),
    category: text.default('General'),
  }),
  expense: z.object({
    date,
    category: z.enum(categories),
    amount: positiveMoney,
    notes: text.default(''),
    reference: text.default(''),
  }),
  payment: z.object({
    order_id: z.string(),
    supplier_id: z.string().nullable().default(null),
    date,
    kind: z.enum(['COD remittance', 'Prepaid payment', 'Supplier payment', 'Customer refund']),
    amount: positiveMoney,
    tax_amount: money.default(0),
    status: z.enum(['Completed', 'Pending']),
    reference: text.min(1),
    idempotency_key: z.string().min(8),
  }),
  credit: z.object({
    supplier_id: z.string(),
    order_id: z.string(),
    amount: positiveMoney,
    date,
    reference: text.min(1),
    notes: text.default(''),
    received: z.literal(true),
    idempotency_key: z.string().min(8),
  }),
  useCredit: z.object({
    supplier_id: z.string(),
    order_id: z.string(),
    amount: positiveMoney,
    date,
    reference: text.min(1),
    notes: text.default(''),
    idempotency_key: z.string().min(8),
  }),
  order: z.object({
    date,
    customer: text.min(2),
    phone: text.default(''),
    email: text.default(''),
    city: text.default(''),
    method: z.enum(['COD', 'Prepaid']),
    status: z.enum(orderStatuses).default('Confirmed'),
    shipping_cost: money.default(0),
    rto_cost: money.default(0),
    tax: money.default(0),
    notes: text.default(''),
    items: z
      .array(
        z.object({
          product_id: z.string(),
          quantity: z.number().int().min(1).max(10000),
          price: money,
        }),
      )
      .min(1)
      .max(100),
  }),
};
export function supplierBalance(db, supplierId) {
  return db
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN type='Credit added' THEN amount ELSE -amount END),0) AS balance FROM credit_ledger WHERE supplier_id=?",
    )
    .get(supplierId).balance;
}
export function supplierOrderCost(db, orderId, supplierId) {
  return db
    .prepare(
      'SELECT COALESCE(SUM(cost*quantity),0) AS cost FROM order_items WHERE order_id=? AND supplier_id=?',
    )
    .get(orderId, supplierId).cost;
}
function ledgerSum(db, orderId, supplierId, type) {
  return db
    .prepare(
      'SELECT COALESCE(SUM(amount),0) AS amount FROM credit_ledger WHERE order_id=? AND supplier_id=? AND type=?',
    )
    .get(orderId, supplierId, type).amount;
}
function paymentSum(
  db,
  orderId,
  kind,
  supplierId = null,
  includePending = false,
  excludeId = null,
) {
  const rows = db
    .prepare('SELECT * FROM payments WHERE order_id=? AND kind=? AND voided_at IS NULL')
    .all(orderId, kind);
  return rows
    .filter(
      (r) =>
        r.id !== excludeId &&
        (includePending || r.status === 'Completed') &&
        (!supplierId || r.supplier_id === supplierId),
    )
    .reduce((s, r) => s + r.amount, 0);
}
function checkLedgerDate(db, data, order) {
  if (data.date < order.date || data.date > today())
    throw new AppError('The ledger date must be between the order date and today.');
  const latest = db
    .prepare('SELECT MAX(date) AS date FROM credit_ledger WHERE supplier_id=?')
    .get(data.supplier_id).date;
  if (latest && data.date < latest)
    throw new AppError(
      'Use a date on or after the latest entry for this supplier to preserve the running balance.',
    );
}
function checkReplay(previous, data, type) {
  if (
    previous &&
    (previous.order_id !== data.order_id ||
      previous.supplier_id !== data.supplier_id ||
      previous.amount !== data.amount ||
      previous.date !== data.date ||
      previous.reference !== data.reference ||
      previous.notes !== data.notes ||
      previous.type !== type)
  )
    throw new AppError('This request key was already used for a different ledger entry.', 409);
  return previous;
}
export function recordCredit(db, input, actor) {
  const data = schemas.credit.parse(input);
  return transaction(db, () => {
    const previous = db
      .prepare('SELECT * FROM credit_ledger WHERE idempotency_key=?')
      .get(data.idempotency_key);
    if (previous) return checkReplay(previous, data, 'Credit added');
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(data.order_id);
    if (!order || order.status !== 'RTO')
      throw new AppError('Credit can only be received for an RTO order.');
    checkLedgerDate(db, data, order);
    const eligible =
      supplierOrderCost(db, data.order_id, data.supplier_id) -
      ledgerSum(db, data.order_id, data.supplier_id, 'Credit added');
    if (data.amount > eligible)
      throw new AppError(
        'Credit exceeds the uncredited product cost for this supplier and return.',
      );
    const row = insert(db, 'credit_ledger', {
      id: id(),
      supplier_id: data.supplier_id,
      order_id: data.order_id,
      type: 'Credit added',
      amount: data.amount,
      date: data.date,
      reference: data.reference,
      notes: data.notes,
      idempotency_key: data.idempotency_key,
      created_by: actor,
      created_at: now(),
    });
    audit(db, actor, 'RTO credit received', row.id, {
      supplier: data.supplier_id,
      amount: data.amount,
    });
    return row;
  });
}
export function useCredit(db, input, actor) {
  const data = schemas.useCredit.parse(input);
  return transaction(db, () => {
    const previous = db
      .prepare('SELECT * FROM credit_ledger WHERE idempotency_key=?')
      .get(data.idempotency_key);
    if (previous) return checkReplay(previous, data, 'Credit used');
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(data.order_id);
    if (!order || ['RTO', 'Cancelled'].includes(order.status))
      throw new AppError('Select an eligible supplier purchase.');
    checkLedgerDate(db, data, order);
    const payable =
      supplierOrderCost(db, data.order_id, data.supplier_id) -
      ledgerSum(db, data.order_id, data.supplier_id, 'Credit used') -
      paymentSum(db, data.order_id, 'Supplier payment', data.supplier_id, true);
    if (data.amount > payable)
      throw new AppError('Credit exceeds the unpaid purchase amount for this supplier.');
    if (data.amount > supplierBalance(db, data.supplier_id))
      throw new AppError(
        'Insufficient credit with this supplier. Credits cannot be transferred between suppliers.',
      );
    const row = insert(db, 'credit_ledger', {
      id: id(),
      supplier_id: data.supplier_id,
      order_id: data.order_id,
      type: 'Credit used',
      amount: data.amount,
      date: data.date,
      reference: data.reference,
      notes: data.notes,
      idempotency_key: data.idempotency_key,
      created_by: actor,
      created_at: now(),
    });
    audit(db, actor, 'Supplier credit used', row.id, {
      supplier: data.supplier_id,
      amount: data.amount,
    });
    return row;
  });
}
function validatePayment(db, d, excludeId = null) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(d.order_id);
  if (!order) throw new AppError('Order not found.');
  if (d.date < order.date || d.date > today())
    throw new AppError('Payment date must be between the order date and today.');
  if (order.source === 'Shopify' && ['Prepaid payment', 'Customer refund'].includes(d.kind))
    throw new AppError(
      'Manage prepaid payments and refunds for this order in Shopify. They synchronize automatically.',
    );
  if (d.tax_amount > 0 && d.kind !== 'Customer refund')
    throw new AppError('Refund tax is only valid for customer refunds.');
  if (d.tax_amount > d.amount) throw new AppError('Refund tax cannot exceed the refund amount.');
  if (
    db
      .prepare('SELECT id FROM payments WHERE order_id=? AND kind=? AND reference=? AND id!=?')
      .get(d.order_id, d.kind, d.reference, excludeId || '')
  )
    throw new AppError('This payment reference has already been recorded for this order.');
  if (order.status === 'Cancelled' && ['Supplier payment', 'Prepaid payment'].includes(d.kind))
    throw new AppError('This order is cancelled. Record a refund instead of a new payment.');
  if (d.kind !== 'Supplier payment' && d.supplier_id)
    throw new AppError('Only supplier payments can have a supplier.');
  let limit;
  if (d.kind === 'COD remittance') {
    if (order.method !== 'COD') throw new AppError('Select a COD order.');
    limit =
      paymentSum(db, order.id, 'COD collected') -
      paymentSum(db, order.id, d.kind, null, true, excludeId);
  } else if (d.kind === 'Prepaid payment') {
    if (order.method !== 'Prepaid') throw new AppError('Select a prepaid order.');
    limit = order.total - paymentSum(db, order.id, d.kind, null, true, excludeId);
  } else if (d.kind === 'Supplier payment') {
    if (!d.supplier_id) throw new AppError('Select a supplier.');
    limit =
      supplierOrderCost(db, order.id, d.supplier_id) -
      ledgerSum(db, order.id, d.supplier_id, 'Credit used') -
      paymentSum(db, order.id, d.kind, d.supplier_id, true, excludeId);
  } else {
    limit =
      paymentSum(db, order.id, 'Prepaid payment') +
      paymentSum(db, order.id, 'COD collected') -
      paymentSum(db, order.id, 'Customer refund', null, true, excludeId);
    const refundedTax = db
      .prepare(
        "SELECT COALESCE(SUM(tax_amount),0) AS amount FROM payments WHERE order_id=? AND kind='Customer refund' AND voided_at IS NULL AND id!=?",
      )
      .get(order.id, excludeId || '').amount;
    if (d.tax_amount > Math.max(0, order.tax - refundedTax))
      throw new AppError('Refund tax exceeds the remaining tax on this order.');
  }
  if (d.amount > limit)
    throw new AppError('Amount exceeds the outstanding balance for this payment.');
}
export function recordPayment(db, input, actor) {
  const d = schemas.payment.parse(input);
  return transaction(db, () => {
    const externalKey = `manual:${d.idempotency_key}`;
    const old = db.prepare('SELECT * FROM payments WHERE external_key=?').get(externalKey);
    if (old) {
      if (
        ['amount', 'order_id', 'supplier_id', 'kind', 'reference', 'tax_amount'].some(
          (key) => old[key] !== d[key],
        )
      )
        throw new AppError('This event was already used for a different payment.', 409);
      return old;
    }
    validatePayment(db, d);
    const { idempotency_key, ...fields } = d;
    const row = insert(db, 'payments', {
      ...fields,
      id: id(),
      source: 'Manual',
      external_key: externalKey,
      created_at: now(),
    });
    audit(db, actor, 'Payment recorded', row.id, { amount: d.amount, kind: d.kind });
    return row;
  });
}
export function completePayment(db, paymentId, inputDate, actor) {
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!row) throw new AppError('Payment not found.', 404);
    if (row.source !== 'Manual')
      throw new AppError('Synced transactions are managed by their provider.', 409);
    if (row.voided_at) throw new AppError('A cancelled payment cannot be completed.', 409);
    if (row.status === 'Completed') return row;
    const completedDate = date.parse(inputDate || today());
    validatePayment(db, { ...row, date: completedDate }, row.id);
    db.prepare("UPDATE payments SET status='Completed',date=? WHERE id=?").run(
      completedDate,
      row.id,
    );
    audit(db, actor, 'Payment completed', row.id, { amount: row.amount, date: completedDate });
    return { ...row, status: 'Completed', date: completedDate };
  });
}
export function cancelPayment(db, paymentId, reason, actor) {
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!row) throw new AppError('Payment not found.', 404);
    if (row.source !== 'Manual')
      throw new AppError('Synced transactions are managed by their provider.', 409);
    if (row.voided_at) return { ...row, status: 'Cancelled' };
    if (row.status !== 'Pending')
      throw new AppError(
        'Completed payments cannot be cancelled. Record a refund where appropriate.',
        409,
      );
    const note = text.min(3).parse(reason);
    const at = now();
    db.prepare('UPDATE payments SET voided_at=?,void_reason=? WHERE id=?').run(at, note, row.id);
    audit(db, actor, 'Pending payment cancelled', row.id, { amount: row.amount, reason: note });
    return { ...row, status: 'Cancelled', voided_at: at, void_reason: note };
  });
}
export function collectCod(db, orderId, onDate = today()) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (order?.status === 'Delivered' && order.method === 'COD' && order.total > 0) {
    db.prepare(
      `INSERT INTO payments(id,order_id,date,kind,amount,status,reference,source,external_key,created_at) VALUES(?,?,?,'COD collected',?,'Completed',?,'Delivery',?,?) ON CONFLICT(external_key) DO NOTHING`,
    ).run(id(), orderId, onDate, order.total, order.number, `collected:${orderId}`, now());
  }
}
export function createOrder(db, input, actor) {
  const d = schemas.order.parse(input);
  if (d.date > today()) throw new AppError('An order date cannot be in the future.');
  return transaction(db, () => {
    const items = d.items.map((line) => {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(line.product_id);
      if (!p) throw new AppError('Product not found.');
      return { ...line, product: p };
    });
    const count = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    let num = count + 1001;
    while (db.prepare('SELECT id FROM orders WHERE number=?').get(`#N${num}`)) num++;
    const order = {
      id: id(),
      number: `#N${num}`,
      date: d.date,
      customer: d.customer,
      phone: d.phone,
      email: d.email,
      city: d.city,
      method: d.method,
      status: d.status,
      total: money.parse(items.reduce((s, l) => s + l.price * l.quantity, 0) + d.tax),
      tax: d.tax,
      shipping_cost: d.shipping_cost,
      rto_cost: d.rto_cost,
      shipping_verified: 1,
      shipping_override: 1,
      source: 'Manual',
      updated_at: now(),
      notes: d.notes,
    };
    insert(db, 'orders', order);
    items.forEach((l) =>
      insert(db, 'order_items', {
        id: id(),
        order_id: order.id,
        product_id: l.product.id,
        supplier_id: l.product.supplier_id,
        name: l.product.name,
        sku: l.product.sku,
        quantity: l.quantity,
        cost: l.product.cost,
        price: l.price,
        cost_verified: l.product.cost_verified,
      }),
    );
    if (d.status !== 'Cancelled')
      for (const l of items) {
        if (!l.product.external_id) {
          const available = db
            .prepare('SELECT stock FROM products WHERE id=?')
            .get(l.product.id).stock;
          if (available < l.quantity)
            throw new AppError(`Insufficient available stock for ${l.product.name}.`);
          db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(l.quantity, l.product.id);
        }
      }
    collectCod(db, order.id, d.date);
    audit(db, actor, 'Order created', order.id);
    return order;
  });
}

// Allocate integer paise with largest remainders; no rounding drift between products.
export function allocatePaise(total, weights) {
  if (!weights.length) return [];
  const sign = total < 0 ? -1 : 1;
  const amount = BigInt(Math.abs(total));
  let basis = weights.map((w) => BigInt(Math.max(0, w)));
  if (basis.every((w) => w === 0n)) basis = basis.map(() => 1n);
  const divisor = basis.reduce((sum, w) => sum + w, 0n);
  const shares = basis.map((w, index) => ({
    index,
    value: Number((amount * w) / divisor),
    remainder: (amount * w) % divisor,
  }));
  let remaining = Math.abs(total) - shares.reduce((sum, r) => sum + r.value, 0);
  for (const r of [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (!remaining) break;
    r.value++;
    remaining--;
  }
  return shares.map((r) => (r.value === 0 ? 0 : sign * r.value));
}
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

export function workspace(db, from = '0000-01-01', to = '9999-12-31') {
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
  const products = db.prepare('SELECT * FROM products ORDER BY name').all();
  const items = db.prepare('SELECT * FROM order_items').all();
  const shipments = db.prepare('SELECT * FROM shipments ORDER BY updated_at DESC').all();
  const payments = db
    .prepare('SELECT * FROM payments ORDER BY date DESC,created_at DESC')
    .all()
    .map((p) => ({ ...p, status: p.voided_at ? 'Cancelled' : p.status }));
  const ledger = db.prepare('SELECT * FROM credit_ledger ORDER BY date DESC,created_at DESC').all();
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY date DESC,created_at DESC').all();
  const between = (r) => r.date >= from && r.date <= to;
  const itemsByOrder = groupBy(items, 'order_id'),
    paymentsByOrder = groupBy(payments, 'order_id'),
    ledgerByOrder = groupBy(ledger, 'order_id'),
    shipmentsByOrder = groupBy(shipments, 'order_id');
  const orders = db
    .prepare('SELECT * FROM orders ORDER BY date DESC,number DESC')
    .all()
    .map((o) => {
      const lines = itemsByOrder.get(o.id) || [];
      const pay = (paymentsByOrder.get(o.id) || []).filter((p) => p.status === 'Completed');
      const sum = (k) => pay.filter((p) => p.kind === k).reduce((s, p) => s + p.amount, 0);
      const credits = ledgerByOrder.get(o.id) || [];
      const cost = lines.reduce((s, i) => s + i.cost * i.quantity, 0);
      const costRecovery = credits
        .filter((l) => l.type === 'Credit added')
        .reduce((s, l) => s + l.amount, 0);
      const used = credits
        .filter((l) => l.type === 'Credit used')
        .reduce((s, l) => s + l.amount, 0);
      const recognized = o.status === 'Delivered';
      const incurred = !['Confirmed', 'Cancelled'].includes(o.status);
      const refundTax = pay
        .filter((p) => p.kind === 'Customer refund')
        .reduce((s, p) => s + (p.tax_amount || 0), 0);
      const revenue = recognized
        ? Math.max(0, o.total - o.tax - sum('Customer refund') + refundTax)
        : 0;
      const profit = revenue - (incurred ? cost : 0) + costRecovery - o.shipping_cost - o.rto_cost;
      const collected = sum('COD collected'),
        remitted = sum('COD remittance'),
        prepaid = sum('Prepaid payment');
      return {
        ...o,
        items: lines,
        shipments: shipmentsByOrder.get(o.id) || [],
        allowed_statuses: [
          o.status,
          ...(o.source === 'Manual' ? manualTransitions[o.status] || [] : []),
        ],
        product_cost: cost,
        credit_received: costRecovery,
        credit_used: used,
        payable: Math.max(0, cost - used - sum('Supplier payment')),
        revenue,
        profit,
        cod_collected: collected,
        cod_remitted: remitted,
        cod_pending: Math.max(0, collected - remitted),
        prepaid,
        refunded: sum('Customer refund'),
        payment_status:
          o.method === 'COD'
            ? collected
              ? remitted >= collected
                ? 'Remitted'
                : remitted
                  ? 'Partially remitted'
                  : 'Awaiting remittance'
              : 'Not collected'
            : prepaid >= o.total
              ? 'Paid'
              : prepaid
                ? 'Partially paid'
                : 'Pending',
        cost_verified: lines.every((l) => l.cost_verified && l.supplier_id),
      };
    });
  const selected = orders.filter(between),
    selectedExpenses = expenses.filter(between);
  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
  const sales = sum(selected, 'revenue'),
    shipping = sum(selected, 'shipping_cost') + sum(selected, 'rto_cost');
  const productCost = selected.reduce(
    (s, o) =>
      s + (!['Confirmed', 'Cancelled'].includes(o.status) ? o.product_cost : 0) - o.credit_received,
    0,
  );
  const adSpend = selectedExpenses
    .filter((e) => e.category === 'Meta Ads')
    .reduce((s, e) => s + e.amount, 0);
  const expenseTotal = sum(selectedExpenses, 'amount');
  const net = sales - productCost - shipping - expenseTotal;
  const totalAdded = ledger
    .filter((l) => l.type === 'Credit added')
    .reduce((s, l) => s + l.amount, 0);
  const totalUsed = ledger
    .filter((l) => l.type === 'Credit used')
    .reduce((s, l) => s + l.amount, 0);
  const pending = orders
    .filter((o) => o.status === 'RTO')
    .reduce((s, o) => s + Math.max(0, o.product_cost - o.credit_received), 0);
  const supplierRows = suppliers.map((s) => {
    const ls = ledger.filter((l) => l.supplier_id === s.id),
      added = ls.filter((l) => l.type === 'Credit added').reduce((n, l) => n + l.amount, 0),
      used = ls.filter((l) => l.type === 'Credit used').reduce((n, l) => n + l.amount, 0);
    return {
      ...s,
      added,
      used,
      balance: added - used,
      pending: orders
        .filter((o) => o.status === 'RTO')
        .reduce(
          (n, o) =>
            n +
            Math.max(
              0,
              o.items
                .filter((i) => i.supplier_id === s.id)
                .reduce((m, i) => m + i.cost * i.quantity, 0) -
                ls
                  .filter((l) => l.order_id === o.id && l.type === 'Credit added')
                  .reduce((m, l) => m + l.amount, 0),
            ),
          0,
        ),
      products: products.filter((p) => p.supplier_id === s.id).length,
    };
  });
  const productTotals = new Map(
    products.map((p) => [p.id, { revenue: 0, profit: 0, orders: 0, quantity: 0 }]),
  );
  for (const o of selected) {
    const weights = o.items.map((i) => i.price * i.quantity);
    const revenue = allocatePaise(o.revenue, weights);
    const shipping = allocatePaise(o.shipping_cost + o.rto_cost, weights);
    const recovery = o.items.map(() => 0);
    for (const entry of (ledgerByOrder.get(o.id) || []).filter((l) => l.type === 'Credit added')) {
      const indexes = o.items
        .map((line, i) => (line.supplier_id === entry.supplier_id ? i : -1))
        .filter((i) => i >= 0);
      const shares = allocatePaise(
        entry.amount,
        indexes.map((i) => o.items[i].cost * o.items[i].quantity),
      );
      indexes.forEach((i, j) => (recovery[i] += shares[j]));
    }
    const seen = new Set();
    o.items.forEach((line, i) => {
      const row = productTotals.get(line.product_id);
      if (!row) return;
      row.revenue += revenue[i];
      row.profit +=
        revenue[i] -
        (['Confirmed', 'Cancelled'].includes(o.status) ? 0 : line.cost * line.quantity) +
        recovery[i] -
        shipping[i];
      row.quantity += line.quantity;
      if (!seen.has(line.product_id)) row.orders++;
      seen.add(line.product_id);
    });
  }
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  const productRows = products.map((p) => ({
    ...p,
    supplier: supplierNames.get(p.supplier_id) || 'Unassigned',
    ...productTotals.get(p.id),
  }));
  const timeline = new Map();
  selected.forEach((o) => {
    if (!timeline.has(o.date))
      timeline.set(o.date, { date: o.date, sales: 0, profit: 0, orders: 0 });
    const row = timeline.get(o.date);
    row.sales += o.revenue;
    row.profit += o.profit;
    row.orders++;
  });
  selectedExpenses.forEach((e) => {
    if (!timeline.has(e.date))
      timeline.set(e.date, { date: e.date, sales: 0, profit: 0, orders: 0 });
    timeline.get(e.date).profit -= e.amount;
  });
  // Allocate period overhead once, equally by order, preserving the exact total in paise.
  const allocation = selected.length ? Math.floor(expenseTotal / selected.length) : 0,
    remainder = selected.length ? expenseTotal % selected.length : 0;
  const allocated = new Map(selected.map((o, i) => [o.id, allocation + (i < remainder ? 1 : 0)]));
  orders.forEach((o) => {
    o.allocated_expense = allocated.get(o.id) || 0;
    o.net_profit = o.profit - o.allocated_expense;
  });
  const statusCounts = Object.fromEntries(
    orderStatuses.map((s) => [s, selected.filter((o) => o.status === s).length]),
  );
  return {
    business: setting(db, 'business', {
      name: 'Zupestore',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    }),
    orders,
    products: productRows,
    suppliers: supplierRows,
    expenses,
    payments,
    ledger,
    shipments,
    paymentMetrics: {
      codCollected: payments
        .filter((p) => between(p) && p.status === 'Completed' && p.kind === 'COD collected')
        .reduce((s, p) => s + p.amount, 0),
      codRemitted: payments
        .filter((p) => between(p) && p.status === 'Completed' && p.kind === 'COD remittance')
        .reduce((s, p) => s + p.amount, 0),
      prepaid: payments
        .filter((p) => between(p) && p.status === 'Completed' && p.kind === 'Prepaid payment')
        .reduce((s, p) => s + p.amount, 0),
      codPending: sum(orders, 'cod_pending'),
    },
    metrics: {
      totalOrders: selected.length,
      confirmed: statusCounts.Confirmed,
      shipped: statusCounts.Shipped,
      delivered: statusCounts.Delivered,
      ndr: statusCounts.NDR,
      rto: statusCounts.RTO,
      sales,
      productCost,
      shipping,
      adSpend,
      otherExpenses: expenseTotal - adSpend,
      grossProfit: sales - productCost - shipping,
      netProfit: net,
      margin: sales ? (net / sales) * 100 : 0,
      rtoRate: selected.filter((o) => !['Confirmed', 'Cancelled'].includes(o.status)).length
        ? (statusCounts.RTO /
            selected.filter((o) => !['Confirmed', 'Cancelled'].includes(o.status)).length) *
          100
        : 0,
      codCollected: sum(selected, 'cod_collected'),
      codRemitted: sum(selected, 'cod_remitted'),
      codPending: sum(selected, 'cod_pending'),
      prepaid: sum(selected, 'prepaid'),
      missingCosts: selected.filter(
        (o) =>
          !o.cost_verified ||
          (!['Confirmed', 'Cancelled'].includes(o.status) && !o.shipping_verified),
      ).length,
      expenseTotal,
      statusCounts,
    },
    credit: {
      added: totalAdded,
      used: totalUsed,
      balance: totalAdded - totalUsed,
      pending,
      creditedOrders: new Set(
        ledger.filter((l) => l.type === 'Credit added').map((l) => l.order_id),
      ).size,
      usedOrders: new Set(ledger.filter((l) => l.type === 'Credit used').map((l) => l.order_id))
        .size,
      pendingOrders: orders.filter((o) => o.status === 'RTO' && o.credit_received < o.product_cost)
        .length,
    },
    timeline: [...timeline.values()].sort((a, b) => a.date.localeCompare(b.date)),
    syncRuns: db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 20').all(),
  };
}
