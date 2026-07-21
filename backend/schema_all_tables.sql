-- Esquema actual del SistemaGestor para PostgreSQL
-- Archivo: backend/schema_all_tables.sql
-- Generado desde la base activa y backend/config/db.js

BEGIN;

-- Limpieza de estructuras retiradas en versiones anteriores.
DROP TABLE IF EXISTS fotos_orden CASCADE;
DROP TABLE IF EXISTS ordenes CASCADE;
DROP TABLE IF EXISTS equipos CASCADE;
DROP TABLE IF EXISTS detalle_ventas CASCADE;
DROP TABLE IF EXISTS eventos CASCADE;

DO $$
DECLARE
  removed_public_module TEXT := 'chat' || 'bot';
BEGIN
  EXECUTE format('DROP INDEX IF EXISTS %I', 'ordenes_servicio_' || removed_public_module || '_estado_idx');
  EXECUTE format('DROP INDEX IF EXISTS %I', 'ordenes_servicio_' || removed_public_module || '_equipo_idx');
  EXECUTE format('DROP INDEX IF EXISTS %I', 'orden_refacciones_' || removed_public_module || '_orden_idx');
  EXECUTE format('DROP INDEX IF EXISTS %I', 'inventario_' || removed_public_module || '_activo_idx');
  EXECUTE format('DROP INDEX IF EXISTS %I', removed_public_module || '_presupuesto_consultas_fecha_idx');
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', removed_public_module || '_presupuesto_consultas');
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', removed_public_module || '_presupuesto_config');
END $$;

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT true,
  eliminado BOOLEAN NOT NULL DEFAULT false,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT usuarios_rol_check CHECK (rol IN ('Administrador', 'TÃ©cnico', 'Recepcionista'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  telefono_principal VARCHAR(20),
  telefono_alternativo_1 VARCHAR(20),
  telefono_alternativo_2 VARCHAR(20),
  telefono_alternativo_3 VARCHAR(20),
  correo VARCHAR(100),
  direccion TEXT,
  notas TEXT,
  activo BOOLEAN DEFAULT true,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  apellido_paterno VARCHAR(100),
  apellido_materno VARCHAR(100),
  contacto_preferido VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS ordenes_servicio (
  id SERIAL PRIMARY KEY,
  folio VARCHAR(20) UNIQUE NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tecnico_id INTEGER REFERENCES usuarios(id),
  usuario_creador_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo_equipo VARCHAR(50),
  marca VARCHAR(100),
  modelo VARCHAR(100),
  imei1 VARCHAR(20),
  imei2 VARCHAR(20),
  serie VARCHAR(100),
  color VARCHAR(50),
  pin VARCHAR(100),
  password VARCHAR(100),
  patron VARCHAR(100),
  falla_reportada TEXT,
  descripcion_falla TEXT,
  pantalla_rota BOOLEAN DEFAULT false,
  camara_danada BOOLEAN DEFAULT false,
  tapa_rota BOOLEAN DEFAULT false,
  marco_golpeado BOOLEAN DEFAULT false,
  humedad BOOLEAN DEFAULT false,
  pantalla_manchada BOOLEAN DEFAULT false,
  botones_danados BOOLEAN DEFAULT false,
  puerto_danado BOOLEAN DEFAULT false,
  otros_insp TEXT,
  accesorios_sim BOOLEAN DEFAULT false,
  accesorios_memoria BOOLEAN DEFAULT false,
  accesorios_funda BOOLEAN DEFAULT false,
  accesorios_cargador BOOLEAN DEFAULT false,
  accesorios_cable BOOLEAN DEFAULT false,
  accesorios_caja BOOLEAN DEFAULT false,
  accesorios_otros TEXT,
  anticipo NUMERIC(10,2) DEFAULT 0,
  costo_estimado NUMERIC(10,2) DEFAULT 0,
  costo_refaccion NUMERIC(10,2) DEFAULT 0,
  costo_final NUMERIC(10,2) DEFAULT 0,
  costo_real NUMERIC(10,2) DEFAULT 0,
  fotografias TEXT,
  firma TEXT,
  firma_imagen TEXT,
  lock_type VARCHAR(20) DEFAULT 'Ninguno',
  lock_pin VARCHAR(20),
  lock_pass VARCHAR(100),
  lock_pattern VARCHAR(20),
  sec_android TEXT,
  sec_patch TEXT,
  sec_imei_orig TEXT,
  sec_imei_mod TEXT,
  estado VARCHAR(30) DEFAULT 'Recibido',
  status_reason TEXT,
  fecha_entrega_estimada TEXT,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  estado_pago VARCHAR(20) DEFAULT 'Pendiente',
  fecha_entrega_real TIMESTAMP,
  pagado_en TIMESTAMP,
  descripcion_equipo TEXT,
  servicio_solicitado TEXT,
  tipo_orden VARCHAR(80) DEFAULT 'ReparaciÃ³n directa',
  pendiente_presupuesto BOOLEAN DEFAULT false,
  pantalla_rayada BOOLEAN DEFAULT false,
  tapa_rayada BOOLEAN DEFAULT false,
  lente_camara_roto BOOLEAN DEFAULT false,
  no_enciende BOOLEAN DEFAULT false,
  equipo_doblado BOOLEAN DEFAULT false,
  tornillos_faltantes BOOLEAN DEFAULT false,
  accesorios_templado BOOLEAN DEFAULT false,
  mano_obra NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS historial_estados (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER NOT NULL REFERENCES ordenes_servicio(id),
  estado VARCHAR(30) NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  comentario TEXT,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidencias_orden (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  historial_estado_id INTEGER REFERENCES historial_estados(id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre_estado VARCHAR(50) NOT NULL DEFAULT 'Recibido',
  url_imagen TEXT NOT NULL,
  tipo_evidencia VARCHAR(50) DEFAULT 'foto',
  comentario TEXT,
  visible_cliente BOOLEAN DEFAULT true,
  fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventario (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE,
  codigo_barras VARCHAR(100),
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  categoria VARCHAR(100),
  costo NUMERIC(10,2) DEFAULT 0,
  precio NUMERIC(10,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  stock_minimo INTEGER DEFAULT 0,
  fotografia TEXT,
  foto_url TEXT,
  activo BOOLEAN DEFAULT true,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orden_refacciones (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES inventario(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (orden_id, producto_id)
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES inventario(id),
  orden_id INTEGER REFERENCES ordenes_servicio(id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo VARCHAR(50) NOT NULL,
  cantidad INTEGER NOT NULL,
  stock_anterior INTEGER NOT NULL DEFAULT 0,
  stock_nuevo INTEGER NOT NULL DEFAULT 0,
  motivo TEXT,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  metodo_pago VARCHAR(50),
  total NUMERIC(10,2) NOT NULL,
  monto_recibido NUMERIC(10,2) DEFAULT 0,
  cambio NUMERIC(10,2) DEFAULT 0,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subtotal NUMERIC(10,2) DEFAULT 0,
  descuento NUMERIC(10,2) DEFAULT 0,
  efectivo_recibido NUMERIC(10,2) DEFAULT 0,
  transferencia_recibida NUMERIC(10,2) DEFAULT 0,
  referencia_transferencia TEXT,
  observaciones_ticket TEXT
);

CREATE TABLE IF NOT EXISTS ventas_detalle (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  producto_id INTEGER REFERENCES inventario(id),
  cantidad INTEGER NOT NULL,
  precio_unitario NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  nombre TEXT,
  descripcion TEXT,
  tipo_item VARCHAR(30) DEFAULT 'producto',
  orden_id INTEGER REFERENCES ordenes_servicio(id)
);

CREATE TABLE IF NOT EXISTS cajas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre TIMESTAMP,
  monto_inicial NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_esperado NUMERIC(10,2) DEFAULT 0,
  monto_contado NUMERIC(10,2),
  diferencia NUMERIC(10,2),
  estado VARCHAR(20) NOT NULL DEFAULT 'abierta',
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id SERIAL PRIMARY KEY,
  caja_id INTEGER NOT NULL REFERENCES cajas(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id),
  tipo_movimiento VARCHAR(40) NOT NULL,
  metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo',
  monto NUMERIC(10,2) NOT NULL,
  descripcion TEXT,
  referencia_tipo VARCHAR(50),
  referencia_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  telefono VARCHAR(20) NOT NULL,
  equipo VARCHAR(100),
  marca VARCHAR(100),
  modelo VARCHAR(100),
  problema TEXT,
  fotografias TEXT,
  estado VARCHAR(20) DEFAULT 'Pendiente',
  orden_id INTEGER REFERENCES ordenes_servicio(id),
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  correo VARCHAR(100),
  preferred_contact VARCHAR(30),
  observaciones TEXT,
  observaciones_internas TEXT
);

CREATE TABLE IF NOT EXISTS eventos_calendario (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  fecha_inicio TIMESTAMP NOT NULL,
  fecha_fin TIMESTAMP NOT NULL,
  tipo_evento VARCHAR(50),
  orden_id INTEGER REFERENCES ordenes_servicio(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  color VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS configuracion (
  id INTEGER PRIMARY KEY DEFAULT 1,
  nombre VARCHAR(200),
  direccion TEXT,
  telefono VARCHAR(20),
  whatsapp VARCHAR(20),
  redes_sociales TEXT,
  terminos_legales TEXT,
  impresora_ticket VARCHAR(200),
  papel_ticket VARCHAR(10) DEFAULT '80mm',
  auto_imprimir_ticket BOOLEAN DEFAULT true,
  logo_url TEXT,
  logo_ticket_url TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS cajas_unica_abierta_idx
  ON cajas ((estado))
  WHERE estado = 'abierta';

CREATE INDEX IF NOT EXISTS caja_movimientos_caja_idx
  ON caja_movimientos (caja_id, created_at);

CREATE INDEX IF NOT EXISTS caja_movimientos_referencia_idx
  ON caja_movimientos (referencia_tipo, referencia_id);

CREATE UNIQUE INDEX IF NOT EXISTS orden_refacciones_orden_producto_idx
  ON orden_refacciones (orden_id, producto_id);

INSERT INTO configuracion (id, nombre)
VALUES (1, 'AllFix Bacalar')
ON CONFLICT (id) DO NOTHING;

COMMIT;
