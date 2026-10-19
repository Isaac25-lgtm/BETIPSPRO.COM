-- Payment schema STUB for later. Checkout and webhooks are DISABLED (PAYMENTS_ENABLED=false)
-- until a licensed payment provider, legal review and owner approval are complete.
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  active INTEGER NOT NULL DEFAULT 0,
  is_experiment INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_payment_id)
);

-- Signed webhook events; UNIQUE prevents duplicate processing.
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  signature_valid INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id)
);

-- Commercial hypotheses only (inactive). Prices in US cents.
INSERT INTO plans (id, name, price_minor, currency, credits, active, is_experiment, created_at) VALUES
  ('starter', 'Starter', 300, 'USD', 10, 0, 1, '2026-10-20T00:00:00Z'),
  ('analyst', 'Analyst', 700, 'USD', 30, 0, 1, '2026-10-20T00:00:00Z'),
  ('pro', 'Pro', 1500, 'USD', 80, 0, 1, '2026-10-20T00:00:00Z');
