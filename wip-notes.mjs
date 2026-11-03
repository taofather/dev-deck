// WIP board storage, used by agent-bridge.mjs. Two places, one note:
// - src/content/wip/board.json: layout and graph (id, title, x, y, from, links, linear). Outside Hugo: saving reloads nothing.
// - docs/_WIP/board/*.md: the note body as a Hugo page, found by its `board: <note id>` front matter.
//   Hugo renders it under /_wip/board/<file>/; editing it in an editor or Obsidian shows on the board.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';

const ROOT = import.meta.dirname;
const BOARD = `${ROOT}/src/content/wip/board.json`;
const DIR = `${ROOT}/docs/_WIP/board`;
const FM = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// Write then rename: a crash mid-write never leaves a truncated file.
const writeAtomic = (file, text) => writeFile(`${file}.tmp`, text).then(() => rename(`${file}.tmp`, file));

const readBoard = () => readFile(BOARD, 'utf8')
  .then((json) => JSON.parse(json))
  .catch((err) => (err.code === 'ENOENT' ? { notes: [] } : Promise.reject(err)));
const writeBoard = (notes) => writeAtomic(BOARD, `${JSON.stringify({ notes }, null, 2)}\n`);

const fmValue = (fm, key) => {
  const v = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1].trim();
  if (v?.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {}
  }
  return v;
};

// note id → { file, title, body } for every board page in docs/_WIP/board.
async function scan() {
  const pages = new Map();
  const files = await readdir(DIR).catch((err) => (err.code === 'ENOENT' ? [] : Promise.reject(err)));
  for (const file of files.filter((f) => f.endsWith('.md') && f !== '_index.md')) {
    const m = (await readFile(`${DIR}/${file}`, 'utf8')).match(FM);
    const id = m && fmValue(m[1], 'board');
    if (id) pages.set(id, { file, fm: m[1], title: fmValue(m[1], 'title'), body: m[2].replace(/^\n/, '').replace(/\n$/, '') });
  }
  return pages;
}

export const pageUrl = (file) => `/_wip/board/${file.replace(/\.md$/, '').toLowerCase()}/`;

// AGENTS.md file naming: YYYYMMDD, the ticket code when there is one, then a slug of the title.
function newFileName(note) {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const slug = note.title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const base = [day, note.linear?.id, slug || note.id.slice(0, 8)].filter(Boolean).join('-');
  // Two notes with the same title on the same day must not share a page.
  for (let i = 1; ; i++) {
    const file = `${base}${i > 1 ? `-${i}` : ''}.md`;
    if (!existsSync(`${DIR}/${file}`)) return file;
  }
}

// claude_sessions front matter, one flow mapping per line so it stays greppable and hand-editable:
//   - { id: <uuid>, name: "<note title>", started: "<ISO time>", origin: board | attached }
const SESSION_LINE = /^ {2}- \{ id: ([0-9a-f-]{36}), name: ("(?:[^"\\]|\\.)*"), started: "?([^",}\s]+)"?, origin: (\w+) \}$/gm;
const sessionsOf = (fm) => [...fm.matchAll(SESSION_LINE)].map(([, id, name, started, origin]) => ({ id, name: JSON.parse(name), started, origin }));
const withSessions = (fm, sessions) => [
  fm.replace(/^claude_sessions:.*\n?(?: {2}- .*\n?)*/m, '').trimEnd(),
  'claude_sessions:',
  ...sessions.map((s) => `  - { id: ${s.id}, name: ${JSON.stringify(s.name)}, started: "${s.started}", origin: ${s.origin} }`),
].join('\n');

// Writes the note's page: keeps any extra front matter of an existing page, refreshes its title.
// edit: optional front matter transform (claude_sessions).
async function writePage(note, body, page, edit = (fm) => fm) {
  await mkdir(DIR, { recursive: true });
  const title = `title: ${JSON.stringify(note.title)}`;
  const fm = edit(page
    ? (/^title:.*$/m.test(page.fm) ? page.fm.replace(/^title:.*$/m, title) : `${title}\n${page.fm}`)
    : [title, `board: ${note.id}`, note.linear && `linear: ${note.linear.url}`, 'tags: [wip]'].filter(Boolean).join('\n'));
  const file = page?.file ?? newFileName(note);
  await writeAtomic(`${DIR}/${file}`, `---\n${fm}\n---\n\n${(body ?? page?.body ?? '').trimEnd()}\n`);
  return file;
}

// GET /wip: board.json joined with the pages; the page wins for title and body.
export async function loadNotes() {
  const [{ notes }, pages] = await Promise.all([readBoard(), scan()]);
  return notes.map((n) => {
    const p = pages.get(n.id);
    return {
      ...n, title: p?.title ?? n.title, body: p?.body ?? n.body ?? '', page: p ? pageUrl(p.file) : null,
      sessions: p ? sessionsOf(p.fm) : [],
    };
  });
}

// PUT /wip: layout and graph only. A title renamed on the board is carried to the page; bodies go through saveBody.
export async function saveNotes(notes) {
  const pages = await scan();
  for (const n of notes) {
    const p = pages.get(n.id);
    if (p && p.title !== n.title) await writePage(n, undefined, p);
  }
  await writeBoard(notes.map(({ body, page, sessions, ...n }) => n));
}

// PUT /wip/body: writes one note's body to its page, creating the page on first save.
export async function saveBody(id, body) {
  const note = (await readBoard()).notes.find((n) => n.id === id);
  if (!note) return null;
  return pageUrl(await writePage(note, body, (await scan()).get(id)));
}

// Records a Claude session on the note's page (created if needed); an id already listed is left as is.
export async function addSession(id, session) {
  const note = (await readBoard()).notes.find((n) => n.id === id);
  if (!note) return null;
  const page = (await scan()).get(id);
  const sessions = page ? sessionsOf(page.fm) : [];
  if (sessions.some((s) => s.id === session.id)) return pageUrl(page.file);
  return pageUrl(await writePage(note, undefined, page, (fm) => withSessions(fm, [...sessions, session])));
}

// What a new session is told about its note: title, page file, Linear ticket and body.
export async function noteContext(id) {
  const note = (await readBoard()).notes.find((n) => n.id === id);
  const page = note && (await scan()).get(id);
  return note && { note, file: page && `${DIR}/${page.file}`, body: page?.body ?? '' };
}

// One-time move of the bodies still stored in board.json into pages; board.json is backed up first.
export async function migrateBodies() {
  const { notes } = await readBoard();
  const legacy = notes.filter((n) => typeof n.body === 'string');
  if (!legacy.length) return 0;
  if (!existsSync(`${BOARD}.pre-pages.bak`)) await copyFile(BOARD, `${BOARD}.pre-pages.bak`);
  const pages = await scan();
  for (const n of legacy) if (n.body.trim() && !pages.has(n.id)) await writePage(n, n.body);
  await writeBoard(notes.map(({ body, ...n }) => n));
  return legacy.length;
}
