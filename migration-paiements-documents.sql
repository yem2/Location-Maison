-- Facultatif : le site crée ces tables tout seul au premier usage. À exécuter dans Neon (SQL Editor) pour tout préparer d'avance.
-- Idempotent : peut être relancé sans risque.

-- ===== Paiements =====
CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY, order_id bigint NOT NULL, customer_id bigint NOT NULL, method text NOT NULL, provider text NOT NULL DEFAULT '',
  reference text NOT NULL UNIQUE, provider_ref text NOT NULL DEFAULT '', amount numeric NOT NULL, currency text NOT NULL,
  charged_amount numeric, charged_currency text, status text NOT NULL DEFAULT 'pending',
  payer_phone text NOT NULL DEFAULT '', payer_name text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
  confirmed_by bigint, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, created_at DESC);
-- une référence de transaction manuelle (Orange/MTN/virement) ne peut servir qu'une seule fois
CREATE UNIQUE INDEX IF NOT EXISTS payments_txn_uniq ON payments (method, provider_ref) WHERE provider = 'manual' AND provider_ref <> '' AND status <> 'failed';
-- une seule réussite par demande (empêche tout double encaissement)
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_paid ON payments (order_id) WHERE status = 'paid';
CREATE TABLE IF NOT EXISTS payment_settings (key text PRIMARY KEY, value text NOT NULL, updated_by bigint, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payment_settings_log (id bigserial PRIMARY KEY, user_id bigint, at timestamptz NOT NULL DEFAULT now(), changed text NOT NULL, ip text NOT NULL DEFAULT '');

-- ===== Contrats =====
CREATE TABLE IF NOT EXISTS contracts (
  id bigserial PRIMARY KEY, number text NOT NULL DEFAULT '', order_id bigint NOT NULL, customer_id bigint NOT NULL, kind text NOT NULL,
  data text NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'issued', created_by bigint, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS contracts_order_idx ON contracts (order_id);
CREATE INDEX IF NOT EXISTS contracts_customer_idx ON contracts (customer_id);

-- ===== Mot de passe oublié =====
CREATE TABLE IF NOT EXISTS password_resets (
  id bigserial PRIMARY KEY, kind text NOT NULL, account_id bigint NOT NULL, token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS password_resets_acc_idx ON password_resets (kind, account_id, created_at DESC);

-- ===== Archives (suppressions récupérables) =====
CREATE TABLE IF NOT EXISTS archives (
  id bigserial PRIMARY KEY, kind text NOT NULL, ref_id text NOT NULL, label text NOT NULL DEFAULT '', data text NOT NULL,
  deleted_by bigint, deleted_at timestamptz NOT NULL DEFAULT now(), restored_at timestamptz);
CREATE INDEX IF NOT EXISTS archives_kind_idx ON archives (kind, deleted_at DESC);

-- ===== Vitesse : index sur les requêtes fréquentes =====
CREATE INDEX IF NOT EXISTS rate_hits_key_at_idx ON rate_hits (key, at);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_property_status_idx ON orders (property_id, status);
CREATE INDEX IF NOT EXISTS activity_customer_idx ON activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_notifications_idx ON customer_notifications (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions (customer_id);
