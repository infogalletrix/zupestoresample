import { createHmac, createHash } from 'node:crypto';
import { id, now, insert, setting, setSetting, transaction } from './db.mjs';
import { AppError, collectCod, today } from './domain.mjs';
import { safeEqual } from './security.mjs';

export const paise = (value) => Math.round(Number(value || 0) * 100);
export function indiaDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? today()
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
}
export function mapShipmentStatus(value) {
  const s = String(value || '')
    .toUpperCase()
    .replaceAll('_', ' ');
  if (/RTO|RETURN TO ORIGIN|RETURNED TO ORIGIN/.test(s)) return 'RTO';
  if (/UNDELIVERED|NDR|UNDELIVERABLE|DELIVERY FAILED|DELIVERY ATTEMPT|DELIVERY EXCEPTION/.test(s))
    return 'NDR';
  if (/DELIVERED/.test(s)) return 'Delivered';
  if (/CANCEL/.test(s)) return 'Cancelled';
  if (/SHIPPED|TRANSIT|PICKED UP|OUT FOR DELIVERY|REACHED|DELAYED/.test(s)) return 'Shipped';
  return 'Confirmed';
}
export const statusCodes = {
  6: 'Shipped',
  7: 'Delivered',
  8: 'Cancelled',
  9: 'RTO',
  10: 'RTO',
  12: 'Shipped',
  13: 'Shipped',
  14: 'Shipped',
  17: 'Shipped',
  18: 'Shipped',
  19: 'Shipped',
  20: 'Shipped',
  21: 'NDR',
  22: 'NDR',
  38: 'NDR',
  39: 'RTO',
  40: 'RTO',
  41: 'RTO',
  42: 'RTO',
};
async function requestJson(url, options = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const seconds = Math.min(15, Number(response.headers?.get('retry-after')) || 2 ** attempt);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      continue;
    }
    if (!response.ok)
      throw new AppError(
        `Provider returned HTTP ${response.status}. Check credentials, permissions, and account access.`,
        502,
      );
    const data = await response.json();
    if (data.errors?.length)
      throw new AppError(`Shopify: ${String(data.errors[0].message).slice(0, 250)}`, 502);
    return data;
  }
}
const itemFields = `id name sku quantity originalUnitPriceSet { shopMoney { amount } } variant { id }`;
const orderFields = `id name createdAt updatedAt cancelledAt currencyCode displayFinancialStatus displayFulfillmentStatus paymentGatewayNames totalPriceSet { shopMoney { amount currencyCode } } totalTaxSet { shopMoney { amount } } currentTotalTaxSet { shopMoney { amount } } customer { displayName email phone } shippingAddress { name phone city } lineItems(first:250) { nodes { ${itemFields} } pageInfo { hasNextPage endCursor } } transactions { id kind status processedAt amountSet { shopMoney { amount currencyCode } } }`;
export function normalizeShopify(db, order) {
  if (order.currencyCode && order.currencyCode !== 'INR')
    throw new AppError(
      `Order ${order.name} is not in INR; currency conversion must be configured before import.`,
    );
  const old = db.prepare('SELECT * FROM orders WHERE external_id=?').get(order.id);
  if (old?.external_updated_at && order.updatedAt < old.external_updated_at) return old.id;
  return transaction(db, () => {
    const orderId = old?.id || id();
    const method = (order.paymentGatewayNames || []).some((n) =>
      /cash on delivery|\bcod\b/i.test(n),
    )
      ? 'COD'
      : 'Prepaid';
    const hasShipments =
      old && db.prepare('SELECT id FROM shipments WHERE order_id=? LIMIT 1').get(old.id);
    const status = order.cancelledAt
      ? 'Cancelled'
      : hasShipments
        ? old.status
        : order.displayFulfillmentStatus === 'FULFILLED'
          ? 'Shipped'
          : 'Confirmed';
    const values = {
      number: order.name,
      date: indiaDate(order.createdAt),
      customer: order.shippingAddress?.name || order.customer?.displayName || 'Shopify customer',
      phone: order.shippingAddress?.phone || order.customer?.phone || '',
      email: order.customer?.email || '',
      city: order.shippingAddress?.city || '',
      method,
      status,
      total: paise(order.totalPriceSet?.shopMoney?.amount),
      tax: paise((order.currentTotalTaxSet || order.totalTaxSet)?.shopMoney?.amount),
      source: 'Shopify',
      financial_status: order.displayFinancialStatus || 'Pending',
      updated_at: now(),
      external_updated_at: order.updatedAt,
    };
    if (old)
      db.prepare(
        `UPDATE orders SET ${Object.keys(values)
          .map((k) => `${k}=?`)
          .join(',')} WHERE id=?`,
      ).run(...Object.values(values), orderId);
    else insert(db, 'orders', { id: orderId, external_id: order.id, ...values });
    for (const line of order.lineItems?.nodes || []) {
      const prior = db
        .prepare('SELECT * FROM order_items WHERE order_id=? AND external_id=?')
        .get(orderId, line.id);
      const product = db
        .prepare(
          'SELECT * FROM products WHERE external_id=? OR sku=? ORDER BY external_id DESC LIMIT 1',
        )
        .get(line.variant?.id || '', line.sku || '__none__');
      const lineValues = {
        name: line.name,
        sku: line.sku || '',
        quantity: line.quantity,
        price: paise(line.originalUnitPriceSet?.shopMoney?.amount),
      };
      if (prior)
        db.prepare('UPDATE order_items SET name=?,sku=?,quantity=?,price=? WHERE id=?').run(
          lineValues.name,
          lineValues.sku,
          lineValues.quantity,
          lineValues.price,
          prior.id,
        );
      else if (line.quantity > 0)
        insert(db, 'order_items', {
          id: id(),
          order_id: orderId,
          external_id: line.id,
          product_id: product?.id || null,
          supplier_id: product?.supplier_id || null,
          ...lineValues,
          cost: product?.cost || 0,
          cost_verified: product?.cost_verified || 0,
        });
    }
    for (const tx of order.transactions || []) {
      if (
        tx.status !== 'SUCCESS' ||
        !['SALE', 'CAPTURE', 'REFUND'].includes(tx.kind) ||
        (method === 'COD' && tx.kind !== 'REFUND')
      )
        continue;
      const amount = paise(tx.amountSet?.shopMoney?.amount);
      if (amount <= 0) continue;
      const kind = tx.kind === 'REFUND' ? 'Customer refund' : 'Prepaid payment';
      db.prepare(
        `INSERT INTO payments(id,order_id,date,kind,amount,status,reference,source,external_key,created_at) VALUES(?,?,?,?,?,'Completed',?,'Shopify',?,?) ON CONFLICT(external_key) DO UPDATE SET amount=excluded.amount,date=excluded.date`,
      ).run(
        id(),
        orderId,
        indiaDate(tx.processedAt),
        kind,
        amount,
        tx.id,
        `shopify:${tx.id}`,
        now(),
      );
    }
    collectCod(db, orderId);
    return orderId;
  });
}
export function normalizeShipment(db, shipment, orderId, deferAggregate = false) {
  const previous = db
    .prepare('SELECT * FROM shipments WHERE external_id=? OR awb=?')
    .get(String(shipment.id || ''), shipment.awb || '__none__');
  const timestamp = shipment.status_at || now();
  if (previous && timestamp < previous.status_at) return false;
  const status = shipment.status || mapShipmentStatus(shipment.raw_status);
  const row = {
    order_id: orderId,
    external_id: shipment.id ? String(shipment.id) : null,
    awb: shipment.awb || null,
    courier: shipment.courier || previous?.courier || '',
    status,
    raw_status: shipment.raw_status || '',
    ndr:
      status === 'NDR'
        ? shipment.ndr || shipment.raw_status || 'Delivery attempt unsuccessful'
        : '',
    updated_at: now(),
    status_at: timestamp,
    shipping_cost: shipment.shipping_cost ?? previous?.shipping_cost ?? null,
  };
  if (previous)
    db.prepare(
      `UPDATE shipments SET ${Object.keys(row)
        .map((k) => `${k}=?`)
        .join(',')} WHERE id=?`,
    ).run(...Object.values(row), previous.id);
  else insert(db, 'shipments', { id: id(), ...row });
  if (!deferAggregate) reconcileShipments(db, orderId, timestamp);
  return true;
}
function reconcileShipments(db, orderId, timestamp) {
  const all = db
    .prepare('SELECT status FROM shipments WHERE order_id=?')
    .all(orderId)
    .map((s) => s.status);
  if (!all.length) return;
  // A split shipment is delivered/returned only once every package has reached that state.
  const aggregate = all.every((s) => s === 'Delivered')
    ? 'Delivered'
    : all.every((s) => s === 'RTO')
      ? 'RTO'
      : all.includes('NDR')
        ? 'NDR'
        : all.every((s) => s === 'Cancelled')
          ? 'Cancelled'
          : all.every((s) => s === 'Confirmed')
            ? 'Confirmed'
            : 'Shipped';
  db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(aggregate, now(), orderId);
  const costs = db
    .prepare(
      'SELECT SUM(shipping_cost) AS amount,COUNT(shipping_cost) AS known,COUNT(*) AS total FROM shipments WHERE order_id=?',
    )
    .get(orderId);
  if (costs.known === costs.total)
    db.prepare(
      'UPDATE orders SET shipping_cost=?,shipping_verified=1 WHERE id=? AND shipping_override=0',
    ).run(costs.amount, orderId);
  collectCod(db, orderId, indiaDate(timestamp));
}
export function createIntegrationService(db, crypto, fetcher = fetch) {
  let active = false,
    workerActive = false;
  function config(provider) {
    const value = setting(db, `integration:${provider}`);
    return value ? crypto.decrypt(value) : {};
  }
  function save(provider, value) {
    setSetting(db, `integration:${provider}`, crypto.encrypt(value));
  }
  function publicConfig() {
    return ['shopify', 'shiprocket', 'settlements'].map((provider) => {
      const c = config(provider);
      return {
        provider,
        configured:
          provider === 'shopify'
            ? !!(c.shop && c.token)
            : provider === 'shiprocket'
              ? !!(c.email && c.password)
              : !!c.secret,
        shop: c.shop || '',
        email: c.email || '',
        apiVersion: c.apiVersion || '2026-07',
        channelId: c.channelId || '',
        hasWebhookSecret: !!c.webhookSecret,
        enabled: c.enabled !== false,
        lastSync: setting(db, `lastSync:${provider}`),
        settlementPath: c.settlementPath || '',
        status: setting(db, `status:${provider}`, 'Not connected'),
      };
    });
  }
  async function graphql(query, variables = {}) {
    const c = config('shopify');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(c.shop || '') || !c.token)
      throw new AppError('Connect a valid Shopify store in Settings.');
    const version = c.apiVersion || '2026-07';
    if (!/^20\d{2}-(01|04|07|10)$/.test(version))
      throw new AppError('Invalid Shopify API version.');
    const result = await requestJson(
      `https://${c.shop}/admin/api/${version}/graphql.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': c.token },
        body: JSON.stringify({ query, variables }),
      },
      fetcher,
    );
    if (result.extensions?.cost?.throttleStatus?.currentlyAvailable < 100)
      await new Promise((r) => setTimeout(r, 1500));
    return result.data;
  }
  async function allOrderLines(o) {
    while (o.lineItems.pageInfo.hasNextPage) {
      const d = await graphql(
        `query MoreLines($id:ID!,$after:String){order(id:$id){lineItems(first:250,after:$after){nodes{${itemFields}}pageInfo{hasNextPage endCursor}}}}`,
        { id: o.id, after: o.lineItems.pageInfo.endCursor },
      );
      o.lineItems.nodes.push(...d.order.lineItems.nodes);
      o.lineItems.pageInfo = d.order.lineItems.pageInfo;
    }
    return o;
  }
  async function syncShopify() {
    let cursor = null,
      count = 0;
    do {
      const data = await graphql(
        `
          query Products($after: String) {
            productVariants(first: 100, after: $after) {
              nodes {
                id
                displayName
                sku
                price
                inventoryQuantity
                inventoryItem {
                  unitCost {
                    amount
                    currencyCode
                  }
                }
                product {
                  productType
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        { after: cursor },
      );
      for (const v of data.productVariants.nodes) {
        const sku = v.sku || `SHOP-${v.id.split('/').pop()}`;
        const old = db
          .prepare('SELECT * FROM products WHERE external_id=? OR sku=?')
          .get(v.id, sku);
        const cost = v.inventoryItem?.unitCost;
        const values = {
          external_id: v.id,
          name: v.displayName,
          sku,
          price: paise(v.price),
          stock: Math.max(0, v.inventoryQuantity || 0),
          category: v.product?.productType || 'General',
        };
        if (old)
          db.prepare(
            `UPDATE products SET ${Object.keys(values)
              .map((k) => `${k}=?`)
              .join(',')} WHERE id=?`,
          ).run(...Object.values(values), old.id);
        else
          insert(db, 'products', {
            id: id(),
            ...values,
            cost: cost?.currencyCode === 'INR' ? paise(cost.amount) : 0,
            cost_verified: cost?.currencyCode === 'INR' ? 1 : 0,
          });
      }
      cursor = data.productVariants.pageInfo.hasNextPage
        ? data.productVariants.pageInfo.endCursor
        : null;
    } while (cursor);
    const last = setting(db, 'lastSync:shopify');
    const filter = last
      ? `updated_at:>='${new Date(new Date(last).getTime() - 300000).toISOString()}'`
      : '';
    cursor = null;
    do {
      const d = await graphql(
        `query Orders($after:String,$query:String){orders(first:50,after:$after,query:$query,sortKey:UPDATED_AT){nodes{${orderFields}}pageInfo{hasNextPage endCursor}}}`,
        { after: cursor, query: filter },
      );
      for (const o of d.orders.nodes) {
        normalizeShopify(db, await allOrderLines(o));
        count++;
      }
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    } while (cursor);
    return {
      count,
      message: `${count} orders reconciled; products and prepaid transactions updated.`,
    };
  }
  async function shiprocketToken(force = false) {
    const c = config('shiprocket');
    if (!c.email || !c.password) throw new AppError('Connect Shiprocket in Settings.');
    if (!force && c.token && c.tokenExpires > Date.now()) return c.token;
    const d = await requestJson(
      'https://apiv2.shiprocket.in/v1/external/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, password: c.password }),
      },
      fetcher,
    );
    if (!d.token) throw new AppError('Shiprocket did not return an access token.', 502);
    save('shiprocket', { ...c, token: d.token, tokenExpires: Date.now() + 8 * 86400000 });
    return d.token;
  }
  async function shipGet(path) {
    const token = await shiprocketToken();
    try {
      return await requestJson(
        `https://apiv2.shiprocket.in/v1/external${path}`,
        { headers: { Authorization: `Bearer ${token}` } },
        fetcher,
      );
    } catch (e) {
      if (e.message.includes('401')) {
        const next = await shiprocketToken(true);
        return requestJson(
          `https://apiv2.shiprocket.in/v1/external${path}`,
          { headers: { Authorization: `Bearer ${next}` } },
          fetcher,
        );
      }
      throw e;
    }
  }
  async function syncShiprocket() {
    let page = 1,
      totalPages = 1,
      count = 0,
      unmatched = 0;
    const c = config('shiprocket');
    do {
      const params = new URLSearchParams({ page: String(page), per_page: '100', sort: 'DESC' });
      if (c.channelId) params.set('channel_id', c.channelId);
      const d = await shipGet(`/orders?${params}`);
      if (!Array.isArray(d.data)) throw new AppError('Unexpected Shiprocket order response.', 502);
      for (const remote of d.data) {
        const number = String(remote.channel_order_id || '');
        const matches = db
          .prepare('SELECT * FROM orders WHERE external_id=? OR number=? OR number=?')
          .all(`gid://shopify/Order/${number}`, number, `#${number.replace(/^#/, '')}`);
        if (matches.length !== 1) {
          unmatched++;
          continue;
        }
        const o = matches[0];
        transaction(db, () => {
          for (const s of remote.shipments || []) {
            if (!s.awb) continue;
            const raw = s.current_status || s.status || remote.status;
            normalizeShipment(
              db,
              {
                id: s.id,
                awb: s.awb,
                courier: s.courier,
                status: mapShipmentStatus(raw),
                raw_status: raw,
                status_at: now(),
                shipping_cost:
                  s.freight_charges !== undefined ? paise(s.freight_charges) : undefined,
              },
              o.id,
              true,
            );
            count++;
          }
          reconcileShipments(db, o.id, now());
        });
      }
      totalPages = Number(d.meta?.pagination?.total_pages || 1);
      page++;
      if (page > 10000)
        throw new AppError(
          'Shiprocket pagination exceeded the safety limit; restrict your channel.',
        );
    } while (page <= totalPages);
    return {
      count,
      message: `${count} shipments updated. ${unmatched} unmatched orders. COD remittance requires a separate settlement feed.`,
    };
  }
  async function sync(provider) {
    if (active) throw new AppError('A synchronization is already running.', 409);
    if (!['shopify', 'shiprocket'].includes(provider))
      throw new AppError('Unsupported integration.');
    active = true;
    const runId = id(),
      started = now();
    insert(db, 'sync_runs', {
      id: runId,
      provider,
      status: 'Running',
      message: 'Connecting to provider…',
      records: 0,
      started_at: started,
    });
    try {
      const result = await (provider === 'shopify' ? syncShopify() : syncShiprocket());
      setSetting(db, `lastSync:${provider}`, started);
      setSetting(db, `status:${provider}`, 'Connected');
      db.prepare(
        "UPDATE sync_runs SET status='Success',message=?,records=?,finished_at=? WHERE id=?",
      ).run(result.message, result.count, now(), runId);
      return result;
    } catch (e) {
      setSetting(db, `status:${provider}`, 'Needs attention');
      db.prepare("UPDATE sync_runs SET status='Failed',message=?,finished_at=? WHERE id=?").run(
        e.message.slice(0, 500),
        now(),
        runId,
      );
      throw e;
    } finally {
      active = false;
    }
  }
  function receiveShopify(raw, headers) {
    const c = config('shopify');
    if (!c.webhookSecret) throw new AppError('Webhook is not configured.', 503);
    const hmac = createHmac('sha256', c.webhookSecret).update(raw).digest('base64');
    if (
      !safeEqual(hmac, headers['x-shopify-hmac-sha256']) ||
      headers['x-shopify-shop-domain'] !== c.shop
    )
      throw new AppError('Invalid webhook signature.', 401);
    if (
      ![
        'orders/create',
        'orders/updated',
        'orders/paid',
        'orders/cancelled',
        'refunds/create',
        'fulfillments/create',
        'fulfillments/update',
      ].includes(headers['x-shopify-topic'])
    )
      return;
    const eventId = headers['x-shopify-webhook-id'];
    if (!eventId) throw new AppError('Missing webhook ID.');
    db.prepare(
      'INSERT OR IGNORE INTO webhook_events(id,provider,payload,created_at) VALUES(?,?,?,?)',
    ).run(`shopify:${eventId}`, 'shopify', raw.toString(), now());
  }
  function receiveTracking(raw, headers) {
    const c = config('shiprocket');
    if (!c.webhookSecret || !safeEqual(c.webhookSecret, headers['x-api-key']))
      throw new AppError('Invalid tracking security token.', 401);
    const eventId = createHash('sha256').update(raw).digest('hex');
    db.prepare(
      'INSERT OR IGNORE INTO webhook_events(id,provider,payload,created_at) VALUES(?,?,?,?)',
    ).run(`tracking:${eventId}`, 'shiprocket', raw.toString(), now());
  }
  async function processWebhooks() {
    if (workerActive || active) return;
    workerActive = true;
    try {
      const events = db
        .prepare(
          "SELECT * FROM webhook_events WHERE status='pending' AND attempts<5 ORDER BY created_at LIMIT 20",
        )
        .all();
      for (const event of events) {
        try {
          const payload = JSON.parse(event.payload);
          if (event.provider === 'shopify') {
            const externalId = payload.admin_graphql_api_id?.includes('/Order/')
              ? payload.admin_graphql_api_id
              : `gid://shopify/Order/${payload.order_id || payload.id}`;
            const d = await graphql(`query Order($id:ID!){order(id:$id){${orderFields}}}`, {
              id: externalId,
            });
            if (!d.order) throw new Error('Order is unavailable through Shopify API.');
            normalizeShopify(db, await allOrderLines(d.order));
          } else {
            const shipment = db
              .prepare('SELECT * FROM shipments WHERE awb=?')
              .get(String(payload.awb || ''));
            const num = String(payload.order_id || '');
            const order = shipment
              ? db.prepare('SELECT * FROM orders WHERE id=?').get(shipment.order_id)
              : db
                  .prepare('SELECT * FROM orders WHERE number=? OR number=? OR external_id=?')
                  .get(num, `#${num.replace(/^#/, '')}`, `gid://shopify/Order/${num}`);
            if (!order) throw new Error('Tracking event is waiting for its order to sync.');
            if (!payload.awb) throw new Error('Tracking event has no AWB.');
            const rawStatus = payload.current_status || payload.shipment_status || '';
            const timestamp = payload.current_timestamp
              ? new Date(
                  String(payload.current_timestamp).replace(' ', 'T') +
                    (String(payload.current_timestamp).includes('Z') ||
                    /[+-]\d\d:\d\d$/.test(payload.current_timestamp)
                      ? ''
                      : '+05:30'),
                ).toISOString()
              : event.created_at;
            normalizeShipment(
              db,
              {
                id: shipment?.external_id,
                awb: String(payload.awb),
                courier: payload.courier_name,
                raw_status: rawStatus,
                status: rawStatus
                  ? mapShipmentStatus(rawStatus)
                  : statusCodes[payload.current_status_id] || 'Confirmed',
                status_at: timestamp,
                ndr: payload.scans?.at(-1)?.activity || '',
              },
              order.id,
            );
          }
          db.prepare("UPDATE webhook_events SET status='processed',error=NULL WHERE id=?").run(
            event.id,
          );
        } catch (e) {
          db.prepare(
            "UPDATE webhook_events SET attempts=attempts+1,error=?,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END WHERE id=?",
          ).run(e.message.slice(0, 400), event.id);
        }
      }
    } finally {
      workerActive = false;
    }
  }
  return {
    config,
    save,
    publicConfig,
    sync,
    receiveShopify,
    receiveTracking,
    processWebhooks,
    isActive: () => active,
  };
}
