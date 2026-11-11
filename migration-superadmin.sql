-- Super administrateur : archivage des biens + profil des administrateurs.
-- À exécuter une fois dans Neon (SQL Editor). Idempotent : peut être relancé sans risque.
-- (Le site crée aussi ces colonnes automatiquement au premier usage.)

ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived    boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio    text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS city   text NOT NULL DEFAULT '';
