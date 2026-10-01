import type { Period } from './types';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'CommerceWorkspace',
      ...options.headers,
    },
    credentials: 'same-origin',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      body.error || 'The server could not complete this request. Please try again.',
      response.status,
    );
  return body;
}
export const save = (path: string, data: unknown, method = 'POST') =>
  api(path, { method, body: JSON.stringify(data) });
export const money = (value: number, compact = false) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 2,
    ...(compact ? { notation: 'compact' as const } : {}),
  }).format(value / 100);
export const decimalMoney = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
export const num = (value: number) => new Intl.NumberFormat('en-IN').format(value);
export const shortDate = (value: string) =>
  new Date(value.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
export const longDate = (value: string) =>
  new Date(value.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
export const localDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function makePeriod(label: string): Period {
  const today = localDate(),
    d = new Date(`${today}T12:00:00`);
  let from = today;
  if (label === 'Yesterday') {
    d.setDate(d.getDate() - 1);
    return { label, from: fmt(d), to: fmt(d) };
  }
  if (label === 'Last 7 days') {
    d.setDate(d.getDate() - 6);
    from = fmt(d);
  }
  if (label === 'Last 30 days') {
    d.setDate(d.getDate() - 29);
    from = fmt(d);
  }
  if (label === 'This week') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    from = fmt(d);
  }
  if (label === 'This month') from = today.slice(0, 7) + '-01';
  if (label === 'This year') from = today.slice(0, 4) + '-01-01';
  if (label === 'All time') from = '2000-01-01';
  return { label, from, to: today };
}
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const inPeriod = (date: string, period: Period) => date >= period.from && date <= period.to;
export const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
export const toPaise = (value: FormDataEntryValue | null) => Math.round(Number(value || 0) * 100);
export const colors = ['#5968ed', '#2cbda3', '#f2b55d', '#a58af2', '#ed879e', '#70b4e6'];
export const exportFile = (
  type: string,
  period: Period,
  format = 'csv',
  extra: Record<string, string> = {},
) => {
  const a = document.createElement('a');
  const query = new URLSearchParams({ from: period.from, to: period.to, format, ...extra });
  a.href = `/api/export/${type}?${query}`;
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
};
