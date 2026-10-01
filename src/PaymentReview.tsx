import { useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { Dialog, Notice } from './components';
import { localDate, money, save } from './lib';
import type { Order, Payment } from './types';

export function PaymentReview({
  payment,
  action,
  order,
  onClose,
  onSaved,
}: {
  payment: Payment;
  action: 'complete' | 'cancel';
  order?: Order;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const completing = action === 'complete';
  return (
    <Dialog
      title={completing ? 'Confirm payment completion' : 'Cancel pending payment'}
      subtitle="Review the details before updating your ledger."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError('');
          try {
            await save(
              `/payments/${payment.id}/${action}`,
              completing ? { date: form.get('date') } : { reason: form.get('reason') },
              'PATCH',
            );
            await onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Notice tone="warning">{error}</Notice>}
        <div className="payment-review-summary">
          <span>{payment.kind}</span>
          <strong>{money(payment.amount)}</strong>
          <p>
            {order?.number || 'Order'} · {payment.reference}
          </p>
        </div>
        {completing ? (
          <>
            <label className="field">
              Actual payment date
              <input
                type="date"
                name="date"
                defaultValue={localDate()}
                min={order?.date}
                max={localDate()}
                required
              />
            </label>
            <Notice>
              Confirm only after the payment has actually settled. The remaining balance is checked
              again before saving.
            </Notice>
          </>
        ) : (
          <>
            <label className="field">
              Reason for cancellation
              <textarea
                name="reason"
                minLength={3}
                maxLength={1000}
                required
                placeholder="For example, payment was never sent"
              />
            </label>
            <Notice>
              The reserved amount will become available again. This record stays in your history
              with the cancellation reason.
            </Notice>
          </>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Go back
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}{' '}
            {completing ? 'Confirm payment' : 'Cancel this payment'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
