-- Keep the existing one-open-cash-register rule, independently for each business.
DROP INDEX cajas_unica_abierta_idx;
CREATE UNIQUE INDEX cajas_unica_abierta_idx ON cajas(negocio_id) WHERE estado='abierta';
-- Product codes belong to a business; identical SKUs in different businesses are valid.
ALTER TABLE inventario DROP CONSTRAINT inventario_codigo_key;
CREATE UNIQUE INDEX inventario_codigo_key ON inventario(negocio_id,codigo);
INSERT INTO tenant_migraciones(version) VALUES('20261013-v2');
