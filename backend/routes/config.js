const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { printTicketText, printTicketImage } = require('../services/ticketPrinterService');
const upload = require('../middleware/upload');

const router = express.Router();

function resolvePrintableLogoPath(logoUrl = '') {
  if (!logoUrl || String(logoUrl).startsWith('data:')) return '';

  const cleanUrl = String(logoUrl).split('?')[0].replace(/\\/g, '/').replace(/^\/+/, '');
  const candidates = [];

  if (cleanUrl.startsWith('uploads/')) {
    candidates.push(path.resolve(__dirname, '..', cleanUrl));
  }

  if (cleanUrl.startsWith('img/')) {
    candidates.push(path.resolve(__dirname, '..', '..', 'frontend', cleanUrl));
  }

  if (path.isAbsolute(logoUrl)) {
    candidates.push(logoUrl);
  }

  return candidates.find(candidate => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch (err) {
      return false;
    }
  }) || '';
}

function getSystemPrinters() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }

    const resolveFromRegistry = () => {
      execFile(
        'reg.exe',
        ['query', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices'],
        { windowsHide: true, timeout: 8000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve([]);
            return;
          }

          const printers = stdout
            .split(/\r?\n/)
            .map(line => line.match(/^\s{4}(.+?)\s+REG_SZ\s+/))
            .filter(Boolean)
            .map(match => ({ name: match[1].trim(), isDefault: false }))
            .filter(printer => printer.name)
            .sort((a, b) => a.name.localeCompare(b.name));

          resolve(printers);
        }
      );
    };

    const command = `
Add-Type -AssemblyName System.Drawing;
$printers = Get-CimInstance Win32_Printer | ForEach-Object {
  $paperMm = $null
  try {
    $settings = New-Object System.Drawing.Printing.PrinterSettings
    $settings.PrinterName = $_.Name
    if ($settings.IsValid) {
      $paper = $settings.DefaultPageSettings.PaperSize
      if ($paper -and $paper.Width -gt 0) {
        $paperMm = [Math]::Round(($paper.Width / 100) * 25.4, 1)
      }
    }
  } catch {}
  [PSCustomObject]@{
    Name = $_.Name
    Default = $_.Default
    PaperMm = $paperMm
    TicketPaper = if ($paperMm -and $paperMm -le 65) { '58mm' } else { '80mm' }
  }
};
$printers | ConvertTo-Json -Compress
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolveFromRegistry();
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          const printers = (Array.isArray(parsed) ? parsed : [parsed])
            .map(printer => ({
              name: printer.Name || '',
              isDefault: Boolean(printer.Default),
              paperMm: printer.PaperMm || null,
              ticketPaper: printer.TicketPaper || (Number(printer.PaperMm) <= 65 ? '58mm' : '80mm')
            }))
            .filter(printer => printer.name)
            .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
          if (printers.length) resolve(printers);
          else resolveFromRegistry();
        } catch (err) {
          resolveFromRegistry();
        }
      }
    );
  });
}

// Configuracion del negocio
router.get('/negocio', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM configuracion WHERE id = 1');
    if (result.rows.length === 0) {
      res.json({
        nombre: '',
        direccion: '',
        telefono: '',
        whatsapp: '',
        redes_sociales: '',
        terminos_legales: '',
        logo_url: '',
        logo_ticket_url: '',
        impresora_ticket: '',
        papel_ticket: '80mm',
        auto_imprimir_ticket: true
      });
    }
    else res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener configuracion' });
  }
});

router.put('/negocio', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      nombre,
      direccion,
      telefono,
      whatsapp,
      redes_sociales,
      terminos_legales,
      logo_url,
      logo_ticket_url,
      impresora_ticket,
      papel_ticket,
      auto_imprimir_ticket
    } = req.body;
    const normalizedPaper = papel_ticket === '58mm' ? '58mm' : '80mm';
    const autoPrint = auto_imprimir_ticket !== false;
    await pool.query(
      `INSERT INTO configuracion (
         id, nombre, direccion, telefono, whatsapp, redes_sociales, terminos_legales,
         logo_url, logo_ticket_url, impresora_ticket, papel_ticket, auto_imprimir_ticket
       )
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         nombre = $1,
         direccion = $2,
         telefono = $3,
         whatsapp = $4,
         redes_sociales = $5,
         terminos_legales = $6,
         logo_url = $7,
         logo_ticket_url = $8,
         impresora_ticket = $9,
         papel_ticket = $10,
         auto_imprimir_ticket = $11`,
      [
        nombre,
        direccion,
        telefono,
        whatsapp,
        redes_sociales,
        terminos_legales,
        logo_url || '',
        logo_ticket_url || '',
        impresora_ticket || '',
        normalizedPaper,
        autoPrint
      ]
    );
    res.json({ message: 'Configuración actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar configuracion' });
  }
});

router.post('/logo', authMiddleware, adminOnly, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún logo.' });
    }

    res.json({
      url: `/uploads/${req.file.filename}`,
      filename: req.file.filename
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al subir logo del negocio' });
  }
});

router.get('/impresoras', authMiddleware, adminOnly, async (req, res) => {
  try {
    const printers = await getSystemPrinters();
    res.json(printers);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener impresoras' });
  }
});

router.post('/imprimir-ticket', authMiddleware, async (req, res) => {
  try {
    const {
      text,
      imageData,
      printerName,
      paper,
      detectedPaper,
      copies,
      logoUrl,
      pixelWidth,
      pixelHeight,
      dpi
    } = req.body;
    if (imageData) {
      await printTicketImage({
        imageData,
        printerName,
        paper: paper || detectedPaper || 'auto',
        copies,
        pixelWidth,
        pixelHeight,
        dpi
      });
    } else {
      await printTicketText({
        text,
        printerName,
        paper: paper || detectedPaper || 'auto',
        copies,
        logoPath: resolvePrintableLogoPath(logoUrl)
      });
    }
    res.json({ message: 'Ticket enviado a impresora' });
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Error al imprimir ticket'
    });
  }
});

// Usuarios
router.get('/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, rol, nombre, activo, fecha_creacion FROM usuarios ORDER BY fecha_creacion DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.post('/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, rol, nombre } = req.body;
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (username, password, rol, nombre) VALUES ($1, $2, $3, $4) RETURNING id, username, rol, nombre, activo',
      [username, hashedPassword, rol, nombre]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

router.put('/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, rol, nombre, activo } = req.body;
    let query = 'UPDATE usuarios SET username = $1, rol = $2, nombre = $3, activo = $4';
    const params = [username, rol, nombre, activo];
    let idx = 5;
    if (password) {
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash(password, 10);
      query += `, password = $${idx++}`;
      params.push(hashedPassword);
    }
    query += ` WHERE id = $${idx} RETURNING id, username, rol, nombre, activo`;
    params.push(req.params.id);
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

router.delete('/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
