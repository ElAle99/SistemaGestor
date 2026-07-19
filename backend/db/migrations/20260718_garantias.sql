CREATE TABLE IF NOT EXISTS garantias (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER NOT NULL REFERENCES ordenes_servicio(id) ON DELETE RESTRICT,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  servicio_cubierto TEXT NOT NULL,
  condiciones TEXT,
  observaciones TEXT,
  duracion_dias INTEGER NOT NULL DEFAULT 0 CHECK (duracion_dias >= 0),
  fecha_inicio DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  fecha_entrega_original TIMESTAMP,
  estado VARCHAR(30) NOT NULL DEFAULT 'Vigente',
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (orden_id)
);

CREATE TABLE IF NOT EXISTS ingresos_garantia (
  id SERIAL PRIMARY KEY,
  garantia_id INTEGER NOT NULL REFERENCES garantias(id) ON DELETE CASCADE,
  orden_id INTEGER NOT NULL REFERENCES ordenes_servicio(id) ON DELETE RESTRICT,
  fecha_ingreso DATE NOT NULL DEFAULT CURRENT_DATE,
  falla_reportada TEXT NOT NULL,
  diagnostico_tecnico TEXT,
  accesorios_recibidos TEXT,
  observaciones TEXT,
  tecnico_responsable_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  estado_validacion VARCHAR(30) NOT NULL DEFAULT 'Pendiente de revisión',
  motivo_rechazo VARCHAR(80),
  explicacion_rechazo TEXT,
  estado_seguimiento VARCHAR(40) NOT NULL DEFAULT 'En revisión',
  resolucion_final TEXT,
  fecha_entrega_garantia TIMESTAMP,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historial_garantias (
  id SERIAL PRIMARY KEY,
  garantia_id INTEGER NOT NULL REFERENCES garantias(id) ON DELETE CASCADE,
  ingreso_garantia_id INTEGER REFERENCES ingresos_garantia(id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  evento VARCHAR(80) NOT NULL,
  estado_anterior VARCHAR(40),
  estado_nuevo VARCHAR(40),
  comentario TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fotos_garantia (
  id SERIAL PRIMARY KEY,
  garantia_id INTEGER NOT NULL REFERENCES garantias(id) ON DELETE CASCADE,
  ingreso_garantia_id INTEGER REFERENCES ingresos_garantia(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  url_imagen TEXT NOT NULL,
  tipo_evidencia VARCHAR(50) DEFAULT 'foto',
  comentario TEXT,
  fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS costos_garantia (
  id SERIAL PRIMARY KEY,
  garantia_id INTEGER NOT NULL REFERENCES garantias(id) ON DELETE CASCADE,
  ingreso_garantia_id INTEGER REFERENCES ingresos_garantia(id) ON DELETE SET NULL,
  producto_id INTEGER REFERENCES inventario(id) ON DELETE SET NULL,
  tipo_costo VARCHAR(30) NOT NULL DEFAULT 'refaccion',
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  costo_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS garantias_orden_idx ON garantias(orden_id);
CREATE INDEX IF NOT EXISTS garantias_cliente_idx ON garantias(cliente_id);
CREATE INDEX IF NOT EXISTS garantias_estado_idx ON garantias(estado);
CREATE INDEX IF NOT EXISTS garantias_vencimiento_idx ON garantias(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS ingresos_garantia_garantia_idx ON ingresos_garantia(garantia_id, fecha_ingreso DESC);
CREATE INDEX IF NOT EXISTS historial_garantias_garantia_idx ON historial_garantias(garantia_id, fecha DESC);
CREATE INDEX IF NOT EXISTS fotos_garantia_garantia_idx ON fotos_garantia(garantia_id, fecha_subida DESC);
CREATE INDEX IF NOT EXISTS costos_garantia_garantia_idx ON costos_garantia(garantia_id, fecha_creacion DESC);
