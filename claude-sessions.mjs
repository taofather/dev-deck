// Claude Code sessions of AGENT_ROOT, read from ~/.claude/projects/<AGENT_ROOT, non-alphanumerics as ->/<id>.jsonl.
// Used by agent-bridge.mjs for the WIP note aside: the attach picker (listSessions) and the chat history (transcript).
import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Sessions run and resume here: `cd AGENT_ROOT && claude --resume <id>`. Defaults to the folder above dev-deck.
export const AGENT_ROOT = resolve(import.meta.dirname, process.env.AGENT_ROOT || '..');
const PROJECT = `${homedir()}/.claude/projects/${AGENT_ROOT.replace(/[^A-Za-z0-9]/g, '-')}`;
export const isSessionId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? '');

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
export async function listSessions(limit = 30) {
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
export async function transcript(id, limit = 200) {
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
