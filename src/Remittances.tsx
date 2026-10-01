import { useCallback, useEffect, useState } from 'react';
import { Copy, FileUp, RefreshCw, Settings2 } from 'lucide-react';
import { api, money, save } from './lib';
import { Badge, DataTable, Dialog, ExportButton, Notice, Panel } from './components';
import type { Period, Session } from './types';

const fields: Record<string, string> = {
  order_number: 'Order number / Shopify ID',
  awb: 'AWB number',
  reference: 'Bank reference / UTR',
  date: 'Remittance date',
  gross: 'Gross COD cleared',
  bank: 'Amount received in bank',
  fees: 'New settlement fees',
  shipping: 'Existing shipping cost deducted',
  rto: 'Existing RTO cost deducted',
  other: 'Other deduction / wallet transfer',
  status: 'Payment status',
};
type Options = { mapping: Record<string, string>; completedOnly: boolean; dateFormat: string };
type ReportRow = {
  index?: number;
  order_number?: string;
  awb?: string;
  reference?: string;
  date?: string;
  gross?: number;
  bank?: number | null;
  fees?: number;
  status: string;
  message: string;
};
type StoredRow = {
  id: string;
  filename: string;
  status: string;
  message: string;
  created_at: string;
  normalized: ReportRow | null;
};
type Preview = {
  headers: string[];
  rows: ReportRow[];
  total: number;
  totals: Record<string, number>;
};
type Configuration = Options & {
  enabled: boolean;
  configured: boolean;
  allowedHosts: string[];
  webhookUrl: string;
  status: string;
  lastProcessed?: string;
  lastReceived?: string;
};
const initialOptions: Options = { mapping: {}, completedOnly: false, dateFormat: 'DMY' };
function Mapping({
  value,
  onChange,
  headers,
}: {
  value: Options;
  onChange: (v: Options) => void;
  headers?: string[];
}) {
  return (
    <>
      <div className="form-grid report-mapping">
        {Object.entries(fields).map(([key, label]) => (
          <label className="form-field" key={key}>
            <span>{label}</span>
            {headers ? (
              <select
                value={value.mapping[key] || ''}
                onChange={(e) =>
                  onChange({ ...value, mapping: { ...value.mapping, [key]: e.target.value } })
                }
              >
                <option value="">Detect from column name</option>
                <option value="-">Not in this report</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={value.mapping[key] || ''}
                placeholder="Detect automatically, or enter exact column name"
                onChange={(e) =>
                  onChange({ ...value, mapping: { ...value.mapping, [key]: e.target.value } })
                }
              />
            )}
          </label>
        ))}
        <label className="form-field">
          <span>Date format</span>
          <select
            value={value.dateFormat}
            onChange={(e) => onChange({ ...value, dateFormat: e.target.value })}
          >
            <option value="DMY">Day / month / year</option>
            <option value="MDY">Month / day / year</option>
          </select>
        </label>
      </div>
      <label className="check-field">
        <input
          type="checkbox"
          checked={value.completedOnly}
          onChange={(e) => onChange({ ...value, completedOnly: e.target.checked })}
        />
        This report contains completed remittances only (use when it has no status column).
      </label>
      <p className="muted report-explanation">
        Amounts are in INR. Gross COD cleared must equal bank receipt plus deductions. Shipping and
        RTO deductions settle costs already recorded against the order; settlement fees reduce
        profit once. Other deductions stay in review.
      </p>
    </>
  );
}
export function RemittanceAutomation({ session }: { session: Session }) {
  const [config, setConfig] = useState<Configuration | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [hostsText, setHostsText] = useState(''),
    [rotate, setRotate] = useState(false);
  useEffect(() => {
    if (!session.demo && session.user.role === 'admin')
      api<Configuration>('/remittances/config')
        .then((c) => {
          setConfig(c);
          setHostsText(c.allowedHosts.join(', '));
        })
        .catch((e) => setError(e.message));
  }, [session.demo, session.user.role]);
  if (session.demo)
    return (
      <Notice>
        Open your live workspace to configure automatic remittance reports. Report upload and
        reconciliation can be tried in the demo Payments page.
      </Notice>
    );
  if (session.user.role !== 'admin')
    return <Notice>An administrator manages remittance automation.</Notice>;
  return (
    <Panel
      title="Automatic COD remittance reports"
      subtitle="Connect scheduled Shiprocket reports directly to Zupestore."
    >
      {error && <Notice tone="warning">{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {config && (
        <form
          className="report-config"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              const result = (await save('/remittances/config', {
                ...config,
                allowedHosts: hostsText
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                rotateToken: rotate,
              })) as Configuration;
              setConfig(result);
              setHostsText(result.allowedHosts.join(', '));
              setRotate(false);
              setMessage(
                'Settings saved. Copy the private URL into the webhook destination for your Shiprocket remittance report schedule.',
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <ol className="setup-steps">
            <li>In Shiprocket, open Tools → Reports and schedule a Remittance Report.</li>
            <li>
              Select webhook delivery and paste the private URL below. Schedule daily delivery with
              an overlapping date range.
            </li>
            <li>
              Use a sample report in Payments → Reconciliation to verify column names. Save any
              required mappings here.
            </li>
          </ol>
          <label className="check-field">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            Enable automatic report reconciliation
          </label>
          {config.webhookUrl ? (
            <div className="report-endpoint">
              <label className="form-field">
                <span>Private report webhook URL</span>
                <input readOnly value={config.webhookUrl} />
              </label>
              <button
                type="button"
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(config.webhookUrl);
                    setMessage('Private webhook URL copied.');
                  } catch {
                    setError('Select and copy the URL above.');
                  }
                }}
              >
                <Copy size={16} />
                Copy
              </button>
            </div>
          ) : (
            <Notice>Save these settings to generate your private webhook URL.</Notice>
          )}
          <label className="form-field">
            <span>Approved report download hosts</span>
            <input
              placeholder="Exact hostname from the report download link, separated by commas"
              value={hostsText}
              onChange={(e) => setHostsText(e.target.value)}
            />
            <small>
              Needed when Shiprocket sends a download link. Direct CSV/XLSX or JSON report
              deliveries do not need download hosts. Only HTTPS is accepted.
            </small>
          </label>
          <details>
            <summary>Column mapping and report format</summary>
            <Mapping value={config} onChange={(options) => setConfig({ ...config, ...options })} />
          </details>
          <div className="report-state">
            <Badge>{config.status}</Badge>
            <span>
              {config.lastReceived
                ? `Last received: ${new Date(config.lastReceived).toLocaleString('en-IN')}`
                : 'No report received yet'}
            </span>
            <span>
              {config.lastProcessed
                ? `Last processed: ${new Date(config.lastProcessed).toLocaleString('en-IN')}`
                : ''}
            </span>
          </div>
          {config.configured && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={rotate}
                onChange={(e) => setRotate(e.target.checked)}
              />
              Replace the private webhook URL (the previous URL will stop working).
            </label>
          )}
          <button className="button primary" disabled={busy}>
            <Settings2 size={16} />
            {busy ? 'Saving…' : 'Save automation settings'}
          </button>
        </form>
      )}
    </Panel>
  );
}
export function RemittanceReconciliation({
  session,
  period,
  refresh,
}: {
  session: Session;
  period: Period;
  refresh: (message?: string) => void | Promise<void>;
}) {
  const [dismiss, setDismiss] = useState<StoredRow | null>(null);
  const closeDismiss = useCallback(() => setDismiss(null), []);
  const [data, setData] = useState<{ rows: StoredRow[]; totals: Record<string, number> }>({
      rows: [],
      totals: {},
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState(false),
    [file, setFile] = useState<{ filename: string; content: string } | null>(null),
    [options, setOptions] = useState<Options>(initialOptions),
    [preview, setPreview] = useState<Preview | null>(null),
    [headers, setHeaders] = useState<string[]>(),
    [filter, setFilter] = useState('all'),
    [message, setMessage] = useState('');
  const load = useCallback(
    () =>
      api<typeof data>('/remittances')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const canWrite = session.user.role !== 'viewer';
  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const p = (await save('/remittances/import', {
        ...file,
        ...options,
        preview: true,
      })) as Preview;
      setPreview(p);
      setHeaders(p.headers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    setError('');
    try {
      const result = (await save('/remittances/import', {
        ...file,
        ...options,
        preview: false,
      })) as Record<string, number>;
      setMessage(
        `${result.posted} payments posted · ${result.review} need review · ${result.pending} pending · ${result.duplicate} duplicates skipped.`,
      );
      setUpload(false);
      setFile(null);
      setPreview(null);
      await load();
      await refresh('Remittance report reconciled.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="remittance-workspace">
      {dismiss && (
        <Dialog
          title="Dismiss an unresolved report row"
          subtitle="This leaves all posted payments unchanged."
          onClose={closeDismiss}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason');
              setBusy(true);
              setError('');
              try {
                await save(`/remittances/${dismiss.id}/ignore`, { reason });
                setDismiss(null);
                await load();
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <Notice tone="warning">{error}</Notice>}
            <Notice>
              {dismiss.message} Correct order costs or report mapping and retry when this is a valid
              payment. Dismiss only if it is not a payment that should be posted.
            </Notice>
            <label className="form-field">
              <span>Reason</span>
              <textarea name="reason" minLength={3} maxLength={500} required />
            </label>
            <div className="form-actions">
              <button className="button" type="button" onClick={closeDismiss}>
                Go back
              </button>
              <button className="button primary" disabled={busy}>
                Dismiss row
              </button>
            </div>
          </form>
        </Dialog>
      )}
      <div className="report-toolbar">
        <div>
          <h3>Settlement reconciliation</h3>
          <p>
            {data.totals.Posted || 0} posted · {data.totals.Review || 0} need review ·{' '}
            {data.totals.Pending || 0} pending
          </p>
        </div>
        <div className="report-buttons">
          <ExportButton type="settlements" period={period} />
          {canWrite && (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await save('/remittances/retry', {});
                    await load();
                    await refresh('Unresolved remittances checked again.');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={16} />
                Retry matching
              </button>
              <button className="button primary" onClick={() => setUpload(!upload)}>
                <FileUp size={16} />
                Import report
              </button>
            </>
          )}
        </div>
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {upload && (
        <div className="report-upload">
          <h3>Import a remittance report</h3>
          <label className="form-field">
            <span>CSV or Excel (.xlsx), up to 8 MB</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setPreview(null);
                setHeaders(undefined);
                setFile(null);
                setError('');
                if (!f) return;
                if (f.size > 8 * 1024 * 1024) {
                  setError('Choose a file smaller than 8 MB.');
                  return;
                }
                try {
                  const content = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1]);
                    reader.onerror = () => reject(new Error('Could not read this file.'));
                    reader.readAsDataURL(f);
                  });
                  setFile({ filename: f.name, content });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </label>
          <Mapping
            headers={headers}
            value={options}
            onChange={(v) => {
              setOptions(v);
              setPreview(null);
            }}
          />
          <div className="report-buttons">
            <button className="button" disabled={!file || busy} onClick={runPreview}>
              {busy ? 'Working…' : 'Preview and validate'}
            </button>
            {preview && (
              <button className="button primary" disabled={busy} onClick={commit}>
                Import {preview.total} rows
              </button>
            )}
            <button className="button text" onClick={() => setUpload(false)}>
              Close import
            </button>
          </div>
          {preview && (
            <>
              <Notice>
                {Object.entries(preview.totals)
                  .map(([s, n]) => `${n} ${s.toLowerCase()}`)
                  .join(' · ')}
                . Import posts only matched, balanced, completed payments. Other rows are saved for
                review. Preview shows up to 100 rows.
              </Notice>
              <DataTable
                rows={preview.rows.map((r) => ({ ...r, id: String(r.index) }))}
                columns={[
                  { key: 'index', label: 'Row' },
                  {
                    key: 'order_number',
                    label: 'Order / AWB',
                    render: (r) => r.order_number || r.awb || '—',
                  },
                  { key: 'reference', label: 'Reference' },
                  {
                    key: 'gross',
                    label: 'COD cleared',
                    render: (r) => (r.gross === undefined ? '—' : money(r.gross)),
                  },
                  {
                    key: 'bank',
                    label: 'Bank receipt',
                    render: (r) => (r.bank == null ? '—' : money(r.bank)),
                  },
                  { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
                  { key: 'message', label: 'Validation' },
                ]}
              />
            </>
          )}
        </div>
      )}
      <DataTable
        rows={data.rows.filter((r) => filter === 'all' || r.status === filter)}
        columns={[
          {
            key: 'created_at',
            label: 'Received',
            render: (r) => new Date(r.created_at).toLocaleDateString('en-IN'),
          },
          {
            key: 'order',
            label: 'Order / AWB',
            value: (r) => r.normalized?.order_number || r.normalized?.awb || '',
            render: (r) => r.normalized?.order_number || r.normalized?.awb || '—',
          },
          {
            key: 'reference',
            label: 'Bank reference',
            value: (r) => r.normalized?.reference || '',
            render: (r) => r.normalized?.reference || '—',
          },
          { key: 'gross', label: 'COD cleared', render: (r) => money(r.normalized?.gross || 0) },
          {
            key: 'bank',
            label: 'Bank receipt',
            render: (r) => (r.normalized?.bank == null ? '—' : money(r.normalized.bank)),
          },
          { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
          { key: 'message', label: 'Result' },
          { key: 'filename', label: 'Report' },
          {
            key: 'action',
            label: '',
            render: (r) =>
              canWrite && ['Review', 'Pending'].includes(r.status) ? (
                <button className="button small" onClick={() => setDismiss(r)}>
                  Dismiss
                </button>
              ) : null,
          },
        ]}
        filters={
          <select
            aria-label="Filter reconciliation status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {['Review', 'Pending', 'Posted', 'Duplicate', 'Ignored'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        }
        searchPlaceholder="Search remittance, order or report…"
      />
      <p className="page-footnote">
        Shows the latest 1,000 report rows across all dates. Export uses the selected remittance
        date range. Supplier RTO credit is excluded from bank receipts.
      </p>
    </div>
  );
}
