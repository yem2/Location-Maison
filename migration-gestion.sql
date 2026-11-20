-- Facultatif : le site crée ces tables tout seul au premier usage. À exécuter dans Neon (SQL Editor) pour tout préparer d'avance.

CREATE TABLE IF NOT EXISTS tickets (
  id serial PRIMARY KEY, customer_id bigint NOT NULL, lease_id int, property_title text NOT NULL DEFAULT '', title text NOT NULL, description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'autre', priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open', photo text NOT NULL DEFAULT '',
  admin_note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz);
CREATE INDEX IF NOT EXISTS tickets_customer_idx ON tickets (customer_id);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS owners (
  id serial PRIMARY KEY, name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', commission_pct numeric NOT NULL DEFAULT 10,
  notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_id int;

-- un relevé mensuel ne peut être marqué « reversé » qu'une fois par propriétaire, période et devise
CREATE TABLE IF NOT EXISTS owner_payouts (
  id serial PRIMARY KEY, owner_id int NOT NULL, period text NOT NULL, currency text NOT NULL, gross numeric NOT NULL, commission numeric NOT NULL, net numeric NOT NULL,
  method text NOT NULL DEFAULT '', reference text NOT NULL DEFAULT '', paid_by bigint, paid_at timestamptz NOT NULL DEFAULT now(), UNIQUE (owner_id, period, currency));
