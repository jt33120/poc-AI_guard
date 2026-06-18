-- 0008_vault_credentials.sql — make provider_credentials backend-agnostic.
--
-- 0007 stored credentials with in-app envelope encryption only. We now also
-- support Supabase Vault (the root key is held by Supabase outside the database;
-- core/secrets.py::VaultSecretStore). A `backend` discriminator selects how a row
-- is read back; the envelope columns become nullable since Vault rows store only
-- a `vault_secret_id` reference. Existing rows default to 'envelope' (unchanged).

alter table provider_credentials
    add column if not exists backend text not null default 'envelope';
alter table provider_credentials
    add column if not exists vault_secret_id uuid;

alter table provider_credentials alter column key_id drop not null;
alter table provider_credentials alter column wrapped_dek drop not null;
alter table provider_credentials alter column nonce drop not null;
alter table provider_credentials alter column ciphertext drop not null;
