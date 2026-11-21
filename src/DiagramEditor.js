// Editing a diagram JSON (src/content/index.js):
// every change rewrites the file through agent-bridge.mjs, so it only saves under `npm run dev`.
// Each operation takes the raw file content and returns a new one; positions live on the page that shows them.

export const SDD_BRIDGE = `${process.env.AGENT_BRIDGE_URL}/sdd`;
// Node kinds created from the diagram toolbar, and their empty value.
export const NEW_KINDS = {
  controlPoint: { text: '', why: '' },
  narrativeBlock: { text: '', why: '' },
  playerAction: { text: '', why: '' },
  actionSelection: { text: '', why: '' },
};
// Java-like prefix for node IDs
export const prefixOf = (kind) => kind;
export const isUml = (entry) => typeof entry === 'object' && entry?.type === 'uml';
// Status values offered per kind
const STATUSES = ['draft', 'published'];
export const statusesOf = () => STATUSES;
export const ID = /^[a-zA-Z][\w.-]*$/;
// The title a narrative block gets from its id: narrativeBlock.CadenesBlanques -> 'Cadenes Blanques'.
// "Bernat d'Aran" -> 'BernatDAran': a name as an id segment.
const pascal = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Za-z0-9]+/)
  .filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
export const titleOf = (id) => id.replace(/^narrativeBlock\./, '').replace(/([A-Z])/g, ' $1').trim() || id;

