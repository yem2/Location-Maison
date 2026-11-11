-- Paiements multi-moyens (Orange Money, MTN MoMo, PayPal, cartes, espèces, virement).
-- À exécuter une fois dans Neon (SQL Editor). Idempotent : peut être relancé sans risque.
-- (Le site crée aussi ces tables automatiquement au premier usage.)

-- Moyens de paiement gérés par le super administrateur (numéros de compte chiffrés par l'application)
CREATE TABLE IF NOT EXISTS payment_methods (
  id             serial PRIMARY KEY,
  kind           text    NOT NULL,                 -- cash | card | orange_money | mtn_momo | paypal | bank_transfer | other
  label          text    NOT NULL,
  provider       text    NOT NULL,                 -- cash | manual | flutterwave | paypal
  enabled        boolean NOT NULL DEFAULT false,
  position       int     NOT NULL DEFAULT 0,
  account_name   text    NOT NULL DEFAULT '',
  account_number text    NOT NULL DEFAULT '',      -- chiffré (AES-256-GCM)
  instructions   text    NOT NULL DEFAULT '',
  updated_by     bigint,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_kind_uniq ON payment_methods (kind) WHERE kind IN ('cash','card','orange_money','mtn_momo','paypal');

-- Registre des transactions (une ligne par tentative de paiement)
CREATE TABLE IF NOT EXISTS payments (
  id           bigserial PRIMARY KEY,
  order_id     bigint  NOT NULL,
  customer_id  bigint  NOT NULL,
  method_id    int,
  kind         text    NOT NULL,
  provider     text    NOT NULL,
  amount       numeric NOT NULL,
  currency     text    NOT NULL,
  status       text    NOT NULL,                   -- pending | awaiting_confirmation | paid | failed | cancelled | rejected | duplicate
  reference    text    NOT NULL UNIQUE,
  provider_ref text    NOT NULL DEFAULT '',
  payer_ref    text    NOT NULL DEFAULT '',        -- référence de transaction saisie par le client (paiement manuel)
  note         text    NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_by bigint,
  confirmed_at timestamptz
);
-- Garde-fous anti-fraude : un seul paiement « payé » par demande ; une référence de transaction ne sert qu'une fois
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_paid ON payments (order_id) WHERE status = 'paid';
CREATE UNIQUE INDEX IF NOT EXISTS payments_payer_ref_uniq ON payments (lower(payer_ref)) WHERE payer_ref <> '' AND status IN ('awaiting_confirmation','paid');
CREATE INDEX IF NOT EXISTS payments_order_idx  ON payments (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, created_at DESC);

-- Rapidité : index sur les requêtes les plus fréquentes
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_property_status_idx ON orders (property_id, status);
