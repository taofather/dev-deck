// Every src/content/<folder>/**/<doc>.js is a top-level tab under <folder>; tab order = path order.
const modules = import.meta.glob('./*/**/*.js', { eager: true });

export const docs = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, mod]) => ({ ...mod, folder: path.split('/')[1] }));
