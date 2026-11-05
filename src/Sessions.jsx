// Claude sessions of a WIP note, in NoteAside. Sessions run in AGENT_ROOT through agent-bridge.mjs and are listed
// in the note page's claude_sessions front matter, so `cd AGENT_ROOT && claude --resume <id>` picks them up.
// Recording a session or an agent edit livereloads the page: the open chat lives in sessionStorage and its run
// is followed again from the last event seen (as assets/agent-chat.js does).
import { useEffect, useState } from 'react';
import { marked } from 'marked';

// Agent replies render as Markdown. Raw HTML is shown escaped and only http(s)/mailto/relative/anchor URLs
// become links or images: the agent may echo untrusted content from files or the web.
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Allowlist, not a scheme blocklist: `java&#x73;cript:` passes marked verbatim and the browser decodes it.
const safeUrl = (href) => /^(https?:\/\/|mailto:|[/#?]|\.\.?\/)/i.test(href ?? '') || !/[:&]/.test(href ?? '');
marked.use({
  breaks: true,
  renderer: {
    html: escapeHtml,
    link: (href, title, text) => (safeUrl(href) ? false : text),
    image: (href, title, text) => (safeUrl(href) ? false : escapeHtml(text ?? '')),
  },
});
const markdown = (text) => ({ __html: marked.parse(text) });

const BRIDGE = 'http://127.0.0.1:5182';
const KEY = 'wip-chat';

const loadChat = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
};
const storeChat = (chat) => {
  try {
    chat ? sessionStorage.setItem(KEY, JSON.stringify(chat)) : sessionStorage.removeItem(KEY);
  } catch {}
};
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const short = (id) => id.slice(0, 8);

// onChanged: reload the board notes, a session was recorded on the page.
export function Sessions({ note, onChanged }) {
  const [catalog, setCatalog] = useState(null); // { root, sessions } from AGENT_ROOT
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(null);
  // chat: { note, session (null until the bridge names it), log: [[role, text]], run: { id, seen } | null }
  const [chat, setChatState] = useState(() => {
    const c = loadChat();
    return c?.note === note.id ? c : null;
  });
  const setChat = (next) => setChatState((prev) => {
    const value = typeof next === 'function' ? next(prev) : next;
    storeChat(value);
    return value;
  });
  const [input, setInput] = useState('');

  useEffect(() => {
    fetch(`${BRIDGE}/wip/sessions`).then((r) => r.json()).then(setCatalog).catch(() => setError('Bridge not running: npm run dev.'));
  }, []);
  // Another note selected: its own chat, if the stored one belongs to it.
  useEffect(() => {
    const c = loadChat();
    setChatState(c?.note === note.id ? c : null);
    setPicking(false);
  }, [note.id]);
  // A run still going after a reload: follow it again.
  useEffect(() => {
    if (chat?.run) follow(chat.run);
  }, [chat?.run?.id]);

  const resumeCmd = (id) => `cd ${catalog?.root ?? 'AGENT_ROOT'} && claude --resume ${id}`;
  const copy = (id) => navigator.clipboard.writeText(resumeCmd(id)).then(() => {
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  });
  const updatedOf = (id) => catalog?.sessions.find((s) => s.id === id)?.updated;

  const open = (session) => {
    setChat({ note: note.id, session, log: [], run: null });
    if (!session) return;
    fetch(`${BRIDGE}/wip/session?id=${session}`).then((r) => r.json())
      .then(({ log }) => setChat((c) => (c?.session === session ? { ...c, log: log.map((m) => [m.role, m.text]) } : c)))
      .catch((e) => setError(e.message));
  };

  const attach = (s) => fetch(`${BRIDGE}/wip/session/attach`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.id, id: s.id, name: s.title }),
  }).then((r) => (r.ok ? onChanged() : Promise.reject(new Error(`attach failed: ${r.status}`))))
    .then(() => setPicking(false))
    .catch((e) => setError(e.message));

  const send = async () => {
    const message = input.trim();
    if (!message || chat.run) return;
    const run = { id: crypto.randomUUID(), seen: 0 };
    setInput('');
    setChat((c) => ({ ...c, log: [...c.log, ['user', message]] }));
    const res = await fetch(`${BRIDGE}/wip/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: run.id, note: note.id, message, session: chat.session ?? undefined }),
    }).catch((e) => ({ ok: false, statusText: e.message }));
    // The run is stored (and followed, see the effect) only once the bridge has it.
    setChat((c) => (res.ok ? { ...c, run } : { ...c, log: [...c.log, ['error', `bridge: ${res.status ?? ''} ${res.statusText}`]] }));
  };

  // Streams run events from `seen` on; a reload mid-stream re-enters here through the effect above.
  async function follow(run, retries = 3) {
    try {
      const res = await fetch(`${BRIDGE}/stream?run=${run.id}&from=${run.seen}`);
      if (res.status === 404) throw new Error('run lost (bridge restarted?)');
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const events = buf.split('\n\n');
        buf = events.pop();
        for (const raw of events) {
          const ev = JSON.parse(raw.replace(/^data: /, ''));
          run.seen++;
          setChat((c) => {
            if (!c || c.run?.id !== run.id) return c;
            const log = [...c.log];
            if (ev.text) log.push(['agent', ev.text]);
            if (ev.tool) log.push(['tool', `${ev.tool} ${ev.target}`]);
            if (ev.error) log.push(['error', ev.error]);
            const session = c.session ?? ev.session ?? ev.sid ?? null;
            return { ...c, log, session, run: ev.done ? null : { ...run } };
          });
          if (ev.session) onChanged();
          if (ev.done) return;
        }
      }
      throw new Error('stream closed before the run finished');
    } catch (e) {
      if (retries > 0 && !e.message.startsWith('run lost')) return setTimeout(() => follow(run, retries - 1), 1000);
      setChat((c) => (c?.run?.id === run.id ? { ...c, log: [...c.log, ['error', e.message]], run: null } : c));
    }
  }

  const attached = new Set(note.sessions?.map((s) => s.id));
  return (
    <section className="sessions">
      <h3>Claude sessions</h3>
      {error && <p className="board-error">{error}</p>}
      {note.sessions?.length ? (
        <ul className="session-list">
          {note.sessions.map((s) => (
            <li key={s.id} className={chat?.session === s.id ? 'current' : ''}>
              <div className="session-name">{s.name} <span className="muted">· {short(s.id)} · {s.origin}</span></div>
              <div className="muted session-when">started {when(s.started)}{updatedOf(s.id) && ` · active ${when(updatedOf(s.id))}`}</div>
              <div className="session-actions">
                <button className="focus-toggle" onClick={() => open(s.id)}>💬 Chat</button>
                <button className="focus-toggle" title={resumeCmd(s.id)} onClick={() => copy(s.id)}>
                  {copied === s.id ? '✓ Copied' : '📋 Resume cmd'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No sessions yet.</p>}
      <div className="note-editor-bar">
        <button className="focus-toggle" onClick={() => open(null)}>+ New session</button>
        <button className="focus-toggle" onClick={() => setPicking(!picking)}>{picking ? 'Close' : 'Attach existing'}</button>
      </div>
      {picking && (
        <ul className="session-picker">
          {catalog?.sessions.filter((s) => !attached.has(s.id)).map((s) => (
            <li key={s.id}>
              <a onClick={() => attach(s)}>{s.title}</a>
              <span className="muted"> · {short(s.id)} · {when(s.updated)}</span>
            </li>
          )) ?? <li className="muted">Loading…</li>}
        </ul>
      )}
      {chat && (
        <div className="session-chat">
          <div className="session-chat-head">
            <strong>{chat.session ? `Session ${short(chat.session)}` : 'New session'}</strong>
            {chat.run && <span className="muted"> · running…</span>}
            <button className="focus-toggle" onClick={() => setChat(null)}>✕</button>
          </div>
          <div className="session-log">
            {chat.log.map(([role, text], i) => (role === 'agent'
              ? <div key={i} className="msg agent md" dangerouslySetInnerHTML={markdown(text)} />
              : <div key={i} className={`msg ${role}`}>{role === 'tool' ? `🔧 ${text}` : text}</div>))}
            {!chat.log.length && <p className="muted">{chat.session ? 'Loading history…' : `Runs in ${catalog?.root ?? 'AGENT_ROOT'}. The first message starts the session.`}</p>}
          </div>
          <textarea rows={3} value={input} disabled={!!chat.run} placeholder="Message Claude (Enter to send, Shift+Enter for a new line)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }} />
          {chat.session && <p className="muted session-hint">⚠️ Don't resume it in a terminal while a run here is going.</p>}
        </div>
      )}
    </section>
  );
}
