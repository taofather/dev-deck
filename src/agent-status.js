// Corner status of every agent run on agent-bridge.mjs (GET /runs): WIP notes and SDD orchestrators.
// Polled, not pushed: agent edits livereload the page, so the bridge is the only state that lasts.
// Clicking a card replays its run live (GET /stream). Injected only by `hugo server` (head-end.html).
const BRIDGE = 'http://127.0.0.1:5182';
const KEY = 'agent-status';
const POLL_MS = 2000;

let prefs = { hidden: [], open: [] };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY)) };
} catch {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
};

const root = document.createElement('aside');
root.className = 'agent-status';
root.setAttribute('aria-live', 'polite');
document.body.append(root);
const cards = new Map(); // run id → { el, run, stream }

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
};
const line = (log, kind, text) => {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = text;
  log.append(li);
  log.scrollTop = log.scrollHeight;
};

// The run's conversation, replayed from its first event and followed until it ends.
function openLog(c) {
  const log = c.el.querySelector('ol');
  log.replaceChildren();
  log.hidden = false;
  line(log, 'user', c.run.prompt ?? '');
  c.stream = new EventSource(`${BRIDGE}/stream?run=${c.run.id}`);
  c.stream.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.text) line(log, 'agent', ev.text);
    if (ev.tool) line(log, 'tool', `${['Read', 'Glob', 'Grep'].includes(ev.tool) ? '🔍' : '✏️'} ${ev.tool} ${ev.target}`);
    if (ev.error) line(log, 'error', ev.error);
    if (ev.done) c.stream.close();
  };
  // The bridge ends the stream when the run ends; never let EventSource reconnect and replay it again.
  c.stream.onerror = () => c.stream.close();
}
function closeLog(c) {
  c.stream?.close();
  c.el.querySelector('ol').hidden = true;
}

function card(run) {
  const el = document.createElement('article');
  el.innerHTML = `<header><span class="dot"></span><a></a><time></time><button type="button" title="Dismiss">✕</button></header>
    <p></p><ol class="agent-chat-log" hidden></ol>`;
  const c = { el, run, stream: null };
  el.querySelector('header').onclick = (e) => {
    if (e.target.closest('a, button')) return;
    const open = el.querySelector('ol').hidden;
    prefs.open = open ? [...prefs.open, run.id] : prefs.open.filter((id) => id !== run.id);
    save();
    open ? openLog(c) : closeLog(c);
  };
  el.querySelector('button').onclick = () => {
    closeLog(c);
    prefs.hidden.push(run.id);
    save();
    el.remove();
    cards.delete(run.id);
  };
  if (prefs.open.includes(run.id)) openLog(c);
  return c;
}

function render(runs) {
  const live = new Set(runs.map((r) => r.id));
  prefs.hidden = prefs.hidden.filter((id) => live.has(id));
  prefs.open = prefs.open.filter((id) => live.has(id));
  save();
  for (const [id, c] of cards) {
    if (!live.has(id)) {
      closeLog(c);
      c.el.remove();
      cards.delete(id);
    }
  }
  for (const run of runs) {
    if (prefs.hidden.includes(run.id)) continue;
    let c = cards.get(run.id);
    if (!c) {
      cards.set(run.id, (c = card(run)));
      root.append(c.el); // runs come oldest first: the newest sits at the bottom, next to the corner
    }
    const finished = c.run.done !== run.done;
    c.run = run;
    c.el.className = run.error ? 'error' : run.done ? 'done' : 'running';
    if (finished) c.el.classList.add('fresh'); // flashes once (agent-chat.css)
    const a = c.el.querySelector('a');
    a.textContent = run.label ?? run.id;
    if (run.href?.startsWith('/')) a.href = run.href;
    c.el.querySelector('time').textContent = ago(run.started);
    c.el.querySelector('p').textContent = run.error ?? (run.last || (run.done ? 'done' : 'starting…'));
  }
  root.hidden = cards.size === 0;
}

// No bridge (or one older than /runs): show nothing and keep polling.
const poll = () => fetch(`${BRIDGE}/runs`)
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => [])
  .then((runs) => render(runs.reverse()))
  .finally(() => setTimeout(poll, POLL_MS));
poll();
