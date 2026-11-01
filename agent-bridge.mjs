// Localhost bridge: the chat panel (assets/agent-chat.js) POSTs here, this runs `claude -p` in this
// repo (AGENTS.md applies) and streams its stream-json events back as SSE. Started by `npm run dev`.
// Every agent edit livereloads the page, so a run outlives its HTTP request: events are buffered per
// run and GET /stream?run=<id>&from=<n> replays them to the reloaded page.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';

const PORT = 5182;
// Any site open in the browser can reach 127.0.0.1; only the dev site may drive an agent that writes files.
const ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180'];
const TOOLS = 'Read,Edit,Write,Glob,Grep';
const KEEP_MS = 10 * 60 * 1000;
// WIP board notes (src/Board.jsx). Outside the Vite module graph and Hugo mounts: saving reloads nothing.
const BOARD = `${import.meta.dirname}/src/content/wip/board.json`;
const isNote = (n) => n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string'
  && Number.isFinite(n.x) && Number.isFinite(n.y);

function readBody(req, done) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      done(JSON.parse(body));
    } catch {
      done(undefined);
    }
  });
}

// ponytail: in-memory runs, lost on bridge restart; the panel reports it and starts over.
const runs = new Map();

function start(id, msg) {
  const run = { events: [], done: false, listeners: new Set() };
  runs.set(id, run);
  const emit = (ev) => {
    run.events.push(ev);
    for (const res of run.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  const finish = (error) => {
    if (run.done) return;
    emit({ done: true, error });
    run.done = true;
    for (const res of run.listeners) res.end();
    setTimeout(() => runs.delete(id), KEEP_MS);
  };

  const prompt = `[User is viewing ${msg.page}${msg.file ? `; source file: ${msg.file}` : ''}]\n\n${msg.message}`;
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS];
  if (/^[\w-]+$/.test(msg.sid ?? '')) args.push('--resume', msg.sid);
  const child = spawn('claude', args, { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'pipe'] });

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === 'system' && ev.subtype === 'init') emit({ sid: ev.session_id });
      if (ev.type === 'assistant') {
        for (const c of ev.message.content) {
          if (c.type === 'text') emit({ text: c.text });
          if (c.type === 'tool_use') emit({ tool: c.name, target: c.input.file_path ?? c.input.pattern ?? '' });
        }
      }
      if (ev.type === 'result') {
        emit({ sid: ev.session_id });
        finish(ev.is_error ? ev.result : undefined);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  child.on('error', (err) => finish(err.message));
  child.on('close', (code) => finish(code ? stderr.trim() || `claude exited with ${code}` : undefined));
}

createServer((req, res) => {
  const origin = req.headers.origin;
  if (!ORIGINS.includes(origin)) return res.writeHead(403).end();
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://bridge');

  if (req.method === 'GET' && url.pathname === '/stream') {
    const run = runs.get(url.searchParams.get('run'));
    if (!run) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const ev of run.events.slice(Number(url.searchParams.get('from')) || 0)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (run.done) return res.end();
    run.listeners.add(res);
    return res.on('close', () => run.listeners.delete(res));
  }

  if (url.pathname === '/wip' && req.method === 'GET') {
    return readFile(BOARD, 'utf8')
      .catch((err) => (err.code === 'ENOENT' ? '{"notes":[]}' : Promise.reject(err)))
      .then((json) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(json))
      .catch((err) => res.writeHead(500).end(err.message));
  }
  if (url.pathname === '/wip' && req.method === 'PUT') {
    return readBody(req, (board) => {
      if (!Array.isArray(board?.notes) || !board.notes.every(isNote)) return res.writeHead(400).end();
      // Write then rename: a crash mid-write never leaves a truncated board.json.
      writeFile(`${BOARD}.tmp`, `${JSON.stringify({ notes: board.notes }, null, 2)}\n`)
        .then(() => rename(`${BOARD}.tmp`, BOARD))
        .then(() => res.writeHead(204).end())
        .catch((err) => res.writeHead(500).end(err.message));
    });
  }

  if (req.method !== 'POST' || url.pathname !== '/chat') return res.writeHead(404).end();
  readBody(req, (msg) => {
    if (typeof msg?.message !== 'string' || !msg.message.trim() || !/^[\w-]+$/.test(msg.run ?? '') || runs.has(msg.run)) {
      return res.writeHead(400).end();
    }
    start(msg.run, msg);
    res.writeHead(202).end();
  });
}).listen(PORT, '0.0.0.0', () => console.log(`agent bridge on http://0.0.0.0:${PORT}`));
