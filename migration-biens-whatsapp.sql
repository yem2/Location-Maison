-- Biens loués / vendus, une seule demande acceptée par bien, journal WhatsApp.
-- À exécuter une fois dans Neon (SQL Editor). Idempotent. (Le site applique aussi tout automatiquement au premier usage.)

-- 1) États « loué » et « vendu » (la base d'origine n'en autorise que trois)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_availability_check' AND conrelid = 'properties'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%rented%') THEN
    ALTER TABLE properties DROP CONSTRAINT properties_availability_check;
    ALTER TABLE properties ADD CONSTRAINT properties_availability_check CHECK (availability IN ('available','reserved','unavailable','rented','sold'));
  END IF;
END $$;

-- 2) Une seule demande acceptée par bien
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_confirmed_per_property ON orders (property_id) WHERE status = 'confirmed' AND property_id IS NOT NULL;

-- 3) Journal des envois WhatsApp (numéros masqués)
CREATE TABLE IF NOT EXISTS wa_log (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,
  to_masked    text NOT NULL,
  status       text NOT NULL,            -- sent | failed | skipped
  provider     text NOT NULL DEFAULT '',
  provider_ref text NOT NULL DEFAULT '',
  error        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_log_created_idx ON wa_log (created_at DESC);
