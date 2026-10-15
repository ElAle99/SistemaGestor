-- Administrative CLI only, transactionally applied after v1/v2.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sistema_gestor_app') THEN
    CREATE ROLE sistema_gestor_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sistema_gestor_app' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Unsafe runtime role';
  END IF;
END $$;
DO $$ DECLARE parent TEXT; BEGIN
  FOR parent IN SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='sistema_gestor_app') LOOP
    EXECUTE format('REVOKE %I FROM sistema_gestor_app',parent);
  END LOOP;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sistema_gestor_app',current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',current_database());
END $$;
GRANT sistema_gestor_tenant TO sistema_gestor_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sistema_gestor_app;

-- Keep deleted order identities without deleting the two existing historical audit rows.
CREATE TABLE orden_identidades(id INTEGER PRIMARY KEY, negocio_id BIGINT NOT NULL REFERENCES negocios(id), UNIQUE(id,negocio_id));
INSERT INTO orden_identidades SELECT id,negocio_id FROM ordenes_servicio;
INSERT INTO orden_identidades SELECT DISTINCT orden_id,negocio_id FROM auditoria_ordenes ON CONFLICT(id) DO NOTHING;
ALTER TABLE orden_identidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_identidades FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON orden_identidades TO sistema_gestor_tenant USING(negocio_id=app_tenant_id()) WITH CHECK(negocio_id=app_tenant_id());
GRANT SELECT ON orden_identidades TO sistema_gestor_tenant;
CREATE FUNCTION preserve_order_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
  INSERT INTO public.orden_identidades(id,negocio_id) VALUES(NEW.id,NEW.negocio_id) ON CONFLICT(id) DO NOTHING; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_order_identity() FROM PUBLIC;
CREATE TRIGGER preserve_order_identity AFTER INSERT ON ordenes_servicio FOR EACH ROW EXECUTE FUNCTION preserve_order_identity();
ALTER TABLE ordenes_servicio ADD CONSTRAINT order_identity_scope FOREIGN KEY(id,negocio_id) REFERENCES orden_identidades(id,negocio_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE auditoria_ordenes ADD CONSTRAINT audit_order_scope FOREIGN KEY(orden_id,negocio_id) REFERENCES orden_identidades(id,negocio_id);
ALTER TABLE auditoria_ordenes ADD CONSTRAINT audit_actor_scope FOREIGN KEY(usuario_id,negocio_id) REFERENCES usuarios(id,negocio_id);

-- Declarative catalog references support shared (scope 0) or the child's own tenant.
DO $$ DECLARE t TEXT; link RECORD; BEGIN
  FOREACH t IN ARRAY ARRAY['tipos_equipo','marcas','modelos_equipo','fallas_catalogo','reparaciones_catalogo','falla_reparaciones'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_scope BIGINT GENERATED ALWAYS AS (COALESCE(negocio_id,0)) STORED',t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE(id,tenant_scope)',t,t||'_reference_scope');
  END LOOP;
  FOR link IN SELECT * FROM (VALUES
    ('marcas','tipo_equipo_id','tipos_equipo','tipo_equipo_scope'),
    ('modelos_equipo','marca_id','marcas','marca_scope'),
    ('fallas_catalogo','tipo_equipo_id','tipos_equipo','tipo_equipo_scope'),
    ('reparaciones_catalogo','tipo_equipo_id','tipos_equipo','tipo_equipo_scope'),
    ('falla_reparaciones','falla_id','fallas_catalogo','falla_scope'),
    ('falla_reparaciones','reparacion_id','reparaciones_catalogo','reparacion_scope')
  ) AS x(child,col,parent,scope) LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN %I BIGINT NOT NULL DEFAULT 0',link.child,link.scope);
    EXECUTE format('UPDATE %I c SET %I=p.tenant_scope FROM %I p WHERE c.%I=p.id',link.child,link.scope,link.parent,link.col);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I=0 OR %I=negocio_id AND negocio_id IS NOT NULL)',link.child,link.child||'_'||link.scope||'_own',link.scope,link.scope);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(%I,%I) REFERENCES %I(id,tenant_scope)',link.child,link.child||'_'||link.scope||'_fk',link.col,link.scope,link.parent);
  END LOOP;
END $$;

