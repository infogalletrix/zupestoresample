import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import { AppError, date, money, today } from './domain.mjs';
import { id, now, insert, transaction, audit } from './db.mjs';

const MAX_ROWS = 10000;
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const clean = (v) => String(v ?? '').trim();
const key = (v) =>
  clean(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export const reportFields = {
  order_number: ['Order ID', 'Order Number', 'Channel Order ID', 'Shopify Order ID'],
  awb: ['AWB', 'AWB Code', 'AWB Number', 'AWB No'],
  reference: ['UTR', 'UTR Number', 'UTR No', 'Bank Reference', 'Remittance ID', 'Transaction ID'],
  date: ['Remittance Date', 'Payment Date', 'Payout Date', 'Settlement Date'],
  gross: ['Gross Amount', 'Gross Settled Amount', 'COD Amount', 'COD Collected'],
  bank: [
    'Bank Amount',
    'Net Amount',
    'Net Remittance',
    'Remitted Amount',
    'Remittance Amount',
    'Net Payout',
  ],
  fees: ['Settlement Fees', 'Payment Fees', 'COD Fees', 'Remittance Fees'],
  shipping: ['Shipping Deduction', 'Freight Deduction'],
  rto: ['RTO Deduction'],
  other: ['Other Deduction', 'Wallet Transfer'],
  status: ['Remittance Status', 'Payment Status', 'Settlement Status', 'Status'],
};
export function parseMoney(value, optional = false) {
  if (clean(value) === '' && optional) return 0;
  const s = clean(value)
    .replace(/^(?:INR|Rs\.?|₹)\s*/i, '')
    .replaceAll(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s))
    throw new AppError(`Invalid INR amount: ${clean(value).slice(0, 40)}`);
  const [whole, fraction = ''] = s.split('.');
  return money.parse(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
function reportDate(value, format = 'DMY') {
  if (value instanceof Date) return date.parse(value.toISOString().slice(0, 10));
  const s = clean(value);
  if (/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(s)) return date.parse(s.slice(0, 10));
  const match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s.*)?$/);
  if (!match) throw new AppError('Use YYYY-MM-DD or the configured day/month date format.');
  return date.parse(
    `${match[3]}-${(format === 'MDY' ? match[1] : match[2]).padStart(2, '0')}-${(format === 'MDY' ? match[2] : match[1]).padStart(2, '0')}`,
  );
}
export function parseCsv(input) {
  const source = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else cell += ch;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (ch !== ',') {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        if (ch === '\r' && source[i + 1] === '\n') i++;
      }
    } else {
      if (closed || ch === '"') throw new AppError('Malformed CSV quoting.');
      cell += ch;
    }
    if (rows.length > MAX_ROWS || row.length > 100 || cell.length > 10000)
      throw new AppError('Report exceeds the row, column or cell limit.');
  }
  if (quoted) throw new AppError('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export async function readReport(buffer, filename = 'report.csv') {
  if (!buffer.length || buffer.length > MAX_REPORT_BYTES)
    throw new AppError('Choose a report between 1 byte and 8 MB.');
  let rows;
  if (/\.xlsx$/i.test(filename) || buffer.subarray(0, 2).toString() === 'PK') {
    const archive = await unzipper.Open.buffer(buffer);
    if (
      archive.files.length > 1000 ||
      archive.files.reduce((s, f) => s + f.uncompressedSize, 0) > 64 * 1024 * 1024 ||
      archive.files.some((f) => f.uncompressedSize > 32 * 1024 * 1024)
    )
      throw new AppError('The expanded Excel report is too large. Export a smaller CSV report.');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets.find((s) => s.rowCount > 1);
    if (!sheet || sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > 100)
      throw new AppError('Choose an Excel report with at most 10,000 rows and 100 columns.');
    rows = [];
    sheet.eachRow((row) =>
      rows.push(
        row.values.slice(1).map((v) => {
          if (v && typeof v === 'object' && !(v instanceof Date))
            throw new AppError('Reports must contain plain values, not formulas or linked cells.');
          return v instanceof Date ? v.toISOString().slice(0, 10) : v;
        }),
      ),
    );
  } else if (/\.xls$/i.test(filename) || buffer[0] === 0xd0)
    throw new AppError('Save the legacy XLS report as CSV or XLSX before importing.');
  else rows = parseCsv(buffer.toString('utf8'));
  if (rows.length < 2)
    throw new AppError('The report needs a header row and at least one payment.');
  const headers = rows.shift().map(clean);
  if (headers.some((h) => !h) || new Set(headers.map(key)).size !== headers.length)
    throw new AppError('Report column names must be present and unique.');
  if (rows.length > MAX_ROWS) throw new AppError('Import at most 10,000 rows at a time.');
  return {
    headers,
    rows: rows.map((r) => {
      if (r.length > headers.length)
        throw new AppError('A report row contains more values than the header.');
      return Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']));
    }),
  };
}
export function normalizeReportRow(raw, options = {}) {
  const entries = Object.entries(raw);
  const get = (field) => {
    const column = options.mapping?.[field];
    if (column === '-') return '';
    if (column) return raw[column] ?? '';
    const aliases = [field, ...reportFields[field]].map(key);
    const matches = entries.filter(([header]) => aliases.includes(key(header)));
    if (matches.length > 1)
      throw new AppError(`Choose one column for ${field}; multiple columns match.`);
    return matches[0]?.[1] ?? '';
  };
  const result = {
    order_number: clean(get('order_number')),
    awb: clean(get('awb')),
    reference: clean(get('reference')),
    date: reportDate(get('date'), options.dateFormat),
    fees: parseMoney(get('fees'), true),
    shipping: parseMoney(get('shipping'), true),
    rto: parseMoney(get('rto'), true),
    other: parseMoney(get('other'), true),
  };
  if (!result.order_number && !result.awb)
    throw new AppError('An order number or AWB is required.');
  if (!result.reference || result.reference.length > 200)
    throw new AppError('A bank reference / UTR is required.');
  if (result.date > today()) throw new AppError('A remittance date cannot be in the future.');
  const status = key(get('status'));
  result.completed =
    [
      'completed',
      'remitted',
      'paid',
      'success',
      'successful',
      'settled',
      'processed',
      'transferred',
    ].includes(status) ||
    (!status && options.completedOnly === true);
  if (!status && !options.completedOnly)
    throw new AppError(
      'Map the payment status, or confirm this report contains completed remittances only.',
    );
  const gross = clean(get('gross')),
    bank = clean(get('bank'));
  if (!gross && !bank) throw new AppError('Map the gross settled amount or bank amount.');
  const deductions = result.fees + result.shipping + result.rto + result.other;
  result.bank = bank ? parseMoney(bank) : null;
  if (result.bank === null && deductions)
    throw new AppError('A bank amount is required when the report includes deductions.');
  result.gross = gross ? parseMoney(gross) : result.bank + deductions;
  money.parse(result.gross);
  if (result.bank !== null) money.parse(result.bank);
  if (result.gross <= 0 || (result.bank !== null && result.gross !== result.bank + deductions))
    throw new AppError('Gross settled amount must equal bank amount plus all deductions.');
  return result;
}
function matchOrder(db, row) {
  const byAwb = row.awb
    ? db
        .prepare('SELECT o.* FROM orders o JOIN shipments s ON s.order_id=o.id WHERE s.awb=?')
        .get(row.awb)
    : null;
  const number = row.order_number.replace(/^#/, '');
  const byNumber = row.order_number
    ? db
        .prepare('SELECT * FROM orders WHERE number=? OR number=? OR external_id=?')
        .all(row.order_number, `#${number}`, `gid://shopify/Order/${number}`)
    : [];
  if (byNumber.length > 1)
    throw new AppError(
      'Multiple orders match this identifier. Use the AWB and correct order number.',
    );
  if (byAwb && byNumber[0] && byAwb.id !== byNumber[0].id)
    throw new AppError('The AWB and order number identify different orders.');
  if (row.awb && !byAwb) throw new AppError('Waiting for this AWB to synchronize.');
  const order = byAwb || byNumber[0];
  if (!order) throw new AppError('Waiting for this order to synchronize.');
  if (order.method !== 'COD') throw new AppError('This remittance matches a prepaid order.');
  if (row.date < order.date) throw new AppError('The remittance predates the order.');
  return order;
}
function evaluate(db, row) {
  const order = matchOrder(db, row);
  if (!row.completed)
    return { status: 'Pending', message: 'The provider has not confirmed this payment.', order };
  const references = db
    .prepare(
      "SELECT * FROM payments WHERE order_id=? AND kind='COD remittance' AND reference=? AND voided_at IS NULL",
    )
    .all(order.id, row.reference);
  // One bank payout may contain two separate AWB allocations for the same order.
  // A row without an AWB cannot safely be matched to either allocation.
  if (
    references.some(
      (p) => (p.settlement_awb || '') !== (row.awb || '') && (!p.settlement_awb || !row.awb),
    )
  )
    throw new AppError(
      'This bank reference already has an allocation without a matching AWB. Review its order-level payment before posting.',
    );
  const prior = references.find((p) => (p.settlement_awb || '') === (row.awb || ''));
  if (prior) {
    if (prior.amount !== row.gross || prior.date !== row.date || prior.status !== 'Completed')
      throw new AppError(
        'This reference already exists with different values or a pending payment. Review the existing payment.',
      );
    if (
      prior.bank_amount !== null &&
      row.bank !== null &&
      (prior.bank_amount !== row.bank ||
        prior.fee_amount !== row.fees ||
        prior.shipping_deduction !== row.shipping ||
        prior.rto_deduction !== row.rto ||
        prior.other_deduction !== row.other)
    )
      throw new AppError(
        'This reference already exists with different bank amounts or deductions.',
      );
    // A manual entry with unknown deductions needs explicit reconciliation, never silent fee changes.
    if (prior.bank_amount === null && row.bank !== null && row.gross !== row.bank)
      throw new AppError('This manually recorded remittance has deductions that need review.');
    return {
      status: 'Duplicate',
      message: 'Already recorded; no second payment was created.',
      order,
      payment: prior,
    };
  }
  const sums = db
    .prepare(
      'SELECT kind,status,SUM(amount) AS amount FROM payments WHERE order_id=? AND voided_at IS NULL GROUP BY kind,status',
    )
    .all(order.id);
  const collected = sums
    .filter((p) => p.kind === 'COD collected' && p.status === 'Completed')
    .reduce((s, p) => s + p.amount, 0);
  const reserved = sums
    .filter((p) => p.kind === 'COD remittance')
    .reduce((s, p) => s + p.amount, 0);
  if (row.gross > collected - reserved)
    throw new AppError(
      collected === 0
        ? 'Waiting for confirmed COD collection; advance payouts require review.'
        : 'Amount exceeds unreserved COD outstanding. Review pending payments and previous settlements.',
    );
  const priorDeductions = db
    .prepare(
      'SELECT COALESCE(SUM(shipping_deduction),0) AS shipping,COALESCE(SUM(rto_deduction),0) AS rto FROM payments WHERE order_id=? AND voided_at IS NULL',
    )
    .get(order.id);
  if (
    row.shipping + priorDeductions.shipping > order.shipping_cost ||
    row.rto + priorDeductions.rto > order.rto_cost ||
    (row.shipping && !order.shipping_verified)
  )
    throw new AppError(
      'Confirm the actual shipping / RTO costs on the order before clearing these deductions.',
    );
  if (row.other)
    throw new AppError(
      'Other deductions or wallet transfers require review; they are not bank receipts or automatically recognized expenses.',
    );
  return { status: 'Ready', message: 'Matched and balanced.', order };
}
export function previewRows(db, rows, options = {}) {
  return rows.map((raw, index) => {
    let normalized;
    try {
      normalized = normalizeReportRow(raw, options);
      const result = evaluate(db, normalized);
      return {
        index: index + 2,
        ...normalized,
        status: result.status,
        message: result.message,
        order: result.order.number,
      };
    } catch (e) {
      return { index: index + 2, ...normalized, status: 'Review', message: e.message };
    }
  });
}
const fingerprint = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function importRows(
  db,
  rows,
  options = {},
  actor = 'report-webhook',
  filename = 'Report',
  source = 'Shiprocket report',
) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS)
    throw new AppError('A report needs 1–10,000 payment rows.');
  if (rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r)))
    throw new AppError('Each report row must be an object with named columns.');
  const totals = { posted: 0, review: 0, pending: 0, duplicate: 0 };
  for (const raw of rows) {
    let normalized,
      error = '';
    try {
      normalized = normalizeReportRow(raw, options);
    } catch (e) {
      error = e.message;
    }
    const hash = fingerprint(normalized || Object.fromEntries(Object.entries(raw).sort()));
    const old = db.prepare('SELECT * FROM settlement_rows WHERE fingerprint=?').get(hash);
    if (old && ['Posted', 'Duplicate', 'Ignored'].includes(old.status)) {
      totals.duplicate++;
      continue;
    }
    const rowId = old?.id || id();
    if (!old)
      insert(db, 'settlement_rows', {
        id: rowId,
        fingerprint: hash,
        source,
        filename: filename.slice(0, 200),
        raw: JSON.stringify(raw),
        normalized: normalized ? JSON.stringify(normalized) : null,
        status: 'Review',
        message: error,
        created_at: now(),
        updated_at: now(),
      });
    if (error) {
      totals.review++;
      continue;
    }
    const result = postRow(db, rowId, normalized, actor);
    totals[result === 'Posted' ? 'posted' : result.toLowerCase()]++;
  }
  audit(db, actor, 'Remittance report reconciled', filename.slice(0, 200), totals);
  return totals;
}
function postRow(db, rowId, row, actor) {
  try {
    return transaction(db, () => {
      const result = evaluate(db, row);
      let paymentId = result.payment?.id || null;
      const status = result.status === 'Ready' ? 'Posted' : result.status;
      if (status === 'Posted') {
        paymentId = id();
        insert(db, 'payments', {
          id: paymentId,
          order_id: result.order.id,
          date: row.date,
          kind: 'COD remittance',
          amount: row.gross,
          bank_amount: row.bank,
          fee_amount: row.fees,
          shipping_deduction: row.shipping,
          rto_deduction: row.rto,
          other_deduction: row.other,
          settlement_awb: row.awb,
          status: 'Completed',
          reference: row.reference,
          source: 'Shiprocket report',
          external_key: `report:${rowId}`,
          created_at: now(),
        });
        audit(db, actor, 'COD remittance reconciled', paymentId, {
          gross: row.gross,
          bank: row.bank,
          fees: row.fees,
          reference: row.reference,
        });
      }
      db.prepare(
        'UPDATE settlement_rows SET status=?,message=?,order_id=?,payment_id=?,updated_at=? WHERE id=?',
      ).run(status, result.message, result.order.id, paymentId, now(), rowId);
      if (status === 'Posted' || status === 'Duplicate') {
        for (const pending of db
          .prepare(
            "SELECT id,normalized FROM settlement_rows WHERE status='Pending' AND id!=? AND normalized IS NOT NULL",
          )
          .all(rowId)) {
          const before = JSON.parse(pending.normalized);
          if (
            before.reference === row.reference &&
            before.order_number === row.order_number &&
            before.awb === row.awb
          )
            db.prepare(
              "UPDATE settlement_rows SET status='Duplicate',message='Superseded by the completed remittance.',payment_id=?,order_id=?,updated_at=? WHERE id=?",
            ).run(paymentId, result.order.id, now(), pending.id);
        }
      }
      return status;
    });
  } catch (e) {
    db.prepare("UPDATE settlement_rows SET status='Review',message=?,updated_at=? WHERE id=?").run(
      e.message.slice(0, 500),
      now(),
      rowId,
    );
    return 'Review';
  }
}
export function retrySettlements(db, actor = 'automatic-reconciliation') {
  const totals = { posted: 0, review: 0, pending: 0, duplicate: 0 };
  for (const row of db
    .prepare(
      "SELECT * FROM settlement_rows WHERE status IN ('Review','Pending') AND normalized IS NOT NULL ORDER BY updated_at LIMIT 1000",
    )
    .all()) {
    const status = postRow(db, row.id, JSON.parse(row.normalized), actor);
    totals[status === 'Posted' ? 'posted' : status.toLowerCase()]++;
  }
  return totals;
}
