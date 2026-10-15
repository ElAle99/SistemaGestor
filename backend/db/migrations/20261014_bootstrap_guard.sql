CREATE FUNCTION setup_initialized() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.usuarios WHERE rol='Administrador' AND activo=true); $$;
REVOKE ALL ON FUNCTION setup_initialized() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION setup_initialized() TO sistema_gestor_app;
CREATE OR REPLACE FUNCTION runtime_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_migraciones WHERE version='20261014-v7'); $$;
INSERT INTO tenant_migraciones(version) VALUES('20261014-v7');
