// Every src/content/<folder>/**/<doc>.js is a top-level tab under <folder>; tab order = path order.
const modules = import.meta.glob('./*/**/*.js', { eager: true });

export const docs = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  // dirs: the folders between src/content and the file, e.g. ['intrastructure', 'nats'].
  .map(([path, mod]) => ({ ...mod, dirs: path.split('/').slice(1, -1) }));
