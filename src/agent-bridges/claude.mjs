// Claude Code driver: `claude -p --output-format stream-json`, sessions read from
// ~/.claude/projects/<AGENT_ROOT, non-alphanumerics as ->/<id>.jsonl. Model: env AGENT_MODEL (default: Claude's own).
import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { relative } from 'node:path';
import { createInterface } from 'node:readline';
import { AGENT_ROOT, DECK_ROOT } from './paths.mjs';

const TOOLS = 'Read,Edit,Write,Glob,Grep';
const MODEL = process.env.AGENT_MODEL || '';
const PROJECT = `${homedir()}/.claude/projects/${AGENT_ROOT.replace(/[^A-Za-z0-9]/g, '-')}`;
const isSessionId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? '');

const HEAD = 64 * 1024;
const TAIL = 256 * 1024;

async function readSlice(file, from, length) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, from);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

const textOf = (content) => (typeof content === 'string'
  ? content
  : (content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
// Prompts typed by a person: not tool results, not injected reminders or slash-command wrappers.
const isHumanPrompt = (d) => d.type === 'user' && !d.isMeta && !d.isSidechain && textOf(d.message?.content).trim()
  && !/^\s*</.test(textOf(d.message?.content));

// Session title: the last /rename or -n name, else the last AI title, else the first prompt.
async function summary(file, size) {
  const tail = await readSlice(file, Math.max(0, size - TAIL), Math.min(size, TAIL));
  const last = (re) => [...tail.matchAll(re)].pop()?.[1];
  const named = last(/"type":"custom-title","customTitle":("(?:[^"\\]|\\.)*")/g);
  const ai = last(/"type":"ai-title","aiTitle":("(?:[^"\\]|\\.)*")/g);
  if (named || ai) return JSON.parse(named ?? ai);
  for (const line of (await readSlice(file, 0, Math.min(size, HEAD))).split('\n')) {
    try {
      const d = JSON.parse(line);
      if (isHumanPrompt(d)) return textOf(d.message.content).trim().slice(0, 120);
    } catch {}
  }
  return '(no prompt yet)';
}

// The most recent sessions, newest first: { id, title, updated }.
async function listSessions(limit = 30) {
  const files = (await readdir(PROJECT).catch(() => [])).filter((f) => f.endsWith('.jsonl') && isSessionId(f.slice(0, -6)));
  const stats = await Promise.all(files.map(async (f) => ({ f, s: await stat(`${PROJECT}/${f}`) })));
  const recent = stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs).slice(0, limit);
  return Promise.all(recent.map(async ({ f, s }) => ({
    id: f.replace(/\.jsonl$/, ''),
    title: await summary(`${PROJECT}/${f}`, s.size),
    updated: s.mtime.toISOString(),
  })));
}

// The conversation as the aside shows it: prompts, answers and tool calls, last `limit` entries.
async function transcript(id, limit = 200) {
  if (!isSessionId(id)) return null;
  const file = `${PROJECT}/${id}.jsonl`;
  const exists = await stat(file).catch(() => null);
  if (!exists) return [];
  const out = [];
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (isHumanPrompt(d)) out.push({ role: 'user', text: textOf(d.message.content).trim() });
    if (d.type === 'assistant' && !d.isSidechain) {
      for (const c of d.message?.content ?? []) {
        if (c.type === 'text' && c.text.trim()) out.push({ role: 'agent', text: c.text.trim() });
        if (c.type === 'tool_use') out.push({ role: 'tool', text: `${c.name} ${c.input?.file_path ?? c.input?.pattern ?? c.input?.command ?? ''}`.trim() });
      }
    }
  }
  return out.slice(-limit);
}

export default {
  name: 'claude',
  label: MODEL ? `Claude Code (${MODEL})` : 'Claude Code',
  resume: 'claude --resume {id}',
  isSessionId,
  newSessionId: () => randomUUID(),

  command({ prompt, session, isNew, title }) {
    const args = ['-p', prompt];
    if (isNew) {
      args.push('--session-id', session);
      if (title) args.push('--name', title);
    } else {
      args.push('--resume', session);
    }
    // The agent edits dev-deck files: give it access when dev-deck is outside AGENT_ROOT.
    if (relative(AGENT_ROOT, DECK_ROOT).startsWith('..')) args.push('--add-dir', DECK_ROOT);
    if (MODEL) args.push('--model', MODEL);
    args.push('--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS);
    return ['claude', args];
  },

  parse(ev, { emit, finish }) {
    if (ev.type === 'system' && ev.subtype === 'init') emit({ sid: ev.session_id });
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text') emit({ text: c.text });
        if (c.type === 'tool_use') emit({ tool: c.name, target: c.input?.file_path ?? c.input?.pattern ?? '' });
      }
    }
    if (ev.type === 'result') {
      emit({ sid: ev.session_id });
      finish(ev.is_error ? ev.result : undefined);
    }
  },

  listSessions,
  transcript,
};
