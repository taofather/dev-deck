// WIP board: editable notes, one per topic in progress. Rendered by src/Board.jsx.
// Notes live in src/content/wip/board.json (gitignored like docs/_WIP), read and written at runtime
// through agent-bridge.mjs, so editing does not rebuild the bundle or livereload the page.

export const id = 'wip';
export const title = 'WIP';
export const subtitle = 'Local board · notes in src/content/wip/board.json';

export const entities = {};
export const relations = [];

export const pages = [
  {
    id: 'board',
    section: 'Home',
    title: 'Work in progress',
    intro: 'Double-click a note to edit it, drag it by its title. DSL refs (BENT-Order, DBT-Tenders…) open their doc.',
    board: true,
  },
];
