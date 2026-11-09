import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow, useNodesState, useConnection, useUpdateNodeInternals, Panel as FlowPanel } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import '../docs/assets/custom.css';
import './styles.css';

import { docs, replaceSdd } from './content/index.js';
import { ENVS, ID, NEW_KINDS, OP_STATES, SIDES, loadSdd, nextSide, ops, saveSdd, statusesOf } from './SddEdit.js';

const POSITIONS = { right: Position.Right, bottom: Position.Bottom, left: Position.Left, top: Position.Top };
import { Board, Labels, NoteAside, Stickies } from './Board.jsx';
import { CycleIssues } from './Linear.jsx';
import { Orchestrator } from './Orchestrator.jsx';

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
  prd: { label: 'Product requirement', color: '#a07800', prefixes: ['PRD'] },
  adr: { label: 'Architecture decision', color: '#6b4f3a', prefixes: ['ADR'] },
  plan: { label: 'Plan', color: '#3d6b8c', prefixes: ['PLAN'] },
  task: { label: 'Task', color: '#6d7a1f', prefixes: ['TASK'] },
  acc: { label: 'Acceptance criterion', color: '#0f7b6c', prefixes: ['ACC'] },
  cod: { label: 'Code change', color: '#0284c7', prefixes: ['COD'] },
  op: { label: 'Operation', color: '#7c3aed', prefixes: ['OP'] },
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

const buildRelations = () => [...new Map(docs.flatMap((d) => d.relations).map((r) => [r.join('|'), r])).values()];
// Rebuilt when a _sdd.json doc is edited or reloaded (App.refresh).
let relations = buildRelations();

const NODE_W = 230;
const NODE_H = 66;
// Cards with columns grow one row per column; must match .card-cols in styles.css.
const ROW_H = 17;
const colsOf = (id) => entityDocs(id).find((e) => e.columns)?.columns;
const iconOf = (id) => entityDocs(id).find((e) => e.icon)?.icon;
// Labels (post-its, like WIP board notes): an entity's `tags` in any doc, merged.
const tagsOf = (id) => [...new Set(entityDocs(id).flatMap((e) => e.tags ?? []))];
// Status LED from an entity's `status` property (TASK, ACC…; sdd-convert-skill.md), like `tags`. First match wins:
// a warning or block outranks done ("done ⚠" is yellow). Unknown words are grey; no status, no LED.
// COD's "dev" (merged, not released) is yellow; "released" is green.
const LEDS = [['red', /blocked|regressed|fail|❌/], ['yellow', /partial|review|progress|wip|doing|⚠|🟡|^dev$/],
  ['green', /done|met|ok|released|✅/], ['grey', /./]];
