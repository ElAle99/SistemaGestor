// db/init.js - Inicializador de tablas del esquema PostgreSQL (DDL) para AllFix Bacalar

const { getDatabase } = require('./database');

async function initializeDatabase() {
  const db = await getDatabase();

  // 1. Tabla Usuarios (Autenticación y Roles)
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('Administrador', 'Técnico', 'Recepcionista'))
    )
  `);

  // Sembrar usuarios por defecto si no existen
  await db.query("DELETE FROM usuarios WHERE email IN ('Allfix', 'allfixbacalar')");
  const checkAdmin = await db.query("SELECT id FROM usuarios WHERE email = 'Allfix'");
  if (checkAdmin.rows.length === 0) {
    const adminPasswordHash = '$2b$10$Au6AtlXUMPqj.y.CY/9KlezjYuu7E8AN55viHUFJCQY4su5pvK61a';
    await db.query(
      'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)',
      ['Allfix', 'Allfix', adminPasswordHash, 'Administrador']
    );
    await db.query(
      "INSERT INTO usuarios (nombre, email, password, rol) VALUES ('Técnico de Taller', 'tecnico@allfix.com', 'tecnico123', 'Técnico')"
    );
    await db.query(
      "INSERT INTO usuarios (nombre, email, password, rol) VALUES ('Recepcionista Caja', 'recepcion@allfix.com', 'recepcion123', 'Recepcionista')"
    );
  }

  // 2. Tabla Clientes
  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      telefono TEXT NOT NULL UNIQUE,
      telefono_alt1 TEXT,
      telefono_alt2 TEXT,
      telefono_alt3 TEXT,
      email TEXT,
      direccion TEXT,
      observaciones TEXT
    )
  `);

  // 3. Tabla Equipos
  await db.query(`
    CREATE TABLE IF NOT EXISTS equipos (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL,
      tipo_equipo TEXT NOT NULL,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      color TEXT,
      imei1 TEXT,
      imei2 TEXT,
      numero_serie TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    )
  `);

  // 4. Tabla Órdenes
  await db.query(`
    CREATE TABLE IF NOT EXISTS ordenes (
      id SERIAL PRIMARY KEY,
      folio TEXT NOT NULL UNIQUE,
      cliente_id INTEGER NOT NULL,
      equipo_id INTEGER NOT NULL,
      falla_reportada TEXT NOT NULL,
      descripcion_falla TEXT,
      
      -- Datos de desbloqueo e historial técnico
      sec_android TEXT,
      sec_patch TEXT,
      sec_imei_orig TEXT,
      sec_imei_mod TEXT,

      -- Bloqueo de pantalla
      lock_type TEXT DEFAULT 'Ninguno',
      lock_pin TEXT,
      lock_pass TEXT,
      lock_pattern TEXT,

      -- Checklist de Inspección Visual (1 para Sí, 0 para No)
      vis_pantalla_rota INTEGER DEFAULT 0,
      vis_pantalla_manchada INTEGER DEFAULT 0,
      vis_botones INTEGER DEFAULT 0,
      vis_tapa INTEGER DEFAULT 0,
      vis_camara INTEGER DEFAULT 0,
      vis_marco INTEGER DEFAULT 0,
      vis_puerto INTEGER DEFAULT 0,
      vis_otro INTEGER DEFAULT 0,
      inspeccion_obs TEXT,

      -- Checklist de Accesorios (1 para Sí, 0 para No)
      acc_funda INTEGER DEFAULT 0,
      acc_sim INTEGER DEFAULT 0,
      acc_memoria INTEGER DEFAULT 0,
      acc_cargador INTEGER DEFAULT 0,
      acc_cable INTEGER DEFAULT 0,
      acc_caja INTEGER DEFAULT 0,
      acc_otro INTEGER DEFAULT 0,

      -- Firma digital (Base64)
      firma_imagen TEXT,

      -- Valores económicos
      costo_estimado NUMERIC DEFAULT 0,
      anticipo NUMERIC DEFAULT 0,
      costo_real NUMERIC,
      costo_refaccion NUMERIC DEFAULT 0,

      -- Estado
      estado_actual TEXT NOT NULL DEFAULT 'Recibido',
      status_reason TEXT, -- Motivo para Retrasado o Cancelado

      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_entrega_estimada TEXT,
      
      FOREIGN KEY (cliente_id) REFERENCES clientes (id),
      FOREIGN KEY (equipo_id) REFERENCES equipos (id)
    )
  `);

  // 5. Tabla Historial de Estados
  await db.query(`
    CREATE TABLE IF NOT EXISTS historial_estados (
      id SERIAL PRIMARY KEY,
      orden_id INTEGER NOT NULL,
      estado TEXT NOT NULL,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      comentario TEXT,
      FOREIGN KEY (orden_id) REFERENCES ordenes (id) ON DELETE CASCADE
    )
  `);

  // 6. Tabla Fotos de Orden
  await db.query(`
    CREATE TABLE IF NOT EXISTS fotos_orden (
      id SERIAL PRIMARY KEY,
      orden_id INTEGER NOT NULL,
      url_foto TEXT NOT NULL,
      etapa TEXT NOT NULL,
      FOREIGN KEY (orden_id) REFERENCES ordenes (id) ON DELETE CASCADE
    )
  `);

  // 7. Tabla Inventario (Refacciones & Accesorios)
  await db.query(`
    CREATE TABLE IF NOT EXISTS inventario (
      id SERIAL PRIMARY KEY,
      codigo TEXT UNIQUE,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL, -- Refacciones o Accesorios
      descripcion TEXT,
      costo NUMERIC DEFAULT 0,
      precio NUMERIC DEFAULT 0,
      stock INTEGER DEFAULT 0,
      stock_minimo INTEGER DEFAULT 0,
      foto_url TEXT
    )
  `);

  // Sembrar inventario básico si está vacío
  const checkInventory = await db.query("SELECT id FROM inventario LIMIT 1");
  if (checkInventory.rows.length === 0) {
    await db.query(
      `INSERT INTO inventario (codigo, nombre, categoria, descripcion, costo, precio, stock, stock_minimo) VALUES 
       ('11111', 'Pantalla iPhone 11', 'Refacciones', 'Pantalla LCD incell', 450, 1200, 5, 2),
       ('22222', 'Batería Xiaomi Note 10', 'Refacciones', 'Batería Litio 5000mAh', 180, 550, 1, 2),
       ('33333', 'Funda Silicona Universal', 'Accesorios', 'Funda TPU Transparente', 25, 120, 15, 3),
       ('44444', 'Cargador Rápido 20W', 'Accesorios', 'Cargador tipo C de carga rápida', 85, 290, 8, 2)`
    );
  }

  // 8. Tabla Ventas (Punto de Venta)
  await db.query(`
    CREATE TABLE IF NOT EXISTS ventas (
      id SERIAL PRIMARY KEY,
      total NUMERIC NOT NULL,
      metodo_pago TEXT NOT NULL, -- Efectivo, Tarjeta, Transferencia
      monto_recibido NUMERIC,
      cambio NUMERIC,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 9. Tabla Detalle de Ventas
  await db.query(`
    CREATE TABLE IF NOT EXISTS detalle_ventas (
      id SERIAL PRIMARY KEY,
      venta_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_unitario NUMERIC NOT NULL,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES inventario (id)
    )
  `);

  // 10. Tabla Cotizaciones
  await db.query(`
    CREATE TABLE IF NOT EXISTS cotizaciones (
      id SERIAL PRIMARY KEY,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      cliente_nombre TEXT NOT NULL,
      cliente_telefono TEXT NOT NULL,
      preferred_contact TEXT,
      tipo_equipo TEXT NOT NULL,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      problema_reportado TEXT NOT NULL,
      observaciones TEXT,
      estado TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente', 'Contactado', 'Cotizado', 'Aceptado', 'Rechazado')),
      photos TEXT, -- Guardará array JSON de imágenes Base64
      orden_id INTEGER DEFAULT NULL,
      FOREIGN KEY (orden_id) REFERENCES ordenes (id) ON DELETE SET NULL
    )
  `);

  // 11. Tabla Eventos (Calendario)
  await db.query(`
    CREATE TABLE IF NOT EXISTS eventos (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descripcion TEXT,
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT,
      categoria TEXT NOT NULL,
      color TEXT
    )
  `);

  console.log('==================================================');
  console.log('  Base de datos PostgreSQL inicializada y estructurada.');
  console.log('==================================================');
}

module.exports = { initializeDatabase };
