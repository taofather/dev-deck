# Developer Deck

Hybrid documentation engine combining Hugo ([Hextra theme](https://imfing.github.io/hextra/)) with an interactive [React Flow](https://reactflow.dev/) diagram canvas.

## Features

- **Hugo + Hextra Documentation**: Markdown content in `docs/` rendered with search, breadcrumbs, and responsive sidebar navigation.
- **Interactive React Flow Diagrams**: Visual architecture and flow diagrams in `src/content/`, served at `/diagrams/`.
- **Bidirectional Linking**: Embed interactive diagrams in Markdown docs with `{{< reactflow >}}` shortcodes or route links in frontmatter.
- **WIP Board & Agent Bridge**: Interactive editable node canvas and local Claude agent chat for assisting with documentation updates.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Hugo Extended](https://gohugo.io/) (≥ 0.146)
- [Go](https://go.dev/) (for Hugo modules)

### Development

```bash
# Install dependencies
npm install

# Start Hugo server, Vite watch builder, and agent bridge
npm run dev

# Or start standalone React Flow Vite server with hot reload
npm run dev:diagrams
```

Visit:
- Hugo Docs: [http://localhost:5180](http://localhost:5180)
- Interactive Diagrams: [http://localhost:5180/diagrams/](http://localhost:5180/diagrams/)
- Standalone Diagrams: [http://localhost:5179/diagrams/](http://localhost:5179/diagrams/)

### Build

```bash
npm run build
```

Builds the React Flow bundle to `dist/` and compiles the complete Hugo site to `public/`.

## Project Structure

```
├── assets/                 # Global assets (images, agent chat client)
├── content/                # Hugo virtual content and section adapters
├── docs/                   # Markdown documentation (Obsidian vault compatible)
│   ├── _index.md           # Documentation home page
│   └── example/            # Sample documentation pages
├── layouts/                # Hugo theme overrides and shortcodes
├── src/                    # React Flow application
│   ├── Board.jsx           # Editable WIP board component
│   ├── main.jsx            # React Flow diagram application entry
│   ├── styles.css          # React Flow layout styling
│   └── content/            # JavaScript diagram definitions
│       ├── index.js        # Content loader
│       ├── wip/            # WIP board configuration
│       └── example/        # Sample architecture diagram
├── agent-bridge.mjs        # Local SSE bridge for Claude agent interactions
├── hugo.yaml               # Hugo site configuration
└── vite.config.js          # Vite build configuration
```

## Adding a New Diagram

1. Create a definition file under `src/content/<category>/<name>.js`:

```javascript
export const id = 'my-diagram';
export const title = 'My Diagram Title';
export const subtitle = 'Description';

export const entities = {
  'FCOM-Sample': { text: 'Frontend UI component' },
  'BFUN-Service': { text: 'Backend service handler' },
};

export const relations = [
  ['FCOM-Sample', 'BFUN-Service', 'API Call'],
];

export const pages = [
  {
    id: 'main',
    section: 'Overview',
    title: 'Flow Overview',
    entities: ['FCOM-Sample', 'BFUN-Service'],
  },
];
```

2. Link or embed the diagram in any markdown file under `docs/`:

```markdown
---
title: My Documentation Page
reactflow:
  - "#/my-diagram/main"
---

# My Documentation Page

{{< reactflow "#/my-diagram/main" "500px" >}}
```
