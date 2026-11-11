// WIP note pages, used by agent-bridge.mjs. A note lives in two places:
// - docs/_WIP/board/board.json: a JSON diagram like any other (src/content/index.js), loaded and saved by the
//   browser through /sdd (src/SddEdit.js): one entity per note (title, linear, …), relations, positions and sides.
//   Read here only, for the title and Linear ticket a page needs.
// - docs/_WIP/board/*.md: the note body as a Hugo page, found by its `board: <note id>` front matter. Files can only
//   be written from Node, so this module owns them. Hugo renders them under /_wip/board/<file>/; editing one in an
//   editor or Obsidian shows on the board.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';

const ROOT = import.meta.dirname;
const DIR = `${ROOT}/docs/_WIP/board`;
export const BOARD_FILE = 'docs/_WIP/board/board.json';
const FM = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// Write then rename: a crash mid-write never leaves a truncated file.
const writeAtomic = (file, text) => writeFile(`${file}.tmp`, text).then(() => rename(`${file}.tmp`, file));

// The note as board.json declares it: { id, title, linear }, or null when there is no such note.
async function noteOf(id) {
  const doc = await readFile(`${ROOT}/${BOARD_FILE}`, 'utf8').then(JSON.parse).catch(() => ({}));
  const e = doc.entities?.[id];
  if (e === undefined) return null;
  return { id, ...(typeof e === 'string' ? { title: e } : e) };
}

const fmValue = (fm, key) => {
  const v = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1].trim();
  if (v?.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {}
  }
  return v;
};

// note id → { file, fm, title, body } for every board page in docs/_WIP/board.
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
  const slug = (note.title ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const base = [day, note.linear?.id, slug || note.id.slice(0, 8)].filter(Boolean).join('-');
  // Two notes with the same title on the same day must not share a page.
  for (let i = 1; ; i++) {
    const file = `${base}${i > 1 ? `-${i}` : ''}.md`;
    if (!existsSync(`${DIR}/${file}`)) return file;
  }
}

// tags front matter, a flow list (`tags: [wip, idea]`) or a block list (`tags:` then `  - idea` lines).
// The board shows them as sticky labels on the note; `wip` is every note's own tag and is not shown there.
const TAGS = /^tags:[ \t]*(\[.*\])?[ \t]*\n?((?:[ \t]+- .*\n?)*)/m;
const unquote = (v) => (v.startsWith('"') ? JSON.parse(v) : v.replace(/^'|'$/g, ''));
function tagsOf(fm) {
  const m = fm.match(TAGS);
  if (!m) return [];
  const items = m[1] ? m[1].slice(1, -1).split(',') : m[2].split('\n').map((l) => l.replace(/^[ \t]+- /, ''));
  return items.map((t) => t.trim()).filter(Boolean).map(unquote);
}
const yamlItem = (t) => (/^[\w./-]+$/.test(t) ? t : JSON.stringify(t));
const withTags = (fm, tags) => {
  const line = `tags: [${tags.map(yamlItem).join(', ')}]`;
  return TAGS.test(fm) ? fm.replace(TAGS, `${line}\n`).replace(/\n$/, '') : `${fm}\n${line}`;
};

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
// edit: optional front matter transform (tags, claude_sessions).
async function writePage(note, body, page, edit = (fm) => fm) {
  await mkdir(DIR, { recursive: true });
  const title = `title: ${JSON.stringify(note.title ?? 'Untitled')}`;
  const fm = edit(page
    ? (/^title:.*$/m.test(page.fm) ? page.fm.replace(/^title:.*$/m, title) : `${title}\n${page.fm}`)
    : [title, `board: ${note.id}`, note.linear && `linear: ${note.linear.url}`, 'tags: [wip]'].filter(Boolean).join('\n'));
  const file = page?.file ?? newFileName(note);
  await writeAtomic(`${DIR}/${file}`, `---\n${fm}\n---\n\n${(body ?? page?.body ?? '').trimEnd()}\n`);
  return file;
}

// GET /wip/pages: note id → { body, page, sessions, tags } for every note page.
export async function loadPages() {
  const pages = await scan();
  return Object.fromEntries([...pages].map(([id, p]) => [id, { body: p.body, page: pageUrl(p.file), sessions: sessionsOf(p.fm), tags: tagsOf(p.fm) }]));
}

// PUT /wip/title: a note renamed on the board carries its title to its page, when it has one.
export async function saveTitle(id, title) {
  const page = (await scan()).get(id);
  if (page && page.title !== title) await writePage({ id, title }, undefined, page);
}

// PUT /wip/body: writes one note's body to its page, creating the page on first save.
export async function saveBody(id, body) {
  const note = await noteOf(id);
  if (!note) return null;
  return pageUrl(await writePage(note, body, (await scan()).get(id)));
}

// PUT /wip/tags: the note page's tags (page created if needed). `wip` stays first: every board page carries it.
export async function saveTags(id, tags) {
  const note = await noteOf(id);
  if (!note) return null;
  const clean = ['wip', ...new Set(tags.map((t) => String(t).trim()).filter((t) => t && t !== 'wip'))];
  await writePage(note, undefined, (await scan()).get(id), (fm) => withTags(fm, clean));
  return clean;
}

// Records a Claude session on the note's page (created if needed); an id already listed is left as is.
export async function addSession(id, session) {
  const note = await noteOf(id);
  if (!note) return null;
  const page = (await scan()).get(id);
  const sessions = page ? sessionsOf(page.fm) : [];
  if (sessions.some((s) => s.id === session.id)) return pageUrl(page.file);
  return pageUrl(await writePage(note, undefined, page, (fm) => withSessions(fm, [...sessions, session])));
}

// What a new session is told about its note: title, page file, Linear ticket and body.
export async function noteContext(id) {
  const note = await noteOf(id);
  const page = note && (await scan()).get(id);
  return note && { note, file: page && `${DIR}/${page.file}`, body: page?.body ?? '' };
}
