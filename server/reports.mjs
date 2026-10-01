export function performanceRows(timeline, group = 'Daily') {
  const map = new Map();
  for (const row of timeline) {
    let key = row.date;
    if (group === 'Monthly') key = key.slice(0, 7);
    else if (group === 'Annual') key = key.slice(0, 4);
    else if (group === 'Weekly') {
      const day = new Date(key + 'T12:00:00Z');
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      key = day.toISOString().slice(0, 10);
    }
    const value = map.get(key) || { Period: key, Orders: 0, Sales_INR: 0, Net_profit_INR: 0 };
    value.Orders += row.orders;
    value.Sales_INR += row.sales / 100;
    value.Net_profit_INR += row.profit / 100;
    map.set(key, value);
  }
  return [...map.values()]
    .sort((a, b) => a.Period.localeCompare(b.Period))
    .map((r) => ({
      ...r,
      Sales_INR: Math.round(r.Sales_INR * 100) / 100,
      Net_profit_INR: Math.round(r.Net_profit_INR * 100) / 100,
      Margin_percent: r.Sales_INR ? Math.round((r.Net_profit_INR / r.Sales_INR) * 10000) / 100 : 0,
    }));
}
