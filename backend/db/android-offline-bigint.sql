-- Upgrade v1 without deleting rows. Run ONLY through the transactional migration CLI.
-- PostgreSQL cannot change a column type while an RLS policy depends on it.
-- Remove/recreate only the exact original policy while holding ACCESS EXCLUSIVE;
-- ENABLE/FORCE RLS remain set throughout. All changes roll back together on error.
DO $$
DECLARE target record; column_type oid; policy record;
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('android_sync_receipts','android_receipts_tenant'),
  ('android_refresh_sessions','android_refresh_tenant')
 ) AS targets(table_name,policy_name)
 LOOP
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',target.table_name);
  SELECT a.atttypid INTO column_type FROM pg_attribute a
   WHERE a.attrelid=format('public.%I',target.table_name)::regclass
    AND a.attname='negocio_id' AND NOT a.attisdropped;
  IF column_type='bigint'::regtype THEN CONTINUE; END IF;
  IF column_type IS DISTINCT FROM 'integer'::regtype THEN
   RAISE EXCEPTION 'Unexpected offline tenant column type; migration stopped';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid=format('public.%I',target.table_name)::regclass)<>1 THEN
   RAISE EXCEPTION 'Unexpected offline policies; migration stopped';
  END IF;
  SELECT p.*,pg_get_expr(p.polqual,p.polrelid) AS tenant_using,
   pg_get_expr(p.polwithcheck,p.polrelid) AS tenant_check INTO policy
   FROM pg_policy p WHERE p.polrelid=format('public.%I',target.table_name)::regclass
    AND p.polname=target.policy_name;
  IF NOT FOUND OR policy.polcmd<>'*' OR NOT policy.polpermissive
   OR policy.polroles<>ARRAY[0::oid]
   OR regexp_replace(policy.tenant_using,'[()[:space:]]','','g') IS DISTINCT FROM 'negocio_id=app_tenant_id'
   OR regexp_replace(policy.tenant_check,'[()[:space:]]','','g') IS DISTINCT FROM 'negocio_id=app_tenant_id' THEN
   RAISE EXCEPTION 'Unexpected offline policy definition; migration stopped';
  END IF;
  EXECUTE format('DROP POLICY %I ON public.%I',target.policy_name,target.table_name);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN negocio_id TYPE bigint USING negocio_id::bigint',target.table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (negocio_id=app_tenant_id()) WITH CHECK (negocio_id=app_tenant_id())',target.policy_name,target.table_name);
 END LOOP;
END $$;
