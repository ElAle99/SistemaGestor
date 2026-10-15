-- Identity metadata only: no balance, payment, stock or movement value changes.
CREATE TABLE entidad_identidades(tipo TEXT NOT NULL CHECK(tipo IN('orden','venta','caja')),id INTEGER NOT NULL,negocio_id BIGINT NOT NULL REFERENCES negocios(id),
 PRIMARY KEY(tipo,id),UNIQUE(tipo,id,negocio_id));
INSERT INTO entidad_identidades SELECT 'orden',id,negocio_id FROM orden_identidades;
INSERT INTO entidad_identidades SELECT 'venta',id,negocio_id FROM ventas;
INSERT INTO entidad_identidades SELECT 'caja',id,negocio_id FROM cajas;
INSERT INTO entidad_identidades SELECT DISTINCT referencia_tipo,referencia_id,negocio_id FROM caja_movimientos WHERE referencia_id IS NOT NULL AND referencia_tipo IS NOT NULL ON CONFLICT(tipo,id) DO NOTHING;
ALTER TABLE entidad_identidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE entidad_identidades FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON entidad_identidades TO sistema_gestor_tenant USING(negocio_id=app_tenant_id()) WITH CHECK(negocio_id=app_tenant_id());
GRANT SELECT ON entidad_identidades TO sistema_gestor_tenant;
CREATE FUNCTION preserve_financial_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE kind TEXT; BEGIN
 kind:=CASE TG_TABLE_NAME WHEN 'ordenes_servicio' THEN 'orden' WHEN 'ventas' THEN 'venta' WHEN 'cajas' THEN 'caja' END;
 IF kind IS NULL THEN RAISE EXCEPTION 'Invalid identity source'; END IF;
 INSERT INTO public.entidad_identidades(tipo,id,negocio_id) VALUES(kind,NEW.id,NEW.negocio_id) ON CONFLICT(tipo,id) DO NOTHING; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_financial_identity() FROM PUBLIC;
CREATE TRIGGER preserve_financial_identity AFTER INSERT ON ordenes_servicio FOR EACH ROW EXECUTE FUNCTION preserve_financial_identity();
CREATE TRIGGER preserve_financial_identity AFTER INSERT ON ventas FOR EACH ROW EXECUTE FUNCTION preserve_financial_identity();
CREATE TRIGGER preserve_financial_identity AFTER INSERT ON cajas FOR EACH ROW EXECUTE FUNCTION preserve_financial_identity();
ALTER TABLE ventas ADD COLUMN identidad_tipo TEXT GENERATED ALWAYS AS('venta'::TEXT) STORED;
ALTER TABLE cajas ADD COLUMN identidad_tipo TEXT GENERATED ALWAYS AS('caja'::TEXT) STORED;
ALTER TABLE ventas ADD CONSTRAINT sale_identity_scope FOREIGN KEY(identidad_tipo,id,negocio_id) REFERENCES entidad_identidades(tipo,id,negocio_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE cajas ADD CONSTRAINT register_identity_scope FOREIGN KEY(identidad_tipo,id,negocio_id) REFERENCES entidad_identidades(tipo,id,negocio_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE caja_movimientos ADD CONSTRAINT cash_reference_type CHECK(referencia_id IS NULL OR (referencia_tipo IS NOT NULL AND referencia_tipo IN('orden','venta','caja')));
ALTER TABLE caja_movimientos ADD CONSTRAINT cash_reference_scope FOREIGN KEY(referencia_tipo,referencia_id,negocio_id) REFERENCES entidad_identidades(tipo,id,negocio_id);
CREATE OR REPLACE FUNCTION runtime_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_migraciones WHERE version='20261014-v8'); $$;
INSERT INTO tenant_migraciones(version) VALUES('20261014-v8');
