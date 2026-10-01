import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeIndianRupee,
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Info,
  Layers3,
  Link2,
  LoaderCircle,
  Megaphone,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import type {
  Credit,
  Expense,
  Integration,
  ModalState,
  Order,
  Page,
  Payment,
  Period,
  Session,
  SettingsData,
  Supplier,
  Workspace,
} from './types';
import {
  api,
  colors,
  exportFile,
  inPeriod,
  initials,
  longDate,
  money,
  num,
  save,
  shortDate,
} from './lib';
import {
  Badge,
  DataTable,
  Empty,
  ExportButton,
  Money,
  Notice,
  Panel,
  ProductIcon,
  Stat,
  type Column,
} from './components';

import { DailyActions } from './DailyActions';
import { PaymentReview } from './PaymentReview';

export type PageProps = {
  data: Workspace;
  period: Period;
  session: Session;
  open: (modal: NonNullable<ModalState>) => void;
  navigate: (page: Page, search?: string) => void;
  search: string;
  refresh: (message?: string) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
};
const tooltipStyle = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 12,
  boxShadow: '0 8px 30px #14204412',
};
const chartMoney = (v: unknown) => money(Number(v), true);
const axisMoney = (v: number) => (v === 0 ? '₹0' : money(v, true));
function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function orderColumns(open: PageProps['open'], compact = false): Column<Order>[] {
  return [
    {
      key: 'number',
      label: 'Order',
      render: (o) => (
        <button
          className="order-link"
          onClick={(e) => {
            e.stopPropagation();
            open({ type: 'orderDetail', record: o });
          }}
        >
          {o.number}
        </button>
      ),
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (o) => (
        <div className="person-cell">
          <span className="avatar small">{initials(o.customer)}</span>
          <div>
            <strong>{o.customer}</strong>
            <small>{compact ? o.city : o.phone || o.city}</small>
          </div>
        </div>
      ),
    },
    ...(!compact
      ? [
          { key: 'date', label: 'Date', render: (o: Order) => shortDate(o.date) },
          {
            key: 'items',
            label: 'Product',
            value: (o: Order) => o.items.map((i) => i.name).join(', '),
            render: (o: Order) => (
              <div className="stacked-cell">
                <strong>{o.items[0]?.name || '—'}</strong>
                <small>
                  {o.items.reduce((s, i) => s + i.quantity, 0)} item
                  {o.items.reduce((s, i) => s + i.quantity, 0) !== 1 ? 's' : ''}
                  {o.items.length > 1 ? ` · +${o.items.length - 1} products` : ''}
                </small>
              </div>
            ),
          },
        ]
      : []),
    { key: 'status', label: 'Status', render: (o) => <Badge>{o.status}</Badge> },
    {
      key: 'method',
      label: 'Payment',
      render: (o) => <span className={`method ${o.method.toLowerCase()}`}>{o.method}</span>,
    },
    {
      key: 'total',
      label: 'Amount',
      className: 'text-right',
      render: (o) => <Money value={o.total} />,
    },
    ...(!compact
      ? [
          {
            key: 'net_profit',
            label: 'Net profit',
            className: 'text-right',
            render: (o: Order) => (
              <Money value={o.net_profit} className={o.net_profit >= 0 ? 'positive' : 'negative'} />
            ),
          },
        ]
      : []),
    {
      key: 'action',
      label: '',
      render: (o) => (
        <button
          className="icon-button small"
          aria-label={`View order ${o.number}`}
          onClick={(e) => {
            e.stopPropagation();
            open({ type: 'orderDetail', record: o });
          }}
        >
          <ChevronRight size={16} />
        </button>
      ),
    },
  ];
}

