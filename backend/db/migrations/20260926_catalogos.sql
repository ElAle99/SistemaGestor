-- Additive catalog schema; no changes to historic orders or customers.
CREATE TABLE IF NOT EXISTS tipos_equipo (
  id SERIAL PRIMARY KEY, negocio_id BIGINT, nombre VARCHAR(50) NOT NULL,
  clave TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true,
  CHECK (negocio_id IS NULL OR negocio_id > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS tipos_equipo_scope_key ON tipos_equipo (COALESCE(negocio_id, 0), clave);
CREATE TABLE IF NOT EXISTS marcas (
  id SERIAL PRIMARY KEY, negocio_id BIGINT, tipo_equipo_id INTEGER NOT NULL REFERENCES tipos_equipo(id),
  nombre VARCHAR(100) NOT NULL, clave TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true,
  CHECK (negocio_id IS NULL OR negocio_id > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS marcas_scope_key ON marcas (COALESCE(negocio_id, 0), tipo_equipo_id, clave);
CREATE TABLE IF NOT EXISTS modelos_equipo (
  id SERIAL PRIMARY KEY, negocio_id BIGINT, marca_id INTEGER NOT NULL REFERENCES marcas(id),
  nombre VARCHAR(100) NOT NULL, clave TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true,
  CHECK (negocio_id IS NULL OR negocio_id > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS modelos_scope_key ON modelos_equipo (COALESCE(negocio_id, 0), marca_id, clave);
CREATE TABLE IF NOT EXISTS fallas_catalogo (
  id SERIAL PRIMARY KEY, negocio_id BIGINT, tipo_equipo_id INTEGER NOT NULL REFERENCES tipos_equipo(id),
  nombre VARCHAR(250) NOT NULL, clave TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true,
  CHECK (negocio_id IS NULL OR negocio_id > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS fallas_scope_key ON fallas_catalogo (COALESCE(negocio_id, 0), tipo_equipo_id, clave);
CREATE TABLE IF NOT EXISTS reparaciones_catalogo (
  id SERIAL PRIMARY KEY, negocio_id BIGINT, tipo_equipo_id INTEGER NOT NULL REFERENCES tipos_equipo(id),
  nombre VARCHAR(250) NOT NULL, clave TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true,
  CHECK (negocio_id IS NULL OR negocio_id > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS reparaciones_scope_key ON reparaciones_catalogo (COALESCE(negocio_id, 0), tipo_equipo_id, clave);
CREATE TABLE IF NOT EXISTS falla_reparaciones (
  id SERIAL PRIMARY KEY, negocio_id BIGINT,
  falla_id INTEGER NOT NULL REFERENCES fallas_catalogo(id),
  reparacion_id INTEGER NOT NULL REFERENCES reparaciones_catalogo(id),
  CHECK (negocio_id IS NULL OR negocio_id > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS falla_reparaciones_scope_key ON falla_reparaciones (COALESCE(negocio_id, 0), falla_id, reparacion_id);
CREATE TABLE IF NOT EXISTS catalogo_migraciones (version TEXT PRIMARY KEY, fecha TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
