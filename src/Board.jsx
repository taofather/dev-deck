// WIP board page (src/content/wip/wip.js): free-positioned notes, edited in place and saved
// through agent-bridge.mjs (GET/PUT /wip). Only works under `npm run dev`, the bridge is local.
import { useEffect, useRef, useState } from 'react';
import { Sessions } from './Sessions.jsx';
import { ReactFlow, Background, Controls, Panel, Handle, Position, MarkerType, useReactFlow, useConnection } from '@xyflow/react';

const BRIDGE = 'http://127.0.0.1:5182/wip';
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
// A map without key `id`, or undefined when that leaves it empty (keeps board.json free of {}).
const without = (map, id) => {
  const { [id]: _, ...rest } = map ?? {};
  return Object.keys(rest).length ? rest : undefined;
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
  // The node edits its title only; the body lives in a docs/_WIP/board page, edited from NoteAside.
  // A click on the title text (or a double click anywhere) edits it; a note just created by a + button opens editing.
  const [draft, setDraft] = useState(data.fresh ? data.title : null);
  // React Flow keeps a new node hidden until it is measured, so autoFocus misses it: retry for a few frames.
  const input = useRef(null);
  const editing = draft !== null;
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
export function Board({ isRef, colorOf, onRef, selected, onSelect, onNotes, issues, apiRef }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null);
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
  const load = () => fetch(BRIDGE)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))))
    .then((b) => setNotes(b.notes))
    .catch((e) => setError(`${e.message}. The WIP board needs the local bridge: npm run dev.`));
  useEffect(() => {
    load();
    addEventListener('focus', load);
    return () => removeEventListener('focus', load);
  }, []);
  useEffect(() => {
    if (notes) onNotes(notes);
  }, [notes, onNotes]);

  // ponytail: last write wins; two tabs editing at the same moment still overwrite each other (add a version check if that bites).
  const save = (next) => {
    setNotes(next);
    fetch(BRIDGE, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: next }) })
      .then((r) => (r.ok ? setError(null) : Promise.reject(new Error(`save failed: ${r.status}`))))
      .catch((e) => setError(e.message));
  };
  const update = (id, patch) => save(notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  // A related note (from: parent id) goes under its parent, right of the siblings already there.
  const add = (from) => {
    const id = crypto.randomUUID();
    const parent = notes.find((n) => n.id === from);
    const pos = parent
      ? { x: parent.x + notes.filter((n) => n.from === from).length * (NOTE_W + 40), y: parent.y + (getNode(from)?.measured?.height ?? 120) + 60 }
      : { x: notes.length ? Math.max(...notes.map((n) => n.x)) + NOTE_W + 40 : 0, y: 0 };
    setFresh(id);
    onSelect(id);
    save([...notes, { id, title: 'New note', body: '', ...pos, ...(parent && { from }) }]);
  };
  // A Linear issue gets one note: adding it again selects the existing one.
  const addIssue = (issue) => {
    const existing = notes.find((n) => n.linear?.id === issue.identifier);
    if (existing) return onSelect(existing.id);
    const id = crypto.randomUUID();
    const x = notes.length ? Math.max(...notes.map((n) => n.x)) + NOTE_W + 40 : 0;
    const linear = { id: issue.identifier, url: issue.url, state: { name: issue.state.name, color: issue.state.color } };
    onSelect(id);
    save([...notes, { id, title: issue.title, body: '', x, y: 0, linear }]);
    setCenter(x + NOTE_W / 2, 100, { zoom: getZoom(), duration: 400 });
  };
  // The body goes to the note's docs/_WIP/board page; Hugo then rebuilds and livereloads this page.
  const saveBody = (id, body) => fetch(`${BRIDGE}/body`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, body }),
  })
    // An empty 404 is a bridge older than this route: it needs a restart of npm run dev.
    .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t || (r.status === 404
      ? 'The bridge predates note pages: restart npm run dev.' : `save failed: ${r.status}`))))))
    .then(({ page }) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, body, page } : n))));
  useEffect(() => {
    if (apiRef) apiRef.current = notes ? { addIssue, saveBody, rename: (id, title) => update(id, { title }), reload: load } : null;
  });
  const remove = (id) => save(notes.filter((n) => n.id !== id).map(({ from, fromSide, toSide, links, linkSides, linkToSides, ...n }) => {
    const kept = links?.filter((t) => t !== id);
    return JSON.parse(JSON.stringify({
      ...n,
      ...(from !== id && { from, fromSide, toSide }),
      links: kept?.length ? kept : undefined,
      linkSides: without(linkSides, id),
      linkToSides: without(linkToSides, id),
    }));
  }));
  // links: free associations between notes, besides the from (parent) hierarchy. Stored on the source note.
  const link = ({ source, target }) => {
    const s = notes.find((n) => n.id === source);
    if (source === target || s.links?.includes(target)) return;
    update(source, { links: [...(s.links ?? []), target] });
  };
  const unlink = (source, target) => {
    const s = notes.find((n) => n.id === source);
    const links = s.links.filter((t) => t !== target);
    update(source, {
      links: links.length ? links : undefined, linkSides: without(s.linkSides, target), linkToSides: without(s.linkToSides, target),
    });
  };
  // The relation behind an arrow: its sides, how to move either end to the next side, how to delete it.
  const relation = ({ kind, source, target }) => {
    const s = notes.find((n) => n.id === source);
    const t = notes.find((n) => n.id === target);
    if (!s || !t) return null;
    const sides = sidesOf(kind, s, t);
    return kind === 'from'
      ? {
        s, t, sides,
        rotate: (end) => update(target, end === 'origin' ? { fromSide: nextSide(sides.origin) } : { toSide: nextSide(sides.dest) }),
        remove: () => update(target, { from: undefined, fromSide: undefined, toSide: undefined }),
      }
      : {
        s, t, sides,
        rotate: (end) => update(source, end === 'origin'
          ? { linkSides: { ...s.linkSides, [target]: nextSide(sides.origin) } }
          : { linkToSides: { ...s.linkToSides, [target]: nextSide(sides.dest) } }),
        remove: () => unlink(source, target),
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
    selected: n.id === selected,
    data: {
      ...n, isRef, colorOf, onRef, fresh: n.id === fresh, state: stateOf(n, issues),
      onChange: (p) => update(n.id, p), onDelete: () => remove(n.id), onAddRelated: () => add(n.id),
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
      onNodeDragStop={(_, node) => update(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })}
      onNodesChange={(changes) => {
        const moves = changes.filter((c) => c.type === 'position' && c.position);
        if (moves.length) setNotes((ns) => ns.map((n) => {
          const c = moves.find((m) => m.id === n.id);
          return c ? { ...n, x: c.position.x, y: c.position.y } : n;
        }));
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

// Right-hand aside for the selected note: its full body plus the notes it is related to.
export function NoteAside({ note, notes, issues, isRef, colorOf, onRef, onSelect, onSaveBody, onRename, onReload }) {
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
  const parent = notes.find((n) => n.id === note.from);
  const children = notes.filter((n) => n.from === note.id);
  const link = (n) => <li key={n.id}><a onClick={() => onSelect(n.id)}>{n.title}</a></li>;
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
      {parent && <><h3>Related to ↑</h3><ul>{link(parent)}</ul></>}
      {children.length > 0 && <><h3>Related notes ↓</h3><ul>{children.map(link)}</ul></>}
      <p className="muted">Double-click the note on the board to rename it. The body is saved as Markdown in docs/_WIP/board.</p>
    </aside>
  );
}
