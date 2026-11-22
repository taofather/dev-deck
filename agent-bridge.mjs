// Localhost bridge: the diagram orchestrator and WIP note chats POST here, this runs the agent CLI chosen by
// env AGENT (src/agent-bridges: claude | opencode) in the agent root and streams its events back as SSE.
// Started by `npm run dev`.
// Every agent edit livereloads the page, so a run outlives its HTTP request: events are buffered per
// run and GET /stream?run=<id>&from=<n> replays them to the reloaded page.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { addSession, boards, loadPages, movePage, noteContext, noteOf, readBoard, saveBody, saveTags, saveTitle } from './note-pages.mjs';
import { ops } from './src/DiagramEditor.js';
import { AGENT_ROOT, agent } from './src/agent-bridges/index.mjs';

const PORT = 5662;
// Any site open in the browser can reach 127.0.0.1; only the dev site on localhost may drive an agent that writes files.
const isAllowedOrigin = (origin) => !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const KEEP_MS = 10 * 60 * 1000;
if (existsSync(`${import.meta.dirname}/.env`)) process.loadEnvFile(`${import.meta.dirname}/.env`);
const json = (res, data) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

// Web integration (liber-daemonicus-web)
// Base URLs come only from .env, never defaulted: unset → the web routes below throw (and answer 500 with the reason).
const envUrl = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: add it to the deck's .env and restart npm run dev.`);
  return value.replace(/\/+$/, '');
};
const webUrl = () => envUrl('WEB_URL');
const DJ_EMAIL = process.env.DJ_EMAIL || 'dj@aquelarre.cat';
const DJ_PASSWORD = process.env.DJ_PASSWORD || 'password123';
// Supabase Edge Functions base URL; locally the web's Express server emulates /functions/v1/*.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const publishNarrativeUrl = () => `${envUrl('SUPABASE_URL')}/functions/v1/publish-narrative`;
const functionHeaders = (token) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
  ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
});
let cachedDjToken = null;

