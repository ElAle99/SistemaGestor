CREATE OR REPLACE FUNCTION auth_user_by_id(actor INTEGER) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',id,'username',username,'rol',rol,'activo',activo,'session_version',session_version,'negocio_id',negocio_id,'tiene_negocio',true)
 FROM public.usuarios WHERE id=actor AND (public.app_tenant_id() IS NULL OR negocio_id=public.app_tenant_id());
$$;
CREATE OR REPLACE FUNCTION auth_user_by_email(email TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',id,'negocio_id',negocio_id,'nombre',nombre,'correo',correo) FROM public.usuarios
 WHERE lower(correo)=lower(email) AND activo=true AND (public.app_tenant_id() IS NULL OR negocio_id=public.app_tenant_id()) LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION auth_reset_identity(hash TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',p.id,'usuario_id',p.usuario_id,'negocio_id',p.negocio_id) FROM public.password_reset_tokens p
 JOIN public.usuarios u ON u.id=p.usuario_id AND u.negocio_id=p.negocio_id WHERE token_hash=hash AND used_at IS NULL AND expires_at>now() AND u.activo=true
 AND (public.app_tenant_id() IS NULL OR p.negocio_id=public.app_tenant_id()) LIMIT 1;
$$;
DROP FUNCTION public_order_status(TEXT);
REVOKE USAGE,SELECT ON SEQUENCE negocios_id_seq FROM sistema_gestor_tenant;
CREATE OR REPLACE FUNCTION runtime_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_migraciones WHERE version='20261014-v6'); $$;
INSERT INTO tenant_migraciones(version) VALUES('20261014-v6');
