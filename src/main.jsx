import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow, useNodesState, useConnection, useUpdateNodeInternals, Panel as FlowPanel } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import '../docs/assets/custom.css';
import './styles.css';

import { docs, replaceSdd, sddDoc } from './content/index.js';
import { ID, NEW_KINDS, SIDES, isUml, loadNarrativeBlocks, loadPlayerActions, loadSdd, nextSide, ops, prefixOf, saveSdd, statusesOf, titleOf } from './DiagramEditor.js';

const POSITIONS = { right: Position.Right, bottom: Position.Bottom, left: Position.Left, top: Position.Top };
import { KeyValues, Labels, Stickies, useDark } from './Board.jsx';
import { Orchestrator } from './Orchestrator.jsx';
import { EntityDocs, ResumeModal } from './Resume.jsx';

// A base URL from .env (injected by vite.config.js define), without trailing slashes. Never defaulted: unset → throw.
const requireEnvUrl = (name, value) => {
  if (!value) throw new Error(`${name} is not set: add it to the deck's .env and restart npm run dev.`);
  return value.replace(/\/+$/, '');
};

// Liber Daemonum graph dimensions and prefixes
const DIMENSIONS = {
  controlPoint: { label: 'Control Point', color: '#e63946', prefixes: ['controlPoint'] },
  narrativeBlock: { label: 'Narrative Block', color: '#3a86ff', prefixes: ['narrativeBlock'] },
  playerAction: { label: 'Player Action', color: '#06d6a0', prefixes: ['playerAction'] },
  actionSelection: { label: 'Action Selection', color: '#f77f00', prefixes: ['actionSelection'] },
  turn: { label: 'Turn', color: '#8338ec', prefixes: ['turn'] },
  custom: { label: 'Custom', color: '#457b9d', prefixes: ['custom'] },
  intention: { label: 'Intention', color: '#fb8500', prefixes: ['intention'] },
  event: { label: 'Event', color: '#e76f51', prefixes: ['event'] },
  demiurge: { label: 'Demiurge', color: '#6a0dad', prefixes: ['demiurge'] },
  cosmicStatistic: { label: 'Cosmic Statistic', color: '#7209b7', prefixes: ['cosmicStatistic'] },
  character: { label: 'Character', color: '#1d3557', prefixes: ['character'] },
  location: { label: 'Location', color: '#2a9d8f', prefixes: ['location'] },
  item: { label: 'Item', color: '#d4a373', prefixes: ['item'] },
  step: { label: 'Entity', color: '#56616e', prefixes: [] },
};

const dimOf = (id) => {
  const prefix = id?.split(/[.-]/)[0];
  return Object.keys(DIMENSIONS).find((d) => DIMENSIONS[d].prefixes.includes(prefix)) ?? 'step';
};
const isRef = (id) => dimOf(id) !== 'step';
const colorOf = (id) => DIMENSIONS[dimOf(id)]?.color ?? '#56616e';

// Entities and relations are shared by all docs: the same id in two docs is the same thing.
const entityDocs = (entity) =>
  docs
    .filter((d) => d.entities[entity])
    .map((d) => ({ doc: d, ...(typeof d.entities[entity] === 'string' ? { text: d.entities[entity] } : d.entities[entity]) }));

const buildRelations = () => [...new Map(docs.flatMap((d) => d.relations).map((r) => [r.join('|'), r])).values()];
// Rebuilt when a _sdd.json doc is edited or reloaded (App.refresh).
let relations = buildRelations();

// Undo/redo: snapshots of the diagram JSON kept per file (see `history` in App).
const HISTORY_LIMIT = 100;
const NODE_W = 230;
const NODE_H = 66;
// Cards with columns grow one row per column; must match .card-cols in styles.css.
const ROW_H = 17;
// UML entities (_sdd.json `type: "uml"`) list `properties`, drawn like `columns`.
const colsOf = (id) => entityDocs(id).map((e) => e.columns ?? e.properties).find(Boolean);
const umlOf = (id) => entityDocs(id).some((e) => e.type === 'uml');
const methodsOf = (id) => entityDocs(id).map((e) => e.methods).find(Boolean);
const iconOf = (id) => entityDocs(id).find((e) => e.icon)?.icon;
// Key-value properties of any node: an entity's `props`, [[key, value], …], drawn as rows inside its card.
const propsOf = (id) => entityDocs(id).map((e) => e.props).find((p) => p?.length);
// Labels (post-its, like WIP board notes): an entity's `tags` in any doc, merged.
const tagsOf = (id) => [...new Set(entityDocs(id).flatMap((e) => e.tags ?? []))];
// Status LED from an entity's `status` property (TASK, ACC…; sdd-convert-skill.md), like `tags`. First match wins:
// a warning or block outranks done ("done ⚠" is yellow). Unknown words are grey; no status, no LED.
// COD's "dev" (merged, not released) is yellow; "released" is green.
const LEDS = [['red', /blocked|regressed|fail|❌/], ['yellow', /partial|review|progress|wip|doing|⚠|🟡|^dev$/],
  ['green', /published|done|met|ok|released|✅/], ['grey', /./]];
