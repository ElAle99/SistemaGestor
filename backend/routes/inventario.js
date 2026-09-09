const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

function normalizeCategoria(categoria) {
  const normalized = String(categoria || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized.startsWith('accesorio')) return 'Accesorios';
  if (normalized.startsWith('refaccion')) return 'Refacciones';
  return categoria || 'Refacciones';
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

router.post('/upload', authMiddleware, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibiÃ³ ninguna fotografÃ­a.' });
    }

    res.json({
      url: `/uploads/${req.file.filename}`,
      filename: req.file.filename
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al subir fotografÃ­a del producto' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, categoria } = req.query;
    let query = 'SELECT * FROM inventario WHERE activo = true';
    const params = [];
    let idx = 1;
    if (search) {
      query += ` AND (nombre ILIKE $${idx++} OR codigo ILIKE $${idx++} OR codigo_barras ILIKE $${idx++})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoria) {
      query += ` AND categoria = $${idx++}`;
      params.push(categoria);
    }
    query += ' ORDER BY nombre ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inventario WHERE id = $1 AND activo = true', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { codigo, codigo_barras, nombre, descripcion, categoria, costo, precio, stock, stock_minimo, fotografia, foto_url } = req.body;
    const foto = fotografia || foto_url || null;
    const categoriaNormalizada = normalizeCategoria(categoria);
    const codigoNormalizado = normalizeOptionalText(codigo);
    const codigoBarrasNormalizado = normalizeOptionalText(codigo_barras);
    const result = await pool.query(
      'INSERT INTO inventario (codigo, codigo_barras, nombre, descripcion, categoria, costo, precio, stock, stock_minimo, fotografia, foto_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [codigoNormalizado, codigoBarrasNormalizado, nombre, descripcion, categoriaNormalizada, costo, precio, stock, stock_minimo, foto, foto]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { codigo, codigo_barras, nombre, descripcion, categoria, costo, precio, stock, stock_minimo, fotografia, foto_url } = req.body;
    const foto = fotografia || foto_url || null;
    const categoriaNormalizada = normalizeCategoria(categoria);
    const codigoNormalizado = normalizeOptionalText(codigo);
    const codigoBarrasNormalizado = normalizeOptionalText(codigo_barras);
    const result = await pool.query(
      'UPDATE inventario SET codigo = $1, codigo_barras = $2, nombre = $3, descripcion = $4, categoria = $5, costo = $6, precio = $7, stock = $8, stock_minimo = $9, fotografia = $10, foto_url = $11 WHERE id = $12 RETURNING *',
      [codigoNormalizado, codigoBarrasNormalizado, nombre, descripcion, categoriaNormalizada, costo, precio, stock, stock_minimo, foto, foto, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE inventario SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

module.exports = router;
