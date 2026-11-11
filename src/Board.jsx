// WIP board page: the `board: true` page of a JSON diagram (docs/_WIP/board/board.json), free-positioned notes edited
// in place. The diagram loads and saves through /sdd with the SddEdit.js ops, like any other; note bodies, labels and
// Claude sessions live in docs/_WIP/board pages, written by the bridge (note-pages.mjs, /wip/*). Only works under
// `npm run dev`, the bridge is local.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sessions } from './Sessions.jsx';
import { loadSdd, ops, saveSdd } from './SddEdit.js';
import { ReactFlow, Background, Controls, Panel, Handle, Position, MarkerType, useReactFlow, useConnection, useUpdateNodeInternals } from '@xyflow/react';

const BRIDGE = 'http://127.0.0.1:5182/wip';
// Relation label of a parent arrow (a note added with + under another); any other relation is a link.
const FROM = 'from';
const NOTE_W = 320;
// Sides an arrow end can sit on, in the order "Rotate origin/destination" walks them. Stored per relation:
// - parent arrow, on the child: fromSide (default bottom), toSide (default top);
// - link, on the source note: linkSides[target] (default right), linkToSides[target] (default left).
const SIDES = ['right', 'bottom', 'left', 'top'];
const POSITION = { right: Position.Right, bottom: Position.Bottom, left: Position.Left, top: Position.Top };
const nextSide = (side) => SIDES[(SIDES.indexOf(side) + 1) % SIDES.length];
const DEFAULT = { from: { origin: 'bottom', dest: 'top' }, link: { origin: 'right', dest: 'left' } };
// The two ends of a relation, read from the note that stores it.
const sidesOf = (kind, s, t) => (kind === 'from'
  ? { origin: t.fromSide ?? DEFAULT.from.origin, dest: t.toSide ?? DEFAULT.from.dest }
  : { origin: s.linkSides?.[t.id] ?? DEFAULT.link.origin, dest: s.linkToSides?.[t.id] ?? DEFAULT.link.dest });
// The notes the board draws, from the diagram (entities, relations, the page's positions and sides) and the note
// pages (body, page url, sessions, tags). Parent arrows keep their sides on the child (fromSide, toSide), links on the
// source note (linkSides, linkToSides), as Note, NoteAside and the edge menu read them.
const notesOf = (raw, pageId, pages) => {
  const page = raw.pages?.find((p) => p.id === pageId) ?? {};
  const notes = Object.entries(raw.entities ?? {}).map(([id, e]) => ({
    id, ...(typeof e === 'string' ? { title: e } : e), ...(page.positions?.[id] ?? { x: 0, y: 0 }),
    tags: ['wip'], ...pages[id],
  }));
  const byId = new Map(notes.map((n) => [n.id, n]));
  for (const [a, b, label] of raw.relations ?? []) {
    const s = byId.get(a);
    const t = byId.get(b);
    if (!s || !t) continue;
    const side = page.sides?.[`${a}~${b}`];
    if (label === FROM) Object.assign(t, { from: a, fromSide: side?.from, toSide: side?.to });
    else Object.assign(s, {
      links: [...(s.links ?? []), b],
      linkSides: side?.from ? { ...s.linkSides, [b]: side.from } : s.linkSides,
      linkToSides: side?.to ? { ...s.linkToSides, [b]: side.to } : s.linkToSides,
    });
  }
  return notes;
};

// Markdown links, bare URLs and DSL refs become links; everything else stays plain text.
const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)|\b([A-Z][A-Z0-9]+-[\w.-]*[\w])/g;
function Body({ text, isRef, colorOf, onRef }) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [all, label, href, url, ref] = m;
    if (ref && !isRef(ref)) continue;
    out.push(text.slice(last, m.index));
    last = m.index + all.length;
    if (ref) out.push(<a key={m.index} style={{ color: colorOf(ref) }} onClick={() => onRef(ref)}>{ref}</a>);
    else out.push(<a key={m.index} href={href ?? url} target={url ? '_blank' : undefined} rel="noreferrer">{label ?? url}</a>);
  }
  out.push(text.slice(last));
  return <div className="note-body">{out}</div>;
}

