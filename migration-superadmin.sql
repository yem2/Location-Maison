-- Super administrateur : archivage des biens + profil des administrateurs.
-- À exécuter une fois dans Neon (SQL Editor). Idempotent : peut être relancé sans risque.
-- (Le site crée aussi ces colonnes automatiquement au premier usage.)

ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived    boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio    text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS city   text NOT NULL DEFAULT '';

-- Archives des clients (la suppression d'un compte le place d'abord dans les archives, récupérable)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Mot de passe oublié : liens à usage unique (administrateurs et clients)
CREATE TABLE IF NOT EXISTS password_resets (
  id          bigserial PRIMARY KEY,
  kind        text        NOT NULL,            -- 'admin' | 'customer'
  account_id  bigint      NOT NULL,
  token_hash  text        NOT NULL UNIQUE,     -- seul l'empreinte du jeton est stockée
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
