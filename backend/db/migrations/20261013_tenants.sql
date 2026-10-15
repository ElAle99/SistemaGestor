-- Executed inside one transaction + advisory lock by initTenancy. No existing values are deleted.
CREATE TABLE IF NOT EXISTS tenant_migraciones (version TEXT PRIMARY KEY, negocio_legacy BIGINT, configuracion_antes JSONB, aplicada_en TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS negocios (id BIGSERIAL PRIMARY KEY, nombre TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true, creado_en TIMESTAMPTZ DEFAULT now());
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS BIGINT LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.negocio_id', true), '')::BIGINT $$;
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS negocio_id BIGINT;
DO $$
DECLARE legacy BIGINT; old_config RECORD; candidates BIGINT[]; matched BIGINT[]; t TEXT;
BEGIN
  SELECT * INTO STRICT old_config FROM configuracion WHERE id = 1;
  SELECT array_agg(DISTINCT negocio_id) INTO candidates FROM (
    SELECT negocio_id FROM tipos_equipo UNION ALL SELECT negocio_id FROM marcas UNION ALL SELECT negocio_id FROM fallas_catalogo UNION ALL SELECT negocio_id FROM reparaciones_catalogo
  ) scopes WHERE negocio_id IS NOT NULL;
  SELECT array_agg(id) INTO matched FROM negocios WHERE lower(trim(nombre)) = lower(trim(old_config.nombre));
  IF cardinality(matched) > 1 THEN RAISE EXCEPTION 'Negocio legado ambiguo; no se migraron datos'; END IF;
  legacy := COALESCE(old_config.negocio_id, matched[1]);
  IF legacy IS NULL THEN
    IF cardinality(candidates) > 1 THEN RAISE EXCEPTION 'Hay varios scopes sin negocio; se necesita asociación explícita'; END IF;
    legacy := COALESCE(candidates[1], (SELECT COALESCE(max(id), 0) + 1 FROM negocios));
    INSERT INTO negocios(id, nombre) VALUES (legacy, old_config.nombre);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM negocios WHERE id = legacy) THEN RAISE EXCEPTION 'El negocio legado no existe'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(candidates) scope WHERE NOT EXISTS (SELECT 1 FROM negocios WHERE id = scope)) THEN RAISE EXCEPTION 'Hay scopes de catálogo huérfanos'; END IF;
  INSERT INTO tenant_migraciones(version, negocio_legacy, configuracion_antes) VALUES ('20261013-v1', legacy, to_jsonb(old_config) - 'negocio_id');
  UPDATE configuracion SET negocio_id = legacy WHERE id = old_config.id AND negocio_id IS NULL;
  FOREACH t IN ARRAY ARRAY['usuarios','clientes','ordenes_servicio','historial_estados','evidencias_orden','auditoria_ordenes','inventario','orden_refacciones','orden_reparaciones_adicionales','movimientos_inventario','ventas','ventas_detalle','cajas','caja_movimientos','cotizaciones','eventos_calendario','garantias','ingresos_garantia','historial_garantias','fotos_garantia','costos_garantia','password_reset_tokens','configuracion_sistema'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS negocio_id BIGINT', t);
    EXECUTE format('UPDATE %I SET negocio_id = $1 WHERE negocio_id IS NULL', t) USING legacy;
  END LOOP;
END $$;
SELECT setval(pg_get_serial_sequence('negocios','id'), (SELECT max(id) FROM negocios));
CREATE SEQUENCE IF NOT EXISTS configuracion_tenant_id_seq;
SELECT setval('configuracion_tenant_id_seq', (SELECT max(id) FROM configuracion));
ALTER TABLE configuracion ALTER COLUMN id SET DEFAULT nextval('configuracion_tenant_id_seq');
CREATE UNIQUE INDEX configuracion_negocio_unique ON configuracion(negocio_id);
-- System preferences are now independently keyed per business, not a shared global setting.
ALTER TABLE configuracion_sistema DROP CONSTRAINT configuracion_sistema_pkey;
ALTER TABLE configuracion_sistema ADD PRIMARY KEY (clave, negocio_id);

DO $$
DECLARE t TEXT; fk RECORD; child_column TEXT; parent_column TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sistema_gestor_tenant') THEN CREATE ROLE sistema_gestor_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sistema_gestor_tenant' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'El rol tenant tiene privilegios inseguros'; END IF;
  EXECUTE format('GRANT sistema_gestor_tenant TO %I', current_user);
  FOREACH t IN ARRAY ARRAY['configuracion','usuarios','clientes','ordenes_servicio','historial_estados','evidencias_orden','auditoria_ordenes','inventario','orden_refacciones','orden_reparaciones_adicionales','movimientos_inventario','ventas','ventas_detalle','cajas','caja_movimientos','cotizaciones','eventos_calendario','garantias','ingresos_garantia','historial_garantias','fotos_garantia','costos_garantia','password_reset_tokens','configuracion_sistema'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN negocio_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN negocio_id SET DEFAULT app_tenant_id()', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(negocio_id) REFERENCES negocios(id)', t, t||'_negocio_fk');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I TO sistema_gestor_tenant USING (negocio_id = app_tenant_id()) WITH CHECK (negocio_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sistema_gestor_tenant', t);
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=t AND table_schema='public' AND column_name='id') THEN
      EXECUTE format('CREATE UNIQUE INDEX %I ON %I(id, negocio_id)', t||'_id_negocio_unique', t);
    END IF;
  END LOOP;
  -- A tenant may not attach an order, sale or movement to a foreign tenant's row.
  FOR fk IN SELECT c.*, cl.relname AS child, pa.relname AS parent FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_class pa ON pa.oid=c.confrelid WHERE c.contype='f' AND cardinality(c.conkey)=1 AND cardinality(c.confkey)=1 AND cl.relname NOT IN ('negocios','tenant_migraciones') AND pa.relname NOT IN ('negocios') AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=c.conrelid AND attname='negocio_id') AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=c.confrelid AND attname='negocio_id') LOOP
    SELECT attname INTO child_column FROM pg_attribute WHERE attrelid=fk.conrelid AND attnum=fk.conkey[1];
    SELECT attname INTO parent_column FROM pg_attribute WHERE attrelid=fk.confrelid AND attnum=fk.confkey[1];
    IF parent_column='id' AND child_column<>'negocio_id' AND fk.child NOT IN ('tipos_equipo','marcas','modelos_equipo','fallas_catalogo','reparaciones_catalogo','falla_reparaciones') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, negocio_id) REFERENCES %I(id, negocio_id) DEFERRABLE INITIALLY DEFERRED', fk.child, 'tenant_'||fk.conname, child_column, fk.parent);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['tipos_equipo','marcas','modelos_equipo','fallas_catalogo','reparaciones_catalogo','falla_reparaciones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY catalog_read ON %I FOR SELECT TO sistema_gestor_tenant USING (negocio_id IS NULL OR negocio_id = app_tenant_id())', t);
    EXECUTE format('CREATE POLICY catalog_write ON %I FOR ALL TO sistema_gestor_tenant USING (negocio_id = app_tenant_id()) WITH CHECK (negocio_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sistema_gestor_tenant', t);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO sistema_gestor_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_unique_idx ON usuarios(LOWER(correo)) WHERE correo IS NOT NULL AND TRIM(correo) <> '';
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sistema_gestor_tenant;
ALTER TABLE negocios ENABLE ROW LEVEL SECURITY;
ALTER TABLE negocios FORCE ROW LEVEL SECURITY;
CREATE POLICY negocio_read ON negocios FOR SELECT TO sistema_gestor_tenant USING(id=app_tenant_id());
GRANT SELECT ON negocios TO sistema_gestor_tenant;

