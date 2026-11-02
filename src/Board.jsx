// WIP board page (src/content/wip/wip.js): free-positioned notes, edited in place and saved
// through agent-bridge.mjs (GET/PUT /wip). Only works under `npm run dev`, the bridge is local.
import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Panel, Handle, Position, MarkerType, useReactFlow } from '@xyflow/react';

const BRIDGE = 'http://127.0.0.1:5182/wip';
const NOTE_W = 320;

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

function Note({ data }) {
  // A note just created by a + button opens straight into edit mode.
  const [draft, setDraft] = useState(data.fresh ? { title: data.title, body: data.body } : null);
  const commit = () => {
    data.onChange({ title: draft.title.trim() || 'Untitled', body: draft.body });
    setDraft(null);
  };
  const keys = (e) => {
    if (e.key === 'Escape') setDraft(null);
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
  };
  if (draft) {
    return (
      <div className="note editing" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && commit()} onKeyDown={keys}>
        <input className="nodrag" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <textarea className="nodrag nowheel" autoFocus rows={Math.max(6, draft.body.split('\n').length + 1)}
          value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      </div>
    );
  }
  return (
    <div className="note" onDoubleClick={() => setDraft({ title: data.title, body: data.body })}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="note-title">
        {data.title}
        <button className="nodrag" title="Delete note" onClick={() => confirm(`Delete "${data.title}"?`) && data.onDelete()}>✕</button>
      </div>
      <Body text={data.body} isRef={data.isRef} colorOf={data.colorOf} onRef={data.onRef} />
      <button className="note-add nodrag" title="Add related note" onClick={data.onAddRelated}>+</button>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { note: Note };

// The selected note lives in the route (#/doc/page/<note id>) like any entity, so App passes it in and
// renders NoteAside for it; onNotes hands App the notes that aside reads.
export function Board({ isRef, colorOf, onRef, selected, onSelect, onNotes }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null);
  const { getNode } = useReactFlow();

  // Reloaded on focus too: board.json may have changed in another tab or by the agent meanwhile.
  useEffect(() => {
    const load = () => fetch(BRIDGE)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))))
      .then((b) => setNotes(b.notes))
      .catch((e) => setError(`${e.message}. The WIP board needs the local bridge: npm run dev.`));
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
  const remove = (id) => save(notes.filter((n) => n.id !== id).map(({ from, ...n }) => (from === id ? n : { ...n, from })));

  if (!notes) return <div className="board-msg">{error ?? 'Loading…'}</div>;
  const nodes = notes.map((n) => ({
    id: n.id,
    type: 'note',
    position: { x: n.x, y: n.y },
    dragHandle: '.note-title',
    style: { width: NOTE_W },
    selected: n.id === selected,
    data: {
      ...n, isRef, colorOf, onRef, fresh: n.id === fresh,
      onChange: (p) => update(n.id, p), onDelete: () => remove(n.id), onAddRelated: () => add(n.id),
    },
  }));
  const edges = notes.filter((n) => n.from).map((n) => ({
    id: `${n.from}>${n.id}`, source: n.from, target: n.id, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed },
    className: selected && (n.id === selected || n.from === selected) ? 'lit' : undefined,
  }));

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
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      minZoom={0.1}
    >
      <Background gap={20} />
      <Controls />
      <Panel position="top-left">
        <button className="focus-toggle" onClick={() => add()}>+ Note</button>
        {error && <span className="board-error">{error}</span>}
      </Panel>
    </ReactFlow>
  );
}

// Right-hand aside for the selected note: its full body plus the notes it is related to.
export function NoteAside({ note, notes, isRef, colorOf, onRef, onSelect }) {
  const parent = notes.find((n) => n.id === note.from);
  const children = notes.filter((n) => n.from === note.id);
  const link = (n) => <li key={n.id}><a onClick={() => onSelect(n.id)}>{n.title}</a></li>;
  return (
    <aside className="panel">
      <div className="badge" style={{ background: 'var(--color-dark-green-600)' }}>WIP note</div>
      <h2 className="note-aside-title">{note.title}</h2>
      {note.body ? <Body text={note.body} isRef={isRef} colorOf={colorOf} onRef={onRef} /> : <p className="muted">Empty note.</p>}
      {parent && <><h3>Related to ↑</h3><ul>{link(parent)}</ul></>}
      {children.length > 0 && <><h3>Related notes ↓</h3><ul>{children.map(link)}</ul></>}
      <p className="muted">Double-click the note on the board to edit it.</p>
    </aside>
  );
}
