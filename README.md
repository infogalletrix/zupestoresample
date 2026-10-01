# Zupestore

A working local commerce operations application built in this folder from the supplied requirements and dashboard reference. React + TypeScript, Express, and SQLite. Amounts are stored as integer paise. Fonts and application assets are served locally.

## Open the app

Requirements: **Node.js 22.13+** and npm. Node 22 may print an experimental SQLite warning; the application uses Node's built-in `node:sqlite` database.

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Choose **Explore demo workspace**, or create the first owner account with your own email and a password of at least 12 characters. There are no hard-coded administrator credentials.

For a single-server local build:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3001**. On Windows you can also double-click `Start-Zupestore.cmd`. Keep the server running while using the application or receiving scheduled syncs.

## What is included

| Area           | Implemented behavior                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard      | Orders by status, delivered sales, product/shipping/advertising/other costs, gross/net profit, margin, pending COD, RTO rate, charts and best sellers                                                           |
| Orders         | Shopify ID, date, customer/phone, multiple products and quantities, price, historical supplier cost, shipping/RTO costs, status, AWBs, NDR details, payment status, order contribution and allocated net profit |
| Shipments      | Shiprocket polling and authenticated tracking webhooks; AWB, courier, delivery, NDR and RTO states                                                                                                              |
| Expenses       | Manual categories, notes, references, audit-backed removal, and period summaries                                                                                                                                |
| Payments       | COD collection on delivery, actual remittances, partial settlements, prepaid transactions, supplier payments, refunds, pending/completed states                                                                 |
| Products       | SKU, supplier, historical costing, selling price, stock, orders, revenue and product contribution                                                                                                               |
| Suppliers      | Contact information, notes, independent available/pending/used credit balances                                                                                                                                  |
| RTO credits    | Receipt confirmation, partial credits, duplicate protection, order/supplier cost limits, partial usage, live payable preview and immutable ledger                                                               |
| Reports        | Daily/weekly/monthly/annual performance, product/order reports, ad-spend comparison, RTO analysis, P&L                                                                                                          |
| Administration | Owner setup, login/logout, admin/manager/viewer roles, user disabling/password reset by another admin, encrypted API settings, audit history, failed webhook retry                                              |
| Data           | Persistent SQLite, CSV/Excel exports, consistent database backups                                                                                                                                               |
| Interface      | Responsive layouts, mobile navigation, dark/light mode, date presets/custom range, search, sorting, pagination, accessible dialogs                                                                              |

Demo records use **`data/demo.sqlite`**; your business uses **`data/commerce.sqlite`**. Editing the demo never modifies the live workspace. Demo connections are visibly disabled. The application is scoped to one Shopify store and one Shiprocket account per workspace, with multiple suppliers.

## RTO credit accounting

1. An order must be RTO and the supplier must have received and approved the return.
2. Credits cannot exceed the original order's product cost belonging to that supplier, less credits already recorded.
3. Every approved credit is a supplier receivable. It is never a cash receipt or COD remittance.
4. Applying credit requires the same supplier, sufficient available credit, and an eligible unpaid purchase.
5. Application reduces supplier payable and available credit atomically. It does not reduce the new order's product cost or create income.
6. Partial receipts and partial use are supported. Request keys prevent duplicate entries. Ledger dates must preserve supplier chronology, and entries cannot predate their order or be future-dated.
7. Cost/supplier assignments are locked once supplier credit or payments have been recorded. The ledger is append-only in this version; there is no destructive credit edit or unreviewed reversal.

The test suite covers the supplied example: receive ₹500, apply ₹300, retain ₹200; apply that ₹200 to a ₹700 purchase and leave ₹500 payable.

### Profit and reporting definitions

- **Recognized revenue:** delivered order value excluding recorded tax and successful customer refunds. Shopify's adjusted tax amount is synchronized. Manual refunds have an explicit refunded-tax field.
- **Product cost:** the cost snapshot captured for the order, recognized for dispatched/delivered/NDR/RTO orders. Confirmed and cancelled orders do not recognize product cost.
- **RTO recovery:** approved supplier credits recover the returned order's product cost once. Later spending that credit has no second profit effect.
- **Gross profit:** recognized revenue minus net product costs, shipping, and RTO charges.
- **Net profit:** gross profit minus manual expenses, including Meta Ads.
- **Order net profit:** order contribution minus an equal allocation of manual expenses in the selected period. Remainder paise are allocated deterministically, so order totals reconcile to the period P&L whenever the period contains orders.
- **Product contribution:** shared order revenue, shipping and contribution allocated by selling value. This excludes shared period overhead; it is labelled contribution in the UI.
- **COD pending:** collected COD minus completed remittances. Delivery alone never marks a remittance complete. Pending payment records reserve payable but do not count as completed receipts.
- **RTO rate:** RTO orders divided by dispatched orders; confirmed and cancelled orders are excluded from the denominator.
- Reports use **order-date cohorts and current known order outcomes**, with expenses by expense date. These are operational management reports, not a statutory general ledger or GST filing system. A prior cohort can change when its deliveries, returns or refunds arrive.
- Payment ledger date filters apply to **payment dates**. Payment summary cards use the selected **order cohort**. Supplier credit summary balances are **all time**, even when ledger/chart activity is filtered.
- Unknown costs are flagged as provisional. Review imported supplier assignments, costs, shipping invoices and RTO charges before relying on profit. A missing shipping cost is not treated as a verified free shipment.
- Manual expenses are **additional** costs. Do not re-enter product/shipping costs already recorded against an order. Do not add customer collection and remittance figures together as cash income.
- Remittance amounts represent the **gross order balance cleared**. If a provider deducts already-recorded freight or fees from bank settlement, reconcile the deductions and allocate the gross cleared order amount; this version does not calculate a bank balance or import bank statements.