CREATE TABLE negocio_logos (url TEXT PRIMARY KEY, negocio_id BIGINT NOT NULL REFERENCES negocios(id));
INSERT INTO negocio_logos(url,negocio_id) SELECT url, negocio_id FROM configuracion CROSS JOIN LATERAL unnest(ARRAY[logo_url,logo_ticket_url]) url WHERE url IS NOT NULL AND trim(url)<>'' ON CONFLICT DO NOTHING;
ALTER TABLE negocio_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE negocio_logos FORCE ROW LEVEL SECURITY;
CREATE POLICY logo_scope ON negocio_logos TO sistema_gestor_tenant USING(negocio_id=app_tenant_id()) WITH CHECK(negocio_id=app_tenant_id());
GRANT SELECT, INSERT ON negocio_logos TO sistema_gestor_tenant;

CREATE OR REPLACE FUNCTION initialize_business_config() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  INSERT INTO configuracion(negocio_id,nombre,direccion,telefono,whatsapp,redes_sociales,terminos_legales,logo_url,logo_ticket_url) VALUES(NEW.id,NEW.nombre,'','','','','','','');
  INSERT INTO configuracion_sistema(negocio_id,clave,valor) VALUES(NEW.id,'allow_user_creation','false');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION initialize_business_config() FROM PUBLIC;
CREATE TRIGGER initialize_business_config AFTER INSERT ON negocios FOR EACH ROW EXECUTE FUNCTION initialize_business_config();

-- Preserve globally unique legacy folios without reading another tenant's orders to allocate one.
CREATE TABLE order_folio_counters(year INTEGER PRIMARY KEY, number BIGINT NOT NULL);
INSERT INTO order_folio_counters(year,number) SELECT split_part(folio,'-',2)::INTEGER,max(split_part(folio,'-',3)::BIGINT) FROM ordenes_servicio WHERE folio ~ '^AFB-[0-9]{4}-[0-9]+$' GROUP BY split_part(folio,'-',2)::INTEGER;
CREATE OR REPLACE FUNCTION allocate_order_folio(folio_year INTEGER) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n BIGINT; BEGIN
  IF app_tenant_id() IS NULL THEN RAISE EXCEPTION 'Se requiere un negocio'; END IF;
  INSERT INTO order_folio_counters(year,number) VALUES(folio_year,10000) ON CONFLICT(year) DO UPDATE SET number=order_folio_counters.number+1 RETURNING number INTO n;
  RETURN 'AFB-'||folio_year||'-'||n;
END $$;
REVOKE ALL ON FUNCTION allocate_order_folio(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_order_folio(INTEGER) TO sistema_gestor_tenant;
CREATE OR REPLACE FUNCTION track_order_folio() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  IF NEW.folio ~ '^AFB-[0-9]{4}-[0-9]+$' THEN
    INSERT INTO order_folio_counters(year,number) VALUES(split_part(NEW.folio,'-',2)::INTEGER,split_part(NEW.folio,'-',3)::BIGINT)
    ON CONFLICT(year) DO UPDATE SET number=GREATEST(order_folio_counters.number,EXCLUDED.number);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION track_order_folio() FROM PUBLIC;
CREATE TRIGGER track_order_folio AFTER INSERT ON ordenes_servicio FOR EACH ROW EXECUTE FUNCTION track_order_folio();
