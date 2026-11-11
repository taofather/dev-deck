// Editing a docs/**/_sdd.json diagram (src/content/index.js), like the WIP board edits board.json:
// every change rewrites the file through agent-bridge.mjs, so it only saves under `npm run dev`.
// Each operation takes the raw file content and returns a new one; positions live on the page that shows them.

export const SDD_BRIDGE = 'http://127.0.0.1:5182/sdd';
// Node kinds created from the diagram toolbar, and their empty value. PRD and ADR must state a why.
export const NEW_KINDS = {
  PRD: { text: '', why: '' }, ADR: { text: '', why: '' }, PLAN: { text: '', why: '' },
  TASK: { text: '', status: 'todo' }, ACC: { text: '', status: 'open' },
  COD: { text: '', status: 'wip' }, OP: { text: '', status: [] },
  // VERIF: a check with an expected result, per environment like an OP. QUERY: the read-only command it runs.
  VERIF: { text: '', status: [] }, QUERY: { text: '', query: '' },
  // CMD: a command that changes an environment (helm upgrade, script step, kubectl scale); an OP runs it.
  CMD: { text: '', cmd: '', status: [] },
  // A UML entity (class box): no status, only properties [name, type] and optional methods [signature, note]. Its id keeps a DSL prefix (BENT-, DBT-, FDTO-…).
  UML: { type: 'uml', text: '', properties: [['id', 'uuid']] },
};
// The id prefix a toolbar kind creates (UML boxes start as back-end entities; rename to DBT-, FDTO-… as needed).
export const prefixOf = (kind) => (kind === 'UML' ? 'BENT' : kind);
export const isUml = (entry) => typeof entry === 'object' && entry?.type === 'uml';
// `status` values offered per kind (any string is accepted; the LED colour comes from LEDS in main.jsx).
// OP is not here: its status is a list of { env, state } (OP_STATES), edited as environment checkboxes.
const STATUSES = {
  COD: ['wip', 'review', 'dev', 'released'],
  ACC: ['open', 'partial', 'met', 'regressed'],
  TASK: ['todo', 'wip', 'review', 'blocked', 'done'],
};
export const statusesOf = (kind) => STATUSES[kind] ?? [...new Set(Object.values(STATUSES).flat())];
// `fail` is for VERIF targets: checked, and the expected result is not there.
export const OP_STATES = ['pending', 'done', 'fail'];
// Environments: one `env` per node (an ACC holds there), or OP targets (`status: [{ env, state }]`).
export const ENVS = ['eph', 'dev', 'staging', 'sandbox', 'prod'];
export const ID = /^[A-Z][A-Z0-9]*-[\w.-]+$/;

const DEFAULT_PAGE = { id: 'overview', section: 'Home', title: 'Everything', entities: '*' };
const clone = (raw) => structuredClone(raw);
// The raw page behind a page id; a file without pages gets its default overview page written out.
const pageOf = (raw, pageId) => {
  raw.pages ??= [{ ...DEFAULT_PAGE }];
  return raw.pages.find((p) => p.id === pageId);
};
const mapIds = (raw, fn) => {
  raw.relations = (raw.relations ?? []).map(([a, b, ...rest]) => [fn(a), fn(b), ...rest]).filter(([a, b]) => a && b);
  for (const p of raw.pages ?? []) {
    if (Array.isArray(p.entities)) p.entities = p.entities.map(fn).filter(Boolean);
    if (p.positions) p.positions = Object.fromEntries(Object.entries(p.positions).map(([k, v]) => [fn(k), v]).filter(([k]) => k));
    if (p.sides) {
      p.sides = Object.fromEntries(Object.entries(p.sides).map(([k, v]) => [k.split('~').map(fn), v])
        .filter(([ends]) => ends.every(Boolean)).map(([ends, v]) => [ends.join('~'), v]));
    }
  }
};
const sameRel = (r, [a, b, label]) => r[0] === a && r[1] === b && (r[2] ?? '') === (label ?? '');

// Sides an arrow end can sit on, in the order "Rotate origin/destination" walks them (as on the WIP board).
export const SIDES = ['right', 'bottom', 'left', 'top'];
export const nextSide = (side) => SIDES[(SIDES.indexOf(side) + 1) % SIDES.length];

