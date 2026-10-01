import { id, insert, now, setSetting, transaction } from './db.mjs';
import { today, collectCod, recordCredit, useCredit } from './domain.mjs';

export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM orders').get().n) {
    db.prepare("UPDATE orders SET shipping_verified=1 WHERE id LIKE 'demo-order-%'").run();
    return;
  }
  setSetting(db, 'business', { name: 'Zupestore', currency: 'INR', timezone: 'Asia/Kolkata' });
  const base = new Date(`${today()}T12:00:00Z`);
  const daysAgo = (n) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const supplierData = [
    ['s1', 'Aarav Home & Living', 'hello@aarav.example', '+91 98765 00101'],
    ['s2', 'Urban Supply Co.', 'orders@urban.example', '+91 98765 00202'],
    ['s3', 'Nova Electronics', 'sales@nova.example', '+91 98765 00303'],
    ['s4', 'Evergreen Essentials', 'care@evergreen.example', '+91 98765 00404'],
  ];
  supplierData.forEach(([sid, name, email, phone]) =>
    insert(db, 'suppliers', {
      id: sid,
      name,
      email,
      phone,
      notes: 'Sample supplier · demo data',
      created_at: now(),
    }),
  );
  const productData = [
    ['p1', 'Ambient LED lamp', 'LED-LMP-001', 's1', 50000, 129900, 148, 'Home & living', '#f8ecd7'],
    [
      'p2',
      'Mini thermal printer',
      'PRT-MINI-02',
      's3',
      68000,
      169900,
      82,
      'Electronics',
      '#e9e4f8',
    ],
    [
      'p3',
      'Portable steam iron',
      'STM-IRN-03',
      's1',
      80000,
      189900,
      56,
      'Home & living',
      '#ddebf6',
    ],
    ['p4', 'Cloud aroma diffuser', 'ARM-DIF-04', 's4', 42000, 119900, 125, 'Lifestyle', '#e4ecd8'],
    ['p5', 'Magnetic car mount', 'CAR-MNT-05', 's2', 28000, 79900, 214, 'Accessories', '#e0e7f0'],
    ['p6', 'Rechargeable blender', 'BLD-USB-06', 's2', 65000, 159900, 38, 'Kitchen', '#e9ebdd'],
    ['p7', 'Digital desk clock', 'CLK-LED-07', 's3', 35000, 99900, 94, 'Electronics', '#f2e0dc'],
    ['p8', 'Travel organizer set', 'TRV-ORG-08', 's4', 30000, 89900, 176, 'Lifestyle', '#e5def2'],
  ];
  productData.forEach(([pid, name, sku, supplier_id, cost, price, stock, category, color]) =>
    insert(db, 'products', {
      id: pid,
      name,
      sku,
      supplier_id,
      cost,
      price,
      stock,
      category,
      color,
    }),
  );
  const names = [
    'Aditi Sharma',
    'Rahul Mehta',
    'Priya Nair',
    'Arjun Patel',
    'Neha Gupta',
    'Karan Shah',
    'Ananya Rao',
    'Rohan Verma',
    'Ishita Das',
    'Vikram Singh',
    'Sneha Iyer',
    'Aman Kapoor',
    'Meera Joshi',
    'Dev Malhotra',
    'Sana Khan',
    'Riya Agarwal',
  ];
  const cities = [
    'Mumbai',
    'Bengaluru',
    'New Delhi',
    'Pune',
    'Hyderabad',
    'Chennai',
    'Jaipur',
    'Ahmedabad',
  ];
  transaction(db, () => {
    for (let i = 0; i < 184; i++) {
      const p = productData[i % 8],
        oid = `demo-order-${i}`,
        age = Math.floor(i / 3),
        date = daysAgo(age),
        method = i % 4 === 0 ? 'Prepaid' : 'COD';
      const status =
        i < 4
          ? 'Confirmed'
          : i < 10
            ? 'Shipped'
            : i % 13 === 0
              ? 'RTO'
              : i % 17 === 0
                ? 'NDR'
                : i % 31 === 0
                  ? 'Cancelled'
                  : 'Delivered';
      const qty = i % 19 === 0 ? 2 : 1,
        total = p[5] * qty;
      insert(db, 'orders', {
        id: oid,
        external_id: `demo-shopify-${1284 - i}`,
        number: `#${1284 - i}`,
        date,
        customer: names[i % names.length],
        phone: `+91 98${String(12340000 + i).padStart(8, '0')}`,
        email: `customer${i + 1}@example.com`,
        city: cities[i % 8],
        method,
        status,
        total,
        tax: 0,
        shipping_cost: ['Confirmed', 'Cancelled'].includes(status) ? 0 : 6900 + (i % 5) * 1000,
        rto_cost: status === 'RTO' ? 6500 : 0,
        source: 'Shopify',
        financial_status: method === 'Prepaid' ? 'Paid' : 'Pending',
        updated_at: now(),
      });
      insert(db, 'order_items', {
        id: id(),
        order_id: oid,
        product_id: p[0],
        supplier_id: p[3],
        name: p[1],
        sku: p[2],
        quantity: qty,
        cost: p[4],
        price: p[5],
      });
      if (!['Confirmed', 'Cancelled'].includes(status))
        insert(db, 'shipments', {
          id: id(),
          order_id: oid,
          external_id: `demo-shipment-${i}`,
          awb: `143628${String(985632 + i)}`,
          courier: ['Delhivery', 'Blue Dart', 'Xpressbees', 'Ecom Express'][i % 4],
          status,
          raw_status: status.toUpperCase(),
          ndr: status === 'NDR' ? 'Customer unavailable · reattempt needed' : '',
          updated_at: now(),
          status_at: `${date}T08:30:00.000Z`,
        });
      collectCod(db, oid, date);
      if (method === 'Prepaid')
        insert(db, 'payments', {
          id: id(),
          order_id: oid,
          date,
          kind: 'Prepaid payment',
          amount: total,
          status: 'Completed',
          reference: `PAY-${1284 - i}`,
          source: 'Shopify',
          external_key: `demo-pay-${i}`,
          created_at: now(),
        });
      if (method === 'COD' && status === 'Delivered' && age > 8)
        insert(db, 'payments', {
          id: id(),
          order_id: oid,
          date: daysAgo(Math.max(0, age - 7)),
          kind: 'COD remittance',
          amount: total,
          status: 'Completed',
          reference: `UTR-${268410 + i}`,
          source: 'Settlement feed',
          external_key: `demo-remit-${i}`,
          created_at: now(),
        });
    }
    for (let i = 0; i < 24; i++)
      insert(db, 'expenses', {
        id: id(),
        date: daysAgo(i * 2),
        category:
          i % 6 === 0 ? 'Software / subscriptions' : i % 5 === 0 ? 'Other expenses' : 'Meta Ads',
        amount: i % 6 === 0 ? 149900 : i % 5 === 0 ? 45000 : 175000 + (i % 4) * 25000,
        notes:
          i % 6 === 0
            ? 'Monthly tools & store subscriptions'
            : i % 5 === 0
              ? 'Packaging materials & inserts'
              : `Prospecting campaign · ${['Home collection', 'Everyday essentials', 'Best sellers'][i % 3]}`,
        reference: `EXP-${1001 + i}`,
        created_by: 'demo',
        created_at: now(),
      });
  });
  const returns = db
    .prepare(
      "SELECT o.id,o.date,i.supplier_id,i.cost*i.quantity AS cost FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status='RTO' ORDER BY o.date",
    )
    .all();
  for (let i = 0; i < returns.length - 3; i++) {
    const r = returns[i];
    recordCredit(
      db,
      {
        supplier_id: r.supplier_id,
        order_id: r.id,
        amount: r.cost,
        date: r.date,
        reference: `CN-${2401 + i}`,
        notes: 'Return received and accepted by supplier.',
        received: true,
        idempotency_key: `demo-credit-${i}`,
      },
      'demo',
    );
  }
  for (const [supplierId] of supplierData) {
    const eligible = db
      .prepare(
        "SELECT o.id,o.date,i.cost*i.quantity AS cost FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.supplier_id=? AND o.status='Confirmed' LIMIT 1",
      )
      .get(supplierId);
    if (eligible)
      try {
        useCredit(
          db,
          {
            supplier_id: supplierId,
            order_id: eligible.id,
            amount: Math.min(eligible.cost, 20000),
            date: today(),
            reference: `PUR-${eligible.id}`,
            notes: 'Applied to new supplier purchase.',
            idempotency_key: `demo-use-${supplierId}`,
          },
          'demo',
        );
      } catch {}
  }
  db.prepare('UPDATE orders SET shipping_verified=1').run();
}
