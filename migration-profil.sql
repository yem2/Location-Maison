-- Profil client (photo, ville, présentation). À exécuter une fois dans Neon (SQL Editor).
-- Idempotent : peut être relancé sans risque. (Le site crée aussi ces colonnes automatiquement au premier usage.)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city   text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bio    text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '';
