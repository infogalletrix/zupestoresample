export type Supplier = {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  balance: number;
  added: number;
  used: number;
  pending: number;
  products: number;
};
export type Product = {
  id: string;
  external_id?: string;
  name: string;
  sku: string;
  supplier_id: string | null;
  supplier: string;
  cost: number;
  price: number;
  stock: number;
  category: string;
  color: string;
  orders: number;
  quantity: number;
  revenue: number;
  profit: number;
  cost_verified: number;
};
export type Item = {
  id: string;
  product_id: string | null;
  supplier_id: string | null;
  name: string;
  sku: string;
  quantity: number;
  cost: number;
  price: number;
  cost_verified: number;
};
export type Shipment = {
  id: string;
  order_id: string;
  awb: string;
  courier: string;
  status: string;
  raw_status: string;
  ndr: string;
  updated_at: string;
  status_at: string;
};
export type Order = {
  id: string;
  external_id?: string;
  number: string;
  date: string;
  customer: string;
  phone: string;
  email: string;
  city: string;
  method: string;
  status: string;
  total: number;
  allowed_statuses?: string[];
  tax: number;
  shipping_cost: number;
  shipping_verified?: number;
  rto_cost: number;
  source: string;
  notes: string;
  items: Item[];
  shipments: Shipment[];
  product_cost: number;
  payment_fees?: number;
  credit_received: number;
  credit_used: number;
  payable: number;
  revenue: number;
  profit: number;
  net_profit: number;
  allocated_expense: number;
  cod_collected: number;
  cod_remitted: number;
  cod_pending: number;
  prepaid: number;
  refunded: number;
  payment_status: string;
  cost_verified: boolean;
};
export type Expense = {
  id: string;
  date: string;
  category: string;
  amount: number;
  notes: string;
  reference: string;
};
export type Payment = {
  bank_amount?: number | null;
  fee_amount?: number;
  shipping_deduction?: number;
  rto_deduction?: number;
  id: string;
  order_id: string;
  supplier_id: string | null;
  date: string;
  kind: string;
  amount: number;
  status: string;
  reference: string;
  source: string;
  void_reason?: string;
};
export type Credit = {
  id: string;
  supplier_id: string;
  order_id: string;
  type: string;
  amount: number;
  date: string;
  reference: string;
  notes: string;
  created_at: string;
};
export type Metrics = {
  totalOrders: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  ndr: number;
  rto: number;
  sales: number;
  productCost: number;
  shipping: number;
  adSpend: number;
  otherExpenses: number;
  grossProfit: number;
  netProfit: number;
  margin: number;
  rtoRate: number;
  codCollected: number;
  codRemitted: number;
  codPending: number;
  prepaid: number;
  missingCosts: number;
  expenseTotal: number;
  statusCounts: Record<string, number>;
};
export type SyncRun = {
  id: string;
  provider: string;
  status: string;
  message: string;
  records: number;
  started_at: string;
  finished_at: string;
};
export type Workspace = {
  operations?: {
    remittancesToReview: number;
    webhookFailures: number;
    syncIssues: number;
    backupFailed: boolean;
  };
  connections?: Integration[];
  paymentMetrics?: Pick<Metrics, 'codCollected' | 'codRemitted' | 'codPending' | 'prepaid'> & {
    bankReceived?: number;
    bankUnverified?: number;
    deductions?: number;
  };
  business: { name: string; currency: string; timezone: string };
  orders: Order[];
  products: Product[];
  suppliers: Supplier[];
  expenses: Expense[];
  payments: Payment[];
  ledger: Credit[];
  shipments: Shipment[];
  metrics: Metrics;
  credit: {
    added: number;
    used: number;
    balance: number;
    pending: number;
    creditedOrders: number;
    usedOrders: number;
    pendingOrders: number;
  };
  timeline: { date: string; sales: number; profit: number; orders: number }[];
  syncRuns: SyncRun[];
};
export type Session = {
  user: { id: string; name: string; email: string; role: string };
  demo: boolean;
};
export type Period = { label: string; from: string; to: string };
export type Integration = {
  provider: string;
  configured: boolean;
  status: string;
  enabled: boolean;
  shop?: string;
  email?: string;
  apiVersion?: string;
  channelId?: string;
  hasWebhookSecret?: boolean;
  lastSync?: string;
};
export type User = { id: string; name: string; email: string; role: string; active: number };
export type SettingsData = {
  backupStatus?: {
    status?: string;
    lastSuccess?: string;
    message?: string;
    intervalHours: number;
    retentionDays: number;
  } | null;
  business: { name: string };
  integrations: Integration[];
  users: User[];
  audit: { id: string; actor: string; action: string; created_at: string; entity_id: string }[];
  webhookFailures: {
    id: string;
    provider: string;
    status: string;
    attempts: number;
    error: string;
    created_at: string;
  }[];
};
export type Page =
  | 'dashboard'
  | 'orders'
  | 'shipments'
  | 'products'
  | 'suppliers'
  | 'expenses'
  | 'payments'
  | 'rto'
  | 'reports'
  | 'customers'
  | 'settings';
export type ModalState = {
  type:
    | 'expense'
    | 'payment'
    | 'credit'
    | 'useCredit'
    | 'product'
    | 'supplier'
    | 'order'
    | 'orderDetail'
    | 'creditDetail'
    | 'help'
    | 'user'
    | 'integration';
  record?: Order | Product | Supplier | Credit | User | Integration;
  orderId?: string;
  supplierId?: string;
} | null;