CREATE TABLE archivos(id BIGSERIAL PRIMARY KEY, negocio_id BIGINT NOT NULL REFERENCES negocios(id), url TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL UNIQUE CHECK(filename ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$'), publico BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(url,negocio_id), CHECK(url='/uploads/'||filename));
ALTER TABLE archivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE archivos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON archivos TO sistema_gestor_tenant USING(negocio_id=app_tenant_id()) WITH CHECK(negocio_id=app_tenant_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON archivos TO sistema_gestor_tenant;
GRANT USAGE,SELECT ON SEQUENCE archivos_id_seq TO sistema_gestor_tenant;
-- Existing disk URLs only; inline images stay untouched. Conflicting ownership aborts the migration.
INSERT INTO archivos(negocio_id,url,filename,publico)
SELECT negocio_id,url,substring(url from 10),false FROM (
 SELECT negocio_id,url_imagen url FROM evidencias_orden UNION
 SELECT negocio_id,url_imagen FROM fotos_garantia UNION
 SELECT negocio_id,foto_url FROM inventario UNION
 SELECT negocio_id,fotografia FROM inventario
) refs WHERE url ~ '^/uploads/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$';
INSERT INTO archivos(negocio_id,url,filename,publico)
SELECT negocio_id,url,substring(url from 10),true FROM negocio_logos WHERE url ~ '^/uploads/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$'
ON CONFLICT(url) DO NOTHING;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['evidencias_orden','fotos_garantia'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN archivo_url TEXT GENERATED ALWAYS AS (CASE WHEN url_imagen LIKE ''/uploads/%%'' THEN url_imagen END) STORED',t);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(archivo_url,negocio_id) REFERENCES archivos(url,negocio_id)',t,t||'_file_scope');
 END LOOP;
END $$;
ALTER TABLE negocio_logos ADD CONSTRAINT logo_file_scope FOREIGN KEY(url,negocio_id) REFERENCES archivos(url,negocio_id);
ALTER TABLE inventario ADD COLUMN archivo_foto TEXT GENERATED ALWAYS AS(CASE WHEN foto_url LIKE '/uploads/%' THEN foto_url END) STORED;
ALTER TABLE inventario ADD CONSTRAINT inventory_file_scope FOREIGN KEY(archivo_foto,negocio_id) REFERENCES archivos(url,negocio_id);

-- Narrow authentication capabilities; no runtime connection uses an administrative login.
CREATE FUNCTION auth_user_by_id(actor INTEGER) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',id,'username',username,'rol',rol,'activo',activo,'session_version',session_version,'negocio_id',negocio_id,'tiene_negocio',true)
 FROM public.usuarios WHERE id=actor;
$$;
CREATE FUNCTION auth_user_by_username(login TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',id,'username',username,'password',password,'rol',rol,'activo',activo,'session_version',session_version,'negocio_id',negocio_id,'nombre',nombre,'correo',correo,'telefono',telefono)
 FROM public.usuarios WHERE lower(username)=lower(login) AND activo=true LIMIT 1;
$$;
CREATE FUNCTION auth_user_by_email(email TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',id,'negocio_id',negocio_id,'nombre',nombre,'correo',correo) FROM public.usuarios WHERE lower(correo)=lower(email) AND activo=true LIMIT 1;
$$;
CREATE FUNCTION auth_reset_identity(hash TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',p.id,'usuario_id',p.usuario_id,'negocio_id',p.negocio_id) FROM public.password_reset_tokens p JOIN public.usuarios u ON u.id=p.usuario_id AND u.negocio_id=p.negocio_id
 WHERE token_hash=hash AND used_at IS NULL AND expires_at>now() AND u.activo=true LIMIT 1;
$$;
CREATE FUNCTION runtime_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_migraciones WHERE version='20261014-v3'); $$;
CREATE FUNCTION is_legacy_business(tenant BIGINT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_migraciones WHERE version='20261013-v1' AND negocio_legacy=tenant); $$;
CREATE FUNCTION public_logo(file_url TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.archivos a JOIN public.negocio_logos l ON l.url=a.url AND l.negocio_id=a.negocio_id WHERE a.url=file_url AND a.publico=true);
$$;
DO $$ DECLARE fn REGPROCEDURE; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('auth_user_by_id','auth_user_by_username','auth_user_by_email','auth_reset_identity','runtime_schema_ready','is_legacy_business','public_logo') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sistema_gestor_app',fn);
 END LOOP;
END $$;
INSERT INTO tenant_migraciones(version) VALUES('20261014-v3');
