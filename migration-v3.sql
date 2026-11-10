-- Messagerie + supervision. À exécuter une fois dans Neon (SQL Editor), après migration-paiement.sql.
-- Idempotent : peut être relancé sans risque.

-- ===== Messagerie (support client et conversations privées) =====
CREATE TABLE IF NOT EXISTS chat_threads (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('support', 'direct')),
  customer_a      bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_b      bigint REFERENCES customers(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  a_read_id       bigint NOT NULL DEFAULT 0,
  b_read_id       bigint NOT NULL DEFAULT 0,
  admin_read_id   bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_uniq ON chat_threads (kind, customer_a, (COALESCE(customer_b, 0)));
CREATE INDEX IF NOT EXISTS chat_threads_a_idx ON chat_threads (customer_a);
CREATE INDEX IF NOT EXISTS chat_threads_b_idx ON chat_threads (customer_b);

CREATE TABLE IF NOT EXISTS chat_messages (
  id                 bigserial PRIMARY KEY,
  thread_id          bigint NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_type        text NOT NULL CHECK (sender_type IN ('customer', 'admin')),
  sender_customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  sender_admin_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages (thread_id, id);

-- ===== Supervision =====
CREATE TABLE IF NOT EXISTS api_stats (
  day   date NOT NULL,
  api   text NOT NULL,
  class text NOT NULL,
  n     integer NOT NULL DEFAULT 0,
  ms    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, api, class)
);

CREATE TABLE IF NOT EXISTS app_events (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  kind   text NOT NULL,
  api    text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT '',
  method text NOT NULL DEFAULT '',
  status integer,
  ms     integer,
  ip     text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS app_events_kind_at_idx ON app_events (kind, at DESC);
CREATE INDEX IF NOT EXISTS app_events_at_idx ON app_events (at DESC);

CREATE TABLE IF NOT EXISTS monitor_checks (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  name   text NOT NULL,
  ok     boolean NOT NULL,
  ms     integer NOT NULL DEFAULT 0,
  detail text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS monitor_checks_name_at_idx ON monitor_checks (name, at DESC);

CREATE TABLE IF NOT EXISTS code_baseline (
  path        text PRIMARY KEY,
  sha256      text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by bigint
);
