import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow, useNodesState } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import '../docs/assets/consentio.css';
import './styles.css';

import { docs } from './content/index.js';
import { Board, NoteAside } from './Board.jsx';
import { CycleIssues } from './Linear.jsx';

// Colors follow AGENTS.md: blue frontend, red backend, purple database.
const DIMENSIONS = {
  frontend: { label: 'Frontend', color: '#2e5aa8', prefixes: ['FCOM', 'FDTO'] },
  backend: { label: 'Backend', color: '#c0392b', prefixes: ['BFUN', 'BENT', 'BPRO', 'BDTO', 'BAGG'] },
  database: { label: 'Database', color: '#7b3fa0', prefixes: ['DBT', 'DBP', 'DBQ', 'DBI', 'ELI'] },
  event: { label: 'Event', color: '#d4801c', prefixes: ['EVT'] },
  timeline: { label: 'Timeline', color: '#2f8f5b', prefixes: ['TL'] },
  infra: { label: 'Infrastructure', color: '#1f7f8c', prefixes: ['K8S', 'NATS', 'GCP'] },
  action: { label: 'Action point', color: '#b5179e', prefixes: ['AP'] },
  ops: { label: 'Script step', color: '#184c47', prefixes: ['OPS'] },
  step: { label: 'Decision step', color: '#56616e', prefixes: [] },
};

const dimOf = (id) =>
  Object.keys(DIMENSIONS).find((d) => DIMENSIONS[d].prefixes.includes(id?.split('-')[0])) ?? 'step';
const isRef = (id) => dimOf(id) !== 'step';
const colorOf = (id) => DIMENSIONS[dimOf(id)].color;

// Entities and relations are shared by all docs: the same id in two docs is the same thing.
const entityDocs = (entity) =>
  docs
    .filter((d) => d.entities[entity])
    .map((d) => ({ doc: d, ...(typeof d.entities[entity] === 'string' ? { text: d.entities[entity] } : d.entities[entity]) }));

const relations = [...new Map(docs.flatMap((d) => d.relations).map((r) => [r.join('|'), r])).values()];

const NODE_W = 230;
const NODE_H = 66;
// Cards with columns grow one row per column; must match .card-cols in styles.css.
const ROW_H = 17;
const colsOf = (id) => entityDocs(id).find((e) => e.columns)?.columns;
const iconOf = (id) => entityDocs(id).find((e) => e.icon)?.icon;
// An icon is an emoji or a path/URL to an image (e.g. '/icons/gcp/cloud-sql.svg' under static/).
const Icon = ({ icon }) => (!icon ? null : /[./]/.test(icon) ? <img className="icon" src={icon} alt="" /> : <span className="icon">{icon}</span>);
const heightOf = (n) => (n.columns ? 42 + n.columns.length * ROW_H : NODE_H);

