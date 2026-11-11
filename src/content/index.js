// Every src/content/<folder>/**/<doc>.js is a top-level tab under <folder>; tab order = path order.
const modules = import.meta.glob('./*/**/*.js', { eager: true });

// Every docs/**/_sdd.json is a doc too, filed under its docs path (docs/_WIP/x/design → wip/x/design), and so is
// the diagram of a root domain folder: docs/<reign>/<folder>/<folder>.json (docs/domains/tender/tender.json).
// Bundled as the starting point; under `npm run dev` the app reads and saves it live through agent-bridge.mjs (src/SddEdit.js).
// Raw import: an empty or broken file is skipped instead of breaking the app.
const isDiagram = (path) => {
  const [dir, name] = path.split('/').slice(-2);
  return name === '_sdd.json' || name === `${dir}.json`;
};
const sdds = Object.fromEntries(Object.entries(
  import.meta.glob(['../../docs/**/_sdd.json', '../../docs/*/*/*.json'], { eager: true, query: '?raw', import: 'default' }),
).filter(([path]) => isDiagram(path)));

// raw: the file content, kept as is for saving. The doc is derived from it: JSON has no Object.keys, so a page's
// `"entities"` may be a glob string over this file's entity ids: "*" (every entity), "TASK-*", or "COD-*, OP-*".
// No pages means one overview page.
const glob = (pattern) => new RegExp(`^(${pattern.split(',').map((g) => g.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).join('|')})$`);
export const sddDoc = (file, raw) => {
  const dirs = file.split('/').slice(1, -1).map((d, i) => (i === 0 ? d.replace(/^_/, '').toLowerCase() : d));
  const entities = raw.entities ?? {};
  const pages = (raw.pages ?? [{ id: 'overview', section: 'Home', title: 'Everything', entities: '*' }])
    .map((p) => (typeof p.entities === 'string' ? { ...p, entities: Object.keys(entities).filter((k) => glob(p.entities).test(k)) } : p));
  return {
    id: raw.id ?? dirs.slice(1).join('-').toLowerCase(),
    title: raw.title ?? dirs.at(-1),
    subtitle: raw.subtitle ?? file,
    entities,
    relations: raw.relations ?? [],
    pages,
    dirs,
    file,
    raw,
  };
};

const parse = ([path, text]) => {
  if (!text.trim()) return null;
  try {
    return sddDoc(path.replace(/^(\.\.\/)+/, ''), JSON.parse(text));
  } catch (e) {
    console.warn(`${path}: ${e.message}`);
    return null;
  }
};

const sortKey = (d) => [...d.dirs, d.file ? '_sdd.json' : d.key].join('/');

export const docs = [
  ...Object.entries(modules).map(([path, mod]) => ({ ...mod, dirs: path.split('/').slice(1, -1), key: path.split('/').at(-1) })),
  ...Object.entries(sdds).map(parse).filter(Boolean),
].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// A saved or reloaded _sdd.json replaces its doc in place, so every view reading `docs` sees it.
export const replaceSdd = (file, raw) => {
  const i = docs.findIndex((d) => d.file === file);
  if (i >= 0) docs[i] = sddDoc(file, raw);
  return docs[i];
};
