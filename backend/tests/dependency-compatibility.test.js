const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('bcrypt verifies legacy bcrypt prefixes and rejects incorrect passwords', async () => {
  const bcrypt = require('bcrypt');
  const hash = await bcrypt.hash('fixture-password', 4);
  assert.equal(await bcrypt.compare('fixture-password', hash), true);
  assert.equal(await bcrypt.compare('fixture-password', hash.replace(/^\$2b\$/, '$2a$')), true);
  assert.equal(await bcrypt.compare('incorrect', hash), false);
});

test('multipart upload persists in configured directory and registers tenant without changing URL', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'allfix-upload-test-'));
  process.env.UPLOAD_DIR = root;
  const statements = [];
  const dbPath = require.resolve('../config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    pool: { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } }
  } };
  const express = require('express');
  const upload = require('../middleware/upload');
  const app = express();
  app.post('/fixture', (req, res, next) => { req.user = { negocio_id: 42 }; next(); }, upload.single('foto'), (req, res) => res.json({ filename: req.file.filename }));
  app.use((error, req, res, next) => res.status(400).json({ error: 'invalid upload' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const form = new FormData(); const bytes = new Uint8Array([137, 80, 78, 71]);
    form.append('foto', new Blob([bytes], { type: 'image/png' }), 'fixture.png');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/fixture`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const { filename } = await response.json();
    assert.deepEqual(fs.readFileSync(path.join(root, filename)), Buffer.from(bytes));
    assert.equal(statements.length, 1); assert.equal(statements[0].params[0], 42);
    assert.equal(statements[0].params[1], '/uploads/' + filename);
    assert.equal(statements[0].params[3], false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const filename of fs.readdirSync(root)) fs.unlinkSync(path.join(root, filename));
    fs.rmdirSync(root);
  }
});
