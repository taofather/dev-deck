// The one agent conversation of a _sdd.json diagram, in the right panel's Agent tab (main.jsx).
// Its session id lives in the file (`orchestrator`), written by the bridge on the first message (POST /sdd/chat),
// so every browser and the agent's resume command find the same conversation. The agent edits the _sdd.json itself:
// onReload re-reads it when a session is recorded and when a run ends.
import { useEffect, useState } from 'react';
import { BRIDGE, ChatLog, resumeCommand, short, useRunChat, when } from './Sessions.jsx';

// path: the bridge chat route (/sdd/chat; /page/chat for a Hugo page's own conversation, src/page-agent.jsx).
export function Orchestrator({ doc, onReload, path = '/sdd/chat', heading = 'Orchestrator', about }) {
  const record = doc.raw.orchestrator;
  const { chat, setChat, send: post, loadHistory } = useRunChat(`${path}:${doc.file}`, doc.file, (ev) => (ev.session || ev.done) && onReload(),
    { file: doc.file, title: doc.title });
  const [input, setInput] = useState('');
  const [catalog, setCatalog] = useState(null); // { root, agent } from GET /wip/sessions
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    fetch(`${BRIDGE}/wip/sessions`).then((r) => r.json()).then(setCatalog).catch(() => setError('Bridge not running: npm run dev.'));
  }, []);
  // Open on the recorded conversation, with its history; none recorded yet → an empty one, started by the first message.
  // Kept as is while a run goes, or when it already shows the recorded session (log and run survive reloads).
  useEffect(() => {
    if (chat && (chat.run || chat.session === (record?.id ?? null))) return;
    setChat({ note: doc.file, session: record?.id ?? null, log: [], run: null });
    if (record?.id) loadHistory(record.id).catch((e) => setError(e.message));
  }, [doc.file, record?.id]);

  const send = () => {
    const message = input.trim();
    if (!message || !chat || chat.run) return;
    setInput('');
    post(path, { file: doc.file, href: location.pathname }, message);
  };
  // An existing session becomes this conversation (replacing the recorded one, after a confirm).
  const attach = (s) => {
    if (record && !confirm(`Replace session ${short(record.id)} with ${short(s.id)}?`)) return;
    fetch(`${BRIDGE}${path}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: doc.file, id: s.id }) })
      .then((r) => (r.ok ? onReload() : Promise.reject(new Error(`attach failed: ${r.status}`))))
      .then(() => setPicking(false))
      .catch((e) => setError(e.message));
  };
  const resumeCmd = record && resumeCommand(catalog, record.id);
  const copy = () => navigator.clipboard.writeText(resumeCmd).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });

  return (
    <section className="sessions">
      <h2>{heading}</h2>
      <p className="muted">
        {about ?? <>One conversation for <strong>{doc.title}</strong> using {catalog?.agent?.label ?? 'the agent'}. It reads the spec folder and edits <code>{doc.file}</code>; the diagram reloads when a run ends.</>}
      </p>
      {record ? (
        <div className="note-editor-bar">
          <span className="muted">Session {short(record.id)} · started {when(record.started)}</span>
          <button className="focus-toggle" title={resumeCmd} onClick={copy}>{copied ? '✓ Copied' : '📋 Resume cmd'}</button>
        </div>
      ) : <p className="muted">No conversation yet: the first message starts it and records its id in the file.</p>}
      <div className="note-editor-bar">
        <button className="focus-toggle" disabled={!!chat?.run} onClick={() => setPicking(!picking)}>{picking ? 'Close' : '🔗 Attach session'}</button>
      </div>
      {picking && (
        <ul className="session-picker">
          {catalog?.sessions.filter((s) => s.id !== record?.id).map((s) => (
            <li key={s.id}>
              <a onClick={() => attach(s)}>{s.title}</a>
              <span className="muted"> · {short(s.id)} · {when(s.updated)}</span>
            </li>
          )) ?? <li className="muted">Loading…</li>}
        </ul>
      )}
      {error && <p className="board-error">{error}</p>}
      {chat && <ChatLog chat={chat} input={input} setInput={setInput} onSend={send}
        emptyHint={`Runs in ${catalog?.root ?? 'AGENT_ROOT'} with ${catalog?.agent?.label ?? 'the agent'} and the sdd-convert skill.`} />}
    </section>
  );
}