export const ops = {
  // One end of a relation's arrow on this page: page.sides["A~B"] = { from, to } (origin and destination side).
  side: (raw, pageId, rel, end, side) => {
    const next = clone(raw);
    const page = pageOf(next, pageId);
    page.sides = { ...page.sides, [rel]: { ...page.sides?.[rel], [end]: side } };
    return next;
  },
  move: (raw, pageId, moves) => {
    const next = clone(raw);
    const page = pageOf(next, pageId);
    page.positions = { ...page.positions, ...Object.fromEntries(moves.map(({ id, x, y }) => [id, { x: Math.round(x), y: Math.round(y) }])) };
    return next;
  },
  // A new node of `kind` at pos, on this page: KIND-New, KIND-New2, …
  add: (raw, pageId, kind, pos) => {
    const next = clone(raw);
    next.entities ??= {};
    let id = `${prefixOf(kind)}-New`;
    for (let n = 2; next.entities[id] !== undefined; n++) id = `${prefixOf(kind)}-New${n}`;
    next.entities[id] = clone(NEW_KINDS[kind]);
    const page = pageOf(next, pageId);
    if (Array.isArray(page.entities)) page.entities.push(id);
    page.positions = { ...page.positions, [id]: { x: Math.round(pos.x), y: Math.round(pos.y) } };
    return { raw: next, id };
  },
  // text and why: a plain string when there is no why, else { text, why } keeping any other field (columns, icon).
  // `properties` and `methods` (UML entities) are replaced when given; an empty methods list is dropped.
  describe: (raw, id, { text, why, properties, methods }) => {
    const next = clone(raw);
    const old = next.entities?.[id];
    const rest = { ...(old && typeof old === 'object' ? old : {}), ...(properties && { properties }) };
    if (methods) {
      if (methods.length) rest.methods = methods;
      else delete rest.methods;
    }
    next.entities = { ...next.entities, [id]: why || Object.keys(rest).some((k) => k !== 'text' && k !== 'why') ? { ...rest, text, why: why || undefined } : text };
    return next;
  },
  // One property of an entity besides its text: `tags` (labels, post-its) or `status` (LED). An empty value removes it;
  // a string entity becomes { text, … }, and turns back into a string when only its text is left.
  field: (raw, id, key, value) => {
    const next = clone(raw);
    const old = next.entities?.[id];
    const { [key]: _, ...rest } = typeof old === 'object' ? old : { text: old ?? '' };
    const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length);
    const entry = empty ? rest : { ...rest, [key]: value };
    next.entities = { ...next.entities, [id]: Object.keys(entry).some((k) => k !== 'text') ? entry : entry.text };
    return next;
  },
  // Renames the declaration (keeping key order) and every reference in this file.
  rename: (raw, from, to) => {
    const next = clone(raw);
    if (next.entities) next.entities = Object.fromEntries(Object.entries(next.entities).map(([k, v]) => [k === from ? to : k, v]));
    mapIds(next, (x) => (x === from ? to : x));
    return next;
  },
  // Out of this file: its declaration, relations, page lists and positions. Other docs keep theirs.
  remove: (raw, id) => {
    const next = clone(raw);
    if (next.entities) delete next.entities[id];
    mapIds(next, (x) => (x === id ? null : x));
    return next;
  },
  link: (raw, rel) => {
    const next = clone(raw);
    next.relations = [...(next.relations ?? []).filter((r) => !sameRel(r, rel)), rel[2] ? rel : rel.slice(0, 2)];
    return next;
  },
  unlink: (raw, rel) => ({ ...clone(raw), relations: (raw.relations ?? []).filter((r) => !sameRel(r, rel)) }),
  relabel: (raw, rel, label) => ({
    ...clone(raw),
    relations: (raw.relations ?? []).map((r) => (sameRel(r, rel) ? (label ? [r[0], r[1], label] : [r[0], r[1]]) : r)),
  }),
};

export const loadSdd = (file) => fetch(`${SDD_BRIDGE}?file=${encodeURIComponent(file)}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))));

// ponytail: last write wins, like the board; two tabs editing one file overwrite each other.
export const saveSdd = (file, raw) => fetch(`${SDD_BRIDGE}?file=${encodeURIComponent(file)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(raw),
}).then((r) => (r.ok ? null : r.text().then((t) => Promise.reject(new Error(t || `save failed: ${r.status}`)))));