const statusOf = (id) => {
  const s = entityDocs(id).map((e) => e.status).find(Boolean);
  if (!s || typeof s !== 'string') return null;
  return { text: s, led: LEDS.find(([, re]) => re.test(s.toLowerCase()))?.[0] ?? 'grey' };
};
// Environment badge (eph, dev, staging, sandbox, prod) from an entity's `env` property.
const envOf = (id) => entityDocs(id).map((e) => e.env).find(Boolean);
// An icon is an emoji or a path/URL to an image (e.g. '/icons/gcp/cloud-sql.svg' under static/).
const Icon = ({ icon }) => (!icon ? null : /[./]/.test(icon) ? <img className="icon" src={icon} alt="" /> : <span className="icon">{icon}</span>);
// A UML box's methods are a second compartment of rows, under the properties; `props` rows go under the label.
const heightOf = (n) => (n.columns || n.methods ? 42 + ((n.columns?.length ?? 0) + (n.methods?.length ?? 0)) * ROW_H : NODE_H)
  + (n.props ? 6 + n.props.length * ROW_H : 0);

// Normalize all page styles to the same node/edge shape.
function pageGraph(page) {
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
  return { nodes: page.nodes ?? [], edges: page.edges ?? [] };
}

function layout(page) {
  const { edges } = pageGraph(page);
  const nodes = pageGraph(page).nodes.map((n) => ({ ...n, columns: colsOf(n.ref), uml: umlOf(n.ref), methods: methodsOf(n.ref), icon: n.icon ?? iconOf(n.ref), tags: tagsOf(n.ref), props: propsOf(n.ref), status: statusOf(n.ref), env: envOf(n.ref) }));
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
  const cls = ['card', data.kind, data.uml && 'uml', data.focused && 'focused', data.faded && 'faded', data.match && 'match', selected && 'selected',
    (dragging || data.linkTarget) && 'droppable', data.linkSource && 'linking'];
  return (
    <div className={cls.filter(Boolean).join(' ')} style={data.uml ? { borderColor: color } : { borderLeftColor: color }}>
      <Stickies labels={data.tags ?? []} />
      <Handle type="target" position={data.horizontal ? Position.Left : Position.Top} />
      {data.editable && dragging && <Handle id="drop" type="target" position={Position.Left} className="card-drop" isConnectableStart={false} />}
      <div className="card-label">
        {data.status && <span className={`led ${data.status.led}`} title={data.status.text} aria-label={`Status: ${data.status.text}`} />}
        <Icon icon={data.icon} />{data.label}
        {data.env && <span className={`env-badge ${data.env}`} title={`Environment: ${data.env}`}>{data.env}</span>}
      </div>
      {data.ref && data.ref !== data.label && <div className="card-ref" style={{ color }}>{data.ref}</div>}
      {data.sub && <div className="card-sub">{data.sub}</div>}
      {data.props && (
        <table className="card-cols card-props">
          <tbody>
            {data.props.map(([k, v], i) => (
              <tr key={i} title={`${k}: ${v}`}><td>{k}</td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {data.columns && (
        <table className="card-cols">
          <tbody>
            {data.columns.map(([name, type]) => (
              <tr key={name}><td>{name}</td><td>{type}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {data.methods && (
        <table className="card-cols methods">
          <tbody>
            {data.methods.map(([name, type]) => (
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
// Hugo's "<page> – <site>" title, read once before App renames the tab.
const SITE_TITLE = document.title.split(' – ').at(-1);
const go = (docId, pageId, entity) => (location.hash = `/${docId}/${pageId}${entity ? `/${entity}` : ''}`);

// Folder > section > page, from the physical folder layout (src/content, docs/**). No doc level: the folder names it.
// Only a folder holding several docs prefixes each section with its doc title. The branch holding the current page is open.
// Called with no label for the root; each folder calls it again one level deeper.
function DiagramTree({ label, docs: inside = docs, level = 0, route }) {
  const deeper = inside.filter((d) => d.dirs.length > level);
  const here = inside.filter((d) => d.dirs.length === level);
  const children = (
    <>
      {[...new Set(deeper.map((d) => d.dirs[level]))].map((f) => (
        <DiagramTree key={f} label={f} docs={deeper.filter((d) => d.dirs[level] === f)} level={level + 1} route={route} />
      ))}
      {here.flatMap((d) => [...new Set(d.pages.map((p) => p.section))].map((s) => (
        <details key={`${d.id}/${s}`} className="tree" open={d === route.doc && route.page.section === s}>
          <summary className="section">{here.length > 1 ? `${d.title} › ${s}` : s}</summary>
          {d.pages.filter((p) => p.section === s).map((p) => (
            <a key={p.id} className={p === route.page ? 'current' : ''}
              onClick={() => go(d.id, p.id, d === route.doc ? route.entity : null)}>{p.title}</a>
          ))}
        </details>
      )))}
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
const LINK_LABELS = [
  [/^controlPoint$/, /^actionSelection$/, 'offers'],
  [/^actionSelection$/, /^playerAction$/, 'option'],
  [/^playerAction$/, /^controlPoint$/, 'resolves to'],
  [/^playerAction$/, /^narrativeBlock$/, 'triggers'],
  [/^narrativeBlock$/, /^controlPoint$/, 'advances to'],
  [/^controlPoint$/, /^narrativeBlock$/, 'develops into'],
  [/^character$/, /^controlPoint$/, 'participates in'],
  [/^character$/, /^playerAction$/, 'acts'],
  [/^demiurge$/, /^controlPoint$/, 'influences'],
  [/^cosmicStatistic$/, /^controlPoint$/, 'modulates'],
];
const linkLabel = (a, b) => LINK_LABELS.find(([x, y]) => x.test(a.split(/[.-]/)[0]) && y.test(b.split(/[.-]/)[0]))?.[2] ?? '';

// onPick: a click on a node calls it instead of navigating (the flow modal); the view then fits all, no zoom.
// zoomTo: { id } asks for one zoom onto that entity once the route shows it, even where clicks never zoom (editable).
// Search over a node: its id, label and, in a _sdd.json, its whole entity (text, why, tags, status, env).
const matches = (doc, n, q) => [n.data.ref, n.data.label, JSON.stringify(doc.raw?.entities?.[n.data.ref] ?? '')]
  .join(' ').toLowerCase().includes(q);

function Diagram({ doc, page, entity, hidden, edit, onPick, zoomTo, query = '' }) {
  const base = useMemo(() => layout(page), [page]);
  const dark = useDark();
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
  // In the flow modal (onPick) a click on a relation highlights it and its ends here, without navigating.
  const [picked, setPicked] = useState(null);
  const shown = (onPick && picked) || entity;
  const focus = shown?.split('~') ?? [];
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
  const edges = base.edges.map((e) => (shown && e.data.rel === shown ? { ...e, className: 'focused' } : e));

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
      colorMode={dark ? 'dark' : 'light'}
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
      onEdgeClick={(_, e) => e.data.rel && (onPick ? setPicked((p) => (p === e.data.rel ? null : e.data.rel)) : go(doc.id, page.id, e.data.rel))}
      onPaneClick={() => (linkFrom ? setLinkFrom(null) : onPick ? setPicked(null) : go(doc.id, page.id))}
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
          {page.entities && (
            <select className="focus-toggle add-kind" value="" title="Add an entity at the centre of the view"
              onChange={(e) => e.target.value && addAtCenter(e.target.value)}>
              <option value="">+ Add…</option>
              {Object.keys(NEW_KINDS).map((k) => <option key={k} value={k} style={{ color: colorOf(`${prefixOf(k)}.x`) }}>{k}</option>)}
            </select>
          )}
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

// Panel editor of a node declared in the open diagram: id, text, why. Remounted per entity (key).
function EntityEditor({ id, edit }) {
  const entry = edit.raw.entities?.[id];
  const [draft, setDraft] = useState(() => ({
    id, text: typeof entry === 'string' ? entry : entry?.text ?? '', why: typeof entry === 'object' ? entry?.why ?? '' : '',
    published: typeof entry === 'object' && entry?.published === true,
  }));
  const kind = id.split(/[.-]/)[0];
  const narrative = kind === 'narrativeBlock';
  // UML: a class box; properties edited as `name: type` lines.
  const uml = isUml(entry);
  const lines = (list) => (list ?? []).map(([n, t]) => (t ? `${n}: ${t}` : n)).join('\n');
  const pairs = (text) => text.split('\n').map((l) => l.split(':').map((x) => x.trim())).filter(([n]) => n)
    .map(([n, ...t]) => (t.join(':') ? [n, t.join(':')] : [n]));
  const [props, setProps] = useState(() => lines(entry?.properties));
  // Methods: `signature: note` lines; the first colon splits, so a signature cannot hold one.
  const [meths, setMeths] = useState(() => lines(entry?.methods));
  const raw = typeof entry === 'object' ? entry?.status : undefined;
  const status = typeof raw === 'string' ? raw : '';
  const nextId = draft.id.trim();
  const problem = !ID.test(nextId) ? 'Id: prefix.Name (e.g. controlPoint.Action)' : nextId !== id && edit.raw.entities?.[nextId] !== undefined ? `${nextId} already exists` : null;
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const properties = pairs(props);
  const methods = pairs(meths);
  // Save: writes the active JSON and, for a narrativeBlock, sends it to the web (upsert by node_id) with its published flag.
  const save = () => {
    if (problem) return;
    edit.save(id, nextId, { text: draft.text.trim(), why: draft.why.trim(), ...(uml && { properties, methods }), ...(narrative && { published: draft.published }) });
    if (narrative) sendToWeb();
  };
  const keys = (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save();

  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState(null);

  const sendToWeb = async () => {
    if (!draft.text.trim()) {
      setPublishMsg('Desat al JSON. No enviat a la web: falta el text.');
      return;
    }
    setPublishing(true);
    setPublishMsg(null);
    try {
      const relTurn = relations.find(([a, b]) => (a === id && b.startsWith('turn.')) || (b === id && a.startsWith('turn.')));
      const turnLabel = relTurn ? (relTurn[0].startsWith('turn.') ? relTurn[0] : relTurn[1]) : '';
      const relCp = relations.find(([a, b]) => (a === id && b.startsWith('controlPoint.')) || (b === id && a.startsWith('controlPoint.')));
      const controlPointLabel = relCp ? (relCp[0].startsWith('controlPoint.') ? relCp[0] : relCp[1]) : '';

      const connectedActions = relations
        .filter(([a, b]) => (a === id && (b.startsWith('actionSelection.') || b.startsWith('playerAction.'))) || (b === id && (a.startsWith('actionSelection.') || a.startsWith('playerAction.'))))
        .map(([a, b]) => (a === id ? b : a));

      const optionNodes = [];
      for (const act of connectedActions) {
        if (act.startsWith('actionSelection.')) {
          const sub = relations.filter(([a]) => a === act).map(([, b]) => b).filter((b) => b.startsWith('playerAction.'));
          if (sub.length) optionNodes.push(...sub);
          else optionNodes.push(act);
        } else {
          optionNodes.push(act);
        }
      }

      const actionSelector = [...new Set(optionNodes)].map((optId, idx) => ({
        id: `opt_${idx + 1}`,
        label: (edit.raw.entities?.[optId]?.text || optId).slice(0, 140),
      }));

      const title = entry?.title || titleOf(nextId);

      const payload = {
        campaignId: 1,
        nodeId: nextId,
        published: draft.published,
        title,
        content: draft.text.trim(),
        why: draft.why.trim() || undefined,
        turnLabel: turnLabel || undefined,
        controlPointLabel: controlPointLabel || undefined,
        actionSelector: actionSelector.length ? actionSelector : undefined,
      };

      const webBase = requireEnvUrl('WEB_URL', process.env.WEB_URL);
      const apiUrl = webBase.endsWith('/api') ? webBase : `${webBase}/api`;
      // Supabase Edge Function (the web's Express server emulates it locally). Header auth only, no cookies:
      // Edge Functions answer CORS with a wildcard origin, which browsers reject for credentialed requests.
      const supabaseUrl = requireEnvUrl('SUPABASE_URL', process.env.SUPABASE_URL);
      const publishUrl = `${supabaseUrl}/functions/v1/publish-narrative`;
      const functionHeaders = (token) => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(process.env.SUPABASE_ANON_KEY ? { apikey: process.env.SUPABASE_ANON_KEY } : {}),
      });

      const getWebDjToken = async () => {
        let token = localStorage.getItem('ld_web_token');
        if (token) return token;
        const loginRes = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bypass-rate-limit': 'true' },
          body: JSON.stringify({ email: 'dj@aquelarre.cat', password: 'password123' }),
        });
        if (!loginRes.ok) {
          const err = await loginRes.json().catch(() => ({}));
          throw new Error(err.message || `DJ Authentication failed (${loginRes.status})`);
        }
        const data = await loginRes.json();
        if (data.token) {
          localStorage.setItem('ld_web_token', data.token);
          return data.token;
        }
        throw new Error('No authentication token returned by web server');
      };

      let token = await getWebDjToken();
      let res = await fetch(publishUrl, {
        method: 'POST',
        headers: functionHeaders(token),
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('ld_web_token');
        token = await getWebDjToken();
        res = await fetch(publishUrl, {
          method: 'POST',
          headers: functionHeaders(token),
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      const verb = res.status === 201 ? 'creat' : 'actualitzat';
      setPublishMsg(`✓ Desat i ${verb} a la web (${draft.published ? 'publicat' : 'esborrany'})`);
    } catch (err) {
      setPublishMsg(`Desat al JSON. Error enviant a la web: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="sdd-editor" onKeyDown={keys}>
      {/* Labels and status save at once, like board labels; id, text and why save with the button. */}
      <Labels labels={typeof entry === 'object' ? entry?.tags ?? [] : []} onSave={(tags) => edit.field(id, 'tags', tags)} />
      <label>Id <input value={draft.id} onChange={set('id')} /></label>
      <label>Text <textarea rows={4} value={draft.text} onChange={set('text')} /></label>
      <label>Why <textarea rows={3} value={draft.why} onChange={set('why')} /></label>
      {uml && <label>Properties <span className="muted">one per line, name: type</span><textarea rows={Math.max(4, properties.length + 1)} value={props} onChange={(e) => setProps(e.target.value)} /></label>}
      {uml && <label>Methods <span className="muted">one per line, signature: note</span><textarea rows={Math.max(3, methods.length + 1)} value={meths} onChange={(e) => setMeths(e.target.value)} /></label>}
      {narrative && (
        <label>Published{' '}
          <select className="sdd-published" value={String(draft.published)} onChange={(e) => setDraft({ ...draft, published: e.target.value === 'true' })}>
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        </label>
      )}
      {!uml && <KeyValues key={id} pairs={typeof entry === 'object' ? entry?.props ?? [] : []} onChange={(next) => edit.field(id, 'props', next)} />}
      <div className="note-editor-bar">
        <button className="focus-toggle" onClick={save} disabled={!!problem || publishing}
          title={narrative ? 'Desa al JSON i envia el bloc a la web (narrative_blocks)' : undefined}>
          {publishing ? 'Desant…' : 'Save ⌘↵'}
        </button>
        <select className="sdd-status" aria-label="Status" value={status} onChange={(e) => edit.field(id, 'status', e.target.value)}>
          <option value="">— no status</option>
          {[...new Set([...statusesOf(kind), status].filter(Boolean))].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <DeleteButton id={id} edit={edit}>🗑 Delete</DeleteButton>
        {problem && <span className="board-error">{problem}</span>}
        {publishMsg && <span className={publishMsg.startsWith('✓') ? 'board-hint publish-success' : 'board-error'}>{publishMsg}</span>}
      </div>
    </section>
  );
}

// Right panel options on a diagram: [key, icon, label].
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

// Flow around an entity ([a, b]: a precedes b), up to `depth` levels. 'up': the entity and every node
// that reaches it through incoming relations; 'down': every node it reaches through outgoing ones.
// Breadth-first over all docs' relations; cycles stop at nodes already seen.
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
const DEPTHS = [[1, '1'], [2, '2'], [3, '3']];

// A temporary, read-only canvas over the diagram: the node with what comes before and after it, `depth` levels each way.
// Clicking a node closes it and selects that node on the main diagram (App); Esc, ✕ or the backdrop just close it.
// Delete asks where: off this page only (declaration and relations kept), or out of the whole json file.
function DeleteButton({ id, edit, children }) {
  const [open, setOpen] = useState(false);
  const declared = edit.raw.entities?.[id] !== undefined;
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <button className="focus-toggle danger" onClick={() => setOpen(true)}>{children}</button>
      {open && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal delete-modal" role="dialog" aria-label={`Delete ${id}`}>
            <div className="modal-head">
              <strong>Delete <span style={{ color: colorOf(id) }}>{id}</span></strong>
              <button className="focus-toggle" title="Close (Esc)" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="delete-choices">
              <button className="focus-toggle" onClick={() => { setOpen(false); edit.hide(id); }}>
                <strong>This page only</strong>
                <span>Off “{edit.pageTitle}”. It stays in the file, its relations and the other pages.</span>
              </button>
              <button className="focus-toggle danger" onClick={() => { setOpen(false); edit.remove(id); }}>
                <strong>Whole json file</strong>
                <span>{declared ? 'Its declaration, relations, page lists and positions.' : 'Its relations, page lists and positions in this file (declared elsewhere, kept there).'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// The entity pages of this file it is on (links) and a selector to show it on another one.
function PagesOf({ doc, page, id, edit }) {
  const pages = doc.pages.filter((p) => p.entities);
  const on = pages.filter((p) => p.entities.includes(id));
  const off = pages.filter((p) => !p.entities.includes(id));
  return (
    <p className="pages-of muted">
      On {on.map((p, i) => (
        <span key={p.id}>{i ? ' · ' : ''}{p.id === page.id ? <strong>{p.title}</strong> : <a onClick={() => go(doc.id, p.id, id)}>{p.title}</a>}</span>
      ))}
      {off.length > 0 && (
        <select className="focus-toggle" value="" onChange={(e) => e.target.value && edit.show(e.target.value, id)}>
          <option value="">↪ Show on page…</option>
          {off.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}
    </p>
  );
}

function FlowModal({ doc, id, hidden, onPick, onClose }) {
  const [depth, setDepth] = useState(1);
  const up = flowOf(id, depth, 'up');
  const down = flowOf(id, depth, 'down');
  const ids = [...new Set([...up, ...down])];
  const key = ids.join('|');
  const page = useMemo(() => ({
    id: `flow-${id}`, title: `Flow of ${id}`, entities: ids, direction: 'LR', edgeType: 'smoothstep',
  }), [id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={page.title}>
        <div className="modal-head">
          <strong>⇄ Flow of <span style={{ color: colorOf(id) }}>{id}</span></strong>
          <span className="muted">{up.length - 1} before · {down.length - 1} after</span>
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
          ) : <p className="muted modal-empty">No relations: nothing comes before or after {id}.</p>}
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
          <button className="focus-toggle" title="This node with what leads to it and what it leads to" onClick={() => onFlow(entity)}>⇄ Flow</button>
        </div>
      )}
      {edit && <PagesOf doc={doc} page={page} id={entity} edit={edit} />}
      {editable && <EntityEditor key={`${entity}#${edit.restored}`} id={entity} edit={edit} />}
      {edit && !editable && (
        <p className="muted">
          Declared in another diagram, edit it there.{' '}
          <DeleteButton id={entity} edit={edit}>Remove from this diagram</DeleteButton>
        </p>
      )}
      {described.length === 0 && !editable && <p>⚠ Not documented yet.</p>}
      <EntityDocs described={described} skip={editable ? edit.file : undefined} />
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

// Grid columns: folded sides shrink to a strip; the panel is one width everywhere.
// The right panel is wide on purpose: node editor and agent chat, entity docs with column tables.
const FOLDED_W = '36px';
// Sidebar menu options: [key, icon, label].
const MENUS = [['browse', '☰', 'Browse']];

const columnsOf = ({ focus, folded, panelFolded, panelMax }) => (focus || panelMax ? '1fr' : [
  folded ? FOLDED_W : '240px',
  '1fr',
  panelFolded ? FOLDED_W : '680px',
].join(' '));

function App() {
  const [route, setRoute] = useState(parseHash);
  const [hidden, setHidden] = useState(new Set());
  const [focus, setFocus] = useState(false);
  // Each side folds on its own (Focus hides both). Remembered per browser.
  // The open sidebar menu ('browse'), '' when folded. Remembered per browser.
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
  // ⛶ Full screen panel: the panel alone, its content centered (node, relation or agent chat). Esc leaves it.
  const [panelMax, setPanelMax] = useState(false);
  useEffect(() => {
    if (!panelMax) return;
    const esc = (e) => e.key === 'Escape' && !e.target.closest('input, textarea, select') && setPanelMax(false);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [panelMax]);
  // Clicking a node (diagram card) brings a folded panel back, even when that node is already
  // selected and the route does not change. A node's own buttons and handles (✕, +, →) leave it folded.
  // On a diagram it also leaves the Agent tab for the 🔎 Node tab, and so does an edge (relation panel).
  const showPanelOnNode = (e) => {
    if (!e.target.closest('.react-flow__node, .react-flow__edge') || e.target.closest('button, .react-flow__handle')) return;
    if (panelFolded) setPanelFolded(false);
    if (side === 'agent') setSide('node');
  };
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
  // Undo/redo stack per diagram file: { past: [raw…], future: [raw…] }. Only the JSON: a request already sent to the
  // web (Save of a narrativeBlock, Sincronitzar) is not undone. A change from outside (agent, editor) empties the stack,
  // since restoring an older snapshot would also wipe that change.
  const history = useRef(new Map());
  const historyOf = (file) => {
    if (!history.current.has(file)) history.current.set(file, { past: [], future: [] });
    return history.current.get(file);
  };
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
        history.current.delete(d.file);
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
  // RecentVisitedNodes: hash routes of the nodes shown in full screen, browser-history style (a new visit drops the
  // forward branch). Kept in sessionStorage: survives reloads, one stack per tab. Prev/Next move the cursor `at`.
  const [visits, setVisits] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem('recent-visited-nodes'));
      if (Array.isArray(v?.stack) && Number.isInteger(v.at)) return v;
    } catch {}
    return { stack: [], at: -1 };
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('recent-visited-nodes', JSON.stringify(visits));
    } catch {}
  }, [visits]);
  useEffect(() => {
    if (!panelMax || !entity) return;
    setVisits(({ stack, at }) => {
      if (stack[at] === location.hash) return { stack, at };
      const next = [...stack.slice(0, at + 1), location.hash].slice(-50); // ponytail: capped at 50, raise if needed
      return { stack: next, at: next.length - 1 };
    });
  }, [panelMax, doc.id, page.id, entity]);
  // The cursor moves first: the hashchange comes later and finds stack[at] already equal to the hash, so no push.
  const step = (d) => {
    const at = visits.at + d;
    setVisits({ ...visits, at });
    location.hash = visits.stack[at];
  };
  // Landing on a diagram page shows the canvas: the panel opens only for a node named in the URL, or on a click.
  useEffect(() => {
    setPanelFolded(!entity);
  }, [doc.id, page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The node whose flow modal is open (FlowModal), or null.
  const [flow, setFlow] = useState(null);
  const [resume, setResume] = useState(false);
  // A zoom asked from outside the canvas (a pick in the flow modal), consumed by Diagram.
  const [zoomTo, setZoomTo] = useState(null);
  // Diagram search (header input); cleared when the page changes.
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [doc.id, page.id]);
  // Browser tab: the open diagram's title in place of Hugo's "Diagrams", keeping the site name after it.
  useEffect(() => {
    document.title = `${doc.title} – ${SITE_TITLE}`;
  }, [doc.title]);
  // Every change is applied at once, then written; a failed write shows in the toolbar and the next load restores the file.
  // record: false for undo/redo themselves, which move snapshots between the two stacks.
  const commit = (raw, then, { record = true } = {}) => {
    if (record) {
      const h = historyOf(doc.file);
      h.past = [...h.past, doc.raw].slice(-HISTORY_LIMIT);
      h.future = [];
    }
    replaceSdd(doc.file, raw);
    refresh();
    then?.();
    saving.current++;
    saveSdd(doc.file, raw)
      .then(() => setSddError(null), (e) => setSddError(`${e.message}. Not saved: editing needs npm run dev.`))
      .finally(() => saving.current--);
  };
  const h = doc.file ? historyOf(doc.file) : { past: [], future: [] };
  // Bumped by undo/redo: the node form remounts with the restored text instead of keeping (and re-saving) the undone one.
  const restored = useRef(0);
  const undo = () => {
    if (!h.past.length) return;
    restored.current++;
    h.future = [doc.raw, ...h.future];
    commit(h.past.at(-1), undefined, { record: false });
    h.past = h.past.slice(0, -1);
  };
  const redo = () => {
    if (!h.future.length) return;
    restored.current++;
    h.past = [...h.past, doc.raw];
    commit(h.future[0], undefined, { record: false });
    h.future = h.future.slice(1);
  };
  // ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes; not while typing in a field, which keeps its own text undo.
  const undoRedo = useRef();
  undoRedo.current = { undo, redo };
  useEffect(() => {
    const keys = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) undoRedo.current.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') undoRedo.current.redo();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, []);
  const edit = doc.file && {
    file: doc.file,
    raw: doc.raw,
    restored: restored.current,
    error: sddError,
    move: (moves) => commit(ops.move(doc.raw, page.id, moves)),
    add: (kind, pos) => {
      const { raw, id } = ops.add(doc.raw, page.id, kind, pos);
      commit(raw, () => go(doc.id, page.id, id));
    },
    save: (id, to, value) => commit(ops.rename(ops.describe(doc.raw, id, value), id, to), () => to !== id && go(doc.id, page.id, to)),
    remove: (id) => commit(ops.remove(doc.raw, id), () => go(doc.id, page.id)),
    hide: (id) => commit(ops.hide(doc.raw, page.id, id), () => go(doc.id, page.id)),
    pageTitle: page.title,
    // Onto another page of this file; the glob test says whether the page's pattern already covers it.
    show: (pageId, id) => {
      const p = doc.raw.pages?.find((x) => x.id === pageId);
      const matches = typeof p?.entities === 'string' && sddDoc(doc.file, { ...doc.raw, pages: [{ ...p, exclude: [], include: [] }] }).pages[0].entities.includes(id);
      commit(ops.show(doc.raw, pageId, id, matches));
    },
    field: (id, key, value) => commit(ops.field(doc.raw, id, key, value)),
    link: (rel) => commit(ops.link(doc.raw, rel)),
    unlink: (rel) => commit(ops.unlink(doc.raw, rel)),
    relabel: (rel, label) => commit(ops.relabel(doc.raw, rel, label)),
    side: (rel, end, side) => commit(ops.side(doc.raw, page.id, rel, end, side)),
  };
  // Sincronitzar: narrative_blocks then player_actions (web DB) → this JSON, in one save. Blocks first, so a choice
  // finds its block node. New nodes go below everything placed on this page.
  const [sync, setSync] = useState({ busy: false, msg: null });
  useEffect(() => setSync({ busy: false, msg: null }), [doc.id]);
  const syncNarrative = async () => {
    setSync({ busy: true, msg: null });
    try {
      const [blocks, actions] = await Promise.all([loadNarrativeBlocks(1), loadPlayerActions(1)]);
      const placed = Object.values(doc.raw.pages?.find((p) => p.id === page.id)?.positions ?? {});
      const pos = { x: 0, y: placed.length ? Math.max(...placed.map((p) => p.y)) + 120 : 0 };
      const b = ops.sync(doc.raw, page.id, blocks, pos);
      const a = ops.syncActions(b.raw, page.id, actions, { x: pos.x + 300, y: pos.y });
      if (b.counts.updated || b.counts.added || a.counts.updated || a.counts.added) commit(a.raw);
      const line = (c) => `${c.updated} actualitzats · ${c.added} nous · ${c.unchanged} sense canvis`;
      setSync({
        busy: false,
        msg: `✓ Blocs: ${line(b.counts)} — Accions: ${line(a.counts)}${a.counts.orphan ? ` · ${a.counts.orphan} sense bloc` : ''}`,
      });
    } catch (err) {
      setSync({ busy: false, msg: `Error sincronitzant: ${err.message}` });
    }
  };
  // Filled by layouts/diagrams.html from the reactflow-* front matter; absent under `npm run dev:diagrams`.
  const home = window.reactflowHomes?.[doc.id];
  const i = doc.pages.indexOf(page);
  const [prev, next] = [doc.pages[i - 1], doc.pages[i + 1]];
  const openMenu = (m) => setMenu(m);
  const toggle = (d) => setHidden((h) => {
    const n = new Set(h);
    n.has(d) ? n.delete(d) : n.add(d);
    return n;
  });

  return (
    <div className={['layout', focus && 'focus', folded && 'folded', panelFolded && 'panel-folded', panelMax && 'panel-max'].filter(Boolean).join(' ')}
      style={{ gridTemplateColumns: columnsOf({ focus, folded, panelFolded, panelMax }) }}>
      <button className="fold-toggle panel-max-toggle" title="Full screen panel"
        onClick={() => {
          setPanelMax(true);
          setPanelFolded(false);
        }}>⛶</button>
      {panelMax && (
        <>
          <button className="fold-toggle panel-prev" title="Prev item" disabled={visits.at <= 0} onClick={() => step(-1)}>‹</button>
          <button className="fold-toggle panel-next" title="Next item" disabled={visits.at >= visits.stack.length - 1} onClick={() => step(1)}>›</button>
        </>
      )}
      {/* In full screen, » leaves it (back to the side panel) instead of folding the only thing on screen. */}
      <button className="fold-toggle panel-fold" title={panelMax ? 'Exit full screen (Esc)' : panelFolded ? 'Unfold panel' : 'Fold panel'}
        onClick={panelMax ? () => setPanelMax(false) : foldPanel}>
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
          </>
        )}
      </nav>
      <main>
        <header>
          <button className="focus-toggle" onClick={() => setFocus(!focus)}>{focus ? '⇤ Panels' : '⤢ Focus'}</button>
          {doc.file && (
            <span className="undo-redo">
              <button className="focus-toggle" title={`Desfés (⌘Z) · ${h.past.length}`} onClick={undo} disabled={!h.past.length}>↶</button>
              <button className="focus-toggle" title={`Refés (⇧⌘Z) · ${h.future.length}`} onClick={redo} disabled={!h.future.length}>↷</button>
            </span>
          )}
          {!page.sequence && (
            <input type="search" className="diagram-search" placeholder="🔍 Search nodes…" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          )}
          {doc.file && <button className="focus-toggle resume-button" onClick={() => setResume(true)}>📝 Make Resume</button>}
          {doc.file && (
            <button className="focus-toggle sync-button" title="Porta els blocs narratius i les accions dels jugadors de la web (narrative_blocks, player_actions) a aquest JSON"
              onClick={syncNarrative} disabled={sync.busy}>
              {sync.busy ? 'Sincronitzant…' : '🔄 Sincronitzar'}
            </button>
          )}
          {sync.msg && <span className="sync-msg">{sync.msg}</span>}
          <div className="eyebrow">{doc.title} › {page.section}</div>
          <h2>{page.title}</h2>
        </header>
        <div className="canvas" onClickCapture={showPanelOnNode}>
          {page.sequence ? (
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
      {doc.file && side === 'agent' ? (
        <aside className="panel">
          <SideMenu side={side} onSide={setSide} />
          <Orchestrator doc={doc} onReload={() => pullRef.current?.()} />
        </aside>
      ) : (
        <Panel doc={doc} page={page} entity={entity} edit={edit} onFlow={setFlow}
          menu={doc.file && <SideMenu side={side} onSide={setSide} />} />
      )}
      {resume && (
        <ResumeModal key={`${doc.id}/${page.id}`} title={page.title} ids={[...new Set(pageGraph(page).nodes.map((n) => n.ref ?? n.id))]}
          docsOf={entityDocs} relations={relations} colorOf={colorOf} onClose={() => setResume(false)} />
      )}
      {flow && (
        <FlowModal doc={doc} id={flow} hidden={hidden} onClose={() => setFlow(null)}
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