// A page's entity pattern: "*", "TASK-*" or "COD-*, OP-*" ("*" = any run of characters).
export const glob = (pattern) => new RegExp(`^(${pattern.split(',').map((g) => g.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).join('|')})$`);
// Whether a listed page (entities: [...]) shows id through one of its patterns ("narrativeBlock.*") rather than by name.
const globbed = (list, id) => list.some((x) => x.includes('*') && glob(x).test(id));

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
    for (const k of ['include', 'exclude']) if (p[k]) p[k] = p[k].map(fn).filter(Boolean);
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
  // A new node of `kind` at pos, on this page: kind.New, kind.New2, …
  add: (raw, pageId, kind, pos) => {
    const next = clone(raw);
    next.entities ??= {};
    let id = `${prefixOf(kind)}.New`;
    for (let n = 2; next.entities[id] !== undefined; n++) id = `${prefixOf(kind)}.New${n}`;
    next.entities[id] = clone(NEW_KINDS[kind] ?? { text: '', why: '' });
    const page = pageOf(next, pageId);
    if (Array.isArray(page.entities)) page.entities.push(id);
    page.positions = { ...page.positions, [id]: { x: Math.round(pos.x), y: Math.round(pos.y) } };
    return { raw: next, id };
  },
  // A node with a given id and value at pos, on this page.
  put: (raw, pageId, id, value, pos) => {
    const next = clone(raw);
    next.entities = { ...next.entities, [id]: value };
    const page = pageOf(next, pageId);
    if (Array.isArray(page.entities)) page.entities.push(id);
    page.positions = { ...page.positions, [id]: { x: Math.round(pos.x), y: Math.round(pos.y) } };
    return next;
  },
  // text and why: a plain string when there is no why, else { text, why } keeping any other field (columns, icon).
  // `properties` and `methods` (UML entities) are replaced when given; an empty methods list is dropped.
  // `published` (narrativeBlock) is written when given as a boolean.
  describe: (raw, id, { text, why, properties, methods, published }) => {
    const next = clone(raw);
    const old = next.entities?.[id];
    const rest = { ...(old && typeof old === 'object' ? old : {}), ...(properties && { properties }), ...(typeof published === 'boolean' && { published }) };
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
  // Narrative blocks from the web's narrative_blocks table: the table wins. A known node gets its text (content),
  // why (dj_notes) and published flag; a node only in the table is added, stacked below pos on this page.
  // A title is kept only when it differs from the one the id gives. Returns the counts for the toolbar.
  sync: (raw, pageId, blocks, pos) => {
    let next = clone(raw);
    const counts = { updated: 0, added: 0, unchanged: 0 };
    for (const b of blocks) {
      const id = b.node_id;
      if (typeof id !== 'string' || !ID.test(id)) continue;
      const old = next.entities?.[id];
      const base = old && typeof old === 'object' ? old : old !== undefined ? { text: old } : {};
      const { title: _, ...rest } = base;
      const value = { ...rest, text: b.content ?? '', why: b.dj_notes || undefined, published: b.published !== false };
      if (b.title && b.title !== titleOf(id)) value.title = b.title;
      if (value.why === undefined) delete value.why;
      if (old === undefined) {
        next = ops.put(next, pageId, id, value, { x: pos.x, y: pos.y + counts.added * 90 });
        counts.added++;
      } else if (JSON.stringify(old) === JSON.stringify(value)) {
        counts.unchanged++;
      } else {
        next.entities[id] = value;
        counts.updated++;
      }
    }
    return { raw: next, counts };
  },
  // Player choices from the web's player_actions table: one node per row, playerAction.<Block>.<Player>, linked
  // from its narrative block ('tria'). The table wins on text (option chosen), why (notes), status and props.
  // A row whose block is not in this file is skipped and counted, so a block sync should run first.
  syncActions: (raw, pageId, actions, pos) => {
    let next = clone(raw);
    const counts = { updated: 0, added: 0, unchanged: 0, orphan: 0 };
    const taken = new Map(); // id -> user_id, so two players with the same name in one block don't collide
    for (const a of actions) {
      const block = a.node_id;
      if (typeof block !== 'string' || next.entities?.[block] === undefined) {
        counts.orphan++;
        continue;
      }
      const player = a.character_name || a.user_name || `U${a.user_id}`;
      let id = `playerAction.${block.replace(/^narrativeBlock\./, '')}.${pascal(player) || `U${a.user_id}`}`;
      if (taken.has(id) && taken.get(id) !== a.user_id) id += `U${a.user_id}`;
      taken.set(id, a.user_id);
      const old = next.entities[id];
      const base = old && typeof old === 'object' ? old : {};
      const props = [['Jugador', a.user_name], ['Personatge', a.character_name], ['Tirada', a.dice_roll], ['Opció', a.selected_option_id]]
        .filter(([, v]) => v);
      const value = { ...base, text: a.selected_option_text ?? '', status: 'published', props };
      if (a.notes) value.why = a.notes;
      else delete value.why;
      const rel = [block, id, 'tria'];
      const linked = (next.relations ?? []).some((r) => sameRel(r, rel));
      if (old === undefined) {
        next = ops.put(next, pageId, id, value, { x: pos.x, y: pos.y + counts.added * 90 });
        counts.added++;
      } else if (JSON.stringify(old) === JSON.stringify(value) && linked) {
        counts.unchanged++;
        continue;
      } else {
        next.entities[id] = value;
        counts.updated++;
      }
      if (!linked) next.relations = [...(next.relations ?? []), rel];
    }
    return { raw: next, counts };
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
  // Off one page only, the declaration and relations stay: out of a listed page, or into a glob page's `exclude`.
  hide: (raw, pageId, id) => {
    const next = clone(raw);
    const page = pageOf(next, pageId);
    if (Array.isArray(page.entities)) {
      page.entities = page.entities.filter((x) => x !== id);
      if (globbed(page.entities, id)) page.exclude = [...new Set([...(page.exclude ?? []), id])];
    } else {
      page.exclude = [...new Set([...(page.exclude ?? []), id])];
      page.include = page.include?.filter((x) => x !== id);
    }
    if (page.positions) delete page.positions[id];
    if (page.sides) page.sides = Object.fromEntries(Object.entries(page.sides).filter(([k]) => !k.split('~').includes(id)));
    return next;
  },
  // Onto another page at pos: a listed page gets the id; a glob page drops it from `exclude`, or adds it to `include` when its glob misses it.
  show: (raw, pageId, id, matches, pos) => {
    const next = clone(raw);
    const page = pageOf(next, pageId);
    if (Array.isArray(page.entities)) {
      page.entities = [...new Set([...page.entities, id])];
      page.exclude = page.exclude?.filter((x) => x !== id);
    } else {
      page.exclude = page.exclude?.filter((x) => x !== id);
      if (!matches) page.include = [...new Set([...(page.include ?? []), id])];
    }
    if (pos) page.positions = { ...page.positions, [id]: { x: Math.round(pos.x), y: Math.round(pos.y) } };
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

// The web's tables, fetched as DJ by agent-bridge.mjs: narrative_blocks and player_actions of a campaign.
const loadWeb = (path, key) => (campaignId = 1) => fetch(`${process.env.AGENT_BRIDGE_URL}/web/${path}?campaignId=${campaignId}`)
  .then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `bridge answered ${r.status}`);
    return data[key];
  });
export const loadNarrativeBlocks = loadWeb('narrative-blocks', 'blocks');
export const loadPlayerActions = loadWeb('player-actions', 'actions');
export const loadSdd = (file) => fetch(`${SDD_BRIDGE}?file=${encodeURIComponent(file)}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))));

// ponytail: last write wins, like the board; two tabs editing one file overwrite each other.
export const saveSdd = (file, raw) => fetch(`${SDD_BRIDGE}?file=${encodeURIComponent(file)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(raw),
}).then((r) => (r.ok ? null : r.text().then((t) => Promise.reject(new Error(t || `save failed: ${r.status}`)))));
