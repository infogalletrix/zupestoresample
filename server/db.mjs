import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','manager','viewer')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,mode TEXT NOT NULL DEFAULT 'live',expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,external_id TEXT UNIQUE,name TEXT NOT NULL,sku TEXT NOT NULL UNIQUE,supplier_id TEXT REFERENCES suppliers(id),cost INTEGER NOT NULL DEFAULT 0 CHECK(cost>=0),price INTEGER NOT NULL DEFAULT 0 CHECK(price>=0),stock INTEGER NOT NULL DEFAULT 0,category TEXT NOT NULL DEFAULT 'General',color TEXT NOT NULL DEFAULT '#e8edff',cost_verified INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,external_id TEXT UNIQUE,number TEXT NOT NULL UNIQUE,date TEXT NOT NULL,customer TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',city TEXT NOT NULL DEFAULT '',method TEXT NOT NULL CHECK(method IN ('COD','Prepaid')),status TEXT NOT NULL DEFAULT 'Confirmed',total INTEGER NOT NULL CHECK(total>=0),tax INTEGER NOT NULL DEFAULT 0,shipping_cost INTEGER NOT NULL DEFAULT 0,rto_cost INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'Manual',financial_status TEXT NOT NULL DEFAULT 'Pending',updated_at TEXT NOT NULL,external_updated_at TEXT,notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),external_id TEXT,product_id TEXT REFERENCES products(id),supplier_id TEXT REFERENCES suppliers(id),name TEXT NOT NULL,sku TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),cost INTEGER NOT NULL CHECK(cost>=0),price INTEGER NOT NULL CHECK(price>=0),cost_verified INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS shipments(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),external_id TEXT UNIQUE,awb TEXT UNIQUE,courier TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Confirmed',raw_status TEXT NOT NULL DEFAULT '',ndr TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,status_at TEXT NOT NULL,shipping_cost INTEGER);
    CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY,date TEXT NOT NULL,category TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),notes TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',created_by TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,order_id TEXT REFERENCES orders(id),supplier_id TEXT REFERENCES suppliers(id),date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('COD collected','COD remittance','Prepaid payment','Supplier payment','Customer refund')),amount INTEGER NOT NULL CHECK(amount>0),status TEXT NOT NULL CHECK(status IN ('Completed','Pending')),reference TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT 'Manual',external_key TEXT UNIQUE,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credit_ledger(id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL REFERENCES suppliers(id),order_id TEXT NOT NULL REFERENCES orders(id),type TEXT NOT NULL CHECK(type IN ('Credit added','Credit used')),amount INTEGER NOT NULL CHECK(amount>0),date TEXT NOT NULL,reference TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',idempotency_key TEXT NOT NULL UNIQUE,created_by TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_runs(id TEXT PRIMARY KEY,provider TEXT NOT NULL,status TEXT NOT NULL,message TEXT NOT NULL,records INTEGER NOT NULL DEFAULT 0,started_at TEXT NOT NULL,finished_at TEXT);
    CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,provider TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_orders_date ON orders(date);
    CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS ix_ledger_supplier ON credit_ledger(supplier_id);
    CREATE INDEX IF NOT EXISTS ix_payments_order ON payments(order_id);
    CREATE TABLE IF NOT EXISTS settlement_rows(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,source TEXT NOT NULL,filename TEXT NOT NULL,raw TEXT NOT NULL,normalized TEXT,status TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',order_id TEXT REFERENCES orders(id),payment_id TEXT REFERENCES payments(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_settlement_status ON settlement_rows(status);
  `);
  // Additive migrations preserve existing workspaces as the local schema evolves.
  for (const [table, column, definition] of [
    ['orders', 'shipping_verified', 'INTEGER NOT NULL DEFAULT 0'],
    ['orders', 'shipping_override', 'INTEGER NOT NULL DEFAULT 0'],
    ['payments', 'tax_amount', 'INTEGER NOT NULL DEFAULT 0'],
    ['payments', 'voided_at', 'TEXT'],
    ['payments', 'void_reason', "TEXT NOT NULL DEFAULT ''"],
    ['payments', 'bank_amount', 'INTEGER'],
    ['payments', 'fee_amount', 'INTEGER NOT NULL DEFAULT 0'],
    ['payments', 'shipping_deduction', 'INTEGER NOT NULL DEFAULT 0'],
    ['payments', 'rto_deduction', 'INTEGER NOT NULL DEFAULT 0'],
    ['payments', 'other_deduction', 'INTEGER NOT NULL DEFAULT 0'],
    ['payments', 'settlement_awb', "TEXT NOT NULL DEFAULT ''"],
    ['webhook_events', 'next_attempt_at', 'TEXT'],
  ]) {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function insert(db, table, row) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
  ).run(...keys.map((k) => row[k] ?? null));
  return row;
}
export function setting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, JSON.stringify(value));
}
export function audit(db, actor, action, entityId, details = {}) {
  insert(db, 'audit_log', {
    id: id(),
    actor,
    action,
    entity_id: entityId,
    details: JSON.stringify(details),
    created_at: now(),
  });
}
