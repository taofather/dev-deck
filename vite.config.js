// Hugo renders /diagrams/ (layouts/diagrams.html) and loads dist/assets/index.{js,css}.
// Fixed file names: `hugo server` does not re-render the page when the bundle changes, so a
// hashed name would go stale. index.html is only used by `npm run dev:diagrams`.
// emptyOutDir is off: Hugo stops watching dist/assets if it is deleted and recreated.
// publicDir is off: public/ is Hugo's output.
export default {
  base: '/diagrams/',
  publicDir: false,
  esbuild: { jsx: 'automatic' },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
};
