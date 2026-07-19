const { Pool } = require('pg');
require('./env');
const { getPgPoolConfig } = require('./pgConfig');

const pool = new Pool(getPgPoolConfig());

function readBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'require'].includes(String(value).toLowerCase());
}

async function initDB() {
  try {
    await pool.query('SELECT 1');
    console.log('ConexiÃ³n a PostgreSQL exitosa');
  } catch (error) {
    throw new Error('No se pudo conectar a PostgreSQL. Verifica la configuraciÃ³n.');
  }

  const createTables = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      rol VARCHAR(20) NOT NULL CHECK (rol IN ('Administrador', 'TÃ©cnico', 'Recepcionista')),
      nombre VARCHAR(100) NOT NULL,
      activo BOOLEAN DEFAULT true,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(200) NOT NULL,
      apellido_paterno VARCHAR(100),
      apellido_materno VARCHAR(100),
      telefono_principal VARCHAR(20),
      telefono_alternativo_1 VARCHAR(20),
      telefono_alternativo_2 VARCHAR(20),
      telefono_alternativo_3 VARCHAR(20),
      correo VARCHAR(100),
      direccion TEXT,
      contacto_preferido VARCHAR(30),
      notas TEXT,
      activo BOOLEAN DEFAULT true,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      descripcion_equipo TEXT,
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
      pantalla_rayada BOOLEAN DEFAULT false,
      tapa_rayada BOOLEAN DEFAULT false,
      lente_camara_roto BOOLEAN DEFAULT false,
      no_enciende BOOLEAN DEFAULT false,
      equipo_doblado BOOLEAN DEFAULT false,
      tornillos_faltantes BOOLEAN DEFAULT false,
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
      accesorios_templado BOOLEAN DEFAULT false,
      accesorios_otros TEXT,
      servicio_solicitado TEXT,
      tipo_orden VARCHAR(80) DEFAULT 'ReparaciÃ³n directa',
      pendiente_presupuesto BOOLEAN DEFAULT false,
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
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      subtotal NUMERIC(10,2) DEFAULT 0,
      descuento NUMERIC(10,2) DEFAULT 0,
      total NUMERIC(10,2) NOT NULL,
      efectivo_recibido NUMERIC(10,2) DEFAULT 0,
      transferencia_recibida NUMERIC(10,2) DEFAULT 0,
      referencia_transferencia TEXT,
      observaciones_ticket TEXT,
      monto_recibido NUMERIC(10,2) DEFAULT 0,
      cambio NUMERIC(10,2) DEFAULT 0,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ventas_detalle (
      id SERIAL PRIMARY KEY,
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      producto_id INTEGER NOT NULL REFERENCES inventario(id),
      cantidad INTEGER NOT NULL,
      precio_unitario NUMERIC(10,2) NOT NULL,
      subtotal NUMERIC(10,2) NOT NULL DEFAULT 0
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
      correo VARCHAR(100),
      preferred_contact VARCHAR(30),
      equipo VARCHAR(100),
      marca VARCHAR(100),
      modelo VARCHAR(100),
      problema TEXT,
      observaciones TEXT,
      observaciones_internas TEXT,
      fotografias TEXT,
      estado VARCHAR(20) DEFAULT 'Pendiente',
      orden_id INTEGER REFERENCES ordenes_servicio(id),
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS eventos_calendario (
      id SERIAL PRIMARY KEY,
      titulo VARCHAR(200) NOT NULL,
      descripcion TEXT,
      fecha_inicio TIMESTAMP NOT NULL,
      fecha_fin TIMESTAMP NOT NULL,
      tipo_evento VARCHAR(50),
      color VARCHAR(20),
      orden_id INTEGER REFERENCES ordenes_servicio(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS configuracion (
      id INTEGER PRIMARY KEY DEFAULT 1,
      nombre VARCHAR(200),
      direccion TEXT,
      telefono VARCHAR(20),
      whatsapp VARCHAR(20),
      redes_sociales TEXT,
      terminos_legales TEXT,
      logo_url TEXT,
      logo_ticket_url TEXT,
      impresora_ticket VARCHAR(200),
      papel_ticket VARCHAR(10) DEFAULT '80mm',
      auto_imprimir_ticket BOOLEAN DEFAULT true
    );
  `;

  for (const query of createTables.split(';')) {
    if (query.trim()) await pool.query(query);
  }

  if (readBoolean(process.env.DB_RUN_LEGACY_CLEANUP, false)) {
    const removedPublicModuleSlug = ['chat', 'bot'].join('');
    await pool.query(`
      DROP INDEX IF EXISTS ordenes_servicio_${removedPublicModuleSlug}_estado_idx;
      DROP INDEX IF EXISTS ordenes_servicio_${removedPublicModuleSlug}_equipo_idx;
      DROP INDEX IF EXISTS orden_refacciones_${removedPublicModuleSlug}_orden_idx;
      DROP INDEX IF EXISTS inventario_${removedPublicModuleSlug}_activo_idx;
      DROP INDEX IF EXISTS ${removedPublicModuleSlug}_presupuesto_consultas_fecha_idx;
      DROP TABLE IF EXISTS ${removedPublicModuleSlug}_presupuesto_consultas;
      DROP TABLE IF EXISTS ${removedPublicModuleSlug}_presupuesto_config;
    `);
  }

  await pool.query(`
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS falla_reportada TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS descripcion_falla TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS descripcion_equipo TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS servicio_solicitado TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS tipo_orden VARCHAR(80) DEFAULT 'ReparaciÃ³n directa';
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS pendiente_presupuesto BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS pantalla_rayada BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS tapa_rayada BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS lente_camara_roto BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS no_enciende BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS equipo_doblado BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS tornillos_faltantes BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS pantalla_manchada BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS botones_danados BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS puerto_danado BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS accesorios_cable BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS accesorios_templado BOOLEAN DEFAULT false;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS mano_obra NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS costo_real NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS costo_final NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS firma_imagen TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS lock_type VARCHAR(20) DEFAULT 'Ninguno';
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS lock_pin VARCHAR(20);
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS lock_pass VARCHAR(100);
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS lock_pattern VARCHAR(20);
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sec_android TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sec_patch TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sec_imei_orig TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sec_imei_mod TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS status_reason TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS fecha_entrega_estimada TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'Pendiente';
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS fecha_entrega_real TIMESTAMP;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS pagado_en TIMESTAMP;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS monto_recibido NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cambio NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS efectivo_recibido NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS transferencia_recibida NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS referencia_transferencia TEXT;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS observaciones_ticket TEXT;
    ALTER TABLE ventas_detalle ALTER COLUMN producto_id DROP NOT NULL;
    ALTER TABLE ventas_detalle ADD COLUMN IF NOT EXISTS nombre TEXT;
    ALTER TABLE ventas_detalle ADD COLUMN IF NOT EXISTS descripcion TEXT;
    ALTER TABLE ventas_detalle ADD COLUMN IF NOT EXISTS tipo_item VARCHAR(30) DEFAULT 'producto';
    ALTER TABLE ventas_detalle ADD COLUMN IF NOT EXISTS orden_id INTEGER REFERENCES ordenes_servicio(id);
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id);
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMP;
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS monto_inicial NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS total_esperado NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS monto_contado NUMERIC(10,2);
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS diferencia NUMERIC(10,2);
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'abierta';
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS observaciones TEXT;
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE cajas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS caja_id INTEGER REFERENCES cajas(id) ON DELETE CASCADE;
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id);
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS tipo_movimiento VARCHAR(40);
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) DEFAULT 'efectivo';
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS monto NUMERIC(10,2);
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS descripcion TEXT;
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(50);
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS referencia_id INTEGER;
    ALTER TABLE caja_movimientos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    CREATE UNIQUE INDEX IF NOT EXISTS cajas_unica_abierta_idx ON cajas ((estado)) WHERE estado = 'abierta';
    CREATE INDEX IF NOT EXISTS caja_movimientos_caja_idx ON caja_movimientos(caja_id, created_at);
    CREATE INDEX IF NOT EXISTS caja_movimientos_referencia_idx ON caja_movimientos(referencia_tipo, referencia_id);
    ALTER TABLE inventario ADD COLUMN IF NOT EXISTS foto_url TEXT;
    ALTER TABLE inventario ALTER COLUMN codigo DROP NOT NULL;
    ALTER TABLE eventos_calendario ADD COLUMN IF NOT EXISTS color VARCHAR(20);
    ALTER TABLE orden_refacciones ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE orden_refacciones ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE orden_refacciones ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE orden_refacciones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    CREATE UNIQUE INDEX IF NOT EXISTS orden_refacciones_orden_producto_idx ON orden_refacciones(orden_id, producto_id);
    ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS orden_id INTEGER REFERENCES ordenes_servicio(id) ON DELETE SET NULL;
    ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
    ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS stock_anterior INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS stock_nuevo INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS motivo TEXT;
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS nombre VARCHAR(200);
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS direccion TEXT;
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20);
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS redes_sociales TEXT;
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS terminos_legales TEXT;
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS logo_url TEXT;
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS logo_ticket_url TEXT;
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS impresora_ticket VARCHAR(200);
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS papel_ticket VARCHAR(10) DEFAULT '80mm';
    ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS auto_imprimir_ticket BOOLEAN DEFAULT true;
    ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS correo VARCHAR(100);
    ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS preferred_contact VARCHAR(30);
    ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS observaciones TEXT;
    ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS observaciones_internas TEXT;
    ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS orden_id INTEGER REFERENCES ordenes_servicio(id);
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS historial_estado_id INTEGER REFERENCES historial_estados(id) ON DELETE SET NULL;
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS nombre_estado VARCHAR(50) NOT NULL DEFAULT 'Recibido';
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS url_imagen TEXT;
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS tipo_evidencia VARCHAR(50) DEFAULT 'foto';
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS comentario TEXT;
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS visible_cliente BOOLEAN DEFAULT true;
    ALTER TABLE evidencias_orden ADD COLUMN IF NOT EXISTS fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS apellido_paterno VARCHAR(100);
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS apellido_materno VARCHAR(100);
    ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contacto_preferido VARCHAR(30);
  `);

  await pool.query(`
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
    UPDATE usuarios SET rol = 'TÃ©cnico' WHERE rol <> 'TÃ©cnico' AND rol LIKE 'T%cnico';
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
      CHECK (rol IN ('Administrador', 'TÃ©cnico', 'Recepcionista'));
  `);

  const legacyPhotoOrders = await pool.query(`
    SELECT id, usuario_creador_id, fotografias
    FROM ordenes_servicio
    WHERE fotografias IS NOT NULL AND TRIM(fotografias) <> ''
  `);

  for (const order of legacyPhotoOrders.rows) {
    let photos = [];
    try {
      const parsed = typeof order.fotografias === 'string' ? JSON.parse(order.fotografias) : order.fotografias;
      photos = Array.isArray(parsed)
        ? parsed
        : Object.values(parsed || {});
    } catch (error) {
      photos = [];
    }

    for (const photo of photos.filter(Boolean)) {
      const exists = await pool.query(
        'SELECT id FROM evidencias_orden WHERE orden_id = $1 AND url_imagen = $2 LIMIT 1',
        [order.id, photo]
      );
      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO evidencias_orden
           (orden_id, usuario_id, nombre_estado, url_imagen, tipo_evidencia, comentario, visible_cliente)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [order.id, order.usuario_creador_id || null, 'Recibido', photo, 'legacy', 'Evidencia migrada desde fotografias anteriores.', true]
        );
      }
    }
  }

  const shouldSeedDefaultAdmin = String(process.env.SEED_DEFAULT_ADMIN || '').toLowerCase() === 'true';

  if (shouldSeedDefaultAdmin) {
    const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    const adminDisplayName = String(process.env.ADMIN_NAME || '').trim();
    const missingAdminEnv = [];

    if (!adminUsername) missingAdminEnv.push('ADMIN_USERNAME');
    if (!adminPassword) missingAdminEnv.push('ADMIN_PASSWORD');
    if (!adminDisplayName) missingAdminEnv.push('ADMIN_NAME');

    if (missingAdminEnv.length > 0) {
      console.warn(
        `SEED_DEFAULT_ADMIN=true, pero faltan variables requeridas (${missingAdminEnv.join(', ')}). No se creo el administrador inicial.`
      );
    } else {
      const adminExists = await pool.query(
        'SELECT id FROM usuarios WHERE LOWER(username) = LOWER($1) ORDER BY id ASC',
        [adminUsername]
      );
      if (adminExists.rows.length === 0) {
        const bcrypt = require('bcrypt');
        const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
        await pool.query(
          'INSERT INTO usuarios (username, password, rol, nombre, activo) VALUES ($1, $2, $3, $4, $5)',
          [adminUsername, adminPasswordHash, 'Administrador', adminDisplayName, true]
        );
        console.log('Usuario administrador inicial creado. Desactiva SEED_DEFAULT_ADMIN despues del primer despliegue.');
      } else {
        console.log('Usuario administrador inicial ya existe. No se creo duplicado.');
      }
    }
  }

  await pool.query('INSERT INTO configuracion (id, nombre) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', ['AllFix Bacalar']);
}

module.exports = { pool, initDB };




