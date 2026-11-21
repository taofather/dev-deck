// Localhost bridge: the WIP board and SDD orchestrator chats POST here, this runs the agent CLI chosen by env AGENT
// (src/agent-bridges: claude | opencode) in the agent root (AGENTS.md applies) and streams its events back as SSE.
// Started by `npm run dev`.
// Every agent edit livereloads the page, so a run outlives its HTTP request: events are buffered per
// run and GET /stream?run=<id>&from=<n> replays them to the reloaded page.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { LinearClient } from '@linear/sdk';
import { resolve, sep } from 'node:path';
import { addSession, boards, loadPages, movePage, noteContext, noteOf, readBoard, saveBody, saveTags, saveTitle } from './note-pages.mjs';
import { ops } from './src/SddEdit.js';
import { AGENT_ROOT, agent } from './src/agent-bridges/index.mjs';

const PORT = 5182;
// Any site open in the browser can reach 127.0.0.1; only the dev site may drive an agent that writes files.
const ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180'];
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
const ISSUE = `query($id: String!) { issue(id: $id) { identifier title url state { name color } } }`;
const json = (res, data) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

// Diagram data files edited from the React Flow app (src/content/index.js): docs/**/_sdd.json, docs/**/_ops.json,
// docs/<reign>/<folder>/<folder>.json and the WIP sub-boards docs/_WIP/board/<name>/<name>.json only.
const DOCS = resolve(import.meta.dirname, 'docs');
// _sdd.json: spec diagrams (.agents/sdd-convert-skill.md); _ops.json: operations decks (.agents/operations-deck-skill.md).
const DIAGRAM = /^_(sdd|ops)\.json$/;
const sddPath = (file) => {
  const abs = typeof file === 'string' && resolve(import.meta.dirname, file);
  if (!abs || !abs.startsWith(DOCS + sep)) return null;
  const parts = abs.slice(DOCS.length + 1).split(sep);
  const board = parts.length === 4 && parts[0] === '_WIP' && parts[1] === 'board';
  const named = (parts.length === 3 || board) && parts.at(-1) === `${parts.at(-2)}.json`;
  return DIAGRAM.test(parts.at(-1)) || named ? abs : null;
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

// Runs the agent in cwd as run <id>, buffering its events for /stream.
// turn { prompt, session, isNew, title }: see src/agent-bridges/index.mjs.
// meta { label, href, prompt }: what GET /runs shows in the corner status (src/agent-status.js).
function start(id, turn, cwd, meta) {
  const run = { ...meta, started: Date.now(), last: '', events: [], done: false, listeners: new Set() };
  runs.set(id, run);
  const emit = (ev) => {
    run.events.push(ev);
    if (ev.text) run.last = ev.text;
    if (ev.tool) run.last = `${ev.tool} ${ev.target}`;
    for (const res of run.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  const finish = (error) => {
    if (run.done) return;
    emit({ done: true, error });
    run.done = true;
    run.error = error;
    for (const res of run.listeners) res.end();
    setTimeout(() => runs.delete(id), KEEP_MS);
  };

  const [bin, args] = agent.command(turn);
  const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

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
      agent.parse(ev, { emit, finish });
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  child.on('error', (err) => finish(err.message));
  child.on('close', (code) => finish(code ? stderr.trim() || `${bin} exited with ${code}` : undefined));
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

  // href: where the run was started. A WIP note links to its node: #/<board.json id>/<page id>/<note id>, the board's selection route.
  // Every run still buffered (running, or finished less than KEEP_MS ago), newest first.
  if (req.method === 'GET' && url.pathname === '/runs') {
    return json(res, [...runs].reverse().map(([id, r]) => ({
      id, label: r.label, href: r.href, prompt: r.prompt, started: r.started, done: r.done, error: r.error, last: r.last,
    })));
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    const run = runs.get(url.searchParams.get('run'));
    if (!run) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const ev of run.events.slice(Number(url.searchParams.get('from')) || 0)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (run.done) return res.end();
    run.listeners.add(res);
    return res.on('close', () => run.listeners.delete(res));
  }

  // The board itself (board.json) loads and saves through /sdd like any diagram; these routes are its note pages.
  if (url.pathname === '/wip/pages' && req.method === 'GET') {
    return loadPages().then((pages) => json(res, { pages })).catch((err) => res.writeHead(500).end(err.message));
  }
  // A note renamed on the board: its page title follows.
  if (url.pathname === '/wip/title' && req.method === 'PUT') {
    return readBody(req, (b) => {
      if (typeof b?.id !== 'string' || typeof b.title !== 'string') return res.writeHead(400).end();
      saveTitle(b.id, b.title).then(() => res.writeHead(204).end()).catch((err) => res.writeHead(500).end(err.message));
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

  // A note onto another WIP board (NoteAside "Move to board"): out of its board file with its relations (links
  // cannot cross files), into the target's board page right of its notes, and its page into the target's folder.
  if (url.pathname === '/wip/move' && req.method === 'POST') {
    return readBody(req, async (b) => {
      if (typeof b?.id !== 'string' || typeof b.to !== 'string') return res.writeHead(400).end();
      try {
        const note = await noteOf(b.id);
        const to = (await boards()).find((x) => x.file === b.to);
        if (!note || !to) return res.writeHead(404).end(note ? 'no such board' : 'no such note');
        const dst = await readBoard(to.file);
        const pageId = dst.pages?.find((p) => p.board)?.id;
        if (!pageId) return res.writeHead(409).end(`${to.file} has no board page`);
        if (to.file !== note.where.file) {
          const src = await readBoard(note.where.file);
          const xs = Object.values(dst.pages.find((p) => p.id === pageId).positions ?? {}).map((q) => q.x);
          const pos = { x: xs.length ? Math.max(...xs) + 360 : 0, y: 0 };
          // Target first: a failure in between leaves the note on both boards, never on none.
          await writeFile(resolve(import.meta.dirname, to.file), sddJson(ops.put(dst, pageId, b.id, src.entities[b.id], pos)));
          await writeFile(resolve(import.meta.dirname, note.where.file), sddJson(ops.remove(src, b.id)));
        }
        json(res, { board: dst.id, pageId, page: await movePage(b.id, to.dir) });
      } catch (err) {
        res.writeHead(500).end(err.message);
      }
    });
  }

  // A _sdd.json diagram: read on load and focus, written on every edit (src/SddEdit.js).
  if (url.pathname === '/sdd') {
    const file = sddPath(url.searchParams.get('file'));
    if (!file) return res.writeHead(400).end('file must be docs/**/_sdd.json, docs/**/_ops.json or docs/<reign>/<folder>/<folder>.json');
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

  // The diagram's orchestrator: one agent conversation per _sdd.json (src/Orchestrator.jsx). The first message
  // creates it and records { id, started } as `orchestrator` in the file before the agent starts; later ones resume it.
  if (url.pathname === '/sdd/chat' && req.method === 'POST') {
    return readBody(req, async (b) => {
      const file = sddPath(b?.file);
      if (!file || typeof b.message !== 'string' || !b.message.trim() || !/^[\w-]+$/.test(b.run ?? '') || runs.has(b.run)) {
        return res.writeHead(400).end();
      }
      try {
        const d = await readSdd(file);
        let turn;
        let created;
        if (agent.isSessionId(d.orchestrator?.id)) {
          turn = { prompt: b.message, session: d.orchestrator.id, isNew: false };
        } else {
          created = agent.newSessionId();
          d.orchestrator = { id: created, started: new Date().toISOString() };
          await writeFile(file, sddJson(d));
          const intro = [
            `[Orchestrator of the dev-deck spec diagram "${d.title ?? b.file}".`,
            `Its data: ${file}. The spec documents it was converted from are the Markdown files in the same folder.`,
            `Follow ${resolve(import.meta.dirname, '.agents', file.endsWith('_ops.json') ? 'operations-deck-skill.md' : 'sdd-convert-skill.md')} (load the unified-docs skill first).`,
            'Edit that file in place: keep "orchestrator" as is, and give every new node a position in its kind column.',
            `The user watches it live at /diagrams/#/${d.id ?? ''}.]`,
          ].join(' ');
          turn = { prompt: `${intro}\n\n${b.message}`, session: created, isNew: true, title: `SDD ${d.title ?? b.file}` };
        }
        const emit = start(b.run, turn, AGENT_ROOT, { label: `SDD ${d.title ?? b.file}`, href: `/diagrams/#/${d.id ?? ''}`, prompt: b.message });
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

  // One issue by identifier (C-13262), assigned to anyone: the WIP board's "+ Import".
  if (url.pathname === '/linear/issue' && req.method === 'GET') {
    if (!linear) return res.writeHead(503).end('LINEAR_API_KEY is not set (env or .env)');
    return linear.client.rawRequest(ISSUE, { id: url.searchParams.get('id') ?? '' })
      .then(({ data }) => (data.issue ? json(res, data.issue) : res.writeHead(404).end('Issue not found')))
      .catch((err) => res.writeHead(502).end(err.message));
  }

  // Agent sessions of WIP notes (src/Sessions.jsx): they run in AGENT_ROOT, so agent.resume works from there.
  // `agent` tells the UI which CLI runs and how to resume a session by hand.
  if (url.pathname === '/wip/sessions' && req.method === 'GET') {
    return agent.listSessions()
      .then((sessions) => json(res, { root: AGENT_ROOT, agent: { name: agent.name, label: agent.label, resume: agent.resume }, sessions }))
      .catch((err) => res.writeHead(500).end(err.message));
  }
  if (url.pathname === '/wip/session' && req.method === 'GET') {
    return agent.transcript(url.searchParams.get('id'))
      .then((log) => (log ? json(res, { log }) : res.writeHead(400).end()))
      .catch((err) => res.writeHead(500).end(err.message));
  }
  if (url.pathname === '/wip/session/attach' && req.method === 'POST') {
    return readBody(req, (b) => {
      if (typeof b?.note !== 'string' || !agent.isSessionId(b.id) || typeof b.name !== 'string') return res.writeHead(400).end();
      addSession(b.note, { id: b.id, name: b.name, started: new Date().toISOString(), origin: 'attached' })
        .then((page) => (page ? json(res, { page }) : res.writeHead(404).end('no such note')))
        .catch((err) => res.writeHead(500).end(err.message));
    });
  }
  if (url.pathname === '/wip/chat' && req.method === 'POST') {
    return readBody(req, async (b) => {
      if (typeof b?.note !== 'string' || typeof b.message !== 'string' || !b.message.trim()
        || !/^[\w-]+$/.test(b.run ?? '') || runs.has(b.run) || (b.session && !agent.isSessionId(b.session))) {
        return res.writeHead(400).end();
      }
      try {
        const ctx = await noteContext(b.note);
        if (!ctx) return res.writeHead(404).end('no such note');
        let turn;
        if (b.session) {
          turn = { prompt: b.message, session: b.session, isNew: false };
        } else {
          // A new session: its id goes into the note before the agent starts, so it is tracked even if the run fails.
          const session = agent.newSessionId();
          await addSession(b.note, { id: session, name: ctx.note.title, started: new Date().toISOString(), origin: 'board' });
          const intro = [
            `[WIP note "${ctx.note.title}" from the dev-deck board.`,
            ctx.file ? `Its page, where its notes live: ${ctx.file}.` : 'It has no page yet.',
            ctx.note.linear ? `Linear ticket: ${ctx.note.linear.url}.` : '',
            ']', ctx.body ? `\nNote body:\n${ctx.body}\n` : '',
          ].filter(Boolean).join(' ');
          turn = { prompt: `${intro}\n\n${b.message}`, session, isNew: true, title: ctx.note.title };
          b.newSession = session;
        }
        // dev-deck outside AGENT_ROOT: each driver gives the agent access to it (claude: --add-dir).
        const emit = start(b.run, turn, AGENT_ROOT, { label: ctx.note.title, href: `/diagrams/#/${ctx.note.where.id}/${ctx.note.where.pageId}/${b.note}`, prompt: b.message });
        if (b.newSession) emit({ session: b.newSession });
        res.writeHead(202).end();
      } catch (err) {
        res.writeHead(500).end(err.message);
      }
    });
  }

  res.writeHead(404).end();
}).listen(PORT, '0.0.0.0', () => console.log(`agent bridge on http://0.0.0.0:${PORT} (agent: ${agent.label}, root: ${AGENT_ROOT})`));
