import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { AppError } from './domain.mjs';
import { now, setting, setSetting, audit } from './db.mjs';
import { safeEqual } from './security.mjs';
import { readReport, importRows, retrySettlements, MAX_REPORT_BYTES } from './settlements.mjs';

function publicIpv4(address) {
  const a = address.split('.').map(Number);
  return (
    a.length === 4 &&
    a.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) &&
    ![0, 10, 127].includes(a[0]) &&
    a[0] < 224 &&
    !(a[0] === 169 && a[1] === 254) &&
    !(a[0] === 172 && a[1] >= 16 && a[1] <= 31) &&
    !(a[0] === 192 && a[1] === 168) &&
    !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) &&
    !(a[0] === 198 && [18, 19].includes(a[1]))
  );
}
export async function downloadReport(input, allowedHosts, redirects = 0) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('The report download URL is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  )
    throw new AppError(
      'Report download host is not approved. Add its exact hostname in Remittance automation settings.',
    );
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !publicIpv4(a.address)))
    throw new AppError('Report download must use a public internet address.');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: (_host, options, cb) =>
          options.all ? cb(null, [address]) : cb(null, address.address, address.family),
        timeout: 30000,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirects >= 3 || !res.headers.location)
            return reject(new AppError('Report download redirected too many times.'));
          downloadReport(new URL(res.headers.location, url).href, allowedHosts, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new AppError(`Report download returned HTTP ${res.statusCode}.`));
        }
        const chunks = [];
        let length = 0;
        res.on('data', (chunk) => {
          length += chunk.length;
          if (length > MAX_REPORT_BYTES) {
            req.destroy(new AppError('Report exceeds 8 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            buffer: Buffer.concat(chunks),
            filename: url.pathname.split('/').pop() || 'report.csv',
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new AppError('Report download timed out.')));
    req.on('error', reject);
  });
}
export function createReportService(db, integrations, downloader = downloadReport) {
  let active = false;
  const config = () => integrations.config('reports');
  function publicConfig(origin = '') {
    const c = config();
    return {
      enabled: c.enabled === true,
      configured: !!c.token,
      mapping: c.mapping || {},
      completedOnly: c.completedOnly === true,
      dateFormat: c.dateFormat || 'DMY',
      allowedHosts: c.allowedHosts || [],
      webhookUrl: c.token ? `${origin}/api/webhooks/remittance-report/${c.token}` : '',
      lastReceived: setting(db, 'lastReceived:reports'),
      lastProcessed: setting(db, 'lastSync:reports'),
      status: setting(db, 'status:reports', 'Not connected'),
    };
  }
  function save(input, actor) {
    const c = config();
    integrations.save('reports', {
      ...c,
      ...input,
      token: input.rotateToken || !c.token ? randomBytes(32).toString('hex') : c.token,
    });
    setSetting(db, 'status:reports', input.enabled ? 'Waiting for report' : 'Paused');
    audit(db, actor, 'Remittance automation configured', 'reports');
    return publicConfig();
  }
  function authorize(token) {
    const c = config();
    if (!c.enabled || !c.token || !safeEqual(c.token, token))
      throw new AppError('Invalid report endpoint.', 401);
  }
  function receive(token, buffer, contentType = '') {
    authorize(token);
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_REPORT_BYTES)
      throw new AppError('Empty or oversized report.');
    const eventId = 'reports:' + createHash('sha256').update(buffer).digest('hex');
    const payload = JSON.stringify({ contentType, body: buffer.toString('base64') });
    db.prepare(
      'INSERT OR IGNORE INTO webhook_events(id,provider,payload,created_at) VALUES(?,?,?,?)',
    ).run(eventId, 'reports', payload, now());
    setSetting(db, 'lastReceived:reports', now());
    return eventId;
  }
  async function parsePayload(payload, c) {
    let buffer = Buffer.from(payload.body, 'base64'),
      filename = 'report.csv';
    if (
      /json/i.test(payload.contentType) ||
      ['{', '['].includes(buffer.toString('utf8').trim()[0])
    ) {
      const body = JSON.parse(buffer.toString('utf8'));
      const rows = Array.isArray(body)
        ? body
        : body.rows || (Array.isArray(body.data) ? body.data : null);
      if (rows) return { rows, filename: 'Scheduled remittance report' };
      const url =
        body.report_url ||
        body.download_url ||
        body.url ||
        body.data?.report_url ||
        body.data?.download_url ||
        body.data?.url;
      if (url) ({ buffer, filename } = await downloader(url, c.allowedHosts || []));
      else if (typeof body.csv === 'string') buffer = Buffer.from(body.csv, 'utf8');
      else
        throw new AppError(
          'Report webhook needs CSV/XLSX content, JSON rows, or a report_url/download_url.',
        );
    }
    return { ...(await readReport(buffer, filename)), filename };
  }
  async function process() {
    if (active || !config().enabled) return;
    active = true;
    try {
      const c = config();
      const events = db
        .prepare(
          "SELECT * FROM webhook_events WHERE provider='reports' AND status='pending' AND attempts<12 AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at LIMIT 10",
        )
        .all(now());
      for (const event of events) {
        try {
          const report = await parsePayload(JSON.parse(event.payload), c);
          const counts = importRows(db, report.rows, c, 'report-webhook', report.filename);
          db.prepare("UPDATE webhook_events SET status='processed',error=NULL WHERE id=?").run(
            event.id,
          );
          setSetting(db, 'lastSync:reports', now());
          setSetting(db, 'status:reports', counts.review ? 'Needs review' : 'Connected');
        } catch (e) {
          db.prepare(
            "UPDATE webhook_events SET attempts=attempts+1,error=?,next_attempt_at=?,status=CASE WHEN attempts>=11 THEN 'failed' ELSE 'pending' END WHERE id=?",
          ).run(
            e.message.slice(0, 400),
            new Date(Date.now() + Math.min(3600000, 30000 * 2 ** event.attempts)).toISOString(),
            event.id,
          );
          setSetting(db, 'status:reports', 'Needs attention');
        }
      }
      retrySettlements(db);
    } finally {
      active = false;
    }
  }
  return { config, publicConfig, save, authorize, receive, process };
}
