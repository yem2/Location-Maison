-- Visites : demandes de rendez-vous. À exécuter une fois dans Neon (SQL Editor). Idempotent.
-- (Le site crée aussi cette table automatiquement au premier usage.)
CREATE TABLE IF NOT EXISTS visits (
  id             serial PRIMARY KEY,
  property_id    text    NOT NULL,
  property_title text    NOT NULL DEFAULT '',
  customer_id    bigint  NOT NULL,
  visit_date     date    NOT NULL,
  visit_time     text    NOT NULL,                 -- « HH:MM », heure locale de l'agence
  status         text    NOT NULL DEFAULT 'requested',  -- requested | confirmed | declined | cancelled | done
  note           text    NOT NULL DEFAULT '',
  admin_note     text    NOT NULL DEFAULT '',
  reminded_on    date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Impossible de réserver deux fois le même créneau pour le même bien
CREATE UNIQUE INDEX IF NOT EXISTS visits_slot_uniq ON visits (property_id, visit_date, visit_time) WHERE status IN ('requested','confirmed');
CREATE INDEX IF NOT EXISTS visits_customer_idx ON visits (customer_id, visit_date);
CREATE INDEX IF NOT EXISTS visits_date_idx ON visits (visit_date, status);
