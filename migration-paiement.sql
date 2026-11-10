-- À exécuter une fois dans la base Neon (SQL Editor) avant de déployer cette version.
-- Idempotent : peut être relancé sans risque.

-- Acompte demandé par bien
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deposit numeric NOT NULL DEFAULT 0;

-- Suivi du paiement par demande
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref text;
CREATE INDEX IF NOT EXISTS orders_payment_ref_idx ON orders (payment_ref);

-- Limitation de débit anti-abus (api/_lib.js > throttle)
CREATE TABLE IF NOT EXISTS rate_hits (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_hits_key_at_idx ON rate_hits (key, at);