## Shopify connection

In **Settings → Connections → Shopify**, enter:

- Your `your-store.myshopify.com` domain.
- An authorized Admin API access token.
- API version (default: `2026-07`).
- Optional webhook signing secret for your configured webhook subscriptions.

Required read access: `read_orders`, `read_products`, and `read_inventory`, including any required protected customer data access. Shopify normally limits order access to the last 60 days; older history needs approved `read_all_orders` access. See the [Shopify Order API](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order) and [ProductVariant API](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant).

Click **Sync now** to verify the connection. The adapter paginates products, orders and line items, imports successful prepaid sales/captures/refunds, retains historical supplier costs, and uses an overlapping updated-order cursor. A failed run does not advance the cursor. INR is the supported accounting currency; other currencies are rejected rather than silently converted.

Polling runs every 15 minutes by default, plus once after server start. To use webhooks, host the app on a public HTTPS domain and configure relevant Shopify topics (`orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `refunds/create`, `fulfillments/create`, `fulfillments/update`) to:

```text
https://YOUR-DOMAIN/api/webhooks/store
```

The handler verifies the raw-body HMAC and shop domain, deduplicates event IDs, and stores a durable queue entry. A worker re-fetches the authoritative order. See [Shopify webhook verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

Prepaid payments and refunds belonging to imported Shopify orders are managed in Shopify to avoid double entry. Manual order payments and COD remittances remain available here. Stock and selling price for imported products are owned by Shopify; local product costs and supplier mappings are editable. Manually entered orders decrement local-product stock but do not write orders or inventory changes back to Shopify.

## Shiprocket connection

Create a dedicated API user in Shiprocket and enter its email/password in **Settings → Connections → Shiprocket**. Enter the matching Shopify channel ID, especially if your Shiprocket account serves multiple stores. Run Shopify sync first.

The adapter authenticates, refreshes its token, paginates orders, and matches channel order IDs to imported Shopify IDs/order numbers. It records AWBs and status, preserves unresolved NDR details, and only treats a split shipment as completely delivered when all known packages are delivered. Unmatched records are reported in the sync history. It does not create shipments, purchase labels or book couriers.

For tracking webhooks, set a long security token and configure this URL in Shiprocket:

```text
https://YOUR-DOMAIN/api/webhooks/tracking
```

Set the same token in the Shiprocket webhook configuration. The endpoint verifies the `x-api-key` header. This path avoids reserved provider words listed in the [Shiprocket API documentation](https://apidocs.shiprocket.in/). The order poller uses the documented [Get all Orders endpoint](https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/request/nt81p9c/get-all-orders).

Shipping cost is imported only when the response supplies an actual `freight_charges` value for each shipment. The customer-facing `shipping_charges` field is not assumed to be your courier expense. Otherwise, confirm the invoice amount in the order's cost editor. A manual confirmed shipping cost takes precedence over subsequent status syncs. Record RTO charges from the supplier/courier invoice.

### COD remittance: remaining account-specific integration

**Direct automatic Shiprocket bank-remittance import is not implemented or claimed.** The public documentation consulted did not establish a stable order-level remittance contract. Shipping status and prepaid payment state are not proof of bank settlement.

The application includes an implemented **signed settlement feed** for an authorized provider/middleware to push verified order-level remittances. Without that upstream feed, record COD remittances manually. Connecting and validating your account-specific remittance feed is still required for fully automatic COD settlement tracking.

Configure a random signing secret of at least 24 characters under **Remittance feed**. Post JSON to `/api/webhooks/settlements`:

```json
{
  "event_id": "stable-provider-payment-id-001",
  "order_number": "#1001",
  "amount": 50000,
  "date": "2026-10-01",
  "reference": "BANK-UTR-123",
  "kind": "COD remittance"
}
```

`amount` is integer **paise** (50000 = ₹500), representing the gross order amount cleared. Send one allocation per order; split multi-order payouts into stable, individually identified records. The referenced order must already exist, have collected COD, and have sufficient pending balance.

Headers:

```text
Content-Type: application/json
x-settlement-timestamp: UNIX_SECONDS
x-settlement-signature: HEX_HMAC_SHA256
```

Signature:

```js
const signature = createHmac('sha256', signingSecret)
  .update(`${timestamp}.`)
  .update(rawJsonBody)
  .digest('hex');
```

The timestamp must be within five minutes. Retried deliveries with the same `event_id` and identical payment are idempotent. Different data under the same event ID is rejected. For unmatched orders, retry after the order sync. A statement-specific reader, OAuth token renewal flow, and live provider credentials have not been supplied or tested against your accounts.

## Security, roles, backups and hosting

- Passwords: salted scrypt. Sessions: random tokens stored hashed on the server, HttpOnly/SameSite cookies, 12-hour expiry. Disabling users or changing their access invalidates sessions.
- Mutations require a same-origin verification header and allowed origin. Auth routes are rate limited. Server-side role checks apply to every protected operation.
- Admin: all operations and settings. Manager: daily operations and exports. Viewer: read/export only. Admins cannot disable/demote themselves; another administrator can reset a user's password. There is no email password-reset service in this local version.
- Credentials: AES-256-GCM encrypted in SQLite. The key is read from `ENCRYPTION_KEY` or generated at `data/.encryption-key`. Never publish this directory or key.
- **Backup:** Settings → Backup & export creates a consistent SQLite backup. Store the encryption key separately; saved connections cannot be decrypted without it. A full backup contains user and session records as well as encrypted configuration.
- **Restore:** stop the server; preserve the existing entire `data` directory; restore the chosen database backup as `data/commerce.sqlite` into a fresh data directory, with the matching key file or environment key. Start with `DATA_DIR` pointing to that directory. Do not overwrite a live SQLite database or mix old WAL files with a restored database. Restoring a backup also restores its saved users/configuration; clear restored sessions through a controlled administration process if they should not remain valid.

For hosted use, build the app and run one server process with a persistent local database volume, a trusted HTTPS reverse proxy, `APP_ORIGIN=https://YOUR-DOMAIN`, `COOKIE_SECURE=true`, and `NODE_ENV=production`. Protect first-owner setup with a strong `SETUP_TOKEN` until the account exists. The `Dockerfile` builds the same application. The default host binding is loopback to keep local development private.

Copy `.env.example` to `.env` only if you want to change defaults. For a local production build set `APP_ORIGIN=http://127.0.0.1:3001`. Polling requires a continuously running server; laptop sleep stops polling. Public webhooks require a reachable HTTPS URL. This local SQLite edition uses one process and loads reporting records into memory; migrate storage/query pagination before large-scale or multi-instance hosting.

### VPS deployment: zupestore.galletrix.com

`compose.yaml` runs the app behind the VPS's Nginx server on `127.0.0.1:3107`. It enables secure cookies, automatic restarts, a health check and bounded container logs. Database files and the encryption key persist in the `zupestore_app_data` Docker volume. `TRUST_PROXY=1` makes rate limits apply per client behind this single proxy; keep the app port private and use the supplied Nginx forwarding-header configuration.

On a server with Docker Compose, Nginx and Certbot installed:

```sh
git clone https://github.com/infogalletrix/zupestoresample.git /opt/zupestore
cd /opt/zupestore
# First deployment only: generate a private setup token, never commit it.
(umask 077; printf 'SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env)
docker compose up -d --build --wait
curl --fail http://127.0.0.1:3107/api/health
```

Install `deploy/zupestore.nginx.conf` as a new virtual host for this domain, check `nginx -t`, and reload Nginx. With DNS pointing to the VPS, issue its certificate using `certbot --nginx -d zupestore.galletrix.com --redirect`. Keep the Certbot renewal timer enabled. On the HTTPS site, expand **Have a hosting setup token?** and use the token from the server's `.env` when creating the first administrator. Choose your own email and password; no default administrator account is installed.

For updates, run `git pull --ff-only` and `docker compose up -d --build --wait` in `/opt/zupestore`. Back up the live database through **Settings > Backup & export** and preserve the volume's `.encryption-key` separately before updating. Do not remove the data volume. Shopify, Shiprocket and settlement credentials are configured by the administrator in the app after deployment.

## Validation and source map

```powershell
npm run check
npm audit
```

`npm run check` builds the TypeScript frontend and runs backend, integration-contract, and component interaction tests. Tests cover the exact RTO example, supplier boundaries, over-credit/overpayment, duplicate events, partial COD settlement, role enforcement, encryption, HMAC validation, pagination, cost snapshots, tax/refunds, spreadsheet safety and real credit-form submissions. Provider calls are mocked; they are not live-account acceptance tests. Component tests use jsdom; visual desktop/mobile QA requires a real browser. Browser-control tools were unavailable during this implementation session.

| Path                      | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `src/App.tsx`             | Authentication, navigation, workspace, date filtering, theme |
| `src/Pages.tsx`           | Dashboard and all business modules                           |
| `src/Forms.tsx`           | Validated entry forms, order details, connection settings    |
| `src/components.tsx`      | Tables, export controls, dialogs, dates, cards               |
| `server/domain.mjs`       | Credit ledger, payment rules and profit calculations         |
| `server/integrations.mjs` | Shopify, Shiprocket, normalization and webhook worker        |
| `server/app.mjs`          | Auth, authorized API routes, exports and backup              |
| `server/db.mjs`           | SQLite schema and additive migrations                        |
| `tests/`                  | Backend, provider-contract and component tests               |

Meta Ads automation is a future integration. Advertising expenses are fully supported manually today.
