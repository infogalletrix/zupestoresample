import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  X,
  Inbox,
  CalendarDays,
  Check,
  Info,
  ArrowUpRight,
  Lamp,
  Printer,
  Wind,
  Plug,
  Package,
  Clock3,
  Coffee,
  Smartphone,
} from 'lucide-react';
import { exportFile, makePeriod, money, shortDate } from './lib';
import type { Period, Product } from './types';

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const value = String(children);
  const color =
    tone ||
    (/RTO|Failed|Cancelled/i.test(value)
      ? 'red'
      : /NDR|Pending|Awaiting|Partially|attention/i.test(value)
        ? 'amber'
        : /Delivered|Completed|Credited|Connected|Paid|Remitted|Success|Credit added/i.test(value)
          ? 'green'
          : /Shipped|Credit used/i.test(value)
            ? 'purple'
            : 'neutral');
  return (
    <span className={`badge ${color}`}>
      <i />
      {children}
    </span>
  );
}
export function Stat({
  label,
  value,
  note,
  icon,
  accent = 'purple',
  change,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  accent?: string;
  change?: string;
}) {
  return (
    <div className={`stat-card ${accent}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-bottom">
        {change && (
          <span className="stat-change">
            <ArrowUpRight size={13} />
            {change}
          </span>
        )}
        <span>{note}</span>
      </div>
    </div>
  );
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: string }) {
  return (
    <div className={`notice ${tone}`}>
      <Info size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title = 'Nothing here yet',
  description = 'Your records will appear here as you start working.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number;
  className?: string;
};
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  searchPlaceholder = 'Search records…',
  filters,
  search: externalSearch = '',
  onRow,
  pageSize = 8,
  empty,
  toolbar = true,
}: {
  rows: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  filters?: ReactNode;
  search?: string;
  onRow?: (row: T) => void;
  pageSize?: number;
  empty?: ReactNode;
  toolbar?: boolean;
}) {
  const [search, setSearch] = useState(externalSearch),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(pageSize),
    [sort, setSort] = useState<{ key: string; direction: number } | null>(null);
  useEffect(() => {
    setSearch(externalSearch);
  }, [externalSearch]);
  const query = search.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    columns.some((c) =>
      String(c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] ?? ''))
        .toLowerCase()
        .includes(query),
    ),
  );
  if (sort) {
    const c = columns.find((c) => c.key === sort.key)!;
    filtered.sort((a, b) => {
      const x = c.value ? c.value(a) : (a as Record<string, unknown>)[c.key],
        y = c.value ? c.value(b) : (b as Record<string, unknown>)[c.key];
      return (
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x ?? '').localeCompare(String(y ?? ''))) * sort.direction
      );
    });
  }
  const maxPage = Math.max(1, Math.ceil(filtered.length / limit)),
    currentPage = Math.min(page, maxPage),
    start = (currentPage - 1) * limit;
  useEffect(() => setPage(1), [query, rows.length, limit, sort]);
  return (
    <div className="data-table">
      {toolbar && (
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-button small"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="table-filters">
            {filters}
            <span className="results-count">{filtered.length} records</span>
          </div>
        </div>
      )}
      {filtered.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={c.className}
                      aria-sort={
                        sort?.key === c.key
                          ? sort.direction === 1
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                    >
                      <button
                        disabled={!c.label}
                        onClick={() =>
                          setSort((s) => ({
                            key: c.key,
                            direction: s?.key === c.key ? -s.direction : 1,
                          }))
                        }
                      >
                        {c.label}
                        {sort?.key === c.key ? (
                          sort.direction === 1 ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : c.label ? (
                          <ArrowDownUp size={11} />
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(start, start + limit).map((row) => (
                  <tr
                    key={row.id}
                    className={onRow ? 'clickable' : ''}
                    onClick={() => onRow?.(row)}
                    tabIndex={onRow ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onRow?.(row);
                      }
                    }}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={c.className}>
                        {c.render
                          ? c.render(row)
                          : String((row as Record<string, unknown>)[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>
              Showing{' '}
              <strong>
                {start + 1}–{Math.min(start + limit, filtered.length)}
              </strong>{' '}
              of <strong>{filtered.length}</strong>
            </span>
            {toolbar && (
              <label className="page-size">
                Rows{' '}
                <select
                  aria-label="Rows per page"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {[...new Set([pageSize, 25, 50])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="pagination">
              <button
                className="icon-button"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(5, maxPage) }, (_, i) => {
                const p =
                  maxPage <= 5 ? i + 1 : Math.min(Math.max(1, currentPage - 2), maxPage - 4) + i;
                return (
                  <button
                    className={currentPage === p ? 'active' : ''}
                    key={p}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                className="icon-button"
                disabled={currentPage === maxPage}
                onClick={() => setPage(currentPage + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      ) : (
        (!query && empty) || (
          <Empty
            title={query ? 'No matching records' : 'No records yet'}
            description={
              query
                ? 'Try another search or update your filters.'
                : 'Add your first record or connect your store in Settings.'
            }
          />
        )
      )}
    </div>
  );
}
export function DatePicker({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const [open, setOpen] = useState(false),
    [from, setFrom] = useState(period.from),
    [to, setTo] = useState(period.to);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setFrom(period.from);
    setTo(period.to);
  }, [period.from, period.to]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <div className="date-picker" ref={ref}>
      <button className="button date-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <CalendarDays size={16} />
        <span>
          {period.label === 'All time'
            ? 'All time'
            : `${shortDate(period.from)} – ${shortDate(period.to)}, ${period.to.slice(0, 4)}`}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="date-popover">
          {[
            'Today',
            'Yesterday',
            'Last 7 days',
            'This week',
            'Last 30 days',
            'This month',
            'This year',
            'All time',
          ].map((label) => (
            <button
              className={period.label === label ? 'selected' : ''}
              key={label}
              onClick={() => {
                onChange(makePeriod(label));
                setOpen(false);
              }}
            >
              {label}
              {period.label === label && <Check size={15} />}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onChange({ label: 'Custom range', from, to });
              setOpen(false);
            }}
          >
            <span className="field-label">Custom range</span>
            <label>
              From
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
            <button className="button primary" type="submit">
              Apply dates
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
export function ExportButton({
  type,
  period,
  extra = {},
}: {
  type: string;
  period: Period;
  extra?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-control">
      <button className="button" onClick={() => setOpen(!open)}>
        <Download size={16} />
        Export
        <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <button
            className="popover-backdrop"
            aria-label="Close export options"
            onClick={() => setOpen(false)}
          />
          <div className="export-menu">
            {['csv', 'xlsx'].map((format) => (
              <button
                key={format}
                onClick={() => {
                  exportFile(type, period, format, extra);
                  setOpen(false);
                }}
              >
                <Download size={15} />
                {format === 'csv' ? 'Download CSV' : 'Download Excel'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    previous = useRef(document.activeElement as HTMLElement);
  useEffect(() => {
    const el = ref.current;
    const controls = () =>
      el?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
      );
    controls()?.[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const all = controls();
        if (!all?.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = overflow;
      previous.current?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function ProductIcon({
  product,
  size = 'normal',
}: {
  product: Pick<Product, 'name' | 'color'>;
  size?: string;
}) {
  const n = product.name.toLowerCase();
  const Icon = n.includes('lamp')
    ? Lamp
    : n.includes('printer')
      ? Printer
      : n.includes('diffuser')
        ? Wind
        : n.includes('iron')
          ? Plug
          : n.includes('clock')
            ? Clock3
            : n.includes('blender')
              ? Coffee
              : n.includes('mount')
                ? Smartphone
                : Package;
  return (
    <span className={`product-icon ${size}`} style={{ background: product.color || '#e9edfa' }}>
      <Icon strokeWidth={1.45} />
    </span>
  );
}
export function Money({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`money ${className}`}>{money(value)}</span>;
}
