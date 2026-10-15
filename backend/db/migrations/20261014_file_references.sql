CREATE FUNCTION canonical_upload_url(value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT substring(value from '(/uploads/[A-Za-z0-9_-]+[.][A-Za-z0-9]+)([?].*)?$');
$$;
CREATE FUNCTION upload_references(value TEXT) RETURNS TABLE(url TEXT) LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$ DECLARE item TEXT; data JSONB; BEGIN
 BEGIN data:=value::jsonb; EXCEPTION WHEN invalid_text_representation THEN data:=jsonb_build_array(value); END;
 IF jsonb_typeof(data)<>'array' THEN RETURN; END IF;
 FOR item IN SELECT jsonb_array_elements_text(data) LOOP url:=public.canonical_upload_url(item); IF url IS NOT NULL THEN RETURN NEXT; END IF; END LOOP;
END $$;
INSERT INTO archivos(negocio_id,url,filename)
SELECT DISTINCT negocio_id,url,substring(url from 10) FROM (
 SELECT o.negocio_id,r.url FROM ordenes_servicio o CROSS JOIN LATERAL upload_references(o.fotografias) r UNION
 SELECT c.negocio_id,r.url FROM cotizaciones c CROSS JOIN LATERAL upload_references(c.fotografias) r
) refs WHERE NOT EXISTS(SELECT 1 FROM archivos a WHERE a.url=refs.url);
ALTER TABLE configuracion ADD COLUMN archivo_logo TEXT GENERATED ALWAYS AS(canonical_upload_url(logo_url)) STORED;
ALTER TABLE configuracion ADD COLUMN archivo_logo_ticket TEXT GENERATED ALWAYS AS(canonical_upload_url(logo_ticket_url)) STORED;
ALTER TABLE configuracion ADD CONSTRAINT config_logo_scope FOREIGN KEY(archivo_logo,negocio_id) REFERENCES archivos(url,negocio_id);
ALTER TABLE configuracion ADD CONSTRAINT config_ticket_logo_scope FOREIGN KEY(archivo_logo_ticket,negocio_id) REFERENCES archivos(url,negocio_id);
ALTER TABLE inventario ADD COLUMN archivo_fotografia TEXT GENERATED ALWAYS AS(canonical_upload_url(fotografia)) STORED;
ALTER TABLE inventario ADD CONSTRAINT inventory_photo_scope FOREIGN KEY(archivo_fotografia,negocio_id) REFERENCES archivos(url,negocio_id);
CREATE TABLE documento_archivos(id BIGSERIAL PRIMARY KEY,negocio_id BIGINT NOT NULL REFERENCES negocios(id),orden_id INTEGER,cotizacion_id INTEGER,url TEXT NOT NULL,
 CHECK(num_nonnulls(orden_id,cotizacion_id)=1),
 FOREIGN KEY(orden_id,negocio_id) REFERENCES ordenes_servicio(id,negocio_id) ON DELETE CASCADE,
 FOREIGN KEY(cotizacion_id,negocio_id) REFERENCES cotizaciones(id,negocio_id) ON DELETE CASCADE,
 FOREIGN KEY(url,negocio_id) REFERENCES archivos(url,negocio_id));
ALTER TABLE documento_archivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_archivos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON documento_archivos TO sistema_gestor_tenant USING(negocio_id=app_tenant_id()) WITH CHECK(negocio_id=app_tenant_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON documento_archivos TO sistema_gestor_tenant;
GRANT USAGE,SELECT ON SEQUENCE documento_archivos_id_seq TO sistema_gestor_tenant;
INSERT INTO documento_archivos(negocio_id,orden_id,url) SELECT o.negocio_id,o.id,r.url FROM ordenes_servicio o CROSS JOIN LATERAL upload_references(o.fotografias) r;
INSERT INTO documento_archivos(negocio_id,cotizacion_id,url) SELECT c.negocio_id,c.id,r.url FROM cotizaciones c CROSS JOIN LATERAL upload_references(c.fotografias) r;
-- JSON arrays cannot themselves participate in an FK. This trigger only normalizes
-- references; declarative tenant-composite FKs above enforce ownership.
CREATE FUNCTION sync_document_files() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_TABLE_NAME='ordenes_servicio' THEN
  DELETE FROM public.documento_archivos WHERE orden_id=NEW.id AND negocio_id=NEW.negocio_id;
  INSERT INTO public.documento_archivos(negocio_id,orden_id,url) SELECT NEW.negocio_id,NEW.id,url FROM public.upload_references(NEW.fotografias);
 ELSE
  DELETE FROM public.documento_archivos WHERE cotizacion_id=NEW.id AND negocio_id=NEW.negocio_id;
  INSERT INTO public.documento_archivos(negocio_id,cotizacion_id,url) SELECT NEW.negocio_id,NEW.id,url FROM public.upload_references(NEW.fotografias);
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER sync_document_files AFTER INSERT OR UPDATE OF fotografias,negocio_id ON ordenes_servicio FOR EACH ROW EXECUTE FUNCTION sync_document_files();
CREATE TRIGGER sync_document_files AFTER INSERT OR UPDATE OF fotografias,negocio_id ON cotizaciones FOR EACH ROW EXECUTE FUNCTION sync_document_files();
CREATE OR REPLACE FUNCTION public_logo(file_url TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.archivos a JOIN public.negocio_logos l ON l.url=a.url AND l.negocio_id=a.negocio_id
 WHERE a.url=file_url AND a.publico=true
 AND NOT EXISTS(SELECT 1 FROM public.evidencias_orden e WHERE e.archivo_url=a.url)
 AND NOT EXISTS(SELECT 1 FROM public.fotos_garantia f WHERE f.archivo_url=a.url)
 AND NOT EXISTS(SELECT 1 FROM public.documento_archivos d WHERE d.url=a.url));
$$;
INSERT INTO tenant_migraciones(version) VALUES('20261014-v5');
