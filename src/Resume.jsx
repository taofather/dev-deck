// "Make Resume" on _sdd.json / _ops.json pages, and the entity docs block it shares with main.jsx's Panel.
// main.jsx owns the shared lookups and passes them in, as with Board.jsx:
// docsOf(id) → the entity's docs in every diagram, relations → [from, to, label][], colorOf(id) → its dimension color.
import { useEffect, useState } from 'react';

// An entity's docs from every diagram that declares it. skip: the file whose copy is being edited instead.
export function EntityDocs({ described, skip }) {
  return described.filter((e) => !skip || e.doc.file !== skip).map(({ doc: d, text, why, query, cmd, columns }) => (
    <section key={d.id}>
      {described.length > 1 && <h3>From {d.title}</h3>}
      <p>{text}</p>
      {why && <p><strong>Why:</strong> {why}</p>}
      {query && <pre className="query">{query}</pre>}
      {cmd && <pre className="query cmd">{cmd}</pre>}
      {columns && (
        <table>
          <tbody>
            {columns.map(([name, type, desc]) => (
              <tr key={name}><td>{name}</td><td className="muted">{type}</td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  ));
}

const cell = (v) => String(v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const fence = (lang, code) => `\`\`\`${lang}\n${code}\n\`\`\``;
const ends = (list) => list.map(([id, l]) => `${id}${l ? ` (${l})` : ''}`).join(', ');
const usesOf = (relations, id) => relations.filter(([a]) => a === id).map(([, b, l]) => [b, l]);
const usedByOf = (relations, id) => relations.filter(([, b]) => b === id).map(([a, , l]) => [a, l]);

// The same content as EntityDocs plus relations, as Markdown (Copy as Markdown).
const resumeMarkdown = (title, ids, docsOf, relations) => [`# ${title}`, ...ids.map((id) => {
  const described = docsOf(id);
  const out = usesOf(relations, id);
  const inc = usedByOf(relations, id);
  return [
    `## ${id}`,
    described.length === 0 && '⚠ Not documented yet.',
    ...described.flatMap(({ doc: d, text, why, query, cmd, columns }) => [
      described.length > 1 && `### From ${d.title}`,
      text,
      why && `**Why:** ${why}`,
      query && fence('sql', query),
      cmd && fence('sh', cmd),
      columns && ['| Name | Type | Description |', '|---|---|---|', ...columns.map((c) => `| ${c.map(cell).join(' | ')} |`)].join('\n'),
    ]),
    out.length > 0 && `**Uses ↗** ${ends(out)}`,
    inc.length > 0 && `**Used by ↙** ${ends(inc)}`,
  ].filter(Boolean).join('\n\n');
})].join('\n\n');

// Pick some of the page's nodes (ids), then read all their docs at once, or copy them as Markdown.
export function ResumeModal({ title, ids, docsOf, relations, colorOf, onClose }) {
  const [picked, setPicked] = useState(() => new Set(ids));
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState('');
  const chosen = ids.filter((id) => picked.has(id));
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);
  const toggle = (id) => setPicked((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const copy = () => navigator.clipboard.writeText(resumeMarkdown(title, chosen, docsOf, relations))
    .then(() => setCopied('✓ Copied'), (err) => setCopied(`Copy failed: ${err.message}`));
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal resume-modal" role="dialog" aria-label={`Resume of ${title}`}>
        <div className="modal-head">
          <strong>📝 Resume of {title}</strong>
          <span className="muted">{chosen.length} of {ids.length} nodes</span>
          <span className="modal-depth">
            {shown ? (
              <>
                {copied && <span>{copied}</span>}
                <button className="focus-toggle" onClick={() => setShown(false)}>← Nodes</button>
                <button className="focus-toggle" onClick={copy}>📋 Copy as Markdown</button>
              </>
            ) : (
              <>
                <button className="focus-toggle" onClick={() => setPicked(new Set(ids))}>All</button>
                <button className="focus-toggle" onClick={() => setPicked(new Set())}>None</button>
                <button className="focus-toggle" disabled={chosen.length === 0} onClick={() => { setCopied(''); setShown(true); }}>Make resume</button>
              </>
            )}
            <button className="focus-toggle" title="Close (Esc)" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="resume-body">
          {shown ? chosen.map((id) => {
            const described = docsOf(id);
            const out = usesOf(relations, id);
            const inc = usedByOf(relations, id);
            return (
              <article key={id}>
                <h2 style={{ color: colorOf(id) }}>{id}</h2>
                {described.length === 0 && <p>⚠ Not documented yet.</p>}
                <EntityDocs described={described} />
                {out.length > 0 && <p><strong>Uses ↗</strong> {ends(out)}</p>}
                {inc.length > 0 && <p><strong>Used by ↙</strong> {ends(inc)}</p>}
              </article>
            );
          }) : (
            <ul className="resume-picker">
              {ids.map((id) => (
                <li key={id}>
                  <label>
                    <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} />
                    <span style={{ color: colorOf(id) }}>{id}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
