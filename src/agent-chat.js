// Chat panel for agent-bridge.mjs. Injected only by `hugo server` (layouts/_partials/custom/head-end.html).
// History and session id live in sessionStorage: every agent edit triggers a livereload.
const BRIDGE = 'http://127.0.0.1:5182';
const KEY = 'agent-chat';

const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? { open: false, sid: null, run: null, log: [] };
  } catch {
    return { open: false, sid: null, run: null, log: [] };
  }
};
const state = load();
const save = () => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
};

const root = document.createElement('div');
root.className = 'agent-chat';
root.innerHTML = `
  <button class="agent-chat-toggle" type="button" aria-label="Agent chat">✨</button>
  <section class="agent-chat-panel">
    <header>Agent <button type="button" class="agent-chat-reset" title="New session">↺</button></header>
    <ol class="agent-chat-log" aria-live="polite"></ol>
    <form><textarea rows="3" placeholder="Edit this page…  (Enter to send)"></textarea></form>
  </section>`;
const log = root.querySelector('.agent-chat-log');
const input = root.querySelector('textarea');

const add = (kind, text) => {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = text;
  log.append(li);
  log.scrollTop = log.scrollHeight;
};
const push = (kind, text) => {
  state.log.push([kind, text]);
  save();
  add(kind, text);
};
const setOpen = (open) => {
  state.open = open;
  save();
  root.classList.toggle('open', open);
  if (open) input.focus();
};

async function send(message) {
  push('user', message);
  const run = crypto.randomUUID();
  const file = document.querySelector('meta[name="agent-source"]')?.content;
  try {
    const res = await fetch(`${BRIDGE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run, message, page: location.pathname + location.hash, file, sid: state.sid }),
    });
    if (!res.ok) throw new Error(`bridge answered ${res.status}`);
  } catch (err) {
    return push('error', `${err.message}. Is the bridge running? (node agent-bridge.mjs)`);
  }
  state.run = { id: run, seen: 0 };
  save();
  follow();
}

// Streams the current run from the last event seen. An agent edit livereloads the page mid-stream:
// the reloaded page calls follow() again, so a dropped stream is retried rather than reported.
async function follow(retries = 3) {
  input.disabled = true;
  try {
    const res = await fetch(`${BRIDGE}/stream?run=${state.run.id}&from=${state.run.seen}`);
    if (res.status === 404) throw new Error('run lost (bridge restarted?)');
    if (!res.ok) throw new Error(`bridge answered ${res.status}`);
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
        state.run.seen++;
        if (ev.sid) state.sid = ev.sid;
        if (ev.text) push('agent', ev.text);
        if (ev.tool) push('tool', `${ev.tool === 'Read' || ev.tool === 'Glob' || ev.tool === 'Grep' ? '🔍' : '✏️'} ${ev.tool} ${ev.target}`);
        if (ev.error) push('error', ev.error);
        if (ev.done) state.run = null;
        save();
        if (!state.run) break;
      }
    }
    if (state.run) throw new Error('stream closed before the run finished');
  } catch (err) {
    if (state.run && retries > 0 && !err.message.startsWith('run lost')) {
      return setTimeout(() => follow(retries - 1), 1000);
    }
    push('error', `${err.message}. Is the bridge running? (node agent-bridge.mjs)`);
    state.run = null;
    save();
  }
  input.disabled = false;
  input.focus();
}

root.querySelector('.agent-chat-toggle').onclick = () => setOpen(!state.open);
root.querySelector('.agent-chat-reset').onclick = () => {
  state.sid = null;
  state.run = null;
  state.log = [];
  save();
  log.replaceChildren();
};
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || !input.value.trim()) return;
  e.preventDefault();
  send(input.value.trim());
  input.value = '';
});

state.log.forEach(([kind, text]) => add(kind, text));
document.body.append(root);
setOpen(state.open);
if (state.run) follow();
