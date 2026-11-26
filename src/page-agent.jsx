// Agent drawer on every page of `hugo server` (layouts/_partials/custom/head-end.html), opened from the navbar's 🤖.
// Tabs are files: the page's own .md (<meta name="page-agent-file">, /page/chat, recorded in its front matter), each
// _sdd.json / _ops.json of its folder (/sdd/chat, the same orchestrator as the diagram's 🤖 Agent tab), and the file
// of the session opened from 🕘 Sessions, the list of every conversation (rememberSession in Sessions.jsx).
// ‹ › step through that list: each session goes back to where it was first open (a Hugo page, a diagram, the WIP board).
// The drawer state lives in localStorage, so it stays open across pages, reloads and tabs.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BRIDGE, forgetSession, recentSessions, short, when } from './Sessions.jsx';
import { Orchestrator } from './Orchestrator.jsx';

const KEY = 'page-agent';
const LIST = 'sessions';
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
};
const save = (ui) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ui));
  } catch {}
};
const get = (path) => fetch(`${BRIDGE}${path}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge answered ${r.status}`))));
const icon = (file) => (file.startsWith('wip:') ? '📝' : file.endsWith('_ops.json') ? '⚙️' : file.endsWith('.json') ? '🧭' : '📄');
const label = (file) => (file.startsWith('wip:') ? 'WIP note' : file.endsWith('_ops.json') ? 'Ops' : file.endsWith('.json') ? 'SDD' : 'Page');
const here = () => location.pathname + location.hash;

function useRecent() {
  const [list, setList] = useState(recentSessions);
  useEffect(() => {
    const update = () => setList(recentSessions());
    window.addEventListener('agent-recent', update);
    window.addEventListener('storage', update); // other tabs
    return () => {
      window.removeEventListener('agent-recent', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return list;
}

function PageAgent({ file, navbar }) {
  const [ui, setUiState] = useState(() => ({ open: false, tab: file ?? LIST, ...load() }));
  const setUi = (next) => {
    save(next);
    setUiState(next);
  };
  // Open, the drawer takes its width from the Hugo body (padding on <body>) instead of covering it; wide: half the window.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('page-agent-open', ui.open);
    html.classList.toggle('page-agent-wide', ui.open && !!ui.wide);
  }, [ui.open, ui.wide]);
  const recent = useRecent();
  const [data, setData] = useState({}); // file → GET /page (an .md) or GET /sdd (a json)
  const [error, setError] = useState(null);
  const loadFile = (f) => get(f.endsWith('.md') ? `/page?file=${encodeURIComponent(f)}` : `/sdd?file=${encodeURIComponent(f)}`)
    .then((d) => setData((x) => ({ ...x, [f]: d })))
    .catch((e) => setError(`${f}: ${e.message}. The agent needs the local bridge: npm run dev.`));

  const files = [...new Set([file, ...(data[file]?.diagrams ?? []), ui.tab].filter((f) => f && f !== LIST && !f.startsWith('wip:')))];
  useEffect(() => {
    if (ui.open) files.filter((f) => !data[f]).forEach(loadFile);
  }, [ui.open, files.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const tab = files.includes(ui.tab) ? ui.tab : LIST;
  const d = data[tab];
  const session = tab === LIST ? null : (tab.endsWith('.md') ? d?.session : d?.orchestrator)?.id;
  const at = recent.findIndex((e) => e.session === session && e.file === tab);
  // Opens a session where it was first open: its file's tab, and its page or diagram when that is elsewhere.
  const go = (e) => {
    // A WIP note keeps one open chat for the board (Sessions.jsx): make it this session, the note aside shows it.
    if (e.file.startsWith('wip:')) localStorage.setItem('wip-chat', JSON.stringify({ note: e.file.slice(4), session: e.session, log: [], run: null }));
    setUi({ ...ui, open: true, tab: e.file.startsWith('wip:') ? LIST : e.file });
    if (e.href !== here()) location.href = e.href;
  };
  // The list is newest first: ‹ goes to an older session, › to a newer one; from elsewhere, both open the newest.
  const step = (by) => {
    const e = recent[at < 0 ? 0 : at + by];
    if (e) go(e);
  };

  const toggle = <button className="page-agent-toggle" title="Agent sessions" onClick={() => setUi({ ...ui, open: !ui.open })}>🤖 Agent</button>;
  return (
    <>
      {navbar ? createPortal(toggle, navbar) : toggle}
      {ui.open && (
        <aside className="page-agent-drawer">
          <div className="menu panel-menu">
            <button title="Older session" disabled={!recent.length || at === recent.length - 1} onClick={() => step(1)}>‹</button>
            <button title="Newer session" disabled={!recent.length || at === 0} onClick={() => step(-1)}>›</button>
            <button className={tab === LIST ? 'on' : ''} onClick={() => setUi({ ...ui, tab: LIST })}>🕘 Sessions</button>
            {files.map((f) => (
              <button key={f} className={tab === f ? 'on' : ''} title={f} onClick={() => setUi({ ...ui, tab: f })}>
                {icon(f)} {f === file ? 'Page' : label(f)}
              </button>
            ))}
            <button className="page-agent-close" title={ui.wide ? 'Narrow' : 'Expand'} onClick={() => setUi({ ...ui, wide: !ui.wide })}>{ui.wide ? '⇥' : '⇤'}</button>
            <button title="Close" onClick={() => setUi({ ...ui, open: false })}>✕</button>
          </div>
          {error && <p className="board-error">{error}</p>}
          {tab === LIST && (
            <section className="sessions">
              <h2>Agent sessions</h2>
              {recent.length ? (
                <ul className="session-list">
                  {recent.map((e) => (
                    <li key={`${e.session} ${e.file}`} className={e.session === session && e.file === tab ? 'current' : ''}>
                      <div className="session-name"><a onClick={() => go(e)}>{icon(e.file)} {e.title}</a>
                        <button className="page-agent-close" title="Forget this entry (the session itself stays)" onClick={() => forgetSession(e)}>✕</button></div>
                      <div className="muted session-when">{label(e.file)} · {short(e.session)} · active {when(e.at)} · {e.href}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No conversation yet. Sessions appear here once opened in a page, a diagram or a WIP note.</p>}
            </section>
          )}
          {d && tab.endsWith('.md') && (
            <Orchestrator key={tab} doc={{ file: tab, title: d.title, raw: { orchestrator: d.session } }} onReload={() => loadFile(tab)}
              path="/page/chat" heading="Page agent"
              about={<>One conversation for the page <strong>{d.title}</strong>. It edits <code>{tab}</code>; the page reloads with each edit.</>} />
          )}
          {d && tab.endsWith('.json') && (
            <Orchestrator key={tab} doc={{ file: tab, title: d.title ?? tab, raw: d }} onReload={() => loadFile(tab)} />
          )}
        </aside>
      )}
    </>
  );
}

// Not inside the ?embed iframe of a diagram: its host page has the drawer.
if (!document.documentElement.classList.contains('reactflow-embed')) {
  const file = document.querySelector('meta[name="page-agent-file"]')?.content;
  const nav = document.querySelector('.hextra-nav-container nav');
  const navbar = nav && Object.assign(document.createElement('span'), { className: 'page-agent-navbar' });
  navbar && nav.append(navbar);
  const root = Object.assign(document.createElement('div'), { className: 'reactflow-app page-agent' });
  document.body.append(root);
  createRoot(root).render(<PageAgent file={file} navbar={navbar} />);
}
