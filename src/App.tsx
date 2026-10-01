import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  ChevronDown,
  CircleHelp,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  TrendingUp,
  Truck,
  Users,
  X,
  CheckCircle2,
  LoaderCircle,
} from 'lucide-react';
import { api, ApiError, makePeriod } from './lib';
import type { ModalState, Page, Period, Session, Workspace } from './types';
import { DatePicker, Notice } from './components';
import { WorkspaceSearch } from './WorkspaceSearch';
import { AuthScreen, ModalForms } from './Forms';
import {
  Customers,
  Dashboard,
  Expenses,
  Orders,
  Payments,
  Products,
  Reports,
  RtoBalance,
  Settings,
  Shipments,
  Suppliers,
  type PageProps,
} from './Pages';
const nav = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'shipments', label: 'Shipments', icon: Truck },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'suppliers', label: 'Suppliers', icon: Users },
  { id: 'expenses', label: 'Expenses', icon: ReceiptText },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'rto', label: 'RTO refund balance', icon: RotateCcw },
  { id: 'reports', label: 'Reports', icon: TrendingUp },
  { id: 'customers', label: 'Customers', icon: Users },
] as const;
const pageMap = {
  dashboard: Dashboard,
  orders: Orders,
  shipments: Shipments,
  products: Products,
  suppliers: Suppliers,
  expenses: Expenses,
  payments: Payments,
  rto: RtoBalance,
  reports: Reports,
  customers: Customers,
  settings: Settings,
};
function initialPage(): Page {
  const s = location.hash.replace('#/', '');
  return s in pageMap ? (s as Page) : 'dashboard';
}

