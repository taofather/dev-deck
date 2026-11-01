// WIP board page (src/content/wip/wip.js): free-positioned notes, edited in place and saved
// through agent-bridge.mjs (GET/PUT /wip). Only works under `npm run dev`, the bridge is local.
import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';

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
  const [draft, setDraft] = useState(null);
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
      <div className="note-title">
        {data.title}
        <button className="nodrag" title="Delete note" onClick={() => confirm(`Delete "${data.title}"?`) && data.onDelete()}>✕</button>
      </div>
      <Body text={data.body} isRef={data.isRef} colorOf={data.colorOf} onRef={data.onRef} />
    </div>
  );
}
const nodeTypes = { note: Note };

export function Board({ isRef, colorOf, onRef }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(BRIDGE)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))))
      .then((b) => setNotes(b.notes))
      .catch((e) => setError(`${e.message}. The WIP board needs the local bridge: npm run dev.`));
  }, []);

  // ponytail: last write wins; an agent edit to board.json while the board is open is overwritten on the next save.
  const save = (next) => {
    setNotes(next);
    fetch(BRIDGE, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: next }) })
      .then((r) => (r.ok ? setError(null) : Promise.reject(new Error(`save failed: ${r.status}`))))
      .catch((e) => setError(e.message));
  };
  const update = (id, patch) => save(notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const add = () => {
    const x = notes.length ? Math.max(...notes.map((n) => n.x)) + NOTE_W + 40 : 0;
    save([...notes, { id: crypto.randomUUID(), title: 'New note', body: '', x, y: 0 }]);
  };

  if (!notes) return <div className="board-msg">{error ?? 'Loading…'}</div>;
  const nodes = notes.map((n) => ({
    id: n.id,
    type: 'note',
    position: { x: n.x, y: n.y },
    dragHandle: '.note-title',
    style: { width: NOTE_W },
    data: { ...n, isRef, colorOf, onRef, onChange: (p) => update(n.id, p), onDelete: () => save(notes.filter((o) => o.id !== n.id)) },
  }));

  return (
    <ReactFlow
      fitView
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodeDragStop={(_, node) => update(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })}
      onNodesChange={(changes) => {
        const moves = changes.filter((c) => c.type === 'position' && c.position);
        if (moves.length) setNotes((ns) => ns.map((n) => {
          const c = moves.find((m) => m.id === n.id);
          return c ? { ...n, x: c.position.x, y: c.position.y } : n;
        }));
      }}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      minZoom={0.1}
    >
      <Background gap={20} />
      <Controls />
      <Panel position="top-left">
        <button className="focus-toggle" onClick={add}>+ Note</button>
        {error && <span className="board-error">{error}</span>}
      </Panel>
    </ReactFlow>
  );
}
