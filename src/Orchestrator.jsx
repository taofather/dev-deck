// The one agent conversation of a diagram, in the right panel's Agent tab (main.jsx).
// Its session id lives in the file (`orchestrator`), written by the bridge on the first message (POST /sdd/chat),
// so every browser and the agent's resume command find the same conversation. The agent edits the diagram itself:
// onReload re-reads it when a session is recorded and when a run ends.
import { useEffect, useState } from 'react';
import { BRIDGE, ChatLog, resumeCommand, short, useRunChat, when } from './Sessions.jsx';

export function Orchestrator({ doc, onReload }) {
  const record = doc.raw.orchestrator;
  const { chat, setChat, send: post, loadHistory } = useRunChat('sdd-chat', doc.file, (ev) => (ev.session || ev.done) && onReload());
  const [input, setInput] = useState('');
  const [catalog, setCatalog] = useState(null); // { root, agent } from GET /wip/sessions
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

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
    post('/sdd/chat', { file: doc.file }, message);
  };
  const resumeCmd = record && resumeCommand(catalog, record.id);
  const copy = () => navigator.clipboard.writeText(resumeCmd).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });

  return (
    <section className="sessions">
      <h2>Orchestrator</h2>
      <p className="muted">
        One conversation for <strong>{doc.title}</strong> using {catalog?.agent?.label ?? 'the agent'}. It interacts with the diagram and edits <code>{doc.file}</code>; the diagram reloads when a run ends.
      </p>
      {record ? (
        <div className="note-editor-bar">
          <span className="muted">Session {short(record.id)} · started {when(record.started)}</span>
          <button className="focus-toggle" title={resumeCmd} onClick={copy}>{copied ? '✓ Copied' : '📋 Resume cmd'}</button>
        </div>
      ) : <p className="muted">No conversation yet: the first message starts it and records its id in the file.</p>}
      {error && <p className="board-error">{error}</p>}
      {chat && <ChatLog chat={chat} input={input} setInput={setInput} onSend={send}
        emptyHint={`Runs in ${catalog?.root ?? 'AGENT_ROOT'} with ${catalog?.agent?.label ?? 'the agent'}.`} />}
    </section>
  );
}
