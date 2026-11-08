// Localhost bridge: the chat panel (assets/agent-chat.js) POSTs here, this runs `claude -p` in this
// repo (AGENTS.md applies) and streams its stream-json events back as SSE. Started by `npm run dev`.
// Every agent edit livereloads the page, so a run outlives its HTTP request: events are buffered per
// run and GET /stream?run=<id>&from=<n> replays them to the reloaded page.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { LinearClient } from '@linear/sdk';
import { randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { addSession, loadNotes, migrateBodies, noteContext, saveBody, saveNotes, saveTags } from './wip-notes.mjs';
import { AGENT_ROOT, isSessionId, listSessions, transcript } from './claude-sessions.mjs';

const PORT = 5182;
// Any site open in the browser can reach 127.0.0.1; only the dev site may drive an agent that writes files.
const ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180'];
const TOOLS = 'Read,Edit,Write,Glob,Grep';
const KEEP_MS = 10 * 60 * 1000;
// Linear personal API key (linear.app/mycompany/settings/account/security), from the env or the gitignored .env.
if (existsSync(`${import.meta.dirname}/.env`)) process.loadEnvFile(`${import.meta.dirname}/.env`);
const linear = process.env.LINEAR_API_KEY && new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
// One raw query instead of the SDK's lazy models: those fetch state, cycle and labels one request per issue.
const CYCLE_ISSUES = `query {
  viewer {
    assignedIssues(first: 100, filter: { cycle: { isActive: { eq: true } } }) {
      nodes {
        identifier title url priority priorityLabel
        state { name type color position }
        cycle { number name startsAt endsAt }
        labels { nodes { name color } }
      }
    }
  }
}`;
// WIP board notes (src/Board.jsx): layout in board.json, bodies in docs/_WIP/board pages (wip-notes.mjs).
const isNote = (n) => n && typeof n.id === 'string' && typeof n.title === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y);
const json = (res, data) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

// Diagram data files edited from the React Flow app (src/content/index.js): docs/**/_sdd.json only.
const DOCS = resolve(import.meta.dirname, 'docs');
const sddPath = (file) => {
  const abs = typeof file === 'string' && resolve(import.meta.dirname, file);
  return abs && abs.startsWith(DOCS + sep) && abs.endsWith(`${sep}_sdd.json`) ? abs : null;
};
const isSdd = (d) => d && typeof d === 'object' && !Array.isArray(d) && typeof (d.entities ?? {}) === 'object'
  && Array.isArray(d.relations ?? []) && Array.isArray(d.pages ?? []);
const readSdd = (file) => readFile(file, 'utf8').then((raw) => (raw.trim() ? JSON.parse(raw) : {}));
// Pretty JSON that stays hand-editable: short arrays ([from, to, label], short id lists) on one line.
// Checked by a round trip; a string the regex would touch falls back to plain indentation.
const sddJson = (d) => {
  const plain = JSON.stringify(d, null, 2);
  const compact = plain.replace(/\[\s+([^[\]{}]*?)\s+\]/g, (all, inner) => {
    const line = `[${inner.replace(/\n\s*/g, ' ')}]`;
    return line.length <= 120 ? line : all;
  });
  return `${JSON.stringify(JSON.parse(compact)) === JSON.stringify(d) ? compact : plain}\n`;
};

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