export function Dashboard(p: PageProps) {
  const { data, period, open, navigate, session } = p,
    m = data.metrics;
  const selected = data.orders.filter((o) => inPeriod(o.date, period));
  const topProducts = [...data.products].sort((a, b) => b.revenue - a.revenue).slice(0, 4);
  const revenueMix = [
    { name: 'Prepaid', value: m.prepaid, color: colors[0] },
    { name: 'COD collected', value: m.codCollected, color: colors[1] },
  ].filter((r) => r.value > 0);
  const totalPayment = m.prepaid + m.codCollected;
  return (
    <>
      <PageHeading
        eyebrow="BUSINESS OVERVIEW"
        title="Your store, at a glance."
        subtitle={`Welcome back, ${session.user.name.split(' ')[0]}. Here is what matters for your business today.`}
      >
        <ExportButton type="reports" period={period} />
        {session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => open({ type: 'expense' })}>
            <Plus size={17} />
            Add expense
          </button>
        )}
      </PageHeading>
      <div className="connection-strip">
        <span className="connection-label">
          {session.demo ? 'Demo workspace' : 'Store connections'}
        </span>
        {['shopify', 'shiprocket'].map((provider) => {
          const connection = data.connections?.find((c) => c.provider === provider);
          return (
            <span
              key={provider}
              className={`connection-chip ${connection?.status === 'Connected' ? 'configured' : ''}`}
            >
              <i />
              {provider === 'shopify' ? 'Shopify' : 'Shiprocket'}
              <small>
                {session.demo
                  ? 'Sample data'
                  : connection?.configured
                    ? connection.status
                    : 'Not connected'}
              </small>
            </span>
          );
        })}
        <button className="text-button" onClick={() => navigate('settings')}>
          Manage <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="stats-grid">
        <Stat
          label="Total sales"
          value={money(m.sales)}
          note="Recognized on delivered orders"
          icon={<BadgeIndianRupee size={20} />}
          accent="purple"
        />
        <Stat
          label="Net profit"
          value={money(m.netProfit)}
          note={`${m.margin.toFixed(1)}% profit margin`}
          icon={<TrendingUp size={20} />}
          accent={m.netProfit < 0 ? 'red' : 'green'}
        />
        <Stat
          label="Total orders"
          value={num(m.totalOrders)}
          note={`${num(m.delivered)} successfully delivered`}
          icon={<ShoppingBag size={20} />}
          accent="blue"
        />
        <Stat
          label="COD awaiting remittance"
          value={money(m.codPending)}
          note="Collected, awaiting settlement"
          icon={<Wallet size={20} />}
          accent="amber"
        />
      </div>
      {m.missingCosts > 0 && (
        <Notice tone="warning">
          {m.missingCosts} orders have missing or unverified supplier or shipping costs. Review
          order costs before relying on profit figures.
        </Notice>
      )}
      <DailyActions {...p} />
      <div className="dashboard-chart-grid">
        <Panel
          title="Revenue & profit"
          subtitle="Delivered sales and profit after all recorded costs"
          action={
            <span className="subtle-label">
              {period.label}
              <ChevronDownIcon />
            </span>
          }
        >
          <div className="chart-legend">
            <span>
              <i style={{ background: colors[0] }} />
              Revenue <b>{money(m.sales)}</b>
            </span>
            <span>
              <i style={{ background: colors[1] }} />
              Net profit <b>{money(m.netProfit)}</b>
            </span>
          </div>
          <div className="chart-container revenue-chart">
            {data.timeline.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline} margin={{ top: 12, right: 20, bottom: 0, left: 5 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6574ed" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#6574ed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 4" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={30}
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    dy={8}
                  />
                  <YAxis
                    tickFormatter={axisMoney}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    width={62}
                  />
                  <Tooltip
                    formatter={chartMoney}
                    labelFormatter={(v) => longDate(String(v))}
                    contentStyle={tooltipStyle}
                  />
                  <Area
                    name="Revenue"
                    type="monotone"
                    dataKey="sales"
                    stroke={colors[0]}
                    strokeWidth={2.5}
                    fill="url(#salesFill)"
                  />
                  <Area
                    name="Net profit"
                    type="monotone"
                    dataKey="profit"
                    stroke={colors[1]}
                    strokeWidth={2}
                    fill="transparent"
                    strokeDasharray="4 3"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title="Your story starts here"
                description="Connect Shopify or add an order to see your performance."
              />
            )}
          </div>
          <div className="chart-footer">
            <span>
              <Info size={13} /> Sales and costs follow the selected order-date cohort.
            </span>
            <button className="text-button" onClick={() => navigate('reports')}>
              View reports <ArrowUpRight size={14} />
            </button>
          </div>
        </Panel>
        <Panel title="Payment overview" subtitle="Customer collections by payment method">
          <div className="donut-wrap">
            {totalPayment > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={198}>
                  <PieChart>
                    <Pie
                      data={revenueMix}
                      innerRadius={67}
                      outerRadius={87}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {revenueMix.map((r) => (
                        <Cell key={r.name} fill={r.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={chartMoney} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <span>Total collected</span>
                  <strong>{money(totalPayment, true)}</strong>
                  <small>Customer payments</small>
                </div>
              </>
            ) : (
              <Empty title="No collections yet" description="Payments will appear here." />
            )}
          </div>
          <div className="payment-legend">
            {revenueMix.map((r) => (
              <div key={r.name}>
                <span>
                  <i style={{ background: r.color }} />
                  {r.name}
                </span>
                <strong>{money(r.value)}</strong>
                <small>{totalPayment ? Math.round((r.value / totalPayment) * 100) : 0}%</small>
              </div>
            ))}
          </div>
          <button
            className="button full-width panel-bottom-button"
            onClick={() => navigate('payments')}
          >
            See all payments <ArrowRight size={15} />
          </button>
        </Panel>
      </div>
      <div className="order-pipeline">
        {[
          { label: 'Confirmed', value: m.confirmed, icon: ShoppingBag, color: 'purple' },
          { label: 'Shipped', value: m.shipped, icon: Truck, color: 'blue' },
          { label: 'Delivered', value: m.delivered, icon: CheckCircle2, color: 'green' },
          { label: 'NDR', value: m.ndr, icon: Clock3, color: 'amber' },
          { label: 'RTO', value: m.rto, icon: RotateCcw, color: 'red' },
        ].map((s) => (
          <button key={s.label} onClick={() => navigate('orders', s.label)}>
            <span className={`pipeline-icon ${s.color}`}>
              <s.icon size={18} />
            </span>
            <div>
              <span>{s.label}</span>
              <strong>{num(s.value)}</strong>
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
      <Panel
        title="Where your money goes"
        subtitle="A clear breakdown for the selected period"
        action={
          <button className="text-button" onClick={() => navigate('reports')}>
            Profit & loss <ArrowRight size={14} />
          </button>
        }
      >
        <div className="cost-summary-grid">
          {[
            ['Product costs', money(m.productCost)],
            ['Shipping & returns', money(m.shipping)],
            ['Ad spend', money(m.adSpend)],
            ['Other expenses', money(m.otherExpenses)],
            ['Gross profit', money(m.grossProfit)],
            ['RTO percentage', `${m.rtoRate.toFixed(1)}%`],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </Panel>
      <div className="dashboard-bottom-grid">
        <Panel
          title="Recent orders"
          subtitle="The latest activity from your store"
          action={
            <button className="text-button" onClick={() => navigate('orders')}>
              View all orders <ArrowRight size={14} />
            </button>
          }
        >
          <DataTable
            rows={selected.slice(0, 5)}
            columns={orderColumns(open, true)}
            toolbar={false}
            pageSize={5}
          />
        </Panel>
        <Panel title="Your best sellers" subtitle="Ranked by recognized revenue">
          <div className="top-products">
            {topProducts
              .filter((p) => p.orders > 0)
              .map((product, i) => (
                <button
                  key={product.id}
                  onClick={() =>
                    session.user.role === 'viewer'
                      ? navigate('products')
                      : open({ type: 'product', record: product })
                  }
                >
                  <span className="rank">0{i + 1}</span>
                  <ProductIcon product={product} />
                  <section>
                    <strong>{product.name}</strong>
                    <small>{product.quantity} units ordered</small>
                  </section>
                  <b>{money(product.revenue, true)}</b>
                </button>
              ))}
            {!topProducts.some((p) => p.orders > 0) && <Empty title="No product sales yet" />}
          </div>
          <div className="supplier-credit-teaser">
            <span className="teaser-icon">
              <RotateCcw size={21} />
            </span>
            <div>
              <span>Make returns work for you</span>
              <strong>{money(data.credit.balance)} in supplier credit</strong>
            </div>
            <button
              className="icon-button"
              onClick={() => navigate('rto')}
              aria-label="View RTO supplier credits"
            >
              <ArrowUpRight size={19} />
            </button>
          </div>
        </Panel>
      </div>
    </>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function Orders(p: PageProps) {
  const [tab, setTab] = useState('All orders');
  const rows = p.data.orders.filter((o) => inPeriod(o.date, p.period));
  const filtered = rows.filter((o) =>
    p.search === 'needs:ndr'
      ? o.status === 'NDR'
      : p.search === 'needs:cost'
        ? o.status !== 'Cancelled' &&
          (!o.cost_verified ||
            (!['Confirmed', 'Cancelled'].includes(o.status) && !o.shipping_verified))
        : true,
  );
  const visible = tab === 'All orders' ? filtered : filtered.filter((o) => o.status === tab);
  return (
    <>
      <PageHeading
        eyebrow="STORE OPERATIONS"
        title="Orders"
        subtitle="Every order. Every detail. All in one place."
      >
        <ExportButton type="orders" period={p.period} />
        {p.session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => p.open({ type: 'order' })}>
            <Plus size={16} />
            Create order
          </button>
        )}
      </PageHeading>
      <div className="stats-grid compact-stats">
        <Stat
          label="Orders in period"
          value={num(p.data.metrics.totalOrders)}
          note={p.period.label}
          icon={<ShoppingBag size={19} />}
        />
        <Stat
          label="Delivered"
          value={num(p.data.metrics.delivered)}
          note="Successfully received"
          accent="green"
          icon={<CheckCircle2 size={19} />}
        />
        <Stat
          label="Needs attention"
          value={num(p.data.metrics.ndr)}
          note="Non-delivery reports"
          accent="amber"
          icon={<Clock3 size={19} />}
        />
        <Stat
          label="Return to origin"
          value={`${p.data.metrics.rtoRate.toFixed(1)}%`}
          note={`${p.data.metrics.rto} returned orders`}
          accent="red"
          icon={<RotateCcw size={19} />}
        />
      </div>
      <Panel>
        <div className="tabs">
          {['All orders', 'Confirmed', 'Shipped', 'Delivered', 'NDR', 'RTO', 'Cancelled'].map(
            (t) => (
              <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
                {t}
                <span>
                  {t === 'All orders' ? rows.length : rows.filter((o) => o.status === t).length}
                </span>
              </button>
            ),
          )}
        </div>
        <DataTable
          rows={visible}
          columns={orderColumns(p.open)}
          search={p.search.startsWith('needs:') ? '' : p.search}
          searchPlaceholder="Search order ID, customer, product or status…"
          pageSize={10}
          onRow={(o) => p.open({ type: 'orderDetail', record: o })}
        />
      </Panel>
      <div className="page-footnote">
        <ShieldCheck size={14} /> Synced orders retain their source status. Open an order to review
        supplier costs and payment details.
      </div>
    </>
  );
}

export function RtoBalance(p: PageProps) {
  const { data, period, open, session } = p,
    c = data.credit;
  const [tab, setTab] = useState(p.search === 'needs:credit' ? 'Pending credits' : 'Credit ledger'),
    [supplier, setSupplier] = useState('all'),
    [type, setType] = useState('all');
  const filtered = data.ledger.filter(
    (l) =>
      inPeriod(l.date, period) &&
      (supplier === 'all' || l.supplier_id === supplier) &&
      (type === 'all' || l.type === type),
  );
  const chart = useMemo(() => {
    const map = new Map<string, { date: string; added: number; used: number; balance: number }>();
    let balance = data.ledger
      .filter((l) => l.date < period.from)
      .reduce((s, l) => s + (l.type === 'Credit added' ? l.amount : -l.amount), 0);
    [...data.ledger]
      .filter((l) => inPeriod(l.date, period))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((l) => {
        if (!map.has(l.date)) map.set(l.date, { date: l.date, added: 0, used: 0, balance });
        const row = map.get(l.date)!;
        if (l.type === 'Credit added') {
          row.added += l.amount;
          balance += l.amount;
        } else {
          row.used += l.amount;
          balance -= l.amount;
        }
        row.balance = balance;
      });
    return [...map.values()];
  }, [data.ledger, period]);
  const supplierData = data.suppliers.filter((s) => s.balance > 0);
  const pending = data.orders.filter(
    (o) => o.status === 'RTO' && o.product_cost > o.credit_received,
  );
  const columns: Column<Credit>[] = [
    { key: 'date', label: 'Date', render: (l) => shortDate(l.date) },
    {
      key: 'order_id',
      label: 'Order',
      value: (l) => data.orders.find((o) => o.id === l.order_id)?.number || '',
      render: (l) => (
        <button
          className="order-link"
          onClick={() => {
            const o = data.orders.find((o) => o.id === l.order_id);
            if (o) open({ type: 'orderDetail', record: o });
          }}
        >
          {data.orders.find((o) => o.id === l.order_id)?.number}
        </button>
      ),
    },
    {
      key: 'supplier_id',
      label: 'Supplier',
      value: (l) => data.suppliers.find((s) => s.id === l.supplier_id)?.name || '',
      render: (l) => (
        <div className="stacked-cell">
          <strong>{data.suppliers.find((s) => s.id === l.supplier_id)?.name}</strong>
          <small>{l.reference}</small>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'Product',
      value: (l) =>
        data.orders
          .find((o) => o.id === l.order_id)
          ?.items.map((i) => i.name)
          .join(', ') || '',
      render: (l) => (
        <span className="truncate-cell">
          {data.orders
            .find((o) => o.id === l.order_id)
            ?.items.filter((i) => i.supplier_id === l.supplier_id)
            .map((i) => i.name)
            .join(', ')}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (l) => (
        <span className={`ledger-type ${l.type === 'Credit added' ? 'positive' : 'purple-text'}`}>
          {l.type === 'Credit added' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}{' '}
          {l.type}
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      className: 'text-right',
      render: (l) => (
        <span className={`money ${l.type === 'Credit added' ? 'positive' : 'purple-text'}`}>
          {l.type === 'Credit added' ? '+' : '−'}
          {money(l.amount)}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (l) => (
        <Badge tone={l.type === 'Credit added' ? 'green' : 'purple'}>
          {l.type === 'Credit added' ? 'Credited' : 'Applied'}
        </Badge>
      ),
    },
    {
      key: 'action',
      label: '',
      render: (l) => (
        <button
          className="icon-button small"
          aria-label={`View credit ${l.reference}`}
          onClick={() => open({ type: 'creditDetail', record: l })}
        >
          <MoreHorizontal size={18} />
        </button>
      ),
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="RETURNS, RECOVERED"
        title="RTO refund balance"
        subtitle="Give returned product costs a second life. Track every credit and every use."
      >
        <button className="button" onClick={() => open({ type: 'help' })}>
          <CircleHelp size={16} />
          How it works
        </button>
        {session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => open({ type: 'credit' })}>
            <Plus size={17} />
            Add RTO credit
          </button>
        )}
      </PageHeading>
      <div className="stats-grid rto-stats">
        <Stat
          label="Total credits received"
          value={money(c.added)}
          note={`From ${c.creditedOrders} returned orders · all time`}
          icon={<ArrowDownLeft size={20} />}
          accent="green"
        />
        <Stat
          label="Total credits used"
          value={money(c.used)}
          note={`Applied to ${c.usedOrders} purchases · all time`}
          icon={<ArrowUpRight size={20} />}
          accent="purple"
        />
        <Stat
          label="Available RTO balance"
          value={money(c.balance)}
          note="Supplier credit · all time"
          icon={<Wallet size={20} />}
          accent="blue"
        />
        <Stat
          label="Pending supplier credits"
          value={money(c.pending)}
          note={`Awaiting credit on ${c.pendingOrders} returns`}
          icon={<Clock3 size={20} />}
          accent="amber"
        />
      </div>
      <div className="credit-notice">
        <span className="credit-notice-icon">
          <ShieldCheck size={19} />
        </span>
        <p>
          <strong>Credit, with the right supplier.</strong> RTO balances are supplier receivables
          and are kept separate from your cash and bank balances.
        </p>
        {session.user.role !== 'viewer' && (
          <button onClick={() => open({ type: 'useCredit' })}>
            Use available credit <ArrowRight size={15} />
          </button>
        )}
      </div>
      <div className="rto-chart-grid">
        <Panel
          title="Your credit journey"
          subtitle="Credits received, applied, and carried forward"
          action={<span className="subtle-label">{period.label}</span>}
        >
          <div className="chart-legend small-legend">
            <span>
              <i style={{ background: colors[1] }} />
              Credits received
            </span>
            <span>
              <i style={{ background: '#c5bcf5' }} />
              Credits used
            </span>
            <span>
              <i style={{ background: colors[0] }} />
              Balance
            </span>
          </div>
          <div className="chart-container credit-chart">
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 10, right: 22, left: 2, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--muted)', fontSize: 10 }}
                    minTickGap={20}
                    dy={7}
                  />
                  <YAxis
                    tickFormatter={axisMoney}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--muted)', fontSize: 10 }}
                    width={58}
                  />
                  <Tooltip
                    formatter={chartMoney}
                    contentStyle={tooltipStyle}
                    labelFormatter={(v) => longDate(String(v))}
                  />
                  <Bar
                    dataKey="added"
                    name="Credits received"
                    fill={colors[1]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={15}
                  />
                  <Bar
                    dataKey="used"
                    name="Credits used"
                    fill="#c5bcf5"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={15}
                  />
                  <Line
                    dataKey="balance"
                    name="Balance"
                    stroke={colors[0]}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: colors[0], strokeWidth: 2, stroke: 'var(--surface)' }}
                    type="monotone"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title="No credit activity in this period"
                description="Add a supplier credit or choose another date range."
              />
            )}
          </div>
        </Panel>
        <Panel title="Balance by supplier" subtitle="Your credit stays where it belongs">
          <div className="supplier-donut">
            <div className="donut-wrap">
              {supplierData.length ? (
                <>
                  <ResponsiveContainer width="100%" height={175}>
                    <PieChart>
                      <Pie
                        data={supplierData}
                        dataKey="balance"
                        nameKey="name"
                        innerRadius={57}
                        outerRadius={75}
                        paddingAngle={4}
                        stroke="none"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {supplierData.map((s, i) => (
                          <Cell key={s.id} fill={colors[i % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={chartMoney} contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center">
                    <strong>{money(c.balance)}</strong>
                    <span>Available credit</span>
                  </div>
                </>
              ) : (
                <Empty
                  title="No available credit"
                  description="Your confirmed credits will appear here."
                />
              )}
            </div>
            <div className="supplier-legend">
              {supplierData.map((s, i) => (
                <div key={s.id}>
                  <i style={{ background: colors[i % colors.length] }} />
                  <span>{s.name}</span>
                  <strong>{money(s.balance)}</strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Return credit status" subtitle="Every rupee accounted for">
          <div className="return-status-list">
            <div className="return-status green">
              <CheckCircle2 size={19} />
              <span>
                Credits received<small>{c.creditedOrders} returned orders</small>
              </span>
              <strong>{money(c.added)}</strong>
            </div>
            <div className="return-status amber">
              <Clock3 size={19} />
              <span>
                Awaiting credit<small>{c.pendingOrders} returned orders</small>
              </span>
              <strong>{money(c.pending)}</strong>
            </div>
            <div className="return-status purple">
              <ArrowUpRight size={19} />
              <span>
                Applied to purchases<small>{c.usedOrders} purchase orders</small>
              </span>
              <strong>{money(c.used)}</strong>
            </div>
            <div className="return-status blue">
              <Wallet size={19} />
              <span>
                Ready to use<small>Across {supplierData.length} suppliers</small>
              </span>
              <strong>{money(c.balance)}</strong>
            </div>
          </div>
          <div className="tiny-note">
            <Info size={13} /> Pending returns become usable only after supplier confirmation.
          </div>
        </Panel>
      </div>
      <Panel className="ledger-panel">
        <div className="tabs ledger-tabs">
          {['Credit ledger', 'Credits used', 'Pending credits', 'Supplier balances'].map((t) => (
            <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
              {t}
              {t === 'Pending credits' && c.pendingOrders > 0 && <span>{c.pendingOrders}</span>}
            </button>
          ))}
          <div className="tabs-end">
            <ExportButton
              type={
                tab === 'Supplier balances'
                  ? 'suppliers'
                  : tab === 'Pending credits'
                    ? 'pending-credits'
                    : 'credits'
              }
              period={period}
              extra={{ supplier, creditType: tab === 'Credits used' ? 'Credit used' : type }}
            />
          </div>
        </div>
        {tab === 'Credit ledger' || tab === 'Credits used' ? (
          <DataTable
            rows={
              tab === 'Credits used' ? filtered.filter((l) => l.type === 'Credit used') : filtered
            }
            columns={columns}
            searchPlaceholder="Search order, supplier, product or reference…"
            search={p.search.startsWith('needs:') ? '' : p.search}
            filters={
              <>
                <select
                  aria-label="Filter credit supplier"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                >
                  <option value="all">All suppliers</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {tab === 'Credit ledger' && (
                  <select
                    aria-label="Filter credit type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="all">All types</option>
                    <option>Credit added</option>
                    <option>Credit used</option>
                  </select>
                )}
              </>
            }
          />
        ) : tab === 'Pending credits' ? (
          <DataTable
            rows={pending}
            searchPlaceholder="Search pending returns…"
            columns={[
              {
                key: 'number',
                label: 'Returned order',
                render: (o) => (
                  <button
                    className="order-link"
                    onClick={() => open({ type: 'orderDetail', record: o })}
                  >
                    {o.number}
                  </button>
                ),
              },
              { key: 'customer', label: 'Customer' },
              { key: 'date', label: 'Order date', render: (o) => longDate(o.date) },
              {
                key: 'product_cost',
                label: 'Product cost',
                render: (o) => <Money value={o.product_cost} />,
              },
              {
                key: 'credit_received',
                label: 'Credit received',
                render: (o) => <Money value={o.credit_received} />,
              },
              {
                key: 'pending',
                label: 'Pending credit',
                value: (o) => o.product_cost - o.credit_received,
                render: (o) => (
                  <Money value={o.product_cost - o.credit_received} className="amber-text" />
                ),
              },
              {
                key: 'action',
                label: '',
                render: (o) =>
                  session.user.role !== 'viewer' ? (
                    <button
                      className="button small"
                      onClick={() =>
                        open({
                          type: 'credit',
                          orderId: o.id,
                          supplierId: o.items[0]?.supplier_id || undefined,
                        })
                      }
                    >
                      <Plus size={14} />
                      Receive credit
                    </button>
                  ) : (
                    <Badge>Pending</Badge>
                  ),
              },
            ]}
            filters={<span className="subtle-label">All outstanding returns</span>}
          />
        ) : (
          <SupplierTable
            suppliers={data.suppliers}
            open={open}
            canWrite={session.user.role !== 'viewer'}
          />
        )}
      </Panel>
      <div className="page-footnote">
        <ShieldCheck size={14} /> An auditable ledger. Supplier-specific balances. No
        double-counting in your profit.
      </div>
    </>
  );
}

function SupplierTable({
  suppliers,
  open,
  canWrite,
}: {
  suppliers: Supplier[];
  open: PageProps['open'];
  canWrite: boolean;
}) {
  return (
    <DataTable
      rows={suppliers}
      searchPlaceholder="Search suppliers…"
      columns={[
        {
          key: 'name',
          label: 'Supplier',
          render: (s) => (
            <div className="person-cell">
              <span className="supplier-avatar">{initials(s.name)}</span>
              <div>
                <strong>{s.name}</strong>
                <small>{s.email || s.phone || 'No contact details'}</small>
              </div>
            </div>
          ),
        },
        { key: 'products', label: 'Products' },
        { key: 'added', label: 'Credits received', render: (s) => <Money value={s.added} /> },
        { key: 'used', label: 'Credits used', render: (s) => <Money value={s.used} /> },
        {
          key: 'pending',
          label: 'Awaiting credit',
          render: (s) => <Money value={s.pending} className="amber-text" />,
        },
        {
          key: 'balance',
          label: 'Available balance',
          render: (s) => <Money value={s.balance} className="positive" />,
        },
        {
          key: 'action',
          label: '',
          render: (s) => (
            <div className="inline-actions">
              {canWrite && (
                <button
                  className="button small"
                  disabled={s.balance <= 0}
                  onClick={() => open({ type: 'useCredit', supplierId: s.id })}
                >
                  Use credit <ArrowUpRight size={13} />
                </button>
              )}
              <button
                className="icon-button small"
                onClick={() => open({ type: 'supplier', record: s })}
                aria-label={`Edit ${s.name}`}
                disabled={!canWrite}
              >
                <Settings2 size={16} />
              </button>
            </div>
          ),
        },
      ]}
    />
  );
}
export function Suppliers(p: PageProps) {
  return (
    <>
      <PageHeading
        eyebrow="YOUR PARTNERS"
        title="Suppliers"
        subtitle="Better supplier relationships start with clearer records."
      >
        <ExportButton type="suppliers" period={p.period} />
        {p.session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => p.open({ type: 'supplier' })}>
            <Plus size={17} />
            Add supplier
          </button>
        )}
      </PageHeading>
      <div className="stats-grid">
        <Stat
          label="Supplier partners"
          value={num(p.data.suppliers.length)}
          note="Independent supplier accounts"
          icon={<Users size={20} />}
        />
        <Stat
          label="Available supplier credit"
          value={money(p.data.credit.balance)}
          note="Kept separate from cash"
          accent="green"
          icon={<Wallet size={20} />}
        />
        <Stat
          label="Awaiting supplier credit"
          value={money(p.data.credit.pending)}
          note="Returns awaiting approval"
          accent="amber"
          icon={<Clock3 size={20} />}
        />
        <Stat
          label="Credits put to work"
          value={money(p.data.credit.used)}
          note="Applied to future purchases"
          accent="blue"
          icon={<ArrowUpRight size={20} />}
        />
      </div>
      <Panel title="Your supplier directory" subtitle="Credit balances shown across all dates">
        <SupplierTable
          suppliers={p.data.suppliers}
          open={p.open}
          canWrite={p.session.user.role !== 'viewer'}
        />
      </Panel>
    </>
  );
}

export function Products(p: PageProps) {
  const [category, setCategory] = useState('all');
  const rows = p.data.products.filter((x) => category === 'all' || x.category === category);
  return (
    <>
      <PageHeading
        eyebrow="YOUR CATALOGUE"
        title="Products"
        subtitle="Know what sells, what it costs, and what it earns."
      >
        <ExportButton type="products" period={p.period} />
        {p.session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => p.open({ type: 'product' })}>
            <Plus size={17} />
            Add product
          </button>
        )}
      </PageHeading>
      <div className="catalogue-summary">
        <div>
          <span className="pipeline-icon purple">
            <Package size={21} />
          </span>
          <span>
            <strong>{p.data.products.length}</strong> products in your catalogue
          </span>
        </div>
        <div>
          <span className="live-dot" />
          {num(p.data.products.reduce((s, x) => s + x.stock, 0))} units available
        </div>
        <div>
          <span className="dot amber-dot" />
          {p.data.products.filter((x) => x.stock < 25).length} products running low
        </div>
      </div>
      <Panel>
        <DataTable
          rows={rows}
          search={p.search}
          searchPlaceholder="Search product name or SKU…"
          filters={
            <select
              aria-label="Filter product category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {[...new Set(p.data.products.map((p) => p.category))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          }
          columns={[
            {
              key: 'name',
              label: 'Product',
              render: (x) => (
                <div className="product-cell">
                  <ProductIcon product={x} />
                  <div>
                    <strong>{x.name}</strong>
                    <small>{x.sku}</small>
                  </div>
                </div>
              ),
            },
            { key: 'supplier', label: 'Supplier', render: (x) => <span>{x.supplier}</span> },
            { key: 'cost', label: 'Supplier cost', render: (x) => <Money value={x.cost} /> },
            { key: 'price', label: 'Selling price', render: (x) => <Money value={x.price} /> },
            {
              key: 'stock',
              label: 'Stock',
              render: (x) => (
                <span className={x.stock < 25 ? 'amber-text stock-label' : 'stock-label'}>
                  <i />
                  {num(x.stock)} units
                </span>
              ),
            },
            { key: 'orders', label: 'Orders' },
            { key: 'revenue', label: 'Revenue', render: (x) => <Money value={x.revenue} /> },
            {
              key: 'profit',
              label: 'Contribution',
              render: (x) => (
                <Money value={x.profit} className={x.profit >= 0 ? 'positive' : 'negative'} />
              ),
            },
            {
              key: 'action',
              label: '',
              render: (x) => (
                <button
                  className="icon-button small"
                  disabled={p.session.user.role === 'viewer'}
                  onClick={() => p.open({ type: 'product', record: x })}
                  aria-label={`Edit ${x.name}`}
                >
                  <MoreHorizontal size={18} />
                </button>
              ),
            },
          ]}
        />
      </Panel>
      <Notice>
        Product revenue and contribution follow the selected period. Shared order revenue and
        shipping are allocated by line-item selling value; overhead is reported separately.
      </Notice>
    </>
  );
}

export function Expenses(p: PageProps) {
  const [category, setCategory] = useState('all'),
    [deleting, setDeleting] = useState<string | null>(null);
  const rows = p.data.expenses.filter((e) => inPeriod(e.date, p.period));
  const groups = [
    'Meta Ads',
    'Product cost',
    'Shiprocket / shipping',
    'RTO charges',
    'Software / subscriptions',
    'Other expenses',
  ]
    .map((name, i) => ({
      name,
      amount: rows.filter((r) => r.category === name).reduce((s, r) => s + r.amount, 0),
      color: colors[i],
    }))
    .filter((r) => r.amount > 0);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const columns: Column<Expense>[] = [
    { key: 'date', label: 'Date', render: (e) => longDate(e.date) },
    {
      key: 'category',
      label: 'Category',
      render: (e) => (
        <div className="expense-category">
          <span>
            {e.category === 'Meta Ads' ? (
              <Megaphone size={17} />
            ) : e.category === 'Software / subscriptions' ? (
              <Layers3 size={17} />
            ) : (
              <FileText size={17} />
            )}
          </span>
          <strong>{e.category}</strong>
        </div>
      ),
    },
    {
      key: 'notes',
      label: 'Notes',
      render: (e) => <span className="expense-note">{e.notes || '—'}</span>,
    },
    {
      key: 'reference',
      label: 'Reference',
      render: (e) => <span className="muted">{e.reference || '—'}</span>,
    },
    {
      key: 'amount',
      label: 'Amount',
      className: 'text-right',
      render: (e) => <Money value={e.amount} />,
    },
    {
      key: 'action',
      label: '',
      render: (e) =>
        p.session.user.role !== 'viewer' ? (
          deleting === e.id ? (
            <div className="inline-actions">
              <button
                className="text-button negative"
                onClick={async () => {
                  try {
                    await api(`/expenses/${e.id}`, { method: 'DELETE' });
                    setDeleting(null);
                    await p.refresh('Expense removed.');
                  } catch (err) {
                    p.notify((err as Error).message, true);
                  }
                }}
              >
                Confirm delete
              </button>
              <button
                className="icon-button small"
                onClick={() => setDeleting(null)}
                aria-label="Cancel delete"
              >
                <XCircle size={16} />
              </button>
            </div>
          ) : (
            <button
              className="icon-button small"
              onClick={() => setDeleting(e.id)}
              aria-label="Delete expense"
            >
              <MoreHorizontal size={17} />
            </button>
          )
        ) : null,
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="EVERY COST COUNTS"
        title="Expenses"
        subtitle="Small costs add up. Keep the full picture in view."
      >
        <ExportButton type="expenses" period={p.period} />
        {p.session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => p.open({ type: 'expense' })}>
            <Plus size={17} />
            Add expense
          </button>
        )}
      </PageHeading>
      <div className="expenses-overview">
        <div className="expense-total-panel">
          <span className="eyebrow">TOTAL MANUAL EXPENSES</span>
          <div className="expense-total-value">{money(total)}</div>
          <p>
            {rows.length} recorded expenses · {p.period.label}
          </p>
          <div className="expense-progress">
            {groups.map((g) => (
              <span
                key={g.name}
                style={{ width: `${total ? (g.amount / total) * 100 : 0}%`, background: g.color }}
              />
            ))}
          </div>
        </div>
        <div className="expense-category-grid">
          {groups.length ? (
            groups.map((g) => (
              <div key={g.name}>
                <span>
                  <i style={{ background: g.color }} />
                  {g.name}
                </span>
                <strong>{money(g.amount)}</strong>
                <small>{((g.amount / total) * 100).toFixed(1)}% of total expenses</small>
              </div>
            ))
          ) : (
            <Empty
              title="No expenses in this period"
              description="Record expenses to see your cost breakdown."
            />
          )}
        </div>
      </div>
      <Panel title="Expense ledger" subtitle="Additional costs entered by your team">
        <DataTable
          rows={rows.filter((e) => category === 'all' || e.category === category)}
          columns={columns}
          search={p.search}
          filters={
            <select
              aria-label="Filter expense category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {[
                'Meta Ads',
                'Product cost',
                'Shiprocket / shipping',
                'RTO charges',
                'Software / subscriptions',
                'Other expenses',
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          }
        />
      </Panel>
      <Notice>
        Order-level product costs, shipping and RTO charges already flow into profit. Manual
        expenses are additional costs; avoid entering the same cost in both places.
      </Notice>
    </>
  );
}

export function Payments(p: PageProps) {
  const [tab, setTab] = useState(p.search === 'needs:payment' ? 'Pending' : 'All transactions'),
    [kind, setKind] = useState('all');
  const [review, setReview] = useState<{ payment: Payment; action: 'complete' | 'cancel' } | null>(
    null,
  );
  const closeReview = useCallback(() => setReview(null), []);
  const m = p.data.paymentMetrics || p.data.metrics,
    rows = p.data.payments
      .filter((r) => inPeriod(r.date, p.period))
      .filter(
        (r) =>
          (tab === 'All transactions' || r.status === tab) && (kind === 'all' || r.kind === kind),
      );
  const columns: Column<Payment>[] = [
    { key: 'date', label: 'Payment date', render: (r) => longDate(r.date) },
    {
      key: 'order_id',
      label: 'Order',
      value: (r) => p.data.orders.find((o) => o.id === r.order_id)?.number || '',
      render: (r) => (
        <button
          className="order-link"
          onClick={() => {
            const o = p.data.orders.find((o) => o.id === r.order_id);
            if (o) p.open({ type: 'orderDetail', record: o });
          }}
        >
          {p.data.orders.find((o) => o.id === r.order_id)?.number || '—'}
        </button>
      ),
    },
    {
      key: 'kind',
      label: 'Transaction type',
      render: (r) => (
        <div className="stacked-cell">
          <strong>{r.kind}</strong>
          <small>{r.source}</small>
        </div>
      ),
    },
    {
      key: 'reference',
      label: 'Reference',
      render: (r) => <span className="mono muted">{r.reference}</span>,
    },
    {
      key: 'amount',
      label: 'Amount',
      className: 'text-right',
      render: (r) => (
        <Money
          value={r.amount}
          className={['Supplier payment', 'Customer refund'].includes(r.kind) ? 'negative' : ''}
        />
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
    {
      key: 'action',
      label: '',
      render: (r) =>
        r.status === 'Pending' && r.source === 'Manual' && p.session.user.role !== 'viewer' ? (
          <div className="payment-row-actions">
            <button
              className="button small"
              onClick={() => setReview({ payment: r, action: 'complete' })}
            >
              <Check size={14} /> Complete
            </button>
            <button
              className="icon-button"
              aria-label={`Cancel pending payment ${r.reference}`}
              title="Cancel pending payment"
              onClick={() => setReview({ payment: r, action: 'cancel' })}
            >
              <XCircle size={17} />
            </button>
          </div>
        ) : r.status === 'Cancelled' ? (
          <span className="muted" title={r.void_reason}>
            Cancelled
          </span>
        ) : (
          <CheckCircle2 className="muted" size={16} />
        ),
    },
  ];
  return (
    <>
      {review && (
        <PaymentReview
          payment={review.payment}
          action={review.action}
          order={p.data.orders.find((o) => o.id === review.payment.order_id)}
          onClose={closeReview}
          onSaved={() =>
            p.refresh(
              review.action === 'complete'
                ? 'Payment completed.'
                : 'Pending payment cancelled. Balance released.',
            )
          }
        />
      )}
      <PageHeading
        eyebrow="FOLLOW THE MONEY"
        title="Payments & remittances"
        subtitle="From customer collection to settlement. Keep every payment in sight."
      >
        <ExportButton type="payments" period={p.period} />
        {p.session.user.role !== 'viewer' && (
          <button className="button primary" onClick={() => p.open({ type: 'payment' })}>
            <Plus size={17} />
            Record payment
          </button>
        )}
      </PageHeading>
      <div className="stats-grid">
        <Stat
          label="COD collected"
          value={money(m.codCollected)}
          note="Collected in the selected period"
          icon={<Banknote size={20} />}
          accent="blue"
        />
        <Stat
          label="COD remitted"
          value={money(m.codRemitted)}
          note="Settled in the selected period"
          icon={<CheckCircle2 size={20} />}
          accent="green"
        />
        <Stat
          label="COD pending"
          value={money(m.codPending)}
          note="Outstanding across all dates"
          icon={<Clock3 size={20} />}
          accent="amber"
        />
        <Stat
          label="Prepaid payments"
          value={money(m.prepaid)}
          note="Received in the selected period"
          icon={<CreditCard size={20} />}
          accent="purple"
        />
      </div>
      <Notice>
        Delivery confirms COD collection, not a bank remittance. Shopify prepaid transactions sync
        automatically. COD remittances require a connected settlement feed or a manual record.
      </Notice>
      <Panel>
        <div className="tabs">
          {['All transactions', 'Completed', 'Pending', 'Cancelled'].map((t) => (
            <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
              {t}
            </button>
          ))}
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          search={p.search.startsWith('needs:') ? '' : p.search}
          searchPlaceholder="Search order, transaction or reference…"
          filters={
            <select
              aria-label="Filter payment type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="all">All payment types</option>
              {[
                'COD collected',
                'COD remittance',
                'Prepaid payment',
                'Supplier payment',
                'Customer refund',
              ].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          }
        />
      </Panel>
      <div className="page-footnote">
        <Info size={14} /> Collections, remittances and prepaid totals follow payment dates. COD
        pending is the outstanding balance across all dates. Customer collections and remittances
        are separate stages, not additive cash receipts.
      </div>
    </>
  );
}

export function Shipments(p: PageProps) {
  const [status, setStatus] = useState('all');
  const rows = p.data.shipments.filter((s) => {
    const o = p.data.orders.find((o) => o.id === s.order_id);
    return o && inPeriod(o.date, p.period) && (status === 'all' || s.status === status);
  });
  return (
    <>
      <PageHeading
        eyebrow="FROM YOUR STORE TO THEIR DOOR"
        title="Shipments"
        subtitle="Track deliveries, act on NDRs, and stay ahead of returns."
      >
        <button className="button" onClick={() => p.navigate('settings')}>
          <Link2 size={16} />
          Shiprocket settings
        </button>
        <ExportButton type="orders" period={p.period} />
      </PageHeading>
      <div className="stats-grid">
        <Stat
          label="In transit"
          value={num(p.data.metrics.shipped)}
          note="Orders on their way"
          icon={<Truck size={20} />}
          accent="blue"
        />
        <Stat
          label="Delivered"
          value={num(p.data.metrics.delivered)}
          note="Orders successfully completed"
          icon={<CheckCircle2 size={20} />}
          accent="green"
        />
        <Stat
          label="Delivery exceptions"
          value={num(p.data.metrics.ndr)}
          note="NDRs need attention"
          icon={<Clock3 size={20} />}
          accent="amber"
        />
        <Stat
          label="Returning to origin"
          value={num(p.data.metrics.rto)}
          note="Track supplier receipt & credit"
          icon={<RotateCcw size={20} />}
          accent="purple"
        />
      </div>
      <Panel title="Shipment tracking" subtitle="Updates reconciled from Shiprocket">
        <DataTable
          rows={rows}
          search={p.search}
          searchPlaceholder="Search AWB, courier or status…"
          filters={
            <select
              aria-label="Filter shipment status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              {['Confirmed', 'Shipped', 'Delivered', 'NDR', 'RTO', 'Cancelled'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          }
          columns={[
            {
              key: 'awb',
              label: 'AWB number',
              render: (s) => (
                <div className="awb-cell">
                  <span className="pipeline-icon blue">
                    <Truck size={17} />
                  </span>
                  <div>
                    <strong className="mono">{s.awb}</strong>
                    <small>{s.courier}</small>
                  </div>
                </div>
              ),
            },
            {
              key: 'order_id',
              label: 'Order',
              value: (s) => p.data.orders.find((o) => o.id === s.order_id)?.number || '',
              render: (s) => (
                <button
                  className="order-link"
                  onClick={() => {
                    const o = p.data.orders.find((o) => o.id === s.order_id);
                    if (o) p.open({ type: 'orderDetail', record: o });
                  }}
                >
                  {p.data.orders.find((o) => o.id === s.order_id)?.number}
                </button>
              ),
            },
            {
              key: 'customer',
              label: 'Customer',
              value: (s) => p.data.orders.find((o) => o.id === s.order_id)?.customer || '',
              render: (s) => p.data.orders.find((o) => o.id === s.order_id)?.customer,
            },
            { key: 'status', label: 'Delivery status', render: (s) => <Badge>{s.status}</Badge> },
            {
              key: 'ndr',
              label: 'NDR details',
              render: (s) => (
                <span className={s.ndr ? 'amber-text' : 'muted'}>
                  {s.ndr || 'No active exception'}
                </span>
              ),
            },
            { key: 'status_at', label: 'Latest update', render: (s) => longDate(s.status_at) },
          ]}
        />
      </Panel>
      <Notice>
        Shipment creation and courier booking remain in Shiprocket. This workspace automatically
        imports AWBs, delivery, NDR, and RTO status after you connect your account.
      </Notice>
    </>
  );
}

export function Customers(p: PageProps) {
  const customers = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        phone: string;
        email: string;
        city: string;
        orders: number;
        revenue: number;
        lastOrder: string;
      }
    >();
    p.data.orders
      .filter((o) => inPeriod(o.date, p.period))
      .forEach((o) => {
        const id = o.email || o.phone || o.customer;
        const current = map.get(id) || {
          id,
          name: o.customer,
          phone: o.phone,
          email: o.email,
          city: o.city,
          orders: 0,
          revenue: 0,
          lastOrder: o.date,
        };
        current.orders++;
        current.revenue += o.revenue;
        if (o.date > current.lastOrder) current.lastOrder = o.date;
        map.set(id, current);
      });
    return [...map.values()];
  }, [p.data.orders, p.period]);
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE ORDERS"
        title="Customers"
        subtitle="A clear view of the people who choose your store."
      />
      <Panel>
        <DataTable
          rows={customers}
          search={p.search}
          searchPlaceholder="Search customer, phone or email…"
          columns={[
            {
              key: 'name',
              label: 'Customer',
              render: (c) => (
                <div className="person-cell">
                  <span className="avatar">{initials(c.name)}</span>
                  <div>
                    <strong>{c.name}</strong>
                    <small>{c.email || 'No email'}</small>
                  </div>
                </div>
              ),
            },
            { key: 'phone', label: 'Phone' },
            { key: 'city', label: 'City' },
            { key: 'orders', label: 'Orders' },
            { key: 'revenue', label: 'Revenue', render: (c) => <Money value={c.revenue} /> },
            { key: 'lastOrder', label: 'Latest order', render: (c) => longDate(c.lastOrder) },
            {
              key: 'action',
              label: '',
              render: (c) => (
                <button className="text-button" onClick={() => p.navigate('orders', c.name)}>
                  View orders <ArrowRight size={14} />
                </button>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

export function Reports(p: PageProps) {
  const [view, setView] = useState('Profit & loss'),
    [group, setGroup] = useState('Daily');
  const m = p.data.metrics;
  const rows = useMemo(() => {
    const map = new Map<
      string,
      { id: string; period: string; sales: number; profit: number; orders: number }
    >();
    p.data.timeline.forEach((r) => {
      let key = r.date;
      if (group === 'Monthly') key = r.date.slice(0, 7);
      if (group === 'Annual') key = r.date.slice(0, 4);
      if (group === 'Weekly') {
        const d = new Date(r.date + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        key = d.toISOString().slice(0, 10);
      }
      const item = map.get(key) || { id: key, period: key, sales: 0, profit: 0, orders: 0 };
      item.sales += r.sales;
      item.profit += r.profit;
      item.orders += r.orders;
      map.set(key, item);
    });
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [p.data.timeline, group]);
  const pnl = [
    ['Recognized sales', m.sales],
    ['Product costs, net of RTO credits', -m.productCost],
    ['Shipping & RTO charges', -m.shipping],
    ['Gross profit', m.grossProfit],
    ['Meta Ads spend', -m.adSpend],
    ['Other manually recorded expenses', -m.otherExpenses],
    ['Net profit', m.netProfit],
  ] as [string, number][];
  return (
    <>
      <PageHeading
        eyebrow="DECISIONS, BACKED BY DATA"
        title="Reports & insights"
        subtitle="Understand what’s working, where costs go, and what comes next."
      >
        <ExportButton
          type={
            view === 'Product performance'
              ? 'products'
              : view === 'Order profitability' || view === 'RTO analysis'
                ? 'orders'
                : 'reports'
          }
          period={p.period}
          extra={{ report: view, group }}
        />
      </PageHeading>
      <div className="report-nav">
        {[
          'Profit & loss',
          'Performance',
          'Product performance',
          'Order profitability',
          'Ad spend',
          'RTO analysis',
        ].map((v) => (
          <button className={view === v ? 'active' : ''} onClick={() => setView(v)} key={v}>
            {v}
          </button>
        ))}
      </div>
      {view === 'Profit & loss' ? (
        <div className="report-grid">
          <Panel
            title="Profit & loss statement"
            subtitle={`${longDate(p.period.from)} — ${longDate(p.period.to)}`}
            action={<span className="report-currency">INR</span>}
          >
            <div className="pnl-statement">
              {pnl.map(([name, amount]) => (
                <div
                  className={
                    name === 'Net profit' ? 'total' : name === 'Gross profit' ? 'subtotal' : ''
                  }
                  key={name}
                >
                  <span>{name}</span>
                  <strong
                    className={
                      name.includes('profit') ? (amount >= 0 ? 'positive' : 'negative') : ''
                    }
                  >
                    {amount < 0 ? '−' : ''}
                    {money(Math.abs(amount))}
                  </strong>
                </div>
              ))}
            </div>
            <div className="report-margin">
              <span>Net profit margin</span>
              <strong>{m.margin.toFixed(1)}%</strong>
            </div>
          </Panel>
          <div className="report-side">
            <Panel
              title="Where your revenue goes"
              subtitle="Cost structure for the selected period"
            >
              <div className="cost-breakdown">
                {[
                  { name: 'Product costs', value: m.productCost, color: colors[0] },
                  { name: 'Shipping & returns', value: m.shipping, color: colors[2] },
                  { name: 'Advertising', value: m.adSpend, color: colors[3] },
                  { name: 'Other expenses', value: m.otherExpenses, color: colors[4] },
                  { name: 'Net profit', value: Math.max(0, m.netProfit), color: colors[1] },
                ].map((v) => (
                  <div key={v.name}>
                    <div>
                      <span>
                        <i style={{ background: v.color }} />
                        {v.name}
                      </span>
                      <strong>{money(v.value)}</strong>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${Math.min(100, m.sales ? (Math.max(0, v.value) / m.sales) * 100 : 0)}%`,
                          background: v.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Notice>
              Sales are recognized on delivered orders and exclude recorded tax and customer
              refunds. Product costs are charged when shipped; approved RTO credits recover the
              original cost. Using credit later has no further profit effect.
            </Notice>
          </div>
        </div>
      ) : view === 'Performance' ? (
        <Panel
          title="Performance over time"
          subtitle="Group your selected period for a different perspective"
          action={
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              aria-label="Report frequency"
            >
              {['Daily', 'Weekly', 'Monthly', 'Annual'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          }
        >
          <div className="chart-container report-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ left: 10, right: 24, top: 12 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="period"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  minTickGap={30}
                />
                <YAxis
                  tickFormatter={axisMoney}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  width={64}
                />
                <Tooltip formatter={chartMoney} contentStyle={tooltipStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="sales"
                  name="Revenue"
                  fill={colors[0]}
                  maxBarSize={24}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="profit"
                  name="Net profit"
                  fill={colors[1]}
                  maxBarSize={24}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <DataTable
            rows={rows}
            columns={[
              { key: 'period', label: group === 'Weekly' ? 'Week starting' : 'Period' },
              { key: 'orders', label: 'Orders' },
              { key: 'sales', label: 'Sales', render: (r) => <Money value={r.sales} /> },
              {
                key: 'profit',
                label: 'Net profit',
                render: (r) => (
                  <Money value={r.profit} className={r.profit >= 0 ? 'positive' : 'negative'} />
                ),
              },
              {
                key: 'margin',
                label: 'Margin',
                value: (r) => (r.sales ? r.profit / r.sales : 0),
                render: (r) => `${(r.sales ? (r.profit / r.sales) * 100 : 0).toFixed(1)}%`,
              },
            ]}
          />
        </Panel>
      ) : view === 'Product performance' ? (
        <Panel
          title="Product performance"
          subtitle="Revenue and contribution allocated by selling value"
        >
          <DataTable
            rows={p.data.products}
            columns={[
              {
                key: 'name',
                label: 'Product',
                render: (r) => (
                  <div className="product-cell">
                    <ProductIcon product={r} />
                    <strong>{r.name}</strong>
                  </div>
                ),
              },
              { key: 'sku', label: 'SKU' },
              { key: 'orders', label: 'Orders' },
              { key: 'quantity', label: 'Units ordered' },
              { key: 'revenue', label: 'Revenue', render: (r) => <Money value={r.revenue} /> },
              {
                key: 'profit',
                label: 'Contribution',
                render: (r) => (
                  <Money value={r.profit} className={r.profit >= 0 ? 'positive' : 'negative'} />
                ),
              },
            ]}
          />
        </Panel>
      ) : view === 'Order profitability' ? (
        <Panel
          title="Order profitability"
          subtitle="Net profit includes an equal allocation of this period’s manual expenses"
        >
          <DataTable
            rows={p.data.orders.filter((o) => inPeriod(o.date, p.period))}
            columns={orderColumns(p.open)}
          />
        </Panel>
      ) : view === 'Ad spend' ? (
        <>
          <div className="stats-grid">
            <Stat
              label="Recorded ad spend"
              value={money(m.adSpend)}
              note="Manually entered Meta Ads costs"
              icon={<Megaphone size={20} />}
            />
            <Stat
              label="Recognized revenue"
              value={money(m.sales)}
              note="Delivered order revenue"
              accent="green"
              icon={<BadgeIndianRupee size={20} />}
            />
            <Stat
              label="Blended revenue / ad spend"
              value={m.adSpend ? `${(m.sales / m.adSpend).toFixed(2)}×` : '—'}
              note="Store-wide ratio; not attributed ROAS"
              accent="blue"
              icon={<TrendingUp size={20} />}
            />
            <Stat
              label="Ad spend per order"
              value={m.totalOrders ? money(m.adSpend / m.totalOrders) : '—'}
              note="Across all orders in this period"
              accent="amber"
              icon={<ShoppingCart size={20} />}
            />
          </div>
          <Panel
            title="Advertising expense detail"
            subtitle="Campaign notes from your expense ledger"
          >
            <DataTable
              rows={p.data.expenses.filter(
                (e) => e.category === 'Meta Ads' && inPeriod(e.date, p.period),
              )}
              columns={[
                { key: 'date', label: 'Date', render: (e) => longDate(e.date) },
                { key: 'notes', label: 'Campaign / notes' },
                { key: 'reference', label: 'Reference' },
                { key: 'amount', label: 'Spend', render: (e) => <Money value={e.amount} /> },
              ]}
            />
          </Panel>
          <Notice>
            Meta Ads integration is planned for a future version. Enter ad spend in Expenses today.
            These figures compare store-wide sales and spend without claiming campaign attribution.
          </Notice>
        </>
      ) : (
        <>
          <div className="stats-grid">
            <Stat
              label="RTO orders"
              value={String(m.rto)}
              note="In the selected order cohort"
              icon={<RotateCcw size={20} />}
            />
            <Stat
              label="RTO rate"
              value={`${m.rtoRate.toFixed(1)}%`}
              note="RTO ÷ dispatched orders"
              accent="amber"
              icon={<TrendingUp size={20} />}
            />
            <Stat
              label="Available supplier credit"
              value={money(p.data.credit.balance)}
              note="All-time balance"
              accent="green"
              icon={<Wallet size={20} />}
            />
            <Stat
              label="Awaiting supplier approval"
              value={money(p.data.credit.pending)}
              note="All outstanding returns"
              accent="blue"
              icon={<Clock3 size={20} />}
            />
          </div>
          <Panel
            title="Returned orders"
            subtitle="Review costs, credit recovery, and remaining loss"
          >
            <DataTable
              rows={p.data.orders.filter((o) => o.status === 'RTO' && inPeriod(o.date, p.period))}
              columns={[
                {
                  key: 'number',
                  label: 'Order',
                  render: (o) => (
                    <button
                      className="order-link"
                      onClick={() => p.open({ type: 'orderDetail', record: o })}
                    >
                      {o.number}
                    </button>
                  ),
                },
                { key: 'customer', label: 'Customer' },
                {
                  key: 'product_cost',
                  label: 'Product cost',
                  render: (o) => <Money value={o.product_cost} />,
                },
                {
                  key: 'credit_received',
                  label: 'Recovered credit',
                  render: (o) => <Money value={o.credit_received} className="positive" />,
                },
                {
                  key: 'shipping',
                  label: 'Shipping + RTO',
                  value: (o) => o.shipping_cost + o.rto_cost,
                  render: (o) => <Money value={o.shipping_cost + o.rto_cost} />,
                },
                {
                  key: 'profit',
                  label: 'Order contribution',
                  render: (o) => <Money value={o.profit} className="negative" />,
                },
              ]}
            />
          </Panel>
        </>
      )}
      {m.missingCosts > 0 && (
        <Notice tone="warning">
          Profit is provisional: {m.missingCosts} orders need supplier, product cost, or shipping
          verification.
        </Notice>
      )}
      <div className="page-footnote">
        <Info size={14} /> Operational management reports in INR, using Asia/Kolkata dates. Period
        overhead is allocated equally across orders for order-level net profit.
      </div>
    </>
  );
}

export function Settings(p: PageProps) {
  const [settings, setSettings] = useState<SettingsData | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('Connections'),
    [syncing, setSyncing] = useState('');
  const admin = p.session.user.role === 'admin';
  useEffect(() => {
    api<SettingsData>('/settings')
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, [p.data]);
  async function sync(i: Integration) {
    setSyncing(i.provider);
    try {
      const r = (await save(`/sync/${i.provider}`, {})) as { message: string };
      await p.refresh(r.message);
    } catch (e) {
      p.notify((e as Error).message, true);
      await p.refresh();
    } finally {
      setSyncing('');
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="Settings"
        subtitle="Connect your store, manage your team, and keep your data in your hands."
      />
      <div className="report-nav">
        {['Connections', 'Workspace', 'Team & access', 'Activity', 'Backup & export'].map((t) => (
          <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
            {t}
          </button>
        ))}
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      {!settings ? (
        <div className="loading-panel">
          <LoaderCircle className="spin" />
          Loading settings…
        </div>
      ) : (
        <>
          {tab === 'Connections' && (
            <>
              {p.session.demo && (
                <Notice>
                  Demo workspace: the records you see are sample data. Sign out and create your
                  owner account to connect your actual store.
                </Notice>
              )}
              <div className="integration-grid">
                {settings.integrations.map((i) => (
                  <div className="integration-card" key={i.provider}>
                    <div className="integration-card-top">
                      <span className={`integration-logo ${i.provider}`}>
                        {i.provider === 'shopify' ? (
                          <ShoppingBag size={28} />
                        ) : i.provider === 'shiprocket' ? (
                          <Truck size={28} />
                        ) : (
                          <Banknote size={28} />
                        )}
                      </span>
                      <Badge tone={i.configured && i.status === 'Connected' ? 'green' : 'neutral'}>
                        {i.status}
                      </Badge>
                    </div>
                    <h3>
                      {i.provider === 'shopify'
                        ? 'Shopify'
                        : i.provider === 'shiprocket'
                          ? 'Shiprocket'
                          : 'Remittance feed'}
                    </h3>
                    <p>
                      {i.provider === 'shopify'
                        ? 'Orders, products, inventory, and successful prepaid transactions.'
                        : i.provider === 'shiprocket'
                          ? 'AWB numbers, shipments, delivery updates, NDRs, and RTO status.'
                          : 'Verified settlement records from your provider or middleware.'}
                    </p>
                    <div className="integration-detail">
                      <span>
                        <CheckCircle2 size={13} />
                        {i.provider === 'settlements'
                          ? 'Signed payment webhooks'
                          : 'Scheduled sync + webhooks'}
                      </span>
                      <span>
                        {i.lastSync
                          ? `Last sync ${new Date(i.lastSync).toLocaleString('en-IN')}`
                          : 'No live sync yet'}
                      </span>
                    </div>
                    <div className="integration-card-actions">
                      <button
                        className="button"
                        disabled={!admin || p.session.demo}
                        onClick={() => p.open({ type: 'integration', record: i })}
                      >
                        <Settings2 size={15} />
                        {i.configured ? 'Configure' : 'Connect'}
                      </button>
                      {i.provider !== 'settlements' && (
                        <button
                          className="button primary"
                          disabled={!admin || p.session.demo || !i.configured || !!syncing}
                          onClick={() => sync(i)}
                        >
                          {syncing === i.provider ? (
                            <LoaderCircle className="spin" size={15} />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          Sync now
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="integration-card future-integration">
                  <div className="integration-card-top">
                    <span className="meta-logo">∞</span>
                    <span className="coming-soon">FUTURE INTEGRATION</span>
                  </div>
                  <h3>Meta Ads</h3>
                  <p>Bring campaign spend and advertising performance into your workspace.</p>
                  <div className="future-note">
                    <Sparkles size={17} />
                    <span>For now, log Meta Ads costs in Expenses to keep profit up to date.</span>
                  </div>
                  <button className="button" onClick={() => p.navigate('expenses')}>
                    Manage ad expenses <ArrowRight size={15} />
                  </button>
                </div>
              </div>
              <Panel
                title="Synchronization history"
                subtitle="Real sync results, including any connection problems"
              >
                <DataTable
                  rows={p.data.syncRuns}
                  columns={[
                    { key: 'provider', label: 'Connection' },
                    {
                      key: 'started_at',
                      label: 'Started',
                      render: (r) => new Date(r.started_at).toLocaleString('en-IN'),
                    },
                    { key: 'records', label: 'Records' },
                    { key: 'status', label: 'Result', render: (r) => <Badge>{r.status}</Badge> },
                    {
                      key: 'message',
                      label: 'Details',
                      render: (r) => <span className="wrap-cell">{r.message}</span>,
                    },
                  ]}
                  empty={
                    <Empty
                      title="No sync runs yet"
                      description="Connect your accounts and run your first synchronization."
                    />
                  }
                />
              </Panel>
              {settings.webhookFailures.length > 0 && (
                <Panel
                  title="Webhook deliveries needing attention"
                  action={
                    admin && (
                      <button
                        className="button small"
                        onClick={async () => {
                          try {
                            await save('/webhook-retry', {});
                            await p.refresh('Failed webhooks queued for retry.');
                          } catch (e) {
                            p.notify((e as Error).message, true);
                          }
                        }}
                      >
                        <RefreshCw size={14} />
                        Retry failed
                      </button>
                    )
                  }
                >
                  <DataTable
                    rows={settings.webhookFailures}
                    columns={[
                      { key: 'provider', label: 'Provider' },
                      { key: 'status', label: 'State' },
                      { key: 'attempts', label: 'Attempts' },
                      { key: 'error', label: 'Details' },
                    ]}
                  />
                </Panel>
              )}
            </>
          )}
          {tab === 'Workspace' && (
            <Panel title="Business preferences" subtitle="The essentials for your workspace">
              <form
                className="settings-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    await save('/settings/business', { name: f.get('name') }, 'PATCH');
                    await p.refresh('Business name updated.');
                  } catch (e) {
                    p.notify((e as Error).message, true);
                  }
                }}
              >
                <label className="form-field">
                  <span>Business name</span>
                  <input
                    name="name"
                    defaultValue={settings.business.name}
                    required
                    minLength={2}
                    maxLength={60}
                    disabled={!admin}
                  />
                </label>
                <div className="form-grid">
                  <label className="form-field">
                    <span>Base currency</span>
                    <input value="Indian Rupee · INR (₹)" readOnly />
                  </label>
                  <label className="form-field">
                    <span>Reporting time zone</span>
                    <input value="Asia/Kolkata · IST" readOnly />
                  </label>
                </div>
                <Notice>
                  Supplier credits are isolated by supplier. Historical order costs are preserved
                  when product costs change. Live and demo databases are separate.
                </Notice>
                <button className="button primary" disabled={!admin} type="submit">
                  Save preferences
                </button>
              </form>
            </Panel>
          )}
          {tab === 'Team & access' && (
            <>
              {!admin ? (
                <Notice>Only administrators can manage team members.</Notice>
              ) : (
                <Panel
                  title="Team members"
                  subtitle="Give each person the access they need"
                  action={
                    <button
                      className="button primary small"
                      disabled={p.session.demo}
                      onClick={() => p.open({ type: 'user' })}
                    >
                      <Plus size={15} />
                      Add user
                    </button>
                  }
                >
                  <DataTable
                    rows={settings.users}
                    columns={[
                      {
                        key: 'name',
                        label: 'Team member',
                        render: (u) => (
                          <div className="person-cell">
                            <span className="avatar">{initials(u.name)}</span>
                            <div>
                              <strong>{u.name}</strong>
                              <small>{u.email}</small>
                            </div>
                          </div>
                        ),
                      },
                      {
                        key: 'role',
                        label: 'Role',
                        render: (u) => <span className="role-pill">{u.role}</span>,
                      },
                      {
                        key: 'active',
                        label: 'Status',
                        render: (u) => (
                          <Badge tone={u.active ? 'green' : 'neutral'}>
                            {u.active ? 'Active' : 'Disabled'}
                          </Badge>
                        ),
                      },
                      {
                        key: 'action',
                        label: '',
                        render: (u) => (
                          <button
                            className="button small"
                            disabled={u.id === p.session.user.id}
                            onClick={() => p.open({ type: 'user', record: u })}
                          >
                            Manage access
                          </button>
                        ),
                      },
                    ]}
                    empty={
                      <Empty
                        title="Your team starts with you"
                        description={
                          p.session.demo
                            ? 'Team management is available in your own workspace.'
                            : 'Add a team member to collaborate.'
                        }
                      />
                    }
                  />
                </Panel>
              )}
              <div className="roles-grid">
                {[
                  {
                    name: 'Administrator',
                    desc: 'Full access, integrations, user management, and backups.',
                    icon: ShieldCheck,
                  },
                  {
                    name: 'Manager',
                    desc: 'Manage orders, products, suppliers, expenses, payments, and credits.',
                    icon: Settings2,
                  },
                  {
                    name: 'Viewer',
                    desc: 'Read business records, view reports, and export data.',
                    icon: Search,
                  },
                ].map((r) => (
                  <div key={r.name}>
                    <r.icon size={22} />
                    <h4>{r.name}</h4>
                    <p>{r.desc}</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === 'Activity' && (
            <Panel title="Audit trail" subtitle="A record of who changed what and when">
              {admin ? (
                <DataTable
                  rows={settings.audit}
                  columns={[
                    {
                      key: 'created_at',
                      label: 'When',
                      render: (r) => new Date(r.created_at).toLocaleString('en-IN'),
                    },
                    { key: 'action', label: 'Action' },
                    {
                      key: 'actor',
                      label: 'Actor',
                      render: (r) => settings.users.find((u) => u.id === r.actor)?.name || r.actor,
                    },
                    {
                      key: 'entity_id',
                      label: 'Record',
                      render: (r) => <span className="mono muted">{r.entity_id.slice(0, 16)}</span>,
                    },
                  ]}
                />
              ) : (
                <Notice>Audit logs are available to administrators.</Notice>
              )}
            </Panel>
          )}
          {tab === 'Backup & export' && (
            <div className="backup-grid">
              <Panel title="Database backup" subtitle="Keep a complete copy of your workspace">
                <div className="backup-content">
                  <span className="backup-icon">
                    <ShieldCheck size={32} />
                  </span>
                  <h3>Your data, in your hands.</h3>
                  <p>
                    Download a consistent SQLite backup with business records, users, configuration,
                    and the complete supplier credit ledger.
                  </p>
                  <a
                    className={`button primary ${!admin ? 'disabled' : ''}`}
                    href={admin ? '/api/backup' : undefined}
                  >
                    <Download size={16} />
                    Download database backup
                  </a>
                  <small>
                    Administrator access required. Store backups securely. Keep the server
                    encryption key separately for restoring saved connections.
                  </small>
                </div>
              </Panel>
              <Panel
                title="Export business records"
                subtitle="CSV and Excel files for the selected date range"
              >
                <div className="export-list">
                  {[
                    'orders',
                    'products',
                    'suppliers',
                    'expenses',
                    'payments',
                    'credits',
                    'reports',
                  ].map((t) => (
                    <div key={t}>
                      <span>
                        <FileText size={18} />
                        {t === 'credits' ? 'RTO credit ledger' : t[0].toUpperCase() + t.slice(1)}
                      </span>
                      <div>
                        <button className="button small" onClick={() => exportFile(t, p.period)}>
                          CSV
                        </button>
                        <button
                          className="button small"
                          onClick={() => exportFile(t, p.period, 'xlsx')}
                        >
                          Excel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </>
  );
}
