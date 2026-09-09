const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let count = 0;
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'uploads'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exitCode = 1;
      count++;
    }
  }
}
check(path.join(__dirname, '..'));
check(path.join(__dirname, '../../frontend/js'));
console.log(`${count} archivos JavaScript comprobados.`);