export default function App() {
  const [auth, setAuth] = useState<{
      session: Session | null;
      needsSetup: boolean;
      setupTokenRequired?: boolean;
    } | null>(null),
    [data, setData] = useState<Workspace | null>(null),
    [period, setPeriod] = useState<Period>(() => makePeriod('Last 30 days')),
    [page, setPage] = useState<Page>(initialPage),
    [search, setSearch] = useState(''),
    [modal, setModal] = useState<ModalState>(null),
    [mobileOpen, setMobileOpen] = useState(false),
    [userMenu, setUserMenu] = useState(false),
    [notifications, setNotifications] = useState(false),
    [theme, setTheme] = useState(() => localStorage.getItem('commerce-theme') || 'light'),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    requestSeq = useRef(0);
  const session = auth?.session;
  const notify = useCallback((message: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  const checkAuth = useCallback(async () => {
    ++requestSeq.current;
    const result = await api<{
      session: Session | null;
      needsSetup: boolean;
      setupTokenRequired?: boolean;
    }>('/auth/session');
    setAuth(result);
    setData(null);
  }, []);
  useEffect(() => {
    checkAuth().catch((e) => setError(e.message));
  }, [checkAuth]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('commerce-theme', theme);
  }, [theme]);
  const refresh = useCallback(
    async (message?: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const result = await api<Workspace>(`/workspace?from=${period.from}&to=${period.to}`);
        if (seq === requestSeq.current) {
          setData(result);
          setError('');
        }
        if (message) notify(message);
      } catch (e) {
        if (seq === requestSeq.current) {
          if (e instanceof ApiError && e.status === 401) {
            ++requestSeq.current;
            setData(null);
            setAuth({ session: null, needsSetup: false });
          } else setError((e as Error).message);
        }
        throw e;
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [period, notify],
  );
  useEffect(() => {
    if (!session) return;
    refresh().catch(() => {});
    const timer = setInterval(() => refresh().catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, [session, refresh]);
  useEffect(() => {
    const handler = () => {
      setPage(initialPage());
      setSearch('');
      setMobileOpen(false);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setUserMenu(false);
        setNotifications(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search workspace"]')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const navigate = useCallback((next: Page, query = '') => {
    setPage(next);
    if (query.startsWith('needs:')) setPeriod(makePeriod('All time'));
    setSearch(query);
    history.pushState(null, '', `#/${next}`);
    setMobileOpen(false);
    setNotifications(false);
    window.scrollTo({ top: 0 });
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  useEffect(() => {
    if (!search.startsWith('needs:')) return;
    const frame = requestAnimationFrame(() =>
      document.querySelector('main .tabs')?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [page, search]);
  async function logout() {
    ++requestSeq.current;
    await api('/auth/logout', { method: 'POST' });
    setUserMenu(false);
    setModal(null);
    setData(null);
    await checkAuth();
  }
  if (!auth)
    return (
      <div className="app-loading">
        <span className="brand-mark">
          z<span>↗</span>
        </span>
        {error ? (
          <>
            <p>{error}</p>
            <button className="button" onClick={() => location.reload()}>
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={20} />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  if (!session)
    return (
      <AuthScreen
        needsSetup={auth.needsSetup}
        setupTokenRequired={auth.setupTokenRequired}
        onLogin={checkAuth}
      />
    );
  const Screen = pageMap[page],
    label = page === 'settings' ? 'Settings' : nav.find((n) => n.id === page)?.label;
  const attention = data
    ? data.metrics.ndr + data.credit.pendingOrders + data.metrics.missingCosts
    : 0;
  const pageProps: PageProps | null = data
    ? { data, period, session, open: setModal, navigate, search, refresh, notify }
    : null;
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate('dashboard')}>
          <span className="brand-mark">
            z<span>↗</span>
          </span>
          <div>
            {data?.business.name || 'Zupestore'}
            <span>WORKSPACE</span>
          </div>
        </button>
        <div className="workspace-switcher">
          <span className="workspace-avatar">{(data?.business.name || 'Zupestore')[0]}</span>
          <div>
            <strong>{session.demo ? 'Demo store' : data?.business.name || 'Zupestore'}</strong>
            <span>{session.demo ? 'Sample workspace' : 'Business workspace'}</span>
          </div>
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav>
          {nav.map((item, index) => (
            <div key={item.id}>
              {index === 5 && <div className="nav-divider" />}
              <button
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.id === 'orders' && !!data?.metrics.confirmed && (
                  <span className="nav-count">{data.metrics.confirmed}</span>
                )}
                {item.id === 'rto' && <span className="nav-new-dot" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-insight">
            <div>
              <span className="insight-symbol">
                <TrendingUp size={17} />
              </span>
              <span>A little more clarity.</span>
            </div>
            <p>
              Every order, every cost.
              <br />
              Your business, in balance.
            </p>
            <button onClick={() => navigate('reports')}>
              Explore your reports
              <ArrowUpRightIcon />
            </button>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setModal({ type: 'help' })}>
            <CircleHelp size={18} />
            <span>RTO credit guide</span>
            <ArrowUpRightIcon />
          </button>
          <div className="sidebar-version">
            <span className="live-dot" />
            Zupestore<span>v1.2</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <div className="breadcrumb">
              Workspace <ChevronRightIcon />
              <strong>{label}</strong>
            </div>
          </div>
          <WorkspaceSearch data={data} page={page} navigate={navigate} open={setModal} />
          <div className="topbar-actions">
            <button
              className="icon-button theme-button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="notification-control">
              <button
                className="icon-button notification-button"
                aria-label="View notifications"
                onClick={() => {
                  setNotifications(!notifications);
                  setUserMenu(false);
                }}
              >
                <Bell size={19} />
                {attention > 0 && <i />}
              </button>
              {notifications && (
                <>
                  <button
                    className="popover-backdrop"
                    aria-label="Close notifications"
                    onClick={() => setNotifications(false)}
                  />
                  <div className="notification-menu">
                    <h3>Needs your attention</h3>
                    {data?.metrics.ndr ? (
                      <button onClick={() => navigate('orders', 'NDR')}>
                        <span className="pipeline-icon amber">
                          <Truck size={18} />
                        </span>
                        <span>
                          <strong>{data.metrics.ndr} delivery exceptions</strong>
                          <small>Review your NDR orders</small>
                        </span>
                        <ChevronRightIcon />
                      </button>
                    ) : null}
                    {data?.credit.pendingOrders ? (
                      <button onClick={() => navigate('rto')}>
                        <span className="pipeline-icon purple">
                          <RotateCcw size={18} />
                        </span>
                        <span>
                          <strong>{data.credit.pendingOrders} returns awaiting credit</strong>
                          <small>Confirm supplier receipt</small>
                        </span>
                        <ChevronRightIcon />
                      </button>
                    ) : null}
                    {data?.metrics.missingCosts ? (
                      <button onClick={() => navigate('orders')}>
                        <span className="pipeline-icon amber">
                          <ReceiptText size={18} />
                        </span>
                        <span>
                          <strong>{data.metrics.missingCosts} orders need costs</strong>
                          <small>Verify supplier and product cost</small>
                        </span>
                      </button>
                    ) : null}
                    {!attention && (
                      <p className="caught-up">
                        <CheckCircle2 size={20} />
                        You’re all caught up.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
            <span className="topbar-divider" />
            <div className="user-control">
              <button
                className="user-button"
                aria-label="Account menu"
                onClick={() => {
                  setUserMenu(!userMenu);
                  setNotifications(false);
                }}
                aria-expanded={userMenu}
              >
                <span className="avatar user-avatar">
                  {session.user.name
                    .split(' ')
                    .slice(0, 2)
                    .map((s) => s[0])
                    .join('')}
                </span>
                <span>
                  <strong>{session.user.name}</strong>
                  <small>
                    {session.user.role === 'admin' ? 'Administrator' : session.user.role}
                  </small>
                </span>
                <ChevronDown size={13} />
              </button>
              {userMenu && (
                <>
                  <button
                    className="popover-backdrop"
                    aria-label="Close account menu"
                    onClick={() => setUserMenu(false)}
                  />
                  <div className="user-menu">
                    <span>{session.user.email}</span>
                    <button
                      onClick={() => {
                        navigate('settings');
                        setUserMenu(false);
                      }}
                    >
                      <Settings2 size={16} />
                      Workspace settings
                    </button>
                    <button
                      onClick={() => {
                        setTheme(theme === 'light' ? 'dark' : 'light');
                        setUserMenu(false);
                      }}
                    >
                      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                      {theme === 'light' ? 'Dark mode' : 'Light mode'}
                    </button>
                    <button onClick={() => logout().catch((e) => notify(e.message, true))}>
                      <LogOut size={16} />
                      {session.demo ? 'Exit demo workspace' : 'Sign out'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main>
          {session.demo && (
            <div className="demo-banner">
              <span>
                <Sparkles size={14} />
                <strong>You’re exploring the demo.</strong> Sample data is separate from your
                business.
              </span>
              <button onClick={() => logout().catch((e) => notify(e.message, true))}>
                Create your workspace <ArrowRight size={13} />
              </button>
            </div>
          )}
          <div className="workspace-tools">
            <span>
              <span className="live-dot" />
              {session.demo
                ? 'Sample data'
                : data?.syncRuns[0]?.status === 'Success'
                  ? 'Last sync completed'
                  : 'Workspace ready'}
              {loading && <RefreshCw className="spin" size={11} />}
            </span>
            <div>
              <span className="period-label">Reporting period</span>
              <DatePicker period={period} onChange={setPeriod} />
              <button
                className="icon-button refresh-button"
                onClick={() => refresh().catch(() => {})}
                aria-label="Refresh data"
                disabled={loading}
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
              </button>
            </div>
          </div>
          {search.startsWith('needs:') && (
            <div className="active-search">
              <Search size={14} />
              <strong>
                {(
                  {
                    'needs:ndr': 'Delivery issues',
                    'needs:cost': 'Unverified order costs',
                    'needs:credit': 'Pending supplier credits',
                    'needs:payment': 'Pending payments',
                  } as Record<string, string>
                )[search] || `Search: ${search}`}
              </strong>
              <button
                className="text-button"
                onClick={() => {
                  setSearch('');
                }}
              >
                Clear <X size={13} />
              </button>
            </div>
          )}
          {error && (
            <Notice tone="warning">
              {error}{' '}
              <button className="text-button" onClick={() => refresh().catch(() => {})}>
                Try again
              </button>
            </Notice>
          )}
          {pageProps ? (
            <Screen key={page} {...pageProps} />
          ) : (
            <div className="skeleton-layout">
              <div className="skeleton skeleton-heading" />
              <div className="stats-grid">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton skeleton-stat" />
                ))}
              </div>
              <div className="skeleton skeleton-chart" />
            </div>
          )}
          <footer className="main-footer">
            <span>Your operations. One clear view.</span>
            <span>
              <ShieldCheck size={13} />
              Zupestore · INR · Asia/Kolkata
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {[nav[0], nav[1], nav[6], nav[7]].map((item) => (
          <button
            key={item.id}
            className={page === item.id ? 'active' : ''}
            onClick={() => navigate(item.id)}
            aria-current={page === item.id ? 'page' : undefined}
          >
            <item.icon size={21} />
            <span>{item.id === 'rto' ? 'RTO credits' : item.label}</span>
          </button>
        ))}
      </nav>
      {modal && data && (
        <ModalForms
          key={`${modal.type}-${modal.record && 'id' in modal.record ? modal.record.id : ''}`}
          data={data}
          modal={modal}
          close={closeModal}
          done={refresh}
          canWrite={session.user.role !== 'viewer'}
        />
      )}
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          {toast.error ? <CircleHelp size={19} /> : <CheckCircle2 size={19} />}
          <span>{toast.message}</span>
          <button
            className="icon-button small"
            onClick={() => setToast(null)}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="m5 3 3.5 3.5L5 10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M4 10 10 4M4 4h6v6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