// Labels: the note page's tags, shown as pastel post-its. `wip` is on every board page and is left out.
const labelsOf = (note) => (note.tags ?? []).filter((t) => t !== 'wip');
// Material 100-200 pastels; a label keeps its colour wherever it appears (hash of its text).
const STICKY = ['#fff59d', '#f8bbd0', '#c5e1a5', '#b3e5fc', '#ffcc80', '#d1c4e9', '#b2dfdb', '#ffab91'];
const stickyColor = (label) => STICKY[[...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % STICKY.length];
// A slight tilt per label, -3°..3°, stable across renders.
const stickyTilt = (label, i) => `${((label.length * 7 + i * 5) % 7) - 3}deg`;
export function Sticky({ label, i = 0, onRemove }) {
  return (
    <span className="sticky" style={{ '--sticky': stickyColor(label), '--tilt': stickyTilt(label, i), '--i': i }}>
      {label}
      {onRemove && <button title={`Remove "${label}"`} onClick={onRemove}>×</button>}
    </span>
  );
}
const MAX_STICKIES = 4;
// The post-its on top of a node (a board note or a diagram card): the first MAX_STICKIES, then +n.
export const Stickies = ({ labels }) => labels.length > 0 && (
  <div className="stickies" aria-label="Labels">
    {labels.slice(0, MAX_STICKIES).map((l, i) => <Sticky key={l} label={l} i={i} />)}
    {labels.length > MAX_STICKIES && <span className="sticky more">+{labels.length - MAX_STICKIES}</span>}
  </div>
);

// Linear status line of a note created from a cycle issue: live state when the sidebar has it, else the saved one.
// A link to the issue in the aside only: in the node a click selects the note (and opens the aside).
function Status({ linear, state, link = false }) {
  const content = (
    <>
      <span className="swatch" style={{ background: state.color }} /> {state.name}
      <span className="linear-id">{linear.id}</span>
    </>
  );
  return link
    ? <a className="note-linear" href={linear.url} target="_blank" rel="noreferrer">{content}</a>
    : <div className="note-linear">{content}</div>;
}

// Blur handler that commits only when focus moved elsewhere in the page. When the window itself loses focus
// (macOS emoji palette ⌃⌘Space, ⌘Tab) the field stays document.activeElement, so editing goes on.
const onFocusLeft = (commit) => (e) => {
  const el = e.currentTarget;
  setTimeout(() => el.isConnected && !el.contains(document.activeElement) && commit());
};

function Note({ id, data }) {
  // While a link is dragged from another note, this note turns into a drop zone (React Flow "easy connect").
  const dragging = useConnection((c) => c.inProgress && c.fromNode.id !== id);
  // Click-to-link (data.linkTarget) gets the same outline as a dragged link.
  const droppable = dragging || data.linkTarget;
  // Handles come and go (none while editing the title, the drop zone while a link is dragged): React Flow must
  // re-read them on each toggle, or arrows lose their ends.
  const updateNodeInternals = useUpdateNodeInternals();
  // The node edits its title only; the body lives in a docs/_WIP/board page, edited from NoteAside.
  // A click on the title text (or a double click anywhere) edits it; a note just created by a + button opens editing.
  const [draft, setDraft] = useState(data.fresh ? data.title : null);
  // React Flow keeps a new node hidden until it is measured, so autoFocus misses it: retry for a few frames.
  const input = useRef(null);
  const editing = draft !== null;
  // Toggles only: on mount React Flow measures the node itself, and an early call would make the initial fitView
  // frame unmeasured nodes (zoomed in on nothing).
  const toggles = useRef(`${editing}${dragging}`);
  useEffect(() => {
    if (toggles.current === `${editing}${dragging}`) return;
    toggles.current = `${editing}${dragging}`;
    updateNodeInternals(id);
  }, [editing, dragging, id, updateNodeInternals]);

  useEffect(() => {
    if (!editing) return;
    let tries = 10;
    let frame;
    const focus = () => {
      input.current?.focus();
      if (document.activeElement !== input.current && tries-- > 0) frame = requestAnimationFrame(focus);
      else input.current?.select();
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  const commit = () => {
    data.onChange({ title: draft.trim() || 'Untitled' });
    setDraft(null);
  };
  const keys = (e) => {
    if (e.key === 'Escape') setDraft(null);
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
  };
  if (draft !== null) {
    return (
      <div className="note editing" onBlur={onFocusLeft(commit)} onKeyDown={keys}>
        <input ref={input} className="nodrag" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()} />
      </div>
    );
  }
  return (
    <div className={['note', droppable && 'droppable', data.linkSource && 'linking'].filter(Boolean).join(' ')} style={data.state && { borderTopColor: data.state.color }}
      onDoubleClick={() => setDraft(data.title)}>
      <Stickies labels={labelsOf(data)} />
      {SIDES.map((side) => <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={POSITION[side]} className="note-side" isConnectable={false} />)}
      {SIDES.map((side) => <Handle key={side} id={`s-${side}`} type="source" position={POSITION[side]} className="note-side" isConnectable={false} />)}
      {dragging && <Handle id="drop" type="target" position={Position.Left} className="note-drop" isConnectableStart={false} />}
      <div className="note-title">
        {/* React Flow swallows the click that ends a drag, so dragging by the title still moves the note.
            In click-to-link mode the click links instead. */}
        <span className="note-title-text" title="Click to rename"
          onClick={() => !data.linkSource && !data.linkTarget && setDraft(data.title)}>{data.title}</span>
        {data.sessions?.length > 0 && <span className="note-sessions" title="Claude sessions">🤖 {data.sessions.length}</span>}
        {data.page && <span className="note-page" title="Has a WIP page (link in the aside)">📄</span>}
        <button className="nodrag" title="Delete note" onClick={() => confirm(`Delete "${data.title}"?`) && data.onDelete()}>✕</button>
      </div>
      {data.linear && <Status linear={data.linear} state={data.state} />}
      <button className="note-add nodrag" title="Add related note" onClick={data.onAddRelated}>+</button>
      <Handle id="link" type="source" position={Position.Right} className="note-link" isConnectableEnd={false}
        title="Click, then click another note to link them (or drag onto it)"
        onClick={(e) => {
          e.stopPropagation();
          data.onStartLink();
        }}>→</Handle>
    </div>
  );
}
const nodeTypes = { note: Note };

// The selected note lives in the route (#/doc/page/<note id>) like any entity, so App passes it in and
// renders NoteAside for it; onNotes hands App the notes that aside reads.
const stateOf = (note, issues) => note.linear && (issues?.find((i) => i.identifier === note.linear.id)?.state ?? note.linear.state);

// issues: the sidebar's Linear cycle issues. apiRef: App's handle on addIssue (sidebar +) and saveBody (aside editor).
// file, pageId: the diagram and its board page.
export function Board({ file, pageId, isRef, colorOf, onRef, selected, onSelect, onNotes, issues, apiRef }) {
  // raw: the diagram file as saved; pages: note id → its page data (body, page, sessions, tags).
  const [raw, setRaw] = useState(null);
  const [pages, setPages] = useState({});
  const notes = useMemo(() => raw && notesOf(raw, pageId, pages), [raw, pageId, pages]);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null);
  // Node sizes React Flow measured (id → { width, height }), handed back as node.measured. Without them every
  // rebuilt node (e.g. after the focus reload) is hidden until re-measured, and a background Firefox tab misses
  // that re-measure: all notes stayed invisible. Kept apart from notes, so board.json never stores them.
  const [sizes, setSizes] = useState({});
  // Click-to-link: the note whose → was clicked; the next note clicked becomes the link target.
  const [linkFrom, setLinkFrom] = useState(null);
  useEffect(() => {
    if (!linkFrom) return;
    const esc = (e) => e.key === 'Escape' && setLinkFrom(null);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [linkFrom]);
  // Relation menu, opened by clicking an arrow: { kind: 'from' | 'link', source, target, x, y } (screen coords).
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return;
    const esc = (e) => e.key === 'Escape' && setMenu(null);
    const away = (e) => !e.target.closest('.edge-menu') && setMenu(null);
    // Capture phase: React Flow's pan/zoom stops pointerdown on the pane from bubbling.
    addEventListener('keydown', esc);
    addEventListener('pointerdown', away, true);
    return () => {
      removeEventListener('keydown', esc);
      removeEventListener('pointerdown', away, true);
    };
  }, [menu]);
  const { getNode, setCenter, getZoom } = useReactFlow();

  // Reloaded on focus too: board.json or a note page may have changed in another tab, an editor or by an agent.
  const loadPages = () => fetch(`${BRIDGE}/pages`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))))
    .then((b) => setPages(b.pages));
  const load = () => Promise.all([loadSdd(file).then(setRaw), loadPages()])
    .catch((e) => setError(`${e.message}. The WIP board needs the local bridge: npm run dev.`));
  useEffect(() => {
    load();
    addEventListener('focus', load);
    return () => removeEventListener('focus', load);
  }, [file]);
  useEffect(() => {
    if (notes) onNotes(notes);
  }, [notes, onNotes]);

  // ponytail: last write wins (saveSdd); two tabs editing at the same moment still overwrite each other.
  const commit = (next) => {
    setRaw(next);
    saveSdd(file, next).then(() => setError(null)).catch((e) => setError(e.message));
  };
  // A rename goes to board.json and, when the note has a page, to that page's title.
  const rename = (id, title) => {
    commit(ops.field(raw, id, 'title', title));
    fetch(`${BRIDGE}/title`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, title }) })
      .catch((e) => setError(e.message));
  };
  // A related note (from: parent id) goes under its parent, right of the siblings already there.
  const add = (from) => {
    const id = crypto.randomUUID();
    const parent = notes.find((n) => n.id === from);
    const pos = parent
      ? { x: parent.x + notes.filter((n) => n.from === from).length * (NOTE_W + 40), y: parent.y + (getNode(from)?.measured?.height ?? 120) + 60 }
      : { x: notes.length ? Math.max(...notes.map((n) => n.x)) + NOTE_W + 40 : 0, y: 0 };
    setFresh(id);
    onSelect(id);
    const next = ops.put(raw, pageId, id, { title: 'New note' }, pos);
    commit(parent ? ops.link(next, [from, id, FROM]) : next);
  };
  // A Linear issue gets one note: adding it again selects the existing one and centers the board on it.
  const addIssue = (issue) => {
    const existing = notes.find((n) => n.linear?.id === issue.identifier);
    if (existing) {
      const h = getNode(existing.id)?.measured?.height ?? 120;
      setCenter(existing.x + NOTE_W / 2, existing.y + h / 2, { zoom: getZoom(), duration: 400 });
      return onSelect(existing.id);
    }
    const id = crypto.randomUUID();
    const x = notes.length ? Math.max(...notes.map((n) => n.x)) + NOTE_W + 40 : 0;
    const linear = { id: issue.identifier, url: issue.url, state: { name: issue.state.name, color: issue.state.color } };
    onSelect(id);
    commit(ops.put(raw, pageId, id, { title: issue.title, linear }, { x, y: 0 }));
    setCenter(x + NOTE_W / 2, 100, { zoom: getZoom(), duration: 400 });
  };
  // The body goes to the note's docs/_WIP/board page; Hugo then rebuilds and livereloads this page.
  // Labels go to the page's tags front matter (created if needed); Hugo then rebuilds and livereloads this page.
  const saveTags = (id, tags) => fetch(`${BRIDGE}/tags`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, tags }),
  })
    .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t || (r.status === 404
      ? 'The bridge predates labels: restart npm run dev.' : `save failed: ${r.status}`))))))
    .then(({ tags: saved }) => setPages((p) => ({ ...p, [id]: { ...p[id], tags: saved } })));
  const saveBody = (id, body) => fetch(`${BRIDGE}/body`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, body }),
  })
    // An empty 404 is a bridge older than this route: it needs a restart of npm run dev.
    .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t || (r.status === 404
      ? 'The bridge predates note pages: restart npm run dev.' : `save failed: ${r.status}`))))))
    .then(({ page }) => setPages((p) => ({ ...p, [id]: { ...p[id], body, page } })));
  useEffect(() => {
    if (apiRef) apiRef.current = notes ? { addIssue, saveBody, saveTags, rename, reload: load,
      rotate: (r, end) => relation(r)?.rotate(end) } : null;
  });
  // Out of the diagram: its entity, relations, position and sides (ops.remove). Its page stays.
  const remove = (id) => commit(ops.remove(raw, id));
  // links: free associations between notes, besides the from (parent) hierarchy.
  const link = ({ source, target }) => {
    const s = notes.find((n) => n.id === source);
    if (source === target || s.links?.includes(target)) return;
    commit(ops.link(raw, [source, target]));
  };
  // The relation behind an arrow: its sides, how to move either end to the next side (page.sides["A~B"]), how to delete it.
  const relation = ({ kind, source, target }) => {
    const s = notes.find((n) => n.id === source);
    const t = notes.find((n) => n.id === target);
    if (!s || !t) return null;
    const sides = sidesOf(kind, s, t);
    return {
      s, t, sides,
      rotate: (end) => commit(ops.side(raw, pageId, `${source}~${target}`, end === 'origin' ? 'from' : 'to',
        nextSide(end === 'origin' ? sides.origin : sides.dest))),
      remove: () => commit(ops.unlink(raw, kind === 'from' ? [source, target, FROM] : [source, target])),
    };
  };
  const rel = menu && relation(menu);

  if (!notes) return <div className="board-msg">{error ?? 'Loading…'}</div>;
  const nodes = notes.map((n) => ({
    id: n.id,
    type: 'note',
    position: { x: n.x, y: n.y },
    dragHandle: '.note-title',
    style: { width: NOTE_W },
    ...(sizes[n.id] && { measured: sizes[n.id] }),
    selected: n.id === selected,
    data: {
      ...n, isRef, colorOf, onRef, fresh: n.id === fresh, state: stateOf(n, issues),
      onChange: (p) => p.title !== n.title && rename(n.id, p.title), onDelete: () => remove(n.id), onAddRelated: () => add(n.id),
      onStartLink: () => setLinkFrom(linkFrom === n.id ? null : n.id),
      linkSource: linkFrom === n.id, linkTarget: !!linkFrom && linkFrom !== n.id,
    },
  }));
  const lit = (a, b) => selected && (a === selected || b === selected);
  const ids = new Set(notes.map((n) => n.id));
  const edges = [
    ...notes.filter((n) => n.from).map((n) => ({
      id: `${n.from}>${n.id}`, source: n.from, target: n.id,
      sourceHandle: `s-${n.fromSide ?? DEFAULT.from.origin}`, targetHandle: `t-${n.toSide ?? DEFAULT.from.dest}`,
      data: { kind: 'from' }, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed },
      className: lit(n.id, n.from) ? 'rel lit' : 'rel',
    })),
    ...notes.flatMap((n) => (n.links ?? []).filter((t) => ids.has(t)).map((t) => ({
      id: `${n.id}~${t}`, source: n.id, target: t,
      sourceHandle: `s-${n.linkSides?.[t] ?? DEFAULT.link.origin}`, targetHandle: `t-${n.linkToSides?.[t] ?? DEFAULT.link.dest}`,
      data: { kind: 'link' }, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed },
      className: lit(n.id, t) ? 'rel link lit' : 'rel link',
    }))),
  ];

  return (
    <ReactFlow
      fitView
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeDragStop={(_, node) => commit(ops.move(raw, pageId, [{ id: node.id, ...node.position }]))}
      onNodesChange={(changes) => {
        const measured = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
        if (measured.length) setSizes((m) => Object.assign({ ...m }, ...measured.map((c) => ({ [c.id]: c.dimensions }))));
        // While dragging: moved on screen only; the drop saves.
        const moves = changes.filter((c) => c.type === 'position' && c.position).map((c) => ({ id: c.id, ...c.position }));
        if (moves.length) setRaw((r) => ops.move(r, pageId, moves));
      }}
      onNodeClick={(_, n) => {
        if (!linkFrom) return onSelect(n.id);
        link({ source: linkFrom, target: n.id });
        setLinkFrom(null);
      }}
      onPaneClick={() => (linkFrom ? setLinkFrom(null) : onSelect(null))}
      connectOnClick={false}
      zoomOnDoubleClick={false}
      onConnect={link}
      connectionLineStyle={{ strokeDasharray: '6 4', strokeWidth: 2 }}
      onEdgeClick={(ev, e) => e.data?.kind && setMenu({ kind: e.data.kind, source: e.source, target: e.target, x: ev.clientX, y: ev.clientY })}
      minZoom={0.1}
    >
      <Background gap={20} />
      <Controls />
      <Panel position="top-left">
        <button className="focus-toggle" onClick={() => add()}>+ Note</button>
        {linkFrom && <span className="board-hint">Click a note to link it · Esc to cancel</span>}
        {error && <span className="board-error">{error}</span>}
      </Panel>
      {rel && (
        <div className="edge-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <div className="edge-menu-head">
            <span className="muted">{menu.kind === 'from' ? 'Parent' : 'Link'}</span>
            <strong>{rel.s.title}</strong> → <strong>{rel.t.title}</strong>
          </div>
          {/* Stays open: click again to keep rotating. */}
          <button onClick={() => rel.rotate('origin')}>↻ Rotate origin <span className="muted">{rel.sides.origin} → {nextSide(rel.sides.origin)}</span></button>
          <button onClick={() => rel.rotate('dest')}>↻ Rotate destination <span className="muted">{rel.sides.dest} → {nextSide(rel.sides.dest)}</span></button>
          <button className="danger" onClick={() => {
            rel.remove();
            setMenu(null);
          }}>🗑 Delete relation</button>
        </div>
      )}
    </ReactFlow>
  );
}

