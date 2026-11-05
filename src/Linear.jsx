// WIP board sidebar: my Linear issues in the active cycle, served by agent-bridge.mjs (GET /linear/cycle).
// Replaces the Dimensions filter on board pages, where no diagram node has a dimension.
import { useEffect, useState } from 'react';

const BRIDGE = 'http://127.0.0.1:5182/linear/cycle';
// Linear workflow state kinds, in board order.
const KINDS = ['started', 'unstarted', 'backlog', 'triage', 'completed', 'canceled'];
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// onIssues shares the list with the board (live note status); onAdd puts an issue on the board;
// onBoard holds the identifiers that already have a note.
export function CycleIssues({ onIssues, onAdd, onBoard }) {
  const [issues, setIssues] = useState(null);
  const [error, setError] = useState(null);
  const load = () => fetch(BRIDGE)
    .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t || `bridge answered ${r.status}`)))))
    .then((b) => {
      setIssues(b.issues);
      setError(null);
    })
    .catch((e) => setError(e.message === 'Failed to fetch' ? 'Bridge not running: npm run dev.' : e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (issues) onIssues(issues);
  }, [issues, onIssues]);

  const cycle = issues?.find((i) => i.cycle)?.cycle;
  // Group by state, ordered by state kind then by the team's own state position.
  const states = issues && [...new Map(issues.map((i) => [i.state.name, i.state])).values()]
    .sort((a, b) => KINDS.indexOf(a.type) - KINDS.indexOf(b.type) || a.position - b.position);

  return (
    <div className="linear">
      <div className="section">
        Linear cycle{cycle && ` ${cycle.name ?? cycle.number}`}
        <button className="linear-reload" title="Reload issues" onClick={load}>↻</button>
      </div>
      {cycle && <div className="muted linear-dates">{day(cycle.startsAt)} → {day(cycle.endsAt)}</div>}
      {error && <p className="board-error">{error}</p>}
      {!issues && !error && <p className="muted">Loading…</p>}
      {issues?.length === 0 && <p className="muted">No issues assigned in the active cycle.</p>}
      {states?.map((s) => (
        <div key={s.name}>
          <div className="linear-state"><span className="swatch" style={{ background: s.color }} /> {s.name}</div>
          {issues.filter((i) => i.state.name === s.name).map((i) => (
            // A card whose issue has a note centers the board on it; the title still opens Linear.
            <div key={i.identifier} className={onBoard.has(i.identifier) ? 'linear-card on-board' : 'linear-card'} style={{ borderLeftColor: s.color }}
              onClick={onBoard.has(i.identifier) ? () => onAdd(i) : undefined} title={onBoard.has(i.identifier) ? 'Show its note on the board' : undefined}>
              <div className="linear-card-head">
                <span className="linear-id">{i.identifier}</span>
                <span className="muted">{i.priorityLabel}</span>
              </div>
              <a className="linear-issue" href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{i.title}</a>
              {i.labels.length > 0 && (
                <span className="linear-labels">
                  {i.labels.map((l) => <span key={l.name} style={{ borderColor: l.color, color: l.color }}>{l.name}</span>)}
                </span>
              )}
              <button className={onBoard.has(i.identifier) ? 'linear-add on' : 'linear-add'} onClick={(e) => {
                e.stopPropagation();
                onAdd(i);
              }}
                title={onBoard.has(i.identifier) ? 'Show its note on the board' : 'Add a note to the board'}>
                {onBoard.has(i.identifier) ? '✓' : '+'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
