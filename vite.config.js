// Hugo renders /diagrams/ (layouts/diagrams.html) and loads dist/assets/index.{js,css}.
// Fixed file names: `hugo server` does not re-render the page when the bundle changes, so a
// hashed name would go stale. index.html is only used by `npm run dev:diagrams`.
// emptyOutDir is off: Hugo stops watching dist/assets if it is deleted and recreated.
// publicDir is off: public/ is Hugo's output.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// `vite build --watch` (npm run dev): a docs/ diagram (_sdd.json, <folder>/<folder>.json) is saved live from the
// diagram through agent-bridge.mjs, and the app reads it back from there. Loaded as a virtual module (\0 id), Rollup
// never watches it, so a save does not rebuild the bundle and reload the page. Plain `vite build` bundles it as a normal file.
const SDD = /\/docs\/.+\.json\?raw$/;
const sddUnwatched = {
  name: 'sdd-unwatched',
  enforce: 'pre',
  apply: () => process.argv.includes('--watch'),
  // The id keeps its `?raw` query: an id ending in `.json` would be parsed as JSON by vite:json (it skips ?raw ids).
  resolveId: (id, importer) => (SDD.test(id) && importer ? `\0sdd:${resolve(dirname(importer), id)}` : null),
  load: (id) => (id.startsWith('\0sdd:') ? `export default ${JSON.stringify(readFileSync(id.slice(5).replace(/\?raw$/, ''), 'utf8'))}` : null),
};

export default {
  base: '/diagrams/',
  publicDir: false,
  esbuild: { jsx: 'automatic' },
  plugins: [sddUnwatched],
  build: {
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
};
