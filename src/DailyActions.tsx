import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type { PageProps } from './Pages';
import { money } from './lib';

export function DailyActions({ data, navigate, open, session }: PageProps) {
  const ndr = data.orders.filter((o) => o.status === 'NDR').length;
  const pending = data.payments.filter((p) => p.status === 'Pending');
  const costs = data.orders.filter(
    (o) =>
      o.status !== 'Cancelled' &&
      (!o.cost_verified ||
        (!['Confirmed', 'Cancelled'].includes(o.status) && !o.shipping_verified)),
  ).length;
  const actions = [
    {
      label: 'Delivery issues',
      count: ndr,
      detail: 'Review NDR orders',
      icon: PackageCheck,
      color: 'amber',
      run: () => navigate('orders', 'needs:ndr'),
    },
    {
      label: 'Returns to recover',
      count: data.credit.pendingOrders,
      detail: `${money(data.credit.pending)} supplier credit`,
      icon: RotateCcw,
      color: 'purple',
      run: () => navigate('rto', 'needs:credit'),
    },
    {
      label: 'Pending payments',
      count: pending.length,
      detail: 'Complete or cancel a record',
      icon: Clock3,
      color: 'blue',
      run: () => navigate('payments', 'needs:payment'),
    },
    {
      label: 'Costs to verify',
      count: costs,
      detail: 'Make your profit more accurate',
      icon: ReceiptText,
      color: 'green',
      run: () => navigate('orders', 'needs:cost'),
    },
  ];
  if (!data.orders.length && session.user.role !== 'viewer')
    return (
      <section className="getting-started">
        <div>
          <span className="eyebrow">LET’S GET YOUR STORE READY</span>
          <h2>Your first steps, all in one place.</h2>
          <p>Connect your store, assign supplier costs, and start tracking what you earn.</p>
        </div>
        <div className="setup-steps">
          {[
            {
              label: 'Connect Shopify',
              detail: 'Bring your orders in automatically',
              icon: ShoppingBag,
              done: data.connections?.some((c) => c.provider === 'shopify' && c.configured),
              run: () => navigate('settings'),
            },
            {
              label: 'Add a supplier',
              detail: 'Keep costs and return credits together',
              icon: Users,
              done: !!data.suppliers.length,
              run: () => open({ type: 'supplier' }),
            },
            {
              label: 'Add your first product',
              detail: 'Set a selling price and supplier cost',
              icon: PackageCheck,
              done: !!data.products.length,
              run: () => open({ type: 'product' }),
            },
          ].map((step) => (
            <button key={step.label} onClick={step.run}>
              <step.icon size={20} />
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              {step.done ? (
                <CheckCircle2 className="positive" size={20} />
              ) : (
                <ArrowUpRight size={18} />
              )}
            </button>
          ))}
        </div>
      </section>
    );
  return (
    <section className="daily-actions" aria-label="Daily actions">
      <div className="section-intro">
        <div>
          <h2>Needs your attention</h2>
          <p>Open tasks across all dates, so nothing gets missed.</p>
        </div>
        <span className="subtle-label">Live work queue</span>
      </div>
      <div className="attention-grid">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.run}
            className={`attention-card ${action.color}`}
          >
            <div>
              <span className="attention-icon">
                <action.icon size={19} />
              </span>
              <strong>{action.count}</strong>
              <ArrowUpRight size={17} />
            </div>
            <h3>{action.label}</h3>
            <p>{action.count ? action.detail : 'All caught up'}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
