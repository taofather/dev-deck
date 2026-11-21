// The agent CLI that agent-bridge.mjs drives, chosen with env AGENT=claude|opencode (default: claude).
// Node only, never imported by the browser bundle.
//
// A driver is { name, label, newSessionId(), isSessionId(id), command(run), parse(ev, { emit, finish }),
//   resume, listSessions(limit), transcript(id, limit) }:
// - command({ prompt, session, isNew, title }) → [bin, args]: a new session is created with the given id,
//   otherwise it is resumed.
// - parse(ev, { emit, finish }): one JSON line of the CLI's stdout. emit({ sid }), emit({ text }),
//   emit({ tool, target }); finish(error?) when the CLI reports the run over (process exit also finishes it).
// - resume: shell command template to continue a session by hand in AGENT_ROOT, `{id}` replaced by its id.
// - listSessions → [{ id, title, updated }], newest first; transcript → [{ role: user|agent|tool, text }] or null.
import claude from './claude.mjs';
import opencode from './opencode.mjs';

export { AGENT_ROOT, DECK_ROOT } from './paths.mjs';

const DRIVERS = { claude, opencode };
const name = (process.env.AGENT || 'claude').trim().toLowerCase();

if (!DRIVERS[name]) {
  throw new Error(`Unknown AGENT="${process.env.AGENT}". Use one of: ${Object.keys(DRIVERS).join(', ')}.`);
}

export const agent = DRIVERS[name];