// fetch(url, init) against the web as the DJ; a refused token is renewed once.
async function asDj(url, init = {}) {
  const call = async () => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await getDjToken()}` } });
  let res = await call();
  if (res.status === 401 || res.status === 403) {
    cachedDjToken = null;
    res = await call();
  }
  return res;
}

async function getDjToken() {
  if (cachedDjToken) return cachedDjToken;
  const res = await fetch(`${webUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bypass-rate-limit': 'true' },
    body: JSON.stringify({ email: DJ_EMAIL, password: DJ_PASSWORD }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DJ login failed on web server (${res.status}): ${errText}`);
  }
  const data = await res.json();
  cachedDjToken = data.token;
  return cachedDjToken;
}

// Diagram data files edited from the React Flow app: docs/**/_sdd.json, src/content/**/*.json, content/**/*.json
const ROOT = resolve(import.meta.dirname);
const sddPath = (file) => {
  if (typeof file !== 'string' || !file.trim()) return null;
  const clean = file.replace(/^(\.\/)+/, '').replace(/^(\.\.\/)+/, '');
  const candidates = [
    resolve(ROOT, clean),
    resolve(ROOT, 'src/content', clean),
    resolve(ROOT, 'content', clean),
    resolve(ROOT, 'docs', clean),
  ];
  for (const c of candidates) {
    if (c.startsWith(ROOT + sep) && c.endsWith('.json') && existsSync(c)) {
      return c;
    }
  }
  for (const c of candidates) {
    if (c.startsWith(ROOT + sep) && c.endsWith('.json')) {
      return c;
    }
  }
  return null;
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

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return res.writeHead(403).end();
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
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

  // A diagram: read on load and focus, written on every edit (src/DiagramEditor.js).
  if (url.pathname === '/sdd') {
    const file = sddPath(url.searchParams.get('file'));
    if (!file) return res.writeHead(400).end('file must be docs/**/_sdd.json, docs/**/_ops.json or docs/<reign>/<folder>/<folder>.json');
    if (req.method === 'GET') {
      return readSdd(file)
        .then((d) => json(res, d))
        .catch((err) => res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.message));
    }
    if (req.method === 'PUT') {
      // Only an existing diagram is overwritten: a page built before a diagram moved or was deleted would
      // otherwise recreate the old copy (diagrams come from the bundle; adding or removing one needs a rebuild).
      if (!existsSync(file)) {
        return res.writeHead(404).end(`${url.searchParams.get('file')} no longer exists: reload the page (the bundle may be stale, restart npm run dev).`);
      }
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

  // The diagram's orchestrator: one agent conversation per diagram (src/Orchestrator.jsx). The first message creates it
  // and records { id, started } as `orchestrator` in the file before the agent starts; later ones resume it.
  if (url.pathname === '/sdd/chat' && req.method === 'POST') {
    return readBody(req, async (b) => {
      const file = sddPath(b?.file);
      if (!file) {
        console.warn(`[sdd/chat] 400: diagram file not found for "${b?.file}"`);
        return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: `File not found: ${b?.file}` }));
      }
      if (typeof b?.message !== 'string' || !b.message.trim()) {
        console.warn('[sdd/chat] 400: message required');
        return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Message required' }));
      }
      if (!/^[\w-]+$/.test(b?.run ?? '')) {
        console.warn(`[sdd/chat] 400: invalid run id: ${b?.run}`);
        return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid run id' }));
      }
      if (runs.has(b.run)) {
        console.warn(`[sdd/chat] 400: run ${b.run} already in progress`);
        return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Run already in progress' }));
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
            `[Orchestrator of the Liber Daemonum diagram "${d.title ?? b.file}".`,
            `Its data: ${file}. Follow Liber Daemonum graph and structured rules for LLM agents.`,
            'Node ID prefixes follow Java-like package nomenclature: controlPoint, narrativeBlock, playerAction, actionSelection, turn, custom, intention, event, demiurge, cosmicStatistic, character, location, item.',
            'Edit that file in place: keep "orchestrator" as is, and give every new node a position.',
            `The user watches it live at /diagrams/#/${d.id ?? ''}.]`,
          ].join(' ');
          turn = { prompt: `${intro}\n\n${b.message}`, session: created, isNew: true, title: `Liber Daemonum: ${d.title ?? b.file}` };
        }
        const emit = start(b.run, turn, AGENT_ROOT, { label: `Orchestrator ${d.title ?? b.file}`, href: `/diagrams/#/${d.id ?? ''}`, prompt: b.message });
        if (created) emit({ session: created });
        res.writeHead(202).end();
      } catch (err) {
        res.writeHead(500).end(err.message);
      }
    });
  }

  // Agent sessions of notes (src/Sessions.jsx): they run in AGENT_ROOT, so agent.resume works from there.
  // `agent` tells the UI which CLI runs and how to resume a session by hand.
  if (url.pathname === '/wip/sessions' && req.method === 'GET') {
    return agent.listSessions()
      .then((sessions) => json(res, { root: AGENT_ROOT, agent: { name: agent.name, label: agent.label, resume: agent.resume }, sessions })).catch((err) => res.writeHead(500).end(err.message));
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
            ']', ctx.body ? `\nNote body:\n${ctx.body}\n` : '',
          ].filter(Boolean).join(' ');
          turn = { prompt: `${intro}\n\n${b.message}`, session, isNew: true, title: ctx.note.title };
          b.newSession = session;
        }
        const emit = start(b.run, turn, AGENT_ROOT, { label: ctx.note.title, href: `/diagrams/#/${ctx.note.where?.id ?? ''}/${ctx.note.where?.pageId ?? ''}/${b.note}`, prompt: b.message });
        if (b.newSession) emit({ session: b.newSession });
        res.writeHead(202).end();
      } catch (err) {
        res.writeHead(500).end(err.message);
      }
    });
  }

  // Web integration: publish narrative block via the publish-narrative Edge Function
  if (url.pathname === '/web/publish-narrative' && req.method === 'POST') {
    return readBody(req, async (b) => {
      try {
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || await getDjToken();
        const resWeb = await fetch(publishNarrativeUrl(), {
          method: 'POST',
          headers: functionHeaders(token),
          body: JSON.stringify(b),
        });
        const data = await resWeb.json().catch(() => ({}));
        if (!resWeb.ok && (resWeb.status === 401 || resWeb.status === 403)) {
          cachedDjToken = null;
          const freshToken = await getDjToken();
          const retryRes = await fetch(publishNarrativeUrl(), {
            method: 'POST',
            headers: functionHeaders(freshToken),
            body: JSON.stringify(b),
          });
          const retryData = await retryRes.json().catch(() => ({}));
          return res.writeHead(retryRes.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(retryData));
        }
        return res.writeHead(resWeb.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      } catch (err) {
        console.error('[web/publish-narrative] error:', err.message);
        return res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
      }
    });
  }

  // Web integration (Sincronitzar button): narrative blocks and player actions of a campaign, fetched as DJ
  const SYNC_ROUTES = {
    '/web/narrative-blocks': ['/api/narrative/history', 'history', 'blocks'],
    '/web/player-actions': ['/api/narrative/actions', 'actions', 'actions'],
  };
  if (SYNC_ROUTES[url.pathname] && req.method === 'GET') {
    const [path, from, to] = SYNC_ROUTES[url.pathname];
    const campaignId = encodeURIComponent(url.searchParams.get('campaignId') || '1');
    try {
      const resWeb = await asDj(`${webUrl()}${path}?campaignId=${campaignId}`);
      const data = await resWeb.json().catch(() => ({}));
      if (!resWeb.ok) throw new Error(data.error || `web answered ${resWeb.status}`);
      return json(res, { [to]: data[from] ?? [] });
    } catch (err) {
      console.error(`[${url.pathname}] error:`, err.message);
      return res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
    }
  }

  // Web integration: a narrative block's is_active, by node (Actiu/Inactiu button). Body { campaignId, nodeId, isActive }.
  if (url.pathname === '/web/block-active' && req.method === 'POST') {
    return readBody(req, async (b) => {
      try {
        const resWeb = await asDj(`${webUrl()}/api/narrative/block/active`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: b?.campaignId ?? 1, nodeId: b?.nodeId, isActive: b?.isActive }),
        });
        const data = await resWeb.json().catch(() => ({}));
        return res.writeHead(resWeb.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      } catch (err) {
        console.error('[web/block-active] error:', err.message);
        return res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
      }
    });
  }

  // Web integration: check connection & DJ authentication status
  if (url.pathname === '/web/status' && req.method === 'GET') {
    try {
      const token = await getDjToken();
      const meRes = await fetch(`${webUrl()}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const me = await meRes.json().catch(() => null);
      return json(res, { connected: meRes.ok, user: me?.user, webUrl: webUrl() });
    } catch (err) {
      return json(res, { connected: false, error: err.message, webUrl: process.env.WEB_URL || null });
    }
  }

  res.writeHead(404).end();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[agent-bridge] Port ${PORT} is already in use by another process.`);
  } else {
    console.error('[agent-bridge] server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => console.log(`agent bridge on http://0.0.0.0:${PORT} (agent: ${agent.label}, root: ${AGENT_ROOT})`));
