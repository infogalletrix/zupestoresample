import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  Credit,
  Integration,
  ModalState,
  Order,
  Product,
  Supplier,
  User,
  Workspace,
} from './types';
import { api, decimalMoney, localDate, money, save, toPaise } from './lib';
import { Badge, Dialog, Notice, ProductIcon } from './components';

const categories = [
  'Meta Ads',
  'Product cost',
  'Shiprocket / shipping',
  'RTO charges',
  'Software / subscriptions',
  'Other expenses',
];
type FormProps = {
  data: Workspace;
  modal: NonNullable<ModalState>;
  close: () => void;
  done: (message: string) => Promise<void>;
  canWrite: boolean;
};
function Field({
  label,
  children,
  hint,
  full = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className={`form-field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Submit({
  busy,
  label = 'Save record',
  close,
}: {
  busy: boolean;
  label?: string;
  close: () => void;
}) {
  return (
    <div className="form-actions">
      <button className="button" type="button" onClick={close}>
        Cancel
      </button>
      <button className="button primary" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{' '}
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}
export function ModalForms({ data, modal, close, done, canWrite }: FormProps) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [key] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState(modal.supplierId || data.suppliers[0]?.id || '');
  const [orderId, setOrderId] = useState(modal.orderId || '');
  const [amount, setAmount] = useState('');
  const [paymentKind, setPaymentKind] = useState('COD remittance');
  const [orderLines, setOrderLines] = useState([
    {
      product_id: data.products[0]?.id || '',
      quantity: 1,
      price: (data.products[0]?.price || 0) / 100,
    },
  ]);
  const [status, setStatus] = useState((modal.record as Order)?.status || 'Confirmed');
  async function submit(
    e: FormEvent<HTMLFormElement>,
    fn: (f: FormData) => Promise<unknown>,
    message: string,
  ) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn(new FormData(e.currentTarget));
      await done(message);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const errorNotice = error ? (
    <div className="form-error" role="alert">
      {error}
    </div>
  ) : null;
  const supplierSelect = (
    <select
      value={supplierId}
      onChange={(e) => {
        setSupplierId(e.target.value);
        setOrderId('');
      }}
      required
    >
      <option value="">Select supplier</option>
      {data.suppliers.map((s) => (
        <option value={s.id} key={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
  const dateField = (
    <Field label="Date">
      <input name="date" type="date" defaultValue={localDate()} max={localDate()} required />
    </Field>
  );
  if (modal.type === 'help')
    return (
      <Dialog
        title="A second life for your product costs"
        subtitle="How your RTO supplier credit works"
        onClose={close}
      >
        <div className="help-flow">
          {[
            [
              '1',
              'Confirm the return',
              'When an RTO product reaches the supplier, get confirmation of receipt and a credit note.',
            ],
            [
              '2',
              'Add supplier credit',
              'Record the approved amount against the original order. It becomes available only with that supplier.',
            ],
            [
              '3',
              'Apply it to a new purchase',
              'Choose an eligible order and use all or part of the balance. The remaining payable updates automatically.',
            ],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span>{n}</span>
              <section>
                <h4>{t}</h4>
                <p>{d}</p>
              </section>
            </div>
          ))}
        </div>
        <div className="credit-example">
          <span>Supplier credits your return</span>
          <strong>+ ₹500</strong>
          <span>Apply credit to a new ₹300 purchase</span>
          <strong>− ₹300</strong>
          <span>Remaining supplier credit</span>
          <strong>₹200</strong>
        </div>
        <Notice>
          Supplier credit is a receivable, separate from cash and bank balances. Using it settles a
          purchase; it does not create income or reduce that purchase’s product cost.
        </Notice>
        <button className="button primary full-width" onClick={close}>
          Got it <ArrowRight size={16} />
        </button>
      </Dialog>
    );
  if (modal.type === 'creditDetail') {
    const l = modal.record as Credit;
    const supplier = data.suppliers.find((s) => s.id === l.supplier_id);
    return (
      <Dialog title={l.type} subtitle={`Reference ${l.reference}`} onClose={close}>
        <div className="detail-amount">
          <Badge>{l.type}</Badge>
          <h1>{money(l.amount)}</h1>
        </div>
        <dl className="detail-list">
          <dt>Supplier</dt>
          <dd>{supplier?.name}</dd>
          <dt>Order</dt>
          <dd>{data.orders.find((o) => o.id === l.order_id)?.number}</dd>
          <dt>Ledger date</dt>
          <dd>{l.date}</dd>
          <dt>Current supplier balance</dt>
          <dd>{money(supplier?.balance || 0)}</dd>
          <dt>Notes</dt>
          <dd>{l.notes || '—'}</dd>
        </dl>
        <Notice>
          This is an immutable supplier ledger entry. Its value is excluded from cash balances.
        </Notice>
      </Dialog>
    );
  }
  if (modal.type === 'credit' || modal.type === 'useCredit') {
    const use = modal.type === 'useCredit',
      supplier = data.suppliers.find((s) => s.id === supplierId);
    const eligible = data.orders.filter(
      (o) =>
        (use ? !['RTO', 'Cancelled'].includes(o.status) : o.status === 'RTO') &&
        o.items.some((i) => i.supplier_id === supplierId),
    );
    const selected = eligible.find((o) => o.id === orderId);
    const cost =
      selected?.items
        .filter((i) => i.supplier_id === supplierId)
        .reduce((s, i) => s + i.cost * i.quantity, 0) || 0;
    const posted = data.ledger
      .filter(
        (l) =>
          l.order_id === orderId &&
          l.supplier_id === supplierId &&
          l.type === (use ? 'Credit used' : 'Credit added'),
      )
      .reduce((s, l) => s + l.amount, 0);
    const paid = use
      ? data.payments
          .filter(
            (p) =>
              p.order_id === orderId &&
              p.supplier_id === supplierId &&
              p.kind === 'Supplier payment',
          )
          .reduce((s, p) => s + p.amount, 0)
      : 0;
    const remaining = Math.max(0, cost - posted - paid),
      limit = use ? Math.min(supplier?.balance || 0, remaining) : remaining;
    return (
      <Dialog
        title={use ? 'Use supplier credit' : 'Add RTO credit'}
        subtitle={
          use
            ? 'Settle a new purchase using your available balance.'
            : 'Record a credit after your supplier accepts a returned product.'
        }
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save(use ? '/credits/use' : '/credits', {
                  supplier_id: supplierId,
                  order_id: orderId,
                  amount: toPaise(f.get('amount')),
                  date: f.get('date'),
                  reference: f.get('reference'),
                  notes: f.get('notes'),
                  ...(!use ? { received: true } : {}),
                  idempotency_key: key,
                }),
              use ? 'Supplier credit applied.' : 'RTO credit added to the supplier ledger.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            <Field label="Supplier" full>
              {supplierSelect}
            </Field>
            <Field label={use ? 'Purchase order' : 'Returned order'} full>
              <select
                value={orderId}
                onChange={(e) => {
                  setOrderId(e.target.value);
                  setAmount('');
                }}
                required
              >
                <option value="">Select an order</option>
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {o.customer} ·{' '}
                    {o.items
                      .filter((i) => i.supplier_id === supplierId)
                      .map((i) => i.name)
                      .join(', ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="balance-preview">
            <span>
              <small>Available supplier credit</small>
              <strong>{money(supplier?.balance || 0)}</strong>
            </span>
            <span>
              <small>{use ? 'Unpaid purchase amount' : 'Eligible return cost'}</small>
              <strong>{money(remaining)}</strong>
            </span>
          </div>
          <div className="form-grid">
            <Field
              label={use ? 'Credit to use (₹)' : 'Credit amount (₹)'}
              hint={`Maximum ${decimalMoney(limit)}`}
            >
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={limit / 100}
                name="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </Field>
            {dateField}
            <Field label="Supplier reference / credit note" full>
              <input
                name="reference"
                placeholder={use ? 'Purchase / invoice reference' : 'e.g. CN-2026-001'}
                required
              />
            </Field>
            <Field label="Notes" full>
              <textarea name="notes" rows={2} placeholder="Add details for your records…" />
            </Field>
          </div>
          {use && selected && (
            <div className="credit-example">
              <span>Credit applied</span>
              <strong>{money(Math.round(Number(amount) * 100))}</strong>
              <span>Cash / payment required</span>
              <strong>{money(Math.max(0, remaining - Math.round(Number(amount) * 100)))}</strong>
              <span>Remaining supplier balance</span>
              <strong>
                {money(Math.max(0, (supplier?.balance || 0) - Math.round(Number(amount) * 100)))}
              </strong>
            </div>
          )}
          {!use && (
            <label className="check-field">
              <input type="checkbox" required />
              <span>
                I confirm the supplier has received the returned product and approved this credit.
              </span>
            </label>
          )}
          <Notice>
            This credit belongs to {supplier?.name || 'the selected supplier'} and is separate from
            your cash balance.
          </Notice>
          <Submit
            busy={busy || !canWrite}
            close={close}
            label={use ? 'Apply supplier credit' : 'Add RTO credit'}
          />
        </form>
      </Dialog>
    );
  }
  if (modal.type === 'expense')
    return (
      <Dialog
        title="Record an expense"
        subtitle="Keep your costs visible and your profit accurate."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save('/expenses', {
                  date: f.get('date'),
                  category: f.get('category'),
                  amount: toPaise(f.get('amount')),
                  notes: f.get('notes'),
                  reference: f.get('reference'),
                }),
              'Expense recorded.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            <Field label="Category">
              <select name="category">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            {dateField}
            <Field label="Amount (₹)">
              <input
                type="number"
                min="0.01"
                step="0.01"
                name="amount"
                placeholder="0.00"
                required
              />
            </Field>
            <Field label="Reference (optional)">
              <input name="reference" placeholder="Invoice / transaction ID" />
            </Field>
            <Field label="Notes" full>
              <textarea name="notes" rows={3} placeholder="What was this expense for?" />
            </Field>
          </div>
          <Notice>
            Enter additional costs here. Product, shipping, and RTO costs already recorded on an
            order are included in profit automatically.
          </Notice>
          <Submit busy={busy} close={close} label="Save expense" />
        </form>
      </Dialog>
    );
  if (modal.type === 'payment') {
    const eligible = data.orders.filter((o) =>
      paymentKind === 'COD remittance'
        ? o.method === 'COD' && o.cod_pending > 0
        : paymentKind === 'Prepaid payment'
          ? o.method === 'Prepaid' && o.source !== 'Shopify'
          : paymentKind === 'Customer refund'
            ? o.source !== 'Shopify'
            : true,
    );
    return (
      <Dialog
        title="Record a payment"
        subtitle="Reconcile a remittance, customer payment, or supplier purchase."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save('/payments', {
                  order_id: f.get('order_id'),
                  supplier_id: paymentKind === 'Supplier payment' ? supplierId : null,
                  date: f.get('date'),
                  kind: paymentKind,
                  amount: toPaise(f.get('amount')),
                  tax_amount: paymentKind === 'Customer refund' ? toPaise(f.get('tax_amount')) : 0,
                  status: f.get('status'),
                  reference: f.get('reference'),
                  idempotency_key: key,
                }),
              'Payment recorded.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            <Field label="Payment type" full>
              <select value={paymentKind} onChange={(e) => setPaymentKind(e.target.value)}>
                {['COD remittance', 'Prepaid payment', 'Supplier payment', 'Customer refund'].map(
                  (k) => (
                    <option key={k}>{k}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Order" full>
              <select name="order_id" defaultValue={modal.orderId || ''} required>
                <option value="">Select order</option>
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {o.customer}
                    {paymentKind === 'COD remittance' ? ` · ${money(o.cod_pending)} pending` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {paymentKind === 'Supplier payment' && (
              <Field label="Supplier" full>
                {supplierSelect}
              </Field>
            )}
            <Field label="Amount (₹)">
              <input
                type="number"
                name="amount"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                required
              />
            </Field>
            {dateField}
            {paymentKind === 'Customer refund' && (
              <Field
                label="Tax included in refund (₹)"
                hint="Only the tax component returned to the customer."
              >
                <input name="tax_amount" type="number" min="0" step="0.01" defaultValue="0" />
              </Field>
            )}
            <Field label="Status">
              <select name="status">
                <option>Completed</option>
                <option>Pending</option>
              </select>
            </Field>
            <Field label="UTR / payment reference">
              <input name="reference" required placeholder="e.g. UTR2984012" />
            </Field>
          </div>
          <Notice>
            Only completed payments affect totals. Prepaid payments and refunds on Shopify orders
            must be recorded in Shopify; they synchronize automatically.
          </Notice>
          <Submit busy={busy} close={close} label="Record payment" />
        </form>
      </Dialog>
    );
  }
  if (modal.type === 'supplier') {
    const s = modal.record as Supplier | undefined;
    return (
      <Dialog
        title={s ? 'Edit supplier' : 'Add a supplier'}
        subtitle="Each supplier has an independent RTO credit balance."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save(
                  s ? `/suppliers/${s.id}` : '/suppliers',
                  {
                    name: f.get('name'),
                    email: f.get('email'),
                    phone: f.get('phone'),
                    notes: f.get('notes'),
                  },
                  s ? 'PATCH' : 'POST',
                ),
              s ? 'Supplier updated.' : 'Supplier added.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            <Field label="Supplier name" full>
              <input
                name="name"
                defaultValue={s?.name}
                placeholder="Company or supplier name"
                required
              />
            </Field>
            <Field label="Email">
              <input name="email" type="email" defaultValue={s?.email} />
            </Field>
            <Field label="Phone">
              <input name="phone" type="tel" defaultValue={s?.phone} />
            </Field>
            <Field label="Notes" full>
              <textarea
                name="notes"
                rows={3}
                defaultValue={s?.notes}
                placeholder="Contact details, return terms, or other notes"
              />
            </Field>
          </div>
          <Submit busy={busy} close={close} label={s ? 'Save supplier' : 'Add supplier'} />
        </form>
      </Dialog>
    );
  }
  if (modal.type === 'product') {
    const p = modal.record as Product | undefined;
    return (
      <Dialog
        title={p ? 'Edit product' : 'Add a product'}
        subtitle="Set supplier costs to keep order profitability accurate."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save(
                  p ? `/products/${p.id}` : '/products',
                  {
                    name: f.get('name'),
                    sku: f.get('sku'),
                    supplier_id: f.get('supplier_id') || null,
                    cost: toPaise(f.get('cost')),
                    price: p?.external_id ? p.price : toPaise(f.get('price')),
                    stock: p?.external_id ? p.stock : Number(f.get('stock')),
                    category: f.get('category'),
                  },
                  p ? 'PATCH' : 'POST',
                ),
              p
                ? 'Product updated. Existing order costs retain their historical values.'
                : 'Product added.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            <Field label="Product name" full>
              <input name="name" defaultValue={p?.name} required />
            </Field>
            <Field label="SKU">
              <input name="sku" defaultValue={p?.sku} required />
            </Field>
            <Field label="Category">
              <input name="category" defaultValue={p?.category || 'General'} required />
            </Field>
            <Field label="Supplier" full>
              <select name="supplier_id" defaultValue={p?.supplier_id || ''}>
                <option value="">Unassigned</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supplier unit cost (₹)">
              <input
                name="cost"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(p?.cost || 0) / 100}
                required
              />
            </Field>
            <Field label="Selling price (₹)">
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(p?.price || 0) / 100}
                disabled={!!p?.external_id}
                required
              />
            </Field>
            <Field label="Available stock">
              <input
                name="stock"
                type="number"
                min="0"
                step="1"
                defaultValue={p?.stock || 0}
                disabled={!!p?.external_id}
                required
              />
            </Field>
          </div>
          {p?.external_id && (
            <Notice>
              Stock and selling price are managed in Shopify. Supplier cost changes apply to future
              imported orders.
            </Notice>
          )}
          <Submit busy={busy} close={close} label="Save product" />
        </form>
      </Dialog>
    );
  }
  if (modal.type === 'order')
    return (
      <Dialog
        wide
        title="Create an order"
        subtitle="Record a manual order. Shopify orders arrive automatically once connected."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save('/orders', {
                  date: f.get('date'),
                  customer: f.get('customer'),
                  phone: f.get('phone'),
                  email: f.get('email'),
                  city: f.get('city'),
                  method: f.get('method'),
                  status,
                  shipping_cost: toPaise(f.get('shipping_cost')),
                  tax: toPaise(f.get('tax')),
                  notes: f.get('notes'),
                  items: orderLines.map((l) => ({ ...l, price: Math.round(l.price * 100) })),
                }),
              'Order created.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            <Field label="Customer name">
              <input name="customer" required />
            </Field>
            <Field label="Phone">
              <input name="phone" type="tel" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" />
            </Field>
            <Field label="City">
              <input name="city" />
            </Field>
            {dateField}
            <Field label="Payment method">
              <select name="method">
                <option>COD</option>
                <option>Prepaid</option>
              </select>
            </Field>
          </div>
          <h4 className="form-section-title">Order items</h4>
          {orderLines.map((line, index) => (
            <div className="order-line-form" key={index}>
              <Field label="Product">
                <select
                  value={line.product_id}
                  onChange={(e) =>
                    setOrderLines((lines) =>
                      lines.map((l, i) =>
                        i === index
                          ? {
                              ...l,
                              product_id: e.target.value,
                              price:
                                (data.products.find((p) => p.id === e.target.value)?.price || 0) /
                                100,
                            }
                          : l,
                      ),
                    )
                  }
                  required
                >
                  <option value="">Select product</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Qty">
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={line.quantity}
                  onChange={(e) =>
                    setOrderLines((lines) =>
                      lines.map((l, i) =>
                        i === index ? { ...l, quantity: Number(e.target.value) } : l,
                      ),
                    )
                  }
                  required
                />
              </Field>
              <Field label="Unit price (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.price}
                  onChange={(e) =>
                    setOrderLines((lines) =>
                      lines.map((l, i) =>
                        i === index ? { ...l, price: Number(e.target.value) } : l,
                      ),
                    )
                  }
                  required
                />
              </Field>
              <button
                className="icon-button"
                type="button"
                disabled={orderLines.length === 1}
                onClick={() => setOrderLines((lines) => lines.filter((_, i) => i !== index))}
                aria-label="Remove order item"
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button small"
            onClick={() =>
              setOrderLines((lines) => [
                ...lines,
                {
                  product_id: data.products[0]?.id || '',
                  quantity: 1,
                  price: (data.products[0]?.price || 0) / 100,
                },
              ])
            }
          >
            <Plus size={15} />
            Add item
          </button>
          <div className="form-grid spaced">
            <Field label="Order status">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {['Confirmed', 'Shipped', 'Delivered', 'NDR', 'RTO', 'Cancelled'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Shipping cost (₹)">
              <input name="shipping_cost" type="number" step="0.01" min="0" defaultValue="0" />
            </Field>
            <Field label="Tax charged (₹)">
              <input name="tax" type="number" step="0.01" min="0" defaultValue="0" />
            </Field>
            <Field label="Notes" full>
              <textarea name="notes" rows={2} />
            </Field>
          </div>
          <Submit busy={busy} close={close} label="Create order" />
        </form>
      </Dialog>
    );
  if (modal.type === 'orderDetail') {
    const o =
      data.orders.find((x) => x.id === (modal.record as Order).id) || (modal.record as Order);
    return (
      <Dialog
        wide
        title={`Order ${o.number}`}
        subtitle={`${o.date} · ${o.source} · ${o.method}`}
        onClose={close}
      >
        <div className="order-detail-top">
          <div className="customer-summary">
            <span className="avatar">
              {o.customer
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <h3>{o.customer}</h3>
              <p>
                {o.phone || 'No phone'} · {o.city || 'No city'}
              </p>
              <small>{o.email}</small>
            </div>
          </div>
          <Badge>{o.status}</Badge>
        </div>
        <div className="order-summary-metrics">
          <div>
            <span>Order value</span>
            <strong>{money(o.total)}</strong>
          </div>
          <div>
            <span>Net profit</span>
            <strong className={o.net_profit < 0 ? 'negative' : 'positive'}>
              {money(o.net_profit)}
            </strong>
          </div>
          <div>
            <span>Supplier payable</span>
            <strong>{money(o.payable)}</strong>
          </div>
        </div>
        <div className="order-item-list">
          {o.items.map((item) => (
            <div key={item.id}>
              <ProductIcon
                product={{
                  name: item.name,
                  color: data.products.find((p) => p.id === item.product_id)?.color || '',
                }}
              />
              <section>
                <strong>{item.name}</strong>
                <small>
                  {item.sku} · Quantity {item.quantity}
                </small>
              </section>
              <strong>{money(item.price * item.quantity)}</strong>
            </div>
          ))}
        </div>
        <div className="order-finance-grid">
          <dl className="detail-list">
            <dt>Product cost</dt>
            <dd>{money(o.product_cost)}</dd>
            <dt>Shipping + RTO charges</dt>
            <dd>{money(o.shipping_cost + o.rto_cost)}</dd>
            <dt>RTO cost recovered</dt>
            <dd>{money(o.credit_received)}</dd>
            <dt>Allocated period expenses</dt>
            <dd>{money(o.allocated_expense)}</dd>
            <dt>Payment status</dt>
            <dd>
              <Badge>{o.payment_status}</Badge>
            </dd>
          </dl>
          <dl className="detail-list">
            <dt>COD collected</dt>
            <dd>{money(o.cod_collected)}</dd>
            <dt>COD remitted</dt>
            <dd>{money(o.cod_remitted)}</dd>
            <dt>Prepaid collected</dt>
            <dd>{money(o.prepaid)}</dd>
            <dt>Credit used on purchase</dt>
            <dd>{money(o.credit_used)}</dd>
            <dt>Refunds</dt>
            <dd>{money(o.refunded)}</dd>
          </dl>
        </div>
        {o.shipments.length > 0 && (
          <>
            <h4 className="form-section-title">Shipment tracking</h4>
            {o.shipments.map((s) => (
              <div className="shipment-line" key={s.id}>
                <div>
                  <strong>{s.courier || 'Courier'}</strong>
                  <small>AWB {s.awb}</small>
                  {s.ndr && <p className="negative">{s.ndr}</p>}
                </div>
                <Badge>{s.status}</Badge>
              </div>
            ))}
          </>
        )}
        {canWrite && (
          <details className="cost-editor">
            <summary>Edit supplier costs & order details</summary>
            <form
              onSubmit={(e) =>
                submit(
                  e,
                  (f) =>
                    save(
                      `/orders/${o.id}`,
                      {
                        status: o.source === 'Shopify' ? o.status : f.get('status'),
                        shipping_cost: toPaise(f.get('shipping_cost')),
                        rto_cost: toPaise(f.get('rto_cost')),
                        notes: f.get('notes'),
                        items: o.items.map((i) => ({
                          id: i.id,
                          cost: toPaise(f.get(`cost-${i.id}`)),
                          supplier_id: f.get(`supplier-${i.id}`) || null,
                        })),
                      },
                      'PATCH',
                    ),
                  'Order details updated.',
                )
              }
            >
              {errorNotice}
              {o.items.map((i) => (
                <div className="form-grid spaced" key={i.id}>
                  <Field label={`${i.name} · unit cost (₹)`}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name={`cost-${i.id}`}
                      defaultValue={i.cost / 100}
                      required
                    />
                  </Field>
                  <Field label="Supplier">
                    <select name={`supplier-${i.id}`} defaultValue={i.supplier_id || ''}>
                      <option value="">Unassigned</option>
                      {data.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ))}
              <div className="form-grid spaced">
                <Field label="Shipping cost (₹)">
                  <input
                    type="number"
                    name="shipping_cost"
                    min="0"
                    step="0.01"
                    defaultValue={o.shipping_cost / 100}
                    required
                  />
                </Field>
                <Field label="RTO charges (₹)">
                  <input
                    type="number"
                    name="rto_cost"
                    min="0"
                    step="0.01"
                    defaultValue={o.rto_cost / 100}
                    required
                  />
                </Field>
                {o.source !== 'Shopify' && (
                  <Field label="Order status">
                    <select name="status" defaultValue={o.status}>
                      {['Confirmed', 'Shipped', 'Delivered', 'NDR', 'RTO', 'Cancelled'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Notes" full>
                  <textarea name="notes" defaultValue={o.notes} />
                </Field>
              </div>
              <Submit busy={busy} close={close} label="Save order details" />
            </form>
          </details>
        )}
        <Notice>
          Order net profit includes an equal share of expenses within the selected reporting period.
          Supplier credit use settles payable without changing product cost.
        </Notice>
      </Dialog>
    );
  }
  if (modal.type === 'user') {
    const u = modal.record as User | undefined;
    return (
      <Dialog
        title={u ? 'Manage user access' : 'Add a team member'}
        subtitle="Control who can see and manage your business."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save(
                  u ? `/users/${u.id}` : '/users',
                  u
                    ? {
                        role: f.get('role'),
                        active: f.get('active') === 'on',
                        ...(f.get('password') ? { password: f.get('password') } : {}),
                      }
                    : {
                        name: f.get('name'),
                        email: f.get('email'),
                        password: f.get('password'),
                        role: f.get('role'),
                      },
                  u ? 'PATCH' : 'POST',
                ),
              'User access saved.',
            )
          }
        >
          {errorNotice}
          <div className="form-grid">
            {!u && (
              <>
                <Field label="Full name">
                  <input name="name" required />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" required />
                </Field>
              </>
            )}
            <Field label="Role" full>
              <select name="role" defaultValue={u?.role || 'viewer'}>
                <option value="admin">Admin · full access</option>
                <option value="manager">Manager · operations & finance</option>
                <option value="viewer">Viewer · read only</option>
              </select>
            </Field>
            <Field
              label={u ? 'New password (optional)' : 'Temporary password'}
              full
              hint="At least 12 characters."
            >
              <input
                name="password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                required={!u}
              />
            </Field>
          </div>
          {u && (
            <label className="check-field">
              <input name="active" type="checkbox" defaultChecked={!!u.active} />
              Account enabled
            </label>
          )}
          <Submit busy={busy} close={close} label="Save user" />
        </form>
      </Dialog>
    );
  }
  if (modal.type === 'integration') {
    const i = modal.record as Integration;
    const shop = i.provider === 'shopify',
      ship = i.provider === 'shiprocket';
    return (
      <Dialog
        title={`Connect ${shop ? 'Shopify' : ship ? 'Shiprocket' : 'a remittance feed'}`}
        subtitle="Credentials are encrypted on the server and never returned to the browser."
        onClose={close}
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                save(
                  `/settings/integrations/${i.provider}`,
                  shop
                    ? {
                        shop: f.get('shop'),
                        token: f.get('token') || undefined,
                        webhookSecret: f.get('webhookSecret') || undefined,
                        apiVersion: f.get('apiVersion'),
                        enabled: f.get('enabled') === 'on',
                      }
                    : ship
                      ? {
                          email: f.get('email'),
                          password: f.get('password') || undefined,
                          webhookSecret: f.get('webhookSecret') || undefined,
                          channelId: f.get('channelId') || '',
                          enabled: f.get('enabled') === 'on',
                        }
                      : { secret: f.get('secret') },
                ),
              'Connection settings saved. Run Sync now to verify access.',
            )
          }
        >
          {errorNotice}
          <div className="integration-security">
            <ShieldCheck size={22} />
            <span>Stored with AES-256-GCM encryption</span>
          </div>
          <div className="form-grid">
            {shop ? (
              <>
                <Field label="Shopify store domain" full>
                  <input
                    name="shop"
                    defaultValue={i.shop}
                    placeholder="your-store.myshopify.com"
                    pattern="[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com"
                    required
                  />
                </Field>
                <Field
                  label="Admin API access token"
                  full
                  hint={
                    i.configured
                      ? 'Leave blank to keep the existing token.'
                      : 'Required scopes: read_orders, read_products, read_inventory. Older orders need read_all_orders approval.'
                  }
                >
                  <input
                    name="token"
                    type="password"
                    autoComplete="new-password"
                    required={!i.configured}
                  />
                </Field>
                <Field label="API version">
                  <input
                    name="apiVersion"
                    defaultValue={i.apiVersion || '2026-07'}
                    required
                    pattern="20[0-9]{2}-(01|04|07|10)"
                  />
                </Field>
              </>
            ) : ship ? (
              <>
                <Field label="Shiprocket API user email" full>
                  <input name="email" type="email" defaultValue={i.email} required />
                </Field>
                <Field
                  label="API user password"
                  full
                  hint={
                    i.configured
                      ? 'Leave blank to keep the existing password.'
                      : 'Create a dedicated API user in Shiprocket settings.'
                  }
                >
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required={!i.configured}
                  />
                </Field>
                <Field
                  label="Shopify channel ID (recommended)"
                  full
                  hint="Restricts matching to this store and prevents order-number collisions across channels."
                >
                  <input
                    name="channelId"
                    defaultValue={i.channelId}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="Signing secret"
                  full
                  hint="Use a random secret of at least 24 characters."
                >
                  <input
                    name="secret"
                    type="password"
                    minLength={24}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Notice>
                  A provider or middleware must send signed settlement records to{' '}
                  <code>/api/webhooks/settlements</code>. The payload and signature contract are
                  documented in README.md. This is a feed adapter, not a direct Shiprocket
                  bank-remittance API.
                </Notice>
              </>
            )}
            {(ship || shop) && (
              <>
                <Field
                  label={
                    shop ? 'Shopify webhook signing secret' : 'Tracking webhook security token'
                  }
                  full
                  hint="Optional for polling. Required to accept webhook deliveries."
                >
                  <input name="webhookSecret" type="password" autoComplete="new-password" />
                </Field>
                <div className="form-field full">
                  <span>Webhook endpoint</span>
                  <code className="endpoint">
                    {shop ? '/api/webhooks/store' : '/api/webhooks/tracking'}
                  </code>
                  <small>Use your public HTTPS domain when hosting this application.</small>
                </div>
              </>
            )}
          </div>
          {(ship || shop) && (
            <label className="check-field">
              <input name="enabled" type="checkbox" defaultChecked={i.enabled !== false} />
              Automatically synchronize every 15 minutes while the server is running
            </label>
          )}
          <Submit busy={busy} close={close} label="Save connection" />
        </form>
      </Dialog>
    );
  }
  return null;
}
export function AuthScreen({
  needsSetup,
  onLogin,
}: {
  needsSetup: boolean;
  onLogin: () => Promise<void>;
}) {
  const [mode, setMode] = useState(needsSetup ? 'setup' : 'login'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function enter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await save(`/auth/${mode}`, {
        name: f.get('name'),
        email: f.get('email'),
        password: f.get('password'),
        setupToken: f.get('setupToken') || undefined,
      });
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <div className="brand auth-brand">
          <span className="brand-mark">
            z<span>↗</span>
          </span>
          <div>
            Zupestore<span>WORKSPACE</span>
          </div>
        </div>
        <div className="auth-story-main">
          <span className="eyebrow light">YOUR BUSINESS, IN BALANCE</span>
          <h1>
            Less busywork.
            <br />
            More business.
          </h1>
          <p>
            Your orders, shipments, costs, and supplier credits.
            <br />
            Finally, connected in one clear workspace.
          </p>
          <div className="auth-preview">
            <div className="auth-preview-header">
              <span>
                <i />
                Business overview
              </span>
              <span>INR</span>
            </div>
            <span className="auth-preview-label">Everything accounted for.</span>
            <div className="mini-bars">
              {[25, 38, 29, 48, 39, 58, 52, 70, 64, 85, 76, 98].map((h, i) => (
                <span key={i} style={{ height: h }} />
              ))}
            </div>
            <div className="auth-preview-bottom">
              <span>
                <CheckCircle2 size={15} /> Order clarity
              </span>
              <span>
                <CreditCard size={15} /> Supplier credit
              </span>
            </div>
          </div>
        </div>
        <div className="auth-story-footer">Built for the way your store works.</div>
      </div>
      <div className="auth-form-wrap">
        <span className="auth-top-label">YOUR COMMERCE COMMAND CENTRE</span>
        <div className="auth-form">
          <span className="auth-icon">
            <ShieldCheck size={26} />
          </span>
          <h2>{mode === 'setup' ? 'Make yourself at home.' : 'Welcome back.'}</h2>
          <p>
            {mode === 'setup'
              ? 'Create your owner account to start a fresh workspace.'
              : 'Sign in to see how your business is doing.'}
          </p>
          <form onSubmit={enter}>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {mode === 'setup' && (
              <Field label="Your name">
                <input name="name" placeholder="Full name" required autoComplete="name" />
              </Field>
            )}
            <Field label="Email address">
              <input
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </Field>
            <Field
              label="Password"
              hint={mode === 'setup' ? 'Use at least 12 characters.' : undefined}
            >
              <input
                name="password"
                type="password"
                placeholder={mode === 'setup' ? 'Create a secure password' : 'Enter your password'}
                minLength={mode === 'setup' ? 12 : 1}
                required
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              />
            </Field>
            {mode === 'setup' && (
              <details className="setup-token">
                <summary>Have a hosting setup token?</summary>
                <input name="setupToken" type="password" placeholder="Setup token (optional)" />
              </details>
            )}
            <button className="button primary full-width auth-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {mode === 'setup' ? 'Create workspace' : 'Sign in'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <div className="auth-divider">
            <span>or take a look around</span>
          </div>
          <button
            className="button full-width"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api('/auth/demo', { method: 'POST' });
                await onLogin();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Explore demo workspace <ArrowRight size={16} />
          </button>
          <p className="auth-demo-note">
            Sample data. No credentials needed. Completely separate from your real business.
          </p>
          {needsSetup && (
            <button
              className="text-button"
              onClick={() => setMode(mode === 'setup' ? 'login' : 'setup')}
            >
              {mode === 'setup'
                ? 'Already have an account? Sign in'
                : 'Create the first owner account'}
            </button>
          )}
        </div>
        <div className="auth-footer">
          <ShieldCheck size={14} /> Secure sessions · Local data storage
        </div>
      </div>
    </div>
  );
}