// Aside label editor: post-its with ×, and an input that adds one on Enter (comma-separated adds several).
// onSave(next labels) returns a promise; its error shows next to the input. Shared with the diagram node editor.
export function Labels({ labels, onSave }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const save = (next) => Promise.resolve(onSave(next)).then(() => setError(null)).catch((e) => setError(e.message));
  const add = () => {
    const fresh = input.split(',').map((t) => t.trim()).filter((t) => t && !labels.includes(t));
    setInput('');
    if (fresh.length) save([...labels, ...fresh]);
  };
  return (
    <div className="labels">
      {labels.map((l, i) => <Sticky key={l} label={l} i={i} onRemove={() => save(labels.filter((x) => x !== l))} />)}
      <input value={input} placeholder="+ label" aria-label="Add a label" onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
          if (e.key === 'Escape') setInput('');
        }} />
      {error && <span className="board-error">{error}</span>}
    </div>
  );
}

// Right-hand aside for the selected note: its full body plus the notes it is related to.
export function NoteAside({ note, notes, issues, isRef, colorOf, onRef, onSelect, onSaveBody, onSaveTags, onRename, onReload, onRotate }) {
  const [draft, setDraft] = useState(null);
  // Title: click to rename; Enter or blur saves, Esc cancels. Saved like a rename on the node (board.json + page).
  const [title, setTitle] = useState(null);
  const rename = () => {
    if (title === null) return;
    const next = title.trim() || 'Untitled';
    if (next !== note.title) onRename(note.id, next);
    setTitle(null);
  };
  const [saving, setSaving] = useState(null);
  // Another note selected: drop the unsaved draft of the previous one.
  useEffect(() => {
    setDraft(null);
    setSaving(null);
    setTitle(null);
  }, [note.id]);
  const save = () => {
    setSaving('Saving…');
    onSaveBody(note.id, draft)
      .then(() => {
        setDraft(null);
        setSaving(null);
      })
      .catch((e) => setSaving(e.message));
  };
  // Every arrow touching this note: parent and children (from), links out and in. Each end rotates like the edge menu.
  const byId = (id) => notes.find((n) => n.id === id);
  const rels = [
    note.from && byId(note.from) && { kind: 'from', source: note.from, target: note.id, other: byId(note.from), label: 'Related to ↑' },
    ...notes.filter((n) => n.from === note.id).map((n) => ({ kind: 'from', source: note.id, target: n.id, other: n, label: 'Related ↓' })),
    ...(note.links ?? []).filter(byId).map((t) => ({ kind: 'link', source: note.id, target: t, other: byId(t), label: 'Links to →' })),
    ...notes.filter((n) => n.links?.includes(note.id)).map((n) => ({ kind: 'link', source: n.id, target: note.id, other: n, label: 'Linked from ←' })),
  ].filter(Boolean);
  return (
    <aside className="panel">
      <div className="badge" style={{ background: 'var(--color-dark-green-600)' }}>WIP note</div>
      {title !== null ? (
        <input className="note-aside-title-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={onFocusLeft(rename)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename();
            if (e.key === 'Escape') setTitle(null);
          }} />
      ) : (
        <h2 className="note-aside-title" title="Click to rename" onClick={() => setTitle(note.title)}>{note.title}</h2>
      )}
      {note.linear && <Status linear={note.linear} state={stateOf(note, issues)} link />}
      <Labels key={note.id} labels={labelsOf(note)} onSave={(next) => onSaveTags(note.id, ['wip', ...next])} />
      {draft !== null ? (
        <div className="note-editor">
          <textarea autoFocus rows={Math.max(10, draft.split('\n').length + 2)} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDraft(null);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }} />
          <div className="note-editor-bar">
            <button className="focus-toggle" onClick={save} disabled={saving === 'Saving…'}>Save ⌘↵</button>
            <button className="focus-toggle" onClick={() => setDraft(null)}>Cancel</button>
            {saving && <span className="board-error">{saving}</span>}
          </div>
        </div>
      ) : (
        <>
          {note.body ? <Body text={note.body} isRef={isRef} colorOf={colorOf} onRef={onRef} /> : <p className="muted">Empty note.</p>}
          <div className="note-editor-bar">
            <button className="focus-toggle" onClick={() => setDraft(note.body ?? '')}>✎ Edit</button>
            {note.page && <a href={note.page}>📄 WIP page</a>}
          </div>
        </>
      )}
      <Sessions note={note} onChanged={onReload} />
      {rels.length > 0 && (
        <>
          <h3>Relations</h3>
          <ul className="note-rels">
            {rels.map((r) => {
              const sides = sidesOf(r.kind, byId(r.source), byId(r.target));
              return (
                <li key={`${r.kind}:${r.source}>${r.target}`}>
                  <span className="muted">{r.label}</span> <a onClick={() => onSelect(r.other.id)}>{r.other.title}</a>
                  <span className="note-rel-rotate">
                    <button className="focus-toggle" title={`Origin side: ${sides.origin} → ${nextSide(sides.origin)}`} onClick={() => onRotate(r, 'origin')}>↻ origin · {sides.origin}</button>
                    <button className="focus-toggle" title={`Destination side: ${sides.dest} → ${nextSide(sides.dest)}`} onClick={() => onRotate(r, 'dest')}>↻ destination · {sides.dest}</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="muted">Double-click the note on the board to rename it. The body is saved as Markdown in docs/_WIP/board.</p>
    </aside>
  );
}
