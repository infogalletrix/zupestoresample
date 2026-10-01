import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { ModalForms } from '../src/Forms';
import { DataTable } from '../src/components';
import { openDb, insert, now } from '../server/db.mjs';
import { createOrder, recordCredit, useCredit, workspace, today } from '../server/domain.mjs';
import { seedDemo } from '../server/seed.mjs';
import {
  Orders,
  Shipments,
  Products,
  Suppliers,
  Expenses,
  Payments,
  Reports,
  Customers,
  RtoBalance,
  Dashboard,
} from '../src/Pages';

vi.mock('recharts', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Chart = () => <div data-testid="chart-placeholder" />;
  return {
    ResponsiveContainer: Container,
    AreaChart: Chart,
    ComposedChart: Chart,
    PieChart: Chart,
    BarChart: Chart,
    Area: Chart,
    Bar: Chart,
    CartesianGrid: Chart,
    Cell: Chart,
    Legend: Chart,
    Line: Chart,
    Pie: Chart,
    Tooltip: Chart,
    XAxis: Chart,
    YAxis: Chart,
  };
});
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  db = openDb(':memory:');
  localStorage.clear();
  history.replaceState(null, '', '#/dashboard');
});
afterEach(() => {
  cleanup();
  db.close();
  vi.unstubAllGlobals();
});
const session = {
  user: { id: 'demo', name: 'Demo Owner', email: 'demo@example.com', role: 'admin' },
  demo: true,
};
const period = { label: 'All time', from: '2000-01-01', to: today() };
function fixture() {
  insert(db, 'suppliers', { id: 'A', name: 'Supplier A', created_at: now() });
  for (const [pid, cost] of [
    ['p500', 50000],
    ['p300', 30000],
  ] as const)
    insert(db, 'products', {
      id: pid,
      name: pid,
      sku: pid,
      supplier_id: 'A',
      cost,
      price: 100000,
      stock: 100,
    });
  const returned = createOrder(
    db,
    {
      date: today(),
      customer: 'Returned customer',
      method: 'COD',
      status: 'RTO',
      items: [{ product_id: 'p500', quantity: 1, price: 100000 }],
    },
    'owner',
  );
  const purchase = createOrder(
    db,
    {
      date: today(),
      customer: 'New customer',
      method: 'COD',
      status: 'Confirmed',
      items: [{ product_id: 'p300', quantity: 1, price: 100000 }],
    },
    'owner',
  );
  return { returned, purchase };
}
function mockMutations() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      try {
        const body = JSON.parse(init.body);
        const result = String(url).endsWith('/credits/use')
          ? useCredit(db, body, 'owner')
          : recordCredit(db, body, 'owner');
        return { ok: true, json: async () => result };
      } catch (e) {
        return { ok: false, json: async () => ({ error: (e as Error).message }) };
      }
    }),
  );
}

describe('daily-use screens', () => {
  it('renders every implemented operating screen with real computed data', () => {
    seedDemo(db);
    const data = workspace(db);
    const props = {
      data,
      period,
      session,
      open: vi.fn(),
      navigate: vi.fn(),
      search: '',
      refresh: vi.fn(),
      notify: vi.fn(),
    };
    for (const Screen of [
      Dashboard,
      Orders,
      Shipments,
      Products,
      Suppliers,
      Expenses,
      Payments,
      Reports,
      Customers,
      RtoBalance,
    ]) {
      const { unmount } = render(<Screen {...props} />);
      expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
      expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
      unmount();
    }
  });
  it('opens the demo, navigates to RTO, and displays the isolated sample workspace', async () => {
    seedDemo(db);
    let loggedIn = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => ({
        ok: true,
        json: async () => {
          if (String(url).endsWith('/auth/demo')) {
            loggedIn = true;
            return { ok: true };
          }
          if (String(url).endsWith('/auth/session'))
            return { session: loggedIn ? session : null, needsSetup: true };
          if (String(url).includes('/workspace')) return workspace(db);
          return {};
        },
      })),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Explore demo workspace/ }));
    await screen.findByRole('heading', { name: 'Your store, at a glance.' });
    await user.click(screen.getByRole('button', { name: /RTO refund balance/ }));
    expect(await screen.findByRole('heading', { name: 'RTO refund balance' })).toBeVisible();
    expect(screen.getByText('Available RTO balance')).toBeVisible();
    expect(screen.getByText('You’re exploring the demo.')).toBeVisible();
  });
  it('receives a ₹500 return credit through the actual form and API contract', async () => {
    const { returned } = fixture();
    mockMutations();
    const done = vi.fn(),
      close = vi.fn();
    const user = userEvent.setup();
    render(
      <ModalForms
        data={workspace(db)}
        modal={{ type: 'credit', orderId: returned.id, supplierId: 'A' }}
        close={close}
        done={done}
        canWrite
      />,
    );
    await user.type(screen.getByLabelText('Credit amount (₹)', { exact: false }), '500');
    await user.type(screen.getByLabelText('Supplier reference / credit note'), 'CN-500');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add RTO credit' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(workspace(db).credit.balance).toBe(50000);
    expect(close).toHaveBeenCalled();
  });
  it('previews zero cash payable and ₹200 remaining credit, then applies ₹300', async () => {
    const { returned, purchase } = fixture();
    recordCredit(
      db,
      {
        supplier_id: 'A',
        order_id: returned.id,
        amount: 50000,
        date: today(),
        reference: 'CN500',
        received: true,
        idempotency_key: 'initial-credit-500',
      },
      'owner',
    );
    mockMutations();
    const done = vi.fn(),
      user = userEvent.setup();
    render(
      <ModalForms
        data={workspace(db)}
        modal={{ type: 'useCredit', orderId: purchase.id, supplierId: 'A' }}
        close={vi.fn()}
        done={done}
        canWrite
      />,
    );
    await user.type(screen.getByLabelText('Credit to use (₹)', { exact: false }), '300');
    expect(screen.getByText('₹200')).toBeVisible();
    const preview = screen.getByText('Cash / payment required').parentElement!;
    expect(within(preview).getByText('₹0')).toBeVisible();
    await user.type(screen.getByLabelText('Supplier reference / credit note'), 'PUR-300');
    await user.click(screen.getByRole('button', { name: 'Apply supplier credit' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(workspace(db).credit.balance).toBe(20000);
    expect(workspace(db).orders.find((o) => o.id === purchase.id).payable).toBe(0);
  });
  it('search, sort, and pagination operate on records rather than decorative controls', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Order ${String(i + 1).padStart(2, '0')}`,
      amount: 12 - i,
    }));
    const user = userEvent.setup();
    render(
      <DataTable
        rows={rows}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'amount', label: 'Amount' },
        ]}
        pageSize={5}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Order 06')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Amount' }));
    expect(screen.getByText('Order 12')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Order 12' } });
    expect(screen.getByText('Order 12')).toBeVisible();
    expect(screen.queryByText('Order 01')).not.toBeInTheDocument();
  });
});

it('a search opened from another screen can be edited and cleared in the table', async () => {
  const user = userEvent.setup();
  render(
    <DataTable
      rows={[
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ]}
      columns={[{ key: 'name', label: 'Name' }]}
      search="Alpha"
    />,
  );
  expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  await user.clear(screen.getByRole('textbox'));
  await user.type(screen.getByRole('textbox'), 'Beta');
  expect(screen.getByText('Beta')).toBeVisible();
  expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('Alpha')).toBeVisible();
  expect(screen.getByText('Beta')).toBeVisible();
});
