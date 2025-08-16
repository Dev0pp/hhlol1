const fs = require('fs');
const path = require('path');

function findStaticDir(baseDir) {
  const candidates = ['public', 'dist', 'build', '.'];
  for (const c of candidates) {
    const dir = path.resolve(baseDir, c);
    const idx = path.join(dir, 'index.html');
    try { if (fs.existsSync(idx)) return dir; } catch {}
  }
  // shallow scan fallback
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const idx = path.join(baseDir, e.name, 'index.html');
        if (fs.existsSync(idx)) return path.join(baseDir, e.name);
      }
    }
  } catch {}
  return baseDir;
}

module.exports = { findStaticDir };