// Normalize all page styles to the same node/edge shape.
function pageGraph(page) {
  if (page.board) return { nodes: [], edges: [] };
  if (page.sequence) {
    const refs = new Set([...page.sequence.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter(isRef));
    return { nodes: [...refs].map((id) => ({ id, label: id, ref: id })), edges: [] };
  }
  if (page.entities) {
    const set = new Set(page.entities);
    return {
      nodes: page.entities.map((id) => ({ id, label: id, ref: id })),
      edges: relations.filter(([a, b]) => set.has(a) && set.has(b)),
    };
  }
  return { nodes: page.nodes, edges: page.edges };
}

function layout(page) {
  const { edges } = pageGraph(page);
  const nodes = pageGraph(page).nodes.map((n) => ({ ...n, columns: colsOf(n.ref), icon: n.icon ?? iconOf(n.ref) }));
  // Optional page.groups: [{ id, label, color, icon, ref?, members: [nodeId | groupId] }], drawn as containers.
  // A group with a ref opens that entity's panel when its label is clicked.
  // A group listed in another group's members nests inside it. Groups without any page node are dropped.
  const ids = new Set(nodes.map((n) => n.id));
  const all = page.groups ?? [];
  const alive = (gr) => gr.members.some((m) => ids.has(m) || all.some((c) => c.id === m && alive(c)));
  const groups = all.filter(alive);
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: groups.length > 0 })
    .setGraph({ rankdir: page.direction ?? 'TB', nodesep: 30, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: heightOf(n) }));
  groups.forEach((gr) => g.setNode(gr.id, {}));
  groups.forEach((gr) => gr.members.filter((m) => g.hasNode(m)).forEach((m) => g.setParent(m, gr.id)));
  edges.forEach(([a, b], i) => g.setEdge(a, b, {}, `e${i}`));
  dagre.layout(g);
  const horizontal = page.direction === 'LR';
  const topLeft = (id) => {
    const p = g.node(id);
    return { x: p.x - p.width / 2, y: p.y - p.height / 2 };
  };
  // React Flow wants parents before children and child positions relative to the parent.
  const depth = (id) => (g.parent(id) ? depth(g.parent(id)) + 1 : 0);
  const placed = (id) => {
    const parentId = g.parent(id);
    const own = topLeft(id);
    const origin = parentId ? topLeft(parentId) : { x: 0, y: 0 };
    return { ...(parentId && { parentId, extent: 'parent' }), position: { x: own.x - origin.x, y: own.y - origin.y } };
  };
  const groupNodes = [...groups].sort((a, b) => depth(a.id) - depth(b.id)).map((gr) => {
    const p = g.node(gr.id);
    return {
      id: gr.id, type: 'lane', width: p.width, height: p.height, selectable: false, zIndex: depth(gr.id) - 10, ...placed(gr.id),
      data: { label: gr.label ?? gr.id, color: gr.color, icon: gr.icon, ref: gr.ref },
    };
  });
  const refOf = Object.fromEntries(nodes.map((n) => [n.id, n.ref]));
  return {
    nodes: [...groupNodes, ...nodes.map((n) => {
      const h = heightOf(n);
      return {
        id: n.id,
        type: 'card',
        width: NODE_W,
        height: h,
        ...placed(n.id),
        data: { ...n, dim: dimOf(n.ref), horizontal },
      };
    })],
    // page.edgeType: 'step' (square), 'smoothstep' (rounded corners), 'straight' or 'default' (bezier).
    // An edge between two refs is a relation: clicking it opens #/doc/page/<from>~<to>.
    edges: edges.map(([a, b, label, dashed], i) => ({
      id: `e${i}`,
      data: { rel: refOf[a] && refOf[b] ? `${refOf[a]}~${refOf[b]}` : null },
      type: page.edgeType ?? 'step',
      source: a,
      target: b,
      label,
      animated: !!dashed,
      markerEnd: { type: MarkerType.ArrowClosed },
      labelStyle: { fontFamily: 'ui-monospace, monospace', fontSize: 10 },
    })),
  };
}

// A page's edges as [fromRef, toRef, label], skipping edges with an end that has no ref.
const refEdges = (page) => {
  const { nodes, edges } = pageGraph(page);
  const refOf = Object.fromEntries(nodes.map((n) => [n.id, n.ref]));
  return edges.map(([a, b, label]) => [refOf[a], refOf[b], label]).filter(([a, b]) => a && b);
};

// Every page, in any doc, where an entity appears directly or as a flow node's ref.
const appearances = (entity) =>
  docs.flatMap((doc) => doc.pages
    .filter((p) => pageGraph(p).nodes.some((n) => n.ref === entity) || p.groups?.some((g) => g.ref === entity))
    .map((page) => ({ doc, page })));

