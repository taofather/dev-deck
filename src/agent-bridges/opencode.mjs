// OpenCode driver: `opencode run --format json`, sessions through `opencode session list|export`.
// Model: env AGENT_MODEL (default google/gemini-flash-latest).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { AGENT_ROOT } from './paths.mjs';

const exec = promisify(execFile);
const MODEL = process.env.AGENT_MODEL || 'google/gemini-flash-latest';

const isSessionId = (id) => /^ses_[a-zA-Z0-9_-]+$/.test(id ?? '');

const inputTarget = (input) => {
  const target = input?.path ?? input?.file_path ?? input?.pattern ?? input?.code ?? '';
  return typeof target === 'string' ? target.slice(0, 80) : '';
};

// The most recent sessions, newest first: { id, title, updated }.
async function listSessions(limit = 30) {
  try {
    const { stdout } = await exec('opencode', ['session', 'list'], { cwd: AGENT_ROOT });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const sessions = lines.map((line) => {
      const [id, title, updated] = line.split('\t');
      return {
        id,
        title: title || '(no prompt yet)',
        updated: updated || new Date().toISOString(),
      };
    });
    return sessions.slice(0, limit);
  } catch (err) {
    console.warn('opencode session list failed:', err.message);
    return [];
  }
}

// The conversation as the aside/orchestrator shows it: prompts, answers and tool calls.
async function transcript(id, limit = 200) {
  if (!isSessionId(id)) return null;
  try {
    const { stdout } = await exec('opencode', ['session', 'export', id], { cwd: AGENT_ROOT, maxBuffer: 50 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const out = [];
    for (const msg of data.messages ?? []) {
      if (msg.type === 'user') {
        let text = msg.text ?? '';
        if (typeof text === 'string' && text.startsWith('"') && text.endsWith('"')) {
          try { text = JSON.parse(text); } catch {}
        }
        out.push({ role: 'user', text: String(text).trim() });
      } else if (msg.type === 'assistant') {
        for (const c of msg.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) {
            out.push({ role: 'agent', text: c.text.trim() });
          } else if (c.type === 'tool') {
            out.push({ role: 'tool', text: `${c.name} ${inputTarget(c.state?.input)}`.trim() });
          }
        }
      }
    }
    return out.slice(-limit);
  } catch (err) {
    console.warn(`opencode session export ${id} failed:`, err.message);
    return [];
  }
}

export default {
  name: 'opencode',
  label: `OpenCode (${MODEL})`,
  resume: 'opencode run --session {id}',
  isSessionId,
  newSessionId: () => `ses_liber_${Date.now()}_${randomUUID().slice(0, 8)}`,

  command({ prompt, session, isNew, title }) {
    const args = ['run', '--format', 'json', '--auto', '-m', MODEL, '--session', session];
    if (isNew && title) args.push('--title', title);
    return ['opencode', [...args, prompt]];
  },

  parse(ev, { emit, finish }) {
    if (ev.sessionID) emit({ sid: ev.sessionID });
    if (ev.type === 'tool_use' || ev.type === 'tool') {
      emit({ tool: ev.part?.tool ?? ev.tool ?? 'tool', target: inputTarget(ev.part?.state?.input) });
    }
    if (ev.type === 'text') {
      const text = ev.part?.text ?? ev.text ?? '';
      if (text) emit({ text });
    }
    if (ev.type === 'error') finish(ev.error?.message ?? 'error');
  },

  listSessions,
  transcript,
};