// An OP's status is a list of targets, [{ env, state }]: green when every target is done, yellow when some are,
// grey when none is. No target, no LED.
const statusOf = (id) => {
  const s = entityDocs(id).map((e) => e.status).find((x) => (Array.isArray(x) ? x.length : x));
  if (!s) return null;
  if (Array.isArray(s)) {
    const done = s.filter((t) => t.state === 'done').length;
    return { text: s.map((t) => `${t.env} ${t.state}`).join(' · '), led: done === s.length ? 'green' : done ? 'yellow' : 'grey', targets: s };
  }
  return { text: s, led: LEDS.find(([, re]) => re.test(s.toLowerCase()))[0] };
};
// Environment badge (eph, dev, staging, sandbox, prod) from an entity's `env` property.
const envOf = (id) => entityDocs(id).map((e) => e.env).find(Boolean);
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
  const nodes = pageGraph(page).nodes.map((n) => ({ ...n, columns: colsOf(n.ref), icon: n.icon ?? iconOf(n.ref), tags: tagsOf(n.ref), status: statusOf(n.ref), env: envOf(n.ref) }));
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
    // A position saved by dragging (editable _sdd.json pages) wins over the computed layout.
    if (!parentId && page.positions?.[id]) return { position: page.positions[id] };
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
  const relOf = (a, b) => (refOf[a] && refOf[b] ? `${refOf[a]}~${refOf[b]}` : null);
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
    // page.sides["A~B"]: arrow ends moved off the default sides (rotated in the relation panel; Card's side handles).
    edges: edges.map(([a, b, label, dashed], i) => ({
      id: `e${i}`,
      data: { rel: relOf(a, b) },
      ...(page.sides?.[relOf(a, b)]?.from && { sourceHandle: `s-${page.sides[relOf(a, b)].from}` }),
      ...(page.sides?.[relOf(a, b)]?.to && { targetHandle: `t-${page.sides[relOf(a, b)].to}` }),
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

function Card({ id, data, selected }) {
  const { color } = DIMENSIONS[data.dim];
  // Editable pages link like the WIP board: drag the → handle onto any part of another card (the whole card is a
  // drop zone while a link is dragged), or click → and then the other card. Handles that come and go must be
  // re-measured, or edges lose their ends.
  const dragging = useConnection((c) => c.inProgress && c.fromNode.id !== id);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    if (data.editable) updateNodeInternals(id);
  }, [dragging, data.editable, id, updateNodeInternals]);
  const cls = ['card', data.kind, data.focused && 'focused', data.faded && 'faded', data.match && 'match', selected && 'selected',
    (dragging || data.linkTarget) && 'droppable', data.linkSource && 'linking'];
  return (
    <div className={cls.filter(Boolean).join(' ')} style={{ borderLeftColor: color }}>
      <Stickies labels={data.tags ?? []} />
      <Handle type="target" position={data.horizontal ? Position.Left : Position.Top} />
      {data.editable && dragging && <Handle id="drop" type="target" position={Position.Left} className="card-drop" isConnectableStart={false} />}
      <div className="card-label">
        {data.status && <span className={`led ${data.status.led}`} title={data.status.text} aria-label={`Status: ${data.status.text}`} />}
        <Icon icon={data.icon} />{data.label}
        {data.env && <span className={`env-badge ${data.env}`} title={`Environment: ${data.env}`}>{data.env}</span>}
        {/* A code change lives in a repo, not an environment: its badge is where it got (wip, review, dev, released). */}
        {data.ref?.startsWith('COD-') && data.status && <span className="env-badge" title="Code change status">{data.status.text}</span>}
      </div>
      {data.status?.targets && (
        <div className="card-envs">
          {data.status.targets.map((t) => <span key={t.env} className={`env-chip ${t.state}`} title={`${t.env}: ${t.state}`}>{t.env}</span>)}
        </div>
      )}
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
      {/* Hidden ends for rotated arrows (page.sides); after the defaults, which edges without a handle id take. */}
      {SIDES.map((s) => <Handle key={`s-${s}`} id={`s-${s}`} type="source" position={POSITIONS[s]} className="side-handle" isConnectable={false} />)}
      {SIDES.map((s) => <Handle key={`t-${s}`} id={`t-${s}`} type="target" position={POSITIONS[s]} className="side-handle" isConnectable={false} />)}
      {data.editable && (
        <Handle id="link" type="source" position={Position.Right} className="card-link" isConnectableEnd={false}
          title="Drag onto another node, or click and then click it"
          onClick={(e) => {
            e.stopPropagation();
            data.onStartLink();
          }}>→</Handle>
      )}
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

// Folder > doc > section > page, from the src/content folder layout. The branch holding the current page is open.
// Called with no label for the root; each folder calls it again one level deeper.
function DiagramTree({ label, docs: inside = docs, level = 0, route }) {
  const deeper = inside.filter((d) => d.dirs.length > level);
  const children = (
    <>
      {[...new Set(deeper.map((d) => d.dirs[level]))].map((f) => (
        <DiagramTree key={f} label={f} docs={deeper.filter((d) => d.dirs[level] === f)} level={level + 1} route={route} />
      ))}
      {inside.filter((d) => d.dirs.length === level).map((d) => (
        <details key={d.id} className="tree" open={d === route.doc}>
          <summary>{d.title}</summary>
          {[...new Set(d.pages.map((p) => p.section))].map((s) => (
            <details key={s} className="tree" open={d === route.doc && route.page.section === s}>
              <summary className="section">{s}</summary>
              {d.pages.filter((p) => p.section === s).map((p) => (
                <a key={p.id} className={p === route.page ? 'current' : ''}
                  onClick={() => go(d.id, p.id, d === route.doc ? route.entity : null)}>{p.title}</a>
              ))}
            </details>
          ))}
        </details>
      ))}
    </>
  );
  if (!label) return children;
  return (
    <details className="tree" open={inside.includes(route.doc)}>
      <summary>📁 {label}</summary>
      {children}
    </details>
  );
}

// Suggested label for a new relation, from the skill's spec conventions (sdd-convert-skill.md).
const LINK_LABELS = [[/^PRD$/, /^ADR$/, 'decided by'], [/^PRD$/, /^PLAN$/, 'planned by'], [/^PRD$/, /^ACC$/, 'accepted when'],
  [/^PLAN$/, /^(TASK|COD|OP)$/, 'step'], [/^PLAN$/, /^ACC$/, 'done when'], [/^(TASK|COD|OP)$/, /^ACC$/, 'satisfies'],
  [/^TASK$/, /^(COD|OP)$/, 'done by'], [/^COD$/, /^OP$/, 'deployed by'], [/^(TASK|COD|OP)$/, /^(TASK|COD|OP)$/, 'before'],
  [/^ADR$/, /./, 'shapes'], [/^(TASK|COD|OP)$/, /./, 'changes'], [/^ACC$/, /./, 'checks'], [/^PRD$/, /./, 'implemented by']];
const linkLabel = (a, b) => LINK_LABELS.find(([x, y]) => x.test(a.split('-')[0]) && y.test(b.split('-')[0]))?.[2] ?? '';

// onPick: a click on a node calls it instead of navigating (the flow modal); the view then fits all, no zoom.
// zoomTo: { id } asks for one zoom onto that entity once the route shows it, even where clicks never zoom (editable).
// Search over a node: its id, label and, in a _sdd.json, its whole entity (text, why, tags, status, env).
const matches = (doc, n, q) => [n.data.ref, n.data.label, JSON.stringify(doc.raw?.entities?.[n.data.ref] ?? '')]
  .join(' ').toLowerCase().includes(q);

function Diagram({ doc, page, entity, hidden, edit, onPick, zoomTo, query = '' }) {
  const base = useMemo(() => layout(page), [page]);
  const { fitView, screenToFlowPosition } = useReactFlow();
  // Dragged positions live here until the page changes (the Diagram key remounts this state).
  // An edited _sdd.json page rebuilds base: take its saved positions without remounting (the viewport stays).
  const [moved, setMoved, onNodesChange] = useNodesState(base.nodes);
  useEffect(() => setMoved(base.nodes), [base, setMoved]);
  const refOf = (id) => base.nodes.find((n) => n.id === id)?.data.ref;
  const connect = ({ source, target }) => {
    const [a, b] = [refOf(source), refOf(target)];
    if (!a || !b || a === b) return;
    const label = prompt(`Relation ${a} → ${b}, label:`, linkLabel(a, b));
    if (label !== null) edit.link([a, b, label.trim()]);
  };
  const addAtCenter = (kind) => {
    const r = document.querySelector('.canvas').getBoundingClientRect();
    const p = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    edit.add(kind, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  };
  // Click-to-link, as on the WIP board: the card whose → was clicked; the next card clicked is the target.
  const linkable = !!edit && !!page.entities;
  const [linkFrom, setLinkFrom] = useState(null);
  useEffect(() => {
    if (!linkFrom) return;
    const esc = (e) => e.key === 'Escape' && setLinkFrom(null);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [linkFrom]);

  // A relation (from~to) focuses both ends and the edge itself.
  const focus = entity?.split('~') ?? [];
  const q = query.trim().toLowerCase();
  const hit = (n) => !q || (n.type === 'card' && matches(doc, n, q));
  const nodes = moved.map((n) => ({
    ...n,
    data: {
      ...n.data, focused: focus.includes(n.data.ref), faded: hidden.has(n.data.dim) || !hit(n), match: !!q && hit(n),
      ...(linkable && n.type === 'card' && {
        editable: true, linkSource: linkFrom === n.id, linkTarget: !!linkFrom && linkFrom !== n.id,
        onStartLink: () => setLinkFrom((f) => (f === n.id ? null : n.id)),
      }),
    },
  }));
  const edges = base.edges.map((e) => (entity && e.data.rel === entity ? { ...e, className: 'focused' } : e));

  // Zooms to the selection when it changes, not when the page data does: an edited _sdd.json rebuilds base on every
  // save and reload, and the view must stay where the user left it. Editable diagrams zoom only for the entity the
  // page opened on (a deep link): there a click selects a node to edit or drag, it does not navigate.
  const opened = useRef(false);
  const zoomed = useRef(null);
  useEffect(() => {
    const forced = zoomTo && zoomTo !== zoomed.current && zoomTo.id === entity;
    if (forced) zoomed.current = zoomTo;
    if (onPick || (edit && opened.current && !forced)) return;
    opened.current = true;
    const focus = entity?.split('~') ?? [];
    const hits = base.nodes.filter((n) => focus.includes(n.data.ref)).map((n) => ({ id: n.id }));
    // Wait one frame so React Flow has measured the new nodes.
    if (hits.length) requestAnimationFrame(() => fitView({ nodes: hits, maxZoom: 1.2, duration: 400 }));
  }, [entity, fitView, zoomTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // A search frames its matches once typing pauses.
  useEffect(() => {
    if (!q) return;
    const hits = base.nodes.filter(hit).map((n) => ({ id: n.id }));
    const t = setTimeout(() => hits.length && fitView({ nodes: hits, maxZoom: 1.2, duration: 400 }), 300);
    return () => clearTimeout(t);
  }, [q, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlow
      key={`${doc.id}/${page.id}`}
      fitView
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={nodeTypes}
      // Lanes only react on their label, so empty space inside a group stays inert.
      onNodeClick={(e, n) => {
        if (linkFrom && n.type === 'card') {
          connect({ source: linkFrom, target: n.id });
          return setLinkFrom(null);
        }
        if (n.data.ref && (n.type === 'card' || e.target.closest('.lane-label'))) (onPick ?? ((r) => go(doc.id, page.id, r)))(n.data.ref);
      }}
      onEdgeClick={(_, e) => !onPick && e.data.rel && go(doc.id, page.id, e.data.rel)}
      onPaneClick={() => (linkFrom ? setLinkFrom(null) : !onPick && go(doc.id, page.id))}
      // Links are relations, drawn on entity pages; flow pages (nodes + edges) only move.
      nodesConnectable={linkable}
      onConnect={linkable ? connect : undefined}
      connectOnClick={false}
      connectionLineStyle={{ strokeDasharray: '6 4', strokeWidth: 2 }}
      onNodeDragStop={edit ? (_, n, all) => edit.move((all?.length ? all : [n]).filter((x) => x.type === 'card')
        .map((x) => ({ id: x.id, x: x.position.x, y: x.position.y }))) : undefined}
      // Deleting removes from the file: only through the panel's button, never a stray Backspace.
      deleteKeyCode={null}
      minZoom={0.1}
    >
      <Background gap={20} />
      <Controls />
      <MiniMap pannable zoomable nodeColor={(n) => DIMENSIONS[n.data.dim]?.color ?? 'transparent'} />
      {edit && (
        <FlowPanel position="top-left">
          {page.entities && Object.keys(NEW_KINDS).map((k) => (
            <button key={k} className="focus-toggle" style={{ borderColor: colorOf(`${k}-x`) }} onClick={() => addAtCenter(k)}>+ {k}</button>
          ))}
          <span className="board-hint">
            {linkFrom ? 'Click a node to link it · Esc to cancel' : 'Drag nodes to place them · → on a node to link it'}
          </span>
          {edit.error && <span className="board-error">{edit.error}</span>}
        </FlowPanel>
      )}
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

// Panel editor of a node declared in the open _sdd.json: id, text, why. Remounted per entity (key).
function EntityEditor({ id, edit }) {
  const entry = edit.raw.entities?.[id];
  const [draft, setDraft] = useState(() => ({
    id, text: typeof entry === 'string' ? entry : entry?.text ?? '', why: typeof entry === 'object' ? entry?.why ?? '' : '',
  }));
  const kind = id.split('-')[0];
  const raw = typeof entry === 'object' ? entry?.status : undefined;
  const status = typeof raw === 'string' ? raw : '';
  const env = typeof entry === 'object' ? entry?.env ?? '' : '';
  // OP: status is its target environments, [{ env, state }]; COD lives in a repo, so it has no env.
  const isOp = kind === 'OP';
  const targets = Array.isArray(raw) ? raw : [];
  const needsWhy = ['PRD', 'ADR', 'PLAN'].includes(kind) || draft.why;
  const nextId = draft.id.trim();
  const problem = !ID.test(nextId) ? 'Id: PREFIX-Name' : nextId !== id && edit.raw.entities?.[nextId] !== undefined ? `${nextId} already exists`
    : (kind === 'PRD' && !draft.why.trim()) ? 'A PRD states its why' : null;
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const save = () => !problem && edit.save(id, nextId, { text: draft.text.trim(), why: draft.why.trim() });
  const keys = (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save();
  return (
    <section className="sdd-editor" onKeyDown={keys}>
      {/* Labels and status save at once, like board labels; id, text and why save with the button. */}
      <Labels labels={typeof entry === 'object' ? entry?.tags ?? [] : []} onSave={(tags) => edit.field(id, 'tags', tags)} />
      <label>Id <input value={draft.id} onChange={set('id')} /></label>
      <label>Text <textarea rows={4} value={draft.text} onChange={set('text')} /></label>
      {needsWhy && <label>Why <textarea rows={3} value={draft.why} onChange={set('why')} /></label>}
      {isOp && <OpTargets targets={targets} onChange={(next) => edit.field(id, 'status', next)} />}
      <div className="note-editor-bar">
        <button className="focus-toggle" onClick={save} disabled={!!problem}>Save ⌘↵</button>
        {/* Saved on change. A custom value from the file ("done ⚠") stays in the list so it is not lost. */}
        {!isOp && (
          <select className="sdd-status" aria-label="Status" value={status} onChange={(e) => edit.field(id, 'status', e.target.value)}>
            <option value="">— no status</option>
            {[...new Set([...statusesOf(kind), status].filter(Boolean))].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {!isOp && kind !== 'COD' && (
          <select className="sdd-status" aria-label="Environment" value={env} onChange={(e) => edit.field(id, 'env', e.target.value)}>
            <option value="">— no env</option>
            {[...new Set([...ENVS, env].filter(Boolean))].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button className="focus-toggle danger" onClick={() => confirm(`Remove ${id} and its relations from this diagram?`) && edit.remove(id)}>🗑 Delete</button>
        {problem && <span className="board-error">{problem}</span>}
      </div>
    </section>
  );
}

// An OP's targets: one checkbox per environment, a pending/done state for each ticked one. Saved on change,
// in ENVS order; an env unknown to ENVS (from the file) keeps its row.
function OpTargets({ targets, onChange }) {
  const byEnv = Object.fromEntries(targets.map((t) => [t.env, t]));
  const envs = [...new Set([...ENVS, ...targets.map((t) => t.env)])];
  const set = (env, t) => onChange(envs.map((e) => (e === env ? t : byEnv[e])).filter(Boolean));
  return (
    <fieldset className="op-targets">
      <legend>Environments</legend>
      {envs.map((env) => (
        <label key={env}>
          <input type="checkbox" checked={!!byEnv[env]} onChange={(e) => set(env, e.target.checked ? { env, state: 'pending' } : null)} />
          <span>{env}</span>
          {byEnv[env] && (
            <select className="sdd-status" aria-label={`${env} state`} value={byEnv[env].state}
              onChange={(e) => set(env, { env, state: e.target.value })}>
              {[...new Set([...OP_STATES, byEnv[env].state])].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </label>
      ))}
    </fieldset>
  );
}

// Right panel options on a _sdd.json diagram: [key, icon, label], like the sidebar's Browse / Linear.
const SIDE_MENUS = [['node', '🔎', 'Node'], ['agent', '🤖', 'Agent']];
const SideMenu = ({ side, onSide }) => (
  <div className="menu panel-menu">
    {SIDE_MENUS.map(([m, icon, label]) => (
      <button key={m} className={side === m ? 'on' : ''} onClick={() => onSide(m)}>{icon} {label}</button>
    ))}
  </div>
);

function RelationPanel({ doc, page, rel, edit, menu }) {
  const [a, b] = rel.split('~');
  const between = ([x, y]) => (x === a && y === b) || (x === b && y === a);
  const own = edit ? (edit.raw.relations ?? []).filter(between) : [];
  const labels = [...new Map([...refEdges(page), ...relations].filter(between).map((r) => [r.join('|'), r])).values()];
  const pages = docs.flatMap((d) => d.pages.filter((p) => refEdges(p).some(([x, y]) => x === a && y === b)).map((p) => ({ doc: d, page: p })));
  // The arrow's ends on this page: saved sides, else the card's default handles for the page direction.
  const drawn = edit && refEdges(page).some(([x, y]) => x === a && y === b);
  const lr = page.direction === 'LR';
  const sides = { from: page.sides?.[rel]?.from ?? (lr ? 'right' : 'bottom'), to: page.sides?.[rel]?.to ?? (lr ? 'left' : 'top') };
  const end = (id) => (
    <section key={id}>
      <h3><a onClick={() => openEntity(doc, page, id)} style={{ color: DIMENSIONS[dimOf(id)].color }}>{id}</a></h3>
      <p>{(entityDocs(id).find((e) => e.doc === doc) ?? entityDocs(id)[0])?.text ?? '⚠ Not documented yet.'}</p>
    </section>
  );
  return (
    <aside className="panel">
      {menu}
      <div className="badge" style={{ background: 'var(--color-neutral-500)' }}>Relation</div>
      <h2>{a} → {b}</h2>
      <ul>
        {labels.map(([x, y, l]) => (
          <li key={`${x}|${y}|${l}`}>{x === a ? '→' : '←'} <b>{l || '—'}</b></li>
        ))}
      </ul>
      {drawn && (
        <div className="rel-rotate">
          <button className="focus-toggle" title={`Origin side: ${sides.from} → ${nextSide(sides.from)}`}
            onClick={() => edit.side(rel, 'from', nextSide(sides.from))}>↻ Rotate origin · {sides.from}</button>
          <button className="focus-toggle" title={`Destination side: ${sides.to} → ${nextSide(sides.to)}`}
            onClick={() => edit.side(rel, 'to', nextSide(sides.to))}>↻ Rotate destination · {sides.to}</button>
        </div>
      )}
      {own.length > 0 && (
        <>
          <h3>Edit in {doc.title}</h3>
          <ul>
            {own.map((r) => (
              <li key={r.join('|')}>
                {r[0]} → {r[1]} <b>{r[2] || '—'}</b>{' '}
                <button className="focus-toggle" onClick={() => {
                  const l = prompt('Label:', r[2] ?? '');
                  if (l !== null) edit.relabel(r, l.trim());
                }}>✎</button>{' '}
                <button className="focus-toggle danger" onClick={() => {
                  edit.unlink(r);
                  if (own.length === 1) go(doc.id, page.id);
                }}>🗑</button>
              </li>
            ))}
          </ul>
        </>
      )}
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

// Flow around an entity ([a, b]: a precedes b), up to `depth` levels (Infinity = all). 'up': the entity and every node
// that reaches it through incoming relations; 'down': every node it reaches through outgoing ones.
// Breadth-first over all docs' relations; cycles stop at nodes already seen.
const FLOWS = {
  up: { icon: '⤴', title: 'Upstream', near: 'preceding', none: 'No incoming relations: nothing precedes' },
  down: { icon: '⤵', title: 'Downstream', near: 'following', none: 'No outgoing relations: nothing follows' },
};
const flowOf = (id, depth, dir) => {
  const [from, to] = dir === 'up' ? [1, 0] : [0, 1];
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    frontier = relations.filter((r) => frontier.includes(r[from])).map((r) => r[to])
      .filter((n) => !seen.has(n) && seen.add(n));
  }
  return [...seen];
};
const DEPTHS = [[1, '1'], [2, '2'], [3, '3'], [Infinity, 'all']];

// A temporary, read-only canvas over the diagram: the node and its upstream or downstream (dir), laid out left to right.
// Clicking a node closes it and selects that node on the main diagram (App); Esc, ✕ or the backdrop just close it.
function FlowModal({ doc, id, dir, hidden, onPick, onClose }) {
  const [depth, setDepth] = useState(Infinity);
  const flow = FLOWS[dir];
  const ids = flowOf(id, depth, dir);
  const key = ids.join('|');
  const page = useMemo(() => ({
    id: `${dir}-${id}`, title: `${flow.title} of ${id}`, entities: ids, direction: 'LR', edgeType: 'smoothstep',
  }), [id, dir, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={page.title}>
        <div className="modal-head">
          <strong>{flow.icon} {flow.title} of <span style={{ color: colorOf(id) }}>{id}</span></strong>
          <span className="muted">{ids.length - 1} {flow.near} node{ids.length === 2 ? '' : 's'}</span>
          <span className="modal-depth">
            Depth {DEPTHS.map(([d, label]) => (
              <button key={label} className={`focus-toggle${depth === d ? ' on' : ''}`} onClick={() => setDepth(d)}>{label}</button>
            ))}
          </span>
          <button className="focus-toggle" title="Close (Esc)" onClick={onClose}>✕</button>
        </div>
        <div className="modal-canvas">
          {ids.length > 1 ? (
            <ReactFlowProvider>
              <Diagram key={key} doc={doc} page={page} entity={id} hidden={hidden} onPick={onPick} />
            </ReactFlowProvider>
          ) : <p className="muted modal-empty">{flow.none} {id}.</p>}
        </div>
      </div>
    </div>
  );
}

function Panel({ doc, page, entity, edit, menu, onFlow }) {
  if (!entity) return <aside className="panel muted">{menu}Click a node to read its doc and jump to the other dimensions it lives in.</aside>;
  if (entity.includes('~')) return <RelationPanel doc={doc} page={page} rel={entity} edit={edit} menu={menu} />;
  const editable = edit && edit.raw.entities?.[entity] !== undefined;
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
      {menu}
      <div className="badge" style={{ background: DIMENSIONS[dim].color }}>{DIMENSIONS[dim].label}</div>
      <h2>{entity}</h2>
      {onFlow && (
        <div className="flow-buttons">
          <button className="focus-toggle" title="This node and everything that leads to it" onClick={() => onFlow({ id: entity, dir: 'up' })}>⤴ Upstream</button>
          <button className="focus-toggle" title="This node and everything it leads to" onClick={() => onFlow({ id: entity, dir: 'down' })}>⤵ Downstream</button>
        </div>
      )}
      {editable && <EntityEditor key={entity} id={entity} edit={edit} />}
      {edit && !editable && (
        <p className="muted">
          Declared in another diagram, edit it there.{' '}
          <button className="focus-toggle danger" onClick={() => edit.remove(entity)}>Remove from this diagram</button>
        </p>
      )}
      {described.length === 0 && !editable && <p>⚠ Not documented yet.</p>}
      {described.filter((e) => !(editable && e.doc.file === edit.file)).map(({ doc: d, text, why, columns }) => (
        <section key={d.id}>
          {described.length > 1 && <h3>From {d.title}</h3>}
          <p>{text}</p>
          {why && <p><strong>Why:</strong> {why}</p>}
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

// A boolean kept in localStorage; storage may be unavailable (private window), then it is per page load.
function useFold(key) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const set = (next) => setOn((v) => {
    const value = typeof next === 'function' ? next(v) : next;
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {}
    return value;
  });
  return [on, () => set((v) => !v), set];
}

// Grid columns: folded sides shrink to a strip; the WIP board widens both sides (Linear list, note editor, sessions).
// The right panel is wide on purpose: note editor and Claude chat, entity docs with column tables.
const FOLDED_W = '36px';
// Sidebar menu options: [key, icon, label]. Linear lists the current cycle and lives on the WIP board.
const MENUS = [['browse', '🗂', 'Browse'], ['linear', '◷', 'Linear']];

const columnsOf = ({ focus, folded, panelFolded, board }) => (focus ? '1fr' : [
  folded ? FOLDED_W : board ? '380px' : '240px',
  '1fr',
  panelFolded ? FOLDED_W : board ? '760px' : '680px',
].join(' '));

function App() {
  const [route, setRoute] = useState(parseHash);
  const [hidden, setHidden] = useState(new Set());
  const [focus, setFocus] = useState(false);
  // Each side folds on its own (Focus hides both). Remembered per browser.
  // The open sidebar menu ('browse' | 'linear'), '' when folded. Remembered per browser.
  const [menu, setMenuState] = useState(() => {
    try {
      return localStorage.getItem('sidebar-menu') ?? 'browse';
    } catch {
      return 'browse';
    }
  });
  const setMenu = (m) => {
    setMenuState(m);
    try {
      localStorage.setItem('sidebar-menu', m);
    } catch {}
  };
  const folded = !menu;
  const [panelFolded, foldPanel, setPanelFolded] = useFold('panel-folded');
  // Clicking a node (board note or diagram card) brings a folded panel back, even when that node is already
  // selected and the route does not change. A node's own buttons and handles (✕, +, →) leave it folded.
  // On a _sdd.json diagram it also leaves the Agent tab for the 🔎 Node tab, and so does an edge (relation panel).
  const showPanelOnNode = (e) => {
    if (!e.target.closest('.react-flow__node, .react-flow__edge') || e.target.closest('button, .react-flow__handle')) return;
    if (panelFolded) setPanelFolded(false);
    if (side === 'agent') setSide('node');
  };
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

  // _sdd.json docs: the bundle holds the build-time copy; the bridge serves the file as saved now (edits, agents,
  // an editor). Read on load and on focus, like the WIP board. No bridge: the bundled copy stays, read-only.
  const [sddError, setSddError] = useState(null);
  const refresh = () => {
    relations = buildRelations();
    setRoute(parseHash());
  };
  // Saves still in flight: a read then could return the file before them and undo an edit on screen
  // (closing a prompt() or confirm() refocuses the window, which reads).
  const saving = useRef(0);
  // The same read, for the orchestrator: the agent edits the file, the diagram follows when a run ends.
  const pullRef = useRef(null);
  // Right panel tab on _sdd.json diagrams ('node' | 'agent'). Remembered per browser, like the sidebar menu.
  const [side, setSideState] = useState(() => {
    try {
      return localStorage.getItem('panel-menu') ?? 'node';
    } catch {
      return 'node';
    }
  });
  const setSide = (m) => {
    setSideState(m);
    try {
      localStorage.setItem('panel-menu', m);
    } catch {}
  };
  useEffect(() => {
    const pull = pullRef.current = () => {
      if (saving.current) return;
      return Promise.all(docs.filter((d) => d.file).map((d) => loadSdd(d.file).then((raw) => {
        if (saving.current || JSON.stringify(raw) === JSON.stringify(docs.find((x) => x.file === d.file)?.raw)) return false;
        replaceSdd(d.file, raw);
        return true;
      })))
        .then((changed) => {
          setSddError(null);
          if (changed.some(Boolean)) refresh();
        }, () => setSddError('Read-only: editing needs the local bridge (npm run dev).'));
    };
    pull();
    addEventListener('focus', pull);
    return () => removeEventListener('focus', pull);
  }, []);

  const { doc, page, entity } = route;
  // The open flow modal ({ id, dir: 'up' | 'down' }, FlowModal), or null.
  const [flow, setFlow] = useState(null);
  // A zoom asked from outside the canvas (a pick in the flow modal), consumed by Diagram.
  const [zoomTo, setZoomTo] = useState(null);
  // Diagram search (header input); cleared when the page changes.
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [doc.id, page.id]);
  // Every change is applied at once, then written; a failed write shows in the toolbar and the next load restores the file.
  const commit = (raw, then) => {
    replaceSdd(doc.file, raw);
    refresh();
    then?.();
    saving.current++;
    saveSdd(doc.file, raw)
      .then(() => setSddError(null), (e) => setSddError(`${e.message}. Not saved: editing needs npm run dev.`))
      .finally(() => saving.current--);
  };
  const edit = doc.file && {
    file: doc.file,
    raw: doc.raw,
    error: sddError,
    move: (moves) => commit(ops.move(doc.raw, page.id, moves)),
    add: (kind, pos) => {
      const { raw, id } = ops.add(doc.raw, page.id, kind, pos);
      commit(raw, () => go(doc.id, page.id, id));
    },
    save: (id, to, value) => commit(ops.rename(ops.describe(doc.raw, id, value), id, to), () => to !== id && go(doc.id, page.id, to)),
    remove: (id) => commit(ops.remove(doc.raw, id), () => go(doc.id, page.id)),
    field: (id, key, value) => commit(ops.field(doc.raw, id, key, value)),
    link: (rel) => commit(ops.link(doc.raw, rel)),
    unlink: (rel) => commit(ops.unlink(doc.raw, rel)),
    relabel: (rel, label) => commit(ops.relabel(doc.raw, rel, label)),
    side: (rel, end, side) => commit(ops.side(doc.raw, page.id, rel, end, side)),
  };
  // On the WIP board the route entity is either a note id or a DSL ref clicked inside a note.
  const note = page.board && boardNotes.find((n) => n.id === entity);
  // Filled by layouts/diagrams.html from the reactflow-* front matter; absent under `npm run dev:diagrams`.
  const home = window.reactflowHomes?.[doc.id];
  const i = doc.pages.indexOf(page);
  const [prev, next] = [doc.pages[i - 1], doc.pages[i + 1]];
  const openMenu = (m) => {
    setMenu(m);
    if (m === 'linear' && !page.board) go('wip-board', 'board');
  };
  const toggle = (d) => setHidden((h) => {
    const n = new Set(h);
    n.has(d) ? n.delete(d) : n.add(d);
    return n;
  });

  return (
    <div className={['layout', focus && 'focus', folded && 'folded', panelFolded && 'panel-folded'].filter(Boolean).join(' ')}
      style={{ gridTemplateColumns: columnsOf({ focus, folded, panelFolded, board: page.board }) }}>
      <button className="fold-toggle panel-fold" title={panelFolded ? 'Unfold panel' : 'Fold panel'} onClick={foldPanel}>
        {panelFolded ? '«' : '»'}
      </button>
      <nav className="sidebar">
        <div className="menu">
          {MENUS.map(([m, icon, label]) => (
            <button key={m} className={menu === m ? 'on' : ''} title={label} onClick={() => openMenu(m)}>
              {icon}{!folded && ` ${label}`}
            </button>
          ))}
          {!folded && <button className="fold" title="Fold menu" onClick={() => setMenu('')}>‹</button>}
        </div>
        {menu === 'browse' && (
          <>
            {home && <a className="back" href={home}>← Docs</a>}
            <h1>{doc.title}</h1>
            <DiagramTree route={route} />
            {!page.board && (
              <details className="tree">
                <summary className="section">Dimensions{hidden.size ? ` (${hidden.size} hidden)` : ''}</summary>
                {/* All on / all off. Half-checked when only some are hidden; a click then shows them all. */}
                <label className="dim all">
                  <input type="checkbox" checked={hidden.size === 0}
                    ref={(el) => el && (el.indeterminate = hidden.size > 0 && hidden.size < Object.keys(DIMENSIONS).length)}
                    onChange={() => setHidden(hidden.size === 0 ? new Set(Object.keys(DIMENSIONS)) : new Set())} />
                  {hidden.size === 0 ? 'Unmark all' : 'Mark all'}
                </label>
                {Object.entries(DIMENSIONS).map(([d, { label, color }]) => (
                  <label key={d} className="dim">
                    <input type="checkbox" checked={!hidden.has(d)} onChange={() => toggle(d)} />
                    <span className="swatch" style={{ background: color }} /> {label}
                  </label>
                ))}
              </details>
            )}
          </>
        )}
        {/* Mounted on the board even when hidden: the board reads note status from these issues. */}
        {page.board && (
          <div hidden={menu !== 'linear'}>
            <CycleIssues onIssues={setIssues} onAdd={(i) => apiRef.current?.addIssue(i)}
              onBoard={new Set(boardNotes.map((n) => n.linear?.id).filter(Boolean))} />
          </div>
        )}
      </nav>
      <main>
        <header>
          <button className="focus-toggle" onClick={() => setFocus(!focus)}>{focus ? '⇤ Panels' : '⤢ Focus'}</button>
          {!page.board && !page.sequence && (
            <input type="search" className="diagram-search" placeholder="🔍 Search nodes…" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          )}
          <div className="eyebrow">{doc.title} › {page.section}</div>
          <h2>{page.title}</h2>
        </header>
        <div className="canvas" onClickCapture={showPanelOnNode}>
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
              <Diagram key={`${doc.id}/${page.id}`} doc={doc} page={page} entity={entity} hidden={hidden} edit={edit} zoomTo={zoomTo} query={query} />
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
          onReload={() => apiRef.current?.reload()}
          onRename={(id, title) => apiRef.current?.rename(id, title)}
          onRotate={(rel, end) => apiRef.current?.rotate(rel, end)}
          onSaveTags={(id, tags) => apiRef.current?.saveTags(id, tags) ?? Promise.reject(new Error('Board not loaded'))}
          onSaveBody={(id, body) => apiRef.current?.saveBody(id, body) ?? Promise.reject(new Error('Board not loaded'))} isRef={isRef} colorOf={colorOf}
          onRef={(id) => go(doc.id, page.id, id)} onSelect={(id) => go(doc.id, page.id, id)} />
      ) : doc.file && side === 'agent' ? (
        <aside className="panel">
          <SideMenu side={side} onSide={setSide} />
          <Orchestrator doc={doc} onReload={() => pullRef.current?.()} />
        </aside>
      ) : (
        <Panel doc={doc} page={page} entity={entity} edit={edit} onFlow={setFlow}
          menu={doc.file && <SideMenu side={side} onSide={setSide} />} />
      )}
      {flow && (
        <FlowModal doc={doc} id={flow.id} dir={flow.dir} hidden={hidden} onClose={() => setFlow(null)}
          onPick={(id) => {
            // A pick leaves the modal for the node itself: zoomed on the main diagram, its panel open on the Node tab.
            setFlow(null);
            setSide('node');
            setPanelFolded(false);
            setZoomTo({ id });
            openEntity(doc, page, id);
          }} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

