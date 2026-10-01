import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Package, Search, ShoppingBag, Users, X } from 'lucide-react';
import type { ModalState, Page, Workspace } from './types';

export function WorkspaceSearch({
  data,
  page,
  navigate,
  open,
}: {
  data: Workspace | null;
  page: Page;
  navigate: (page: Page, query?: string) => void;
  open: (modal: NonNullable<ModalState>) => void;
}) {
  const [query, setQuery] = useState(''),
    [expanded, setExpanded] = useState(false),
    [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQuery('');
    setExpanded(false);
  }, [page]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data || !q) return [];
    const matches = (...values: string[]) => values.join(' ').toLowerCase().includes(q);
    return [
      ...data.orders
        .filter((o) => matches(o.number, o.customer, o.phone, ...o.items.map((i) => i.name)))
        .slice(0, 4)
        .map((o) => ({
          id: o.id,
          label: o.number,
          detail: `${o.customer} · ${o.status}`,
          group: 'Order',
          icon: ShoppingBag,
          run: () => open({ type: 'orderDetail', record: o }),
        })),
      ...data.products
        .filter((p) => matches(p.name, p.sku))
        .slice(0, 3)
        .map((p) => ({
          id: p.id,
          label: p.name,
          detail: p.sku,
          group: 'Product',
          icon: Package,
          run: () => navigate('products', p.sku),
        })),
      ...data.suppliers
        .filter((s) => matches(s.name, s.phone, s.email))
        .slice(0, 3)
        .map((s) => ({
          id: s.id,
          label: s.name,
          detail: 'Supplier balance and purchases',
          group: 'Supplier',
          icon: Users,
          run: () => navigate('suppliers', s.name),
        })),
    ];
  }, [data, query, open, navigate]);
  const choose = (index: number) => {
    results[index]?.run();
    setExpanded(false);
    setQuery('');
  };
  return (
    <div className="workspace-search" ref={root}>
      <div className="global-search">
        <Search size={18} />
        <input
          aria-label="Search workspace"
          role="combobox"
          aria-expanded={expanded && !!query.trim()}
          aria-controls="workspace-results"
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && results[active] ? `search-result-${active}` : undefined
          }
          placeholder="Search orders, products, suppliers…"
          value={query}
          onFocus={() => setExpanded(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setExpanded(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setExpanded(false);
              e.currentTarget.blur();
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setExpanded(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter' && results.length) {
              e.preventDefault();
              choose(Math.max(0, active));
            }
          }}
        />
        {query ? (
          <button
            className="icon-button small"
            aria-label="Clear workspace search"
            onClick={() => setQuery('')}
          >
            <X size={15} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>
      {expanded && query.trim() && (
        <div
          className="search-results"
          id="workspace-results"
          role="listbox"
          aria-label="Workspace search results"
        >
          <div className="search-results-heading">
            Search across all dates <span>{results.length} matches</span>
          </div>
          {results.map((result, i) => (
            <button
              key={`${result.group}-${result.id}`}
              id={`search-result-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'selected' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              tabIndex={-1}
            >
              <result.icon size={18} />
              <span>
                <strong>{result.label}</strong>
                <small>{result.detail}</small>
              </span>
              <em>{result.group}</em>
              <ArrowRight size={14} />
            </button>
          ))}
          {!results.length && (
            <p className="search-no-results">
              No matches. Try an order number, phone, SKU, or supplier name.
            </p>
          )}
          <div className="search-results-footer">↑ ↓ to move · Enter to open · Esc to close</div>
        </div>
      )}
    </div>
  );
}