// Runs `claude <args>` in cwd as run <id>, buffering its stream-json events for /stream.
function start(id, args, cwd) {
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

  const child = spawn('claude', [...args, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

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
  return emit;
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
    return loadNotes().then((notes) => json(res, { notes })).catch((err) => res.writeHead(500).end(err.message));
  }
  if (url.pathname === '/wip' && req.method === 'PUT') {
    return readBody(req, (board) => {
      if (!Array.isArray(board?.notes) || !board.notes.every(isNote)) return res.writeHead(400).end();
      saveNotes(board.notes).then(() => res.writeHead(204).end()).catch((err) => res.writeHead(500).end(err.message));
    });
  }
  // One note's body, saved to its docs/_WIP/board page (the aside editor in src/Board.jsx).
  if (url.pathname === '/wip/body' && req.method === 'PUT') {
    return readBody(req, (b) => {
      if (typeof b?.id !== 'string' || typeof b.body !== 'string') return res.writeHead(400).end();
      saveBody(b.id, b.body)
        .then((page) => (page ? json(res, { page }) : res.writeHead(404).end('no such note')))
        .catch((err) => res.writeHead(500).end(err.message));
    });
  }

  // A note's labels: the tags of its docs/_WIP/board page.
  if (url.pathname === '/wip/tags' && req.method === 'PUT') {
    return readBody(req, (b) => {
      if (typeof b?.id !== 'string' || !Array.isArray(b.tags) || !b.tags.every((t) => typeof t === 'string')) return res.writeHead(400).end();
      saveTags(b.id, b.tags)
        .then((tags) => (tags ? json(res, { tags }) : res.writeHead(404).end('no such note')))
        .catch((err) => res.writeHead(500).end(err.message));
    });
  }

  // A _sdd.json diagram: read on load and focus, written on every edit (src/SddEdit.js).
  if (url.pathname === '/sdd') {
    const file = sddPath(url.searchParams.get('file'));
    if (!file) return res.writeHead(400).end('file must be docs/**/_sdd.json');
    if (req.method === 'GET') {
      return readSdd(file)
        .then((d) => json(res, d))
        .catch((err) => res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.message));
    }
    if (req.method === 'PUT') {
      return readBody(req, async (d) => {
        if (!isSdd(d)) return res.writeHead(400).end('not a diagram: { entities, relations, pages }');
        try {
          // The app may hold a copy older than the orchestrator record (written here by /sdd/chat): keep the record.
          const disk = await readSdd(file).catch(() => ({}));
          if (disk.orchestrator && !d.orchestrator) d.orchestrator = disk.orchestrator;
          await writeFile(file, sddJson(d));
          res.writeHead(204).end();
        } catch (err) {
          res.writeHead(500).end(err.message);
        }
      });
    }
  }

  // The diagram's orchestrator: one Claude conversation per _sdd.json (src/Orchestrator.jsx). The first message
  // creates it and records { id, started } as `orchestrator` in the file before claude starts; later ones resume it.
  if (url.pathname === '/sdd/chat' && req.method === 'POST') {
    return readBody(req, async (b) => {
      const file = sddPath(b?.file);
      if (!file || typeof b.message !== 'string' || !b.message.trim() || !/^[\w-]+$/.test(b.run ?? '') || runs.has(b.run)) {
        return res.writeHead(400).end();
      }
      try {
        const d = await readSdd(file);
        let args;
        let created;
        if (isSessionId(d.orchestrator?.id)) {
          args = ['-p', b.message, '--resume', d.orchestrator.id];
        } else {
          created = randomUUID();
          d.orchestrator = { id: created, started: new Date().toISOString() };
          await writeFile(file, sddJson(d));
          const intro = [
            `[Orchestrator of the dev-deck spec diagram "${d.title ?? b.file}".`,
            `Its data: ${file}. The spec documents it was converted from are the Markdown files in the same folder.`,
            `Follow ${resolve(import.meta.dirname, 'sdd-convert-skill.md')} (load the unified-docs skill first).`,
            'Edit that _sdd.json in place: keep "orchestrator" as is, and give every new node a position in its kind column.',
            `The user watches it live at /diagrams/#/${d.id ?? ''}.]`,
          ].join(' ');
          args = ['-p', `${intro}\n\n${b.message}`, '--session-id', created, '--name', `SDD ${d.title ?? b.file}`];
        }
        if (relative(AGENT_ROOT, import.meta.dirname).startsWith('..')) args.push('--add-dir', import.meta.dirname);
        const emit = start(b.run, args, AGENT_ROOT);
        if (created) emit({ session: created });
        res.writeHead(202).end();
      } catch (err) {
        res.writeHead(500).end(err.message);
      }
    });
  }

  // The viewer's issues in the active cycle, for the WIP board sidebar (src/Linear.jsx).
  if (url.pathname === '/linear/cycle' && req.method === 'GET') {
    if (!linear) return res.writeHead(503).end('LINEAR_API_KEY is not set (env or .env)');
    return linear.client.rawRequest(CYCLE_ISSUES)
      .then(({ data }) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        issues: data.viewer.assignedIssues.nodes.map(({ labels, ...i }) => ({ ...i, labels: labels.nodes })),
      })))
      .catch((err) => res.writeHead(502).end(err.message));
  }

  // Claude sessions of WIP notes (src/Sessions.jsx): they run in AGENT_ROOT, so `claude --resume <id>` works from there.
  if (url.pathname === '/wip/sessions' && req.method === 'GET') {
    return listSessions().then((sessions) => json(res, { root: AGENT_ROOT, sessions })).catch((err) => res.writeHead(500).end(err.message));
  }
  if (url.pathname === '/wip/session' && req.method === 'GET') {
    return transcript(url.searchParams.get('id'))
      .then((log) => (log ? json(res, { log }) : res.writeHead(400).end()))
      .catch((err) => res.writeHead(500).end(err.message));
  }
  if (url.pathname === '/wip/session/attach' && req.method === 'POST') {
    return readBody(req, (b) => {
      if (typeof b?.note !== 'string' || !isSessionId(b.id) || typeof b.name !== 'string') return res.writeHead(400).end();
      addSession(b.note, { id: b.id, name: b.name, started: new Date().toISOString(), origin: 'attached' })
        .then((page) => (page ? json(res, { page }) : res.writeHead(404).end('no such note')))
        .catch((err) => res.writeHead(500).end(err.message));
    });
  }
  if (url.pathname === '/wip/chat' && req.method === 'POST') {
    return readBody(req, async (b) => {
      if (typeof b?.note !== 'string' || typeof b.message !== 'string' || !b.message.trim()
        || !/^[\w-]+$/.test(b.run ?? '') || runs.has(b.run) || (b.session && !isSessionId(b.session))) {
        return res.writeHead(400).end();
      }
      try {
        const ctx = await noteContext(b.note);
        if (!ctx) return res.writeHead(404).end('no such note');
        let args;
        if (b.session) {
          args = ['-p', b.message, '--resume', b.session];
        } else {
          // A new session: its id goes into the note before claude starts, so it is tracked even if the run fails.
          const session = randomUUID();
          await addSession(b.note, { id: session, name: ctx.note.title, started: new Date().toISOString(), origin: 'board' });
          const intro = [
            `[WIP note "${ctx.note.title}" from the dev-deck board.`,
            ctx.file ? `Its page, where its notes live: ${ctx.file}.` : 'It has no page yet.',
            ctx.note.linear ? `Linear ticket: ${ctx.note.linear.url}.` : '',
            ']', ctx.body ? `\nNote body:\n${ctx.body}\n` : '',
          ].filter(Boolean).join(' ');
          args = ['-p', `${intro}\n\n${b.message}`, '--session-id', session, '--name', ctx.note.title];
          b.newSession = session;
        }
        // dev-deck outside AGENT_ROOT: the agent still needs to reach the note page.
        if (relative(AGENT_ROOT, import.meta.dirname).startsWith('..')) args.push('--add-dir', import.meta.dirname);
        const emit = start(b.run, args, AGENT_ROOT);
        if (b.newSession) emit({ session: b.newSession });
        res.writeHead(202).end();
      } catch (err) {
        res.writeHead(500).end(err.message);
      }
    });
  }

  // Page chat panel (assets/agent-chat.js): runs in dev-deck.
  if (req.method !== 'POST' || url.pathname !== '/chat') return res.writeHead(404).end();
  readBody(req, (msg) => {
    if (typeof msg?.message !== 'string' || !msg.message.trim() || !/^[\w-]+$/.test(msg.run ?? '') || runs.has(msg.run)) {
      return res.writeHead(400).end();
    }
    const prompt = `[User is viewing ${msg.page}${msg.file ? `; source file: ${msg.file}` : ''}]\n\n${msg.message}`;
    start(msg.run, ['-p', prompt, ...(/^[\w-]+$/.test(msg.sid ?? '') ? ['--resume', msg.sid] : [])], import.meta.dirname);
    res.writeHead(202).end();
  });
}).listen(PORT, '0.0.0.0', () => console.log(`agent bridge on http://0.0.0.0:${PORT}`));

migrateBodies().then((n) => n && console.log(`moved ${n} WIP note bodies to docs/_WIP/board`))
  .catch((err) => console.error('WIP body migration failed:', err.message));
