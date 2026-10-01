import { z } from 'zod';
import { now, audit } from './db.mjs';
import { AppError } from './domain.mjs';
import {
  readReport,
  previewRows,
  importRows,
  retrySettlements,
  reportFields,
} from './settlements.mjs';

const optionsSchema = z.object({
  mapping: z.partialRecord(z.enum(Object.keys(reportFields)), z.string().max(200)).default({}),
  completedOnly: z.boolean().default(false),
  dateFormat: z.enum(['DMY', 'MDY']).default('DMY'),
});
export function registerReportRoutes(app, { reports, admin, write, live }) {
  const origin = () => process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
  app.get('/api/remittances/config', admin, live, (_req, res) =>
    res.json(reports.publicConfig(origin())),
  );
  app.post('/api/remittances/config', admin, live, (req, res) => {
    const input = optionsSchema
      .extend({
        enabled: z.boolean(),
        rotateToken: z.boolean().default(false),
        allowedHosts: z
          .array(
            z
              .string()
              .trim()
              .toLowerCase()
              .regex(/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/),
          )
          .max(20)
          .default([]),
      })
      .parse(req.body);
    reports.save(input, req.auth.user.id);
    res.json(reports.publicConfig(origin()));
  });
  app.get('/api/remittances', (req, res) => {
    const rows = req.db
      .prepare(
        'SELECT id,source,filename,normalized,status,message,order_id,payment_id,created_at FROM settlement_rows ORDER BY created_at DESC LIMIT 1000',
      )
      .all()
      .map((r) => ({ ...r, normalized: r.normalized ? JSON.parse(r.normalized) : null }));
    const totals = Object.fromEntries(
      req.db
        .prepare('SELECT status,COUNT(*) AS count FROM settlement_rows GROUP BY status')
        .all()
        .map((r) => [r.status, r.count]),
    );
    res.json({ rows, totals, fields: reportFields });
  });
  app.post('/api/remittances/import', write, async (req, res) => {
    const input = optionsSchema
      .extend({
        filename: z.string().max(200),
        content: z.string().max(12 * 1024 * 1024),
        preview: z.boolean().default(true),
      })
      .parse(req.body);
    const report = await readReport(Buffer.from(input.content, 'base64'), input.filename);
    if (input.preview) {
      const rows = previewRows(req.db, report.rows, input);
      return res.json({
        headers: report.headers,
        rows: rows.slice(0, 100),
        total: rows.length,
        totals: rows.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {}),
      });
    }
    res.json(
      importRows(req.db, report.rows, input, req.auth.user.id, input.filename, 'Report upload'),
    );
  });
  app.post('/api/remittances/retry', write, (req, res) =>
    res.json(retrySettlements(req.db, req.auth.user.id)),
  );
  app.post('/api/remittances/:id/ignore', write, (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const row = req.db.prepare('SELECT * FROM settlement_rows WHERE id=?').get(req.params.id);
    if (!row) throw new AppError('Report row not found.', 404);
    if (!['Review', 'Pending'].includes(row.status))
      throw new AppError(
        'Only unresolved report rows can be dismissed. Posted payments cannot be changed here.',
        409,
      );
    req.db
      .prepare("UPDATE settlement_rows SET status='Ignored',message=?,updated_at=? WHERE id=?")
      .run(reason, now(), row.id);
    audit(req.db, req.auth.user.id, 'Remittance report row dismissed', row.id, { reason });
    res.json({ ok: true });
  });
}
