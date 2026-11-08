-- Migration 20261107_android_offline_v1. Run only after explicit operator approval.
-- Repeatable; the CLI wraps all DDL and grants in a single transaction.
-- No ALTER/DML against existing business tables or existing tenant policies.
CREATE TABLE IF NOT EXISTS public.android_sync_receipts (
 negocio_id integer NOT NULL DEFAULT app_tenant_id(),
 usuario_id integer NOT NULL,
 operation_id uuid NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (negocio_id, usuario_id, operation_id)
);
ALTER TABLE public.android_sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.android_sync_receipts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.android_sync_receipts'::regclass AND polname='android_receipts_tenant') THEN
  CREATE POLICY android_receipts_tenant ON public.android_sync_receipts
   USING (negocio_id=app_tenant_id()) WITH CHECK (negocio_id=app_tenant_id());
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.android_refresh_sessions (
 negocio_id integer NOT NULL DEFAULT app_tenant_id(),
 usuario_id integer NOT NULL,
 token_hash text NOT NULL,
 family uuid NOT NULL,
 session_version integer NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed boolean NOT NULL DEFAULT false,
 revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY (negocio_id,token_hash)
);
ALTER TABLE public.android_refresh_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.android_refresh_sessions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.android_refresh_sessions'::regclass AND polname='android_refresh_tenant') THEN
  CREATE POLICY android_refresh_tenant ON public.android_refresh_sessions
   USING (negocio_id=app_tenant_id()) WITH CHECK (negocio_id=app_tenant_id());
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS android_refresh_family_idx ON public.android_refresh_sessions(negocio_id,family);
CREATE INDEX IF NOT EXISTS android_refresh_expiry_idx ON public.android_refresh_sessions(expires_at);
-- Receipts are deliberately retained: deleting one could duplicate an old retry.
REVOKE ALL ON public.android_sync_receipts, public.android_refresh_sessions FROM PUBLIC;
