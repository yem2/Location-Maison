-- Facultatif : le site crée ces tables tout seul au premier usage. À exécuter dans Neon (SQL Editor) pour tout préparer d'avance.
-- Les visites utilisent la table « visits » (voir migration-visites.sql).

CREATE TABLE IF NOT EXISTS leases (
  id serial PRIMARY KEY, customer_id bigint NOT NULL, property_id text NOT NULL DEFAULT '', property_title text NOT NULL DEFAULT '', order_id bigint,
  rent numeric NOT NULL, charges numeric NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'XAF', pay_day int NOT NULL DEFAULT 5,
  start_date date NOT NULL, end_date date, deposit numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', note text NOT NULL DEFAULT '',
  created_by bigint, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS leases_customer_idx ON leases (customer_id);

CREATE TABLE IF NOT EXISTS rent_charges (
  id serial PRIMARY KEY, lease_id int NOT NULL, period text NOT NULL, due_date date NOT NULL, amount numeric NOT NULL, currency text NOT NULL,
  status text NOT NULL DEFAULT 'due', method text NOT NULL DEFAULT '', reference text NOT NULL DEFAULT '', payer_phone text NOT NULL DEFAULT '',
  paid_at timestamptz, paid_by bigint, reminded_on date, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (lease_id, period));
CREATE INDEX IF NOT EXISTS rent_charges_due_idx ON rent_charges (status, due_date);
-- une référence de transaction ne peut servir qu'à un seul loyer
CREATE UNIQUE INDEX IF NOT EXISTS rent_ref_uniq ON rent_charges (method, reference) WHERE reference <> '' AND status IN ('declared', 'paid');
