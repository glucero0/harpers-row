import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const areaSourceDir = path.resolve(root, 'content/areas');
const AREA_URL_PREFIX = '/content/areas/';
// Same bare-name rule as master-config.js: no slashes, no "..".
const AREA_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.json$/;

function areaFileFromUrl(urlPath) {
  if (!urlPath.startsWith(AREA_URL_PREFIX)) return null;
  let name;
  try {
    name = decodeURIComponent(urlPath.slice(AREA_URL_PREFIX.length));
  } catch {
    return null;
  }
  if (name.length > 64 || !AREA_FILE.test(name)) return null;
  const file = path.resolve(areaSourceDir, name);
  if (path.dirname(file) !== areaSourceDir) return null;
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return file;
}

// content/ is imported by the game, so it is not Vite's public directory. Area files are fetched
// at startup, and this plugin publishes content/areas at /content/areas/ in dev and in dist/.
function contentAreasPlugin() {
  function serve(req, res, next) {
    const urlPath = (req.url ?? '').split('?')[0];
    const file = areaFileFromUrl(urlPath);
    if (!file) return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  }

  return {
    name: 'content-areas',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    writeBundle(outputOptions) {
      if (!outputOptions.dir) return;
      const target = path.resolve(outputOptions.dir, 'content/areas');
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(areaSourceDir)) {
        if (!AREA_FILE.test(name)) continue;
        fs.copyFileSync(path.join(areaSourceDir, name), path.join(target, name));
      }
    },
  };
}

export default defineConfig({
  plugins: [contentAreasPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Function form required by the rolldown-based Vite build; the object form is rejected.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