function Card({ data, selected }) {
  const { color } = DIMENSIONS[data.dim];
  const cls = ['card', data.kind, data.focused && 'focused', data.faded && 'faded', selected && 'selected'];
  return (
    <div className={cls.filter(Boolean).join(' ')} style={{ borderLeftColor: color }}>
      <Handle type="target" position={data.horizontal ? Position.Left : Position.Top} />
      <div className="card-label"><Icon icon={data.icon} />{data.label}</div>
      {data.ref && data.ref !== data.label && <div className="card-ref" style={{ color }}>{data.ref}</div>}
      {data.sub && <div className="card-sub">{data.sub}</div>}
      {data.columns && (
        <table className="card-cols">
          <tbody>
            {data.columns.map(([name, type]) => (
              <tr key={name}><td>{name}</td><td>{type}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <Handle type="source" position={data.horizontal ? Position.Right : Position.Bottom} />
    </div>
  );
}
const Lane = ({ data }) => (
  <div className={data.focused ? 'lane focused' : 'lane'} style={data.color && { '--lane': data.color }}>
    <div className={data.ref ? 'lane-label ref' : 'lane-label'} title={data.ref}><Icon icon={data.icon} />{data.label}</div>
  </div>
);
const nodeTypes = { card: Card, lane: Lane };

const parseHash = () => {
  const [, docId, pageId, entity] = decodeURIComponent(location.hash).split('/');
  const doc = docs.find((d) => d.id === docId) ?? docs[0];
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  return { doc, page, entity: entity || null };
};
const go = (docId, pageId, entity) => (location.hash = `/${docId}/${pageId}${entity ? `/${entity}` : ''}`);

function Diagram({ doc, page, entity, hidden }) {
  const base = useMemo(() => layout(page), [page]);
  const { fitView } = useReactFlow();
  // Dragged positions live here until the page changes (the Diagram key remounts this state).
  const [moved, , onNodesChange] = useNodesState(base.nodes);

  // A relation (from~to) focuses both ends and the edge itself.
  const focus = entity?.split('~') ?? [];
  const nodes = moved.map((n) => ({
    ...n,
    data: { ...n.data, focused: focus.includes(n.data.ref), faded: hidden.has(n.data.dim) },
  }));
  const edges = base.edges.map((e) => (entity && e.data.rel === entity ? { ...e, className: 'focused' } : e));

  useEffect(() => {
    const focus = entity?.split('~') ?? [];
    const hits = base.nodes.filter((n) => focus.includes(n.data.ref)).map((n) => ({ id: n.id }));
    // Wait one frame so React Flow has measured the new nodes.
    if (hits.length) requestAnimationFrame(() => fitView({ nodes: hits, maxZoom: 1.2, duration: 400 }));
  }, [base, entity, fitView]);

  return (
    <ReactFlow
      key={`${doc.id}/${page.id}`}
      fitView
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={nodeTypes}
      // Lanes only react on their label, so empty space inside a group stays inert.
      onNodeClick={(e, n) => n.data.ref && (n.type === 'card' || e.target.closest('.lane-label')) && go(doc.id, page.id, n.data.ref)}
      onEdgeClick={(_, e) => e.data.rel && go(doc.id, page.id, e.data.rel)}
      onPaneClick={() => go(doc.id, page.id)}
      nodesConnectable={false}
      minZoom={0.1}
    >
      <Background gap={20} />
      <Controls />
      <MiniMap pannable zoomable nodeColor={(n) => DIMENSIONS[n.data.dim]?.color ?? 'transparent'} />
    </ReactFlow>
  );
}

// ZenUML renders plain SVG. Refs are participants and quoted message names ("DBQ-CreateTender"(…)).
function Sequence({ doc, page, entity, hidden }) {
  const [svg, setSvg] = useState('');
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    // ZenUML is ~3 MB, so only sequence pages load it. Text is measured at render time:
    // fonts and icons must be ready first.
    import('@zenuml/core').then(async (z) => {
      await Promise.all([z.ensureDiagramFontsLoaded(), z.ensureDiagramIconsLoaded(page.sequence)]);
      if (live) setSvg(z.renderToSvg(page.sequence, { enableNumbering: false }).svg);
    });
    return () => (live = false);
  }, [page]);

  useEffect(() => {
    const root = box.current;
    root.querySelectorAll('.participant').forEach((g) => isRef(g.dataset.participant) && (g.dataset.ref = g.dataset.participant));
    root.querySelectorAll('.message-label').forEach((t) => {
      t.textContent = t.textContent.replaceAll('"', '');
      const ref = t.textContent.split('(')[0];
      if (isRef(ref)) t.dataset.ref = ref;
    });
    root.querySelectorAll('[data-ref]').forEach((el) => {
      const dim = dimOf(el.dataset.ref);
      el.style.setProperty('--dim', DIMENSIONS[dim].color);
      el.classList.toggle('focused', el.dataset.ref === entity);
      el.classList.toggle('faded', hidden.has(dim));
    });
    root.querySelector('.focused')?.scrollIntoView({ block: 'center', inline: 'center' });
  }, [svg, entity, hidden]);

  return (
    <div
      ref={box}
      className="sequence"
      onClick={(e) => go(doc.id, page.id, e.target.closest('[data-ref]')?.dataset.ref)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Navigate to an entity: stay here if it is on this page, else its first appearance.
const openEntity = (doc, page, id) => {
  const hits = appearances(id);
  const here = hits.find((h) => h.page === page) ?? hits[0];
  here ? go(here.doc.id, here.page.id, id) : go(doc.id, page.id, id);
};

function RelationPanel({ doc, page, rel }) {
  const [a, b] = rel.split('~');
  const between = ([x, y]) => (x === a && y === b) || (x === b && y === a);
  const labels = [...new Map([...refEdges(page), ...relations].filter(between).map((r) => [r.join('|'), r])).values()];
  const pages = docs.flatMap((d) => d.pages.filter((p) => refEdges(p).some(([x, y]) => x === a && y === b)).map((p) => ({ doc: d, page: p })));
  const end = (id) => (
    <section key={id}>
      <h3><a onClick={() => openEntity(doc, page, id)} style={{ color: DIMENSIONS[dimOf(id)].color }}>{id}</a></h3>
      <p>{(entityDocs(id).find((e) => e.doc === doc) ?? entityDocs(id)[0])?.text ?? '⚠ Not documented yet.'}</p>
    </section>
  );
  return (
    <aside className="panel">
      <div className="badge" style={{ background: 'var(--color-neutral-500)' }}>Relation</div>
      <h2>{a} → {b}</h2>
      <ul>
        {labels.map(([x, y, l]) => (
          <li key={`${x}|${y}|${l}`}>{x === a ? '→' : '←'} <b>{l || '—'}</b></li>
        ))}
      </ul>
      {end(a)}
      {end(b)}
      <h3>Appears in</h3>
      <ul>
        {pages.map(({ doc: d, page: p }) => (
          <li key={`${d.id}/${p.id}`}>
            <a className={p === page ? 'current' : ''} onClick={() => go(d.id, p.id, rel)}>{p.title}</a>
            <span className="muted"> · {d.title} › {p.section}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Panel({ doc, page, entity }) {
  if (!entity) return <aside className="panel muted">Click a node to read its doc and jump to the other dimensions it lives in.</aside>;
  if (entity.includes('~')) return <RelationPanel doc={doc} page={page} rel={entity} />;
  const dim = dimOf(entity);
  const out = relations.filter(([a]) => a === entity);
  const inc = relations.filter(([, b]) => b === entity);
  const open = (id) => openEntity(doc, page, id);
  const link = (id, label) => (
    <li key={id + label}>
      <a onClick={() => open(id)} style={{ color: DIMENSIONS[dimOf(id)].color }}>{id}</a>
      {label && <span className="muted"> · {label}</span>}
    </li>
  );
  const described = entityDocs(entity);
  return (
    <aside className="panel">
      <div className="badge" style={{ background: DIMENSIONS[dim].color }}>{DIMENSIONS[dim].label}</div>
      <h2>{entity}</h2>
      {described.length === 0 && <p>⚠ Not documented yet.</p>}
      {described.map(({ doc: d, text, columns }) => (
        <section key={d.id}>
          {described.length > 1 && <h3>From {d.title}</h3>}
          <p>{text}</p>
          {columns && (
            <table>
              <tbody>
                {columns.map(([name, type, desc]) => (
                  <tr key={name}><td>{name}</td><td className="muted">{type}</td><td>{desc}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <h3>Appears in</h3>
      <ul>
        {appearances(entity).map(({ doc: d, page: p }) => (
          <li key={`${d.id}/${p.id}`}>
            <a className={p === page ? 'current' : ''} onClick={() => go(d.id, p.id, entity)}>{p.title}</a>
            <span className="muted"> · {d.title} › {p.section}</span>
          </li>
        ))}
      </ul>
      {out.length > 0 && <><h3>Uses ↗</h3><ul>{out.map(([, b, l]) => link(b, l))}</ul></>}
      {inc.length > 0 && <><h3>Used by ↙</h3><ul>{inc.map(([a, , l]) => link(a, l))}</ul></>}
    </aside>
  );
}

function App() {
  const [route, setRoute] = useState(parseHash);
  const [hidden, setHidden] = useState(new Set());
  const [focus, setFocus] = useState(false);
  // Folds the left sidebar only (Focus hides both sides). Remembered per browser.
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem('sidebar-folded') === '1';
    } catch {
      return false;
    }
  });
  const fold = () => setFolded((f) => {
    try {
      localStorage.setItem('sidebar-folded', f ? '0' : '1');
    } catch {}
    return !f;
  });
  // Filled by the WIP Board so the aside can show the selected note.
  const [boardNotes, setBoardNotes] = useState([]);
  // Linear cycle issues from the board sidebar; the Board registers its add-note function here.
  const [issues, setIssues] = useState(null);
  const apiRef = useRef(null);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const { doc, page, entity } = route;
  // On the WIP board the route entity is either a note id or a DSL ref clicked inside a note.
  const note = page.board && boardNotes.find((n) => n.id === entity);
  // The Home section stays reachable as the default page, the back link replaces it in the sidebar.
  const sections = [...new Set(doc.pages.map((p) => p.section))].filter((s) => s !== 'Home');
  // Filled by layouts/diagrams.html from the reactflow-* front matter; absent under `npm run dev:diagrams`.
  const home = window.reactflowHomes?.[doc.id];
  const i = doc.pages.indexOf(page);
  const [prev, next] = [doc.pages[i - 1], doc.pages[i + 1]];
  const toggle = (d) => setHidden((h) => {
    const n = new Set(h);
    n.has(d) ? n.delete(d) : n.add(d);
    return n;
  });

  return (
    <div className={['layout', focus && 'focus', folded && 'folded', page.board && 'board'].filter(Boolean).join(' ')}>
      <nav className="sidebar">
        <button className="fold-toggle" title={folded ? 'Unfold sidebar' : 'Fold sidebar'} onClick={fold}>{folded ? '»' : '«'}</button>
        {home && <a className="back" href={home}>← Docs</a>}
        <h1>{doc.title}</h1>
        {sections.map((s) => (
          <div key={s}>
            <div className="section">{s}</div>
            {doc.pages.filter((p) => p.section === s).map((p) => (
              <a key={p.id} className={p === page ? 'current' : ''} onClick={() => go(doc.id, p.id, entity)}>{p.title}</a>
            ))}
          </div>
        ))}
        {page.board ? (
          <CycleIssues onIssues={setIssues} onAdd={(i) => apiRef.current?.addIssue(i)}
            onBoard={new Set(boardNotes.map((n) => n.linear?.id).filter(Boolean))} />
        ) : (
          <>
            <div className="section">Dimensions</div>
            {Object.entries(DIMENSIONS).map(([d, { label, color }]) => (
              <label key={d} className="dim">
                <input type="checkbox" checked={!hidden.has(d)} onChange={() => toggle(d)} />
                <span className="swatch" style={{ background: color }} /> {label}
              </label>
            ))}
          </>
        )}
      </nav>
      <main>
        <header>
          <button className="focus-toggle" onClick={() => setFocus(!focus)}>{focus ? '⇤ Panels' : '⤢ Focus'}</button>
          <div className="eyebrow">{doc.title} › {page.section}</div>
          <h2>{page.title}</h2>
          <p>{page.intro}</p>
        </header>
        <div className="canvas">
          {page.board ? (
            <ReactFlowProvider>
              <Board isRef={isRef} colorOf={colorOf} onRef={(id) => go(doc.id, page.id, id)}
                selected={entity} onSelect={(id) => go(doc.id, page.id, id)} onNotes={setBoardNotes}
                issues={issues} apiRef={apiRef} />
            </ReactFlowProvider>
          ) : page.sequence ? (
            <Sequence doc={doc} page={page} entity={entity} hidden={hidden} />
          ) : (
            <ReactFlowProvider>
              <Diagram key={`${doc.id}/${page.id}`} doc={doc} page={page} entity={entity} hidden={hidden} />
            </ReactFlowProvider>
          )}
        </div>
        <footer>
          {prev ? <a onClick={() => go(doc.id, prev.id)}>← {prev.title}</a> : <span />}
          {next && <a onClick={() => go(doc.id, next.id)}>{next.title} →</a>}
        </footer>
      </main>
      {note ? (
        <NoteAside note={note} notes={boardNotes} issues={issues}
          onSaveBody={(id, body) => apiRef.current?.saveBody(id, body) ?? Promise.reject(new Error('Board not loaded'))} isRef={isRef} colorOf={colorOf}
          onRef={(id) => go(doc.id, page.id, id)} onSelect={(id) => go(doc.id, page.id, id)} />
      ) : (
        <Panel doc={doc} page={page} entity={entity} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

