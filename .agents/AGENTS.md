---
name: unified-docs
description: guide for bi-dimensional hybrid documentation engine.
---
This can be used as a skill giving guidelines to use dev-deck unified documentation.
It is hybrid and bi-dimensional because it lives in a hybrid hugo/react-flow repository.
We try to replicate the Markdown hugo docs into its react-flow diagrams siblings.

## Hierarchy and taxonomy

### Reigns: Domains, Infrastructure
- WIP is work in progress. It allows just have a cleaner files area. Folders will be curated and moved inside another domain.
- A Domain usually has the name of an application area, refering to full stack database to front-end.
- Infrastructure refers to our tech stack in kubernetes, GCP, database or third party services.
Reigns have a direct menu link in the top of output site header.

### BoundedContexts
BoundedContexts reflect into a folder in a reign.
E.g: offers, integrations, document-import, tenders, admin, chat, notifications.

### Intentions
Intentions restrict folders inside a BoundedContext. They are 4 types: `model`, `flow`, `changelog`, `ops`.
- Model reflects base database state and entities.
- Flow is everything interconnecting software and features that work together using a Model. Flows can be composed by other flows.
- Changelog is human labor and development around any of previous topic. Those files contain Jira/Linear links.
- Ops are description of operations upon settings, or queries to extract production data, or links to dashboards for metrics.

### Tags in Frontmatter
**strict IntentionTags**
Intentions have a strict relation with BoundedContexts, forming tags that will appear in the `tags` frontmatter attribute. 
The IntentionTag will be always: `intention/BoundedContext`. E.g: `flow/document-import`, `model/identity`,  `changelog/GCE/artifact-registry`.
Sub-folders in a BoundedContext that are not an Intention, should form a sub-level in the tag! E.g: `changelog/GCE/artifact-registry`, `flow/procurement/allocation-table`.

**other tags** can of course exist: `toggle`, `spec`, etc. 

### Other Frontmatter relations
- Issue trackers:

```yaml
---
title: <human-readable summary>
jira: <company.atlassian.org/>
linear: <linear.app/> 
---
```

- `tags: [a, b]`: free classification. Listed at `/tags/<tag>/`.
- `entities: [DBT-Orders, BENT-Order]`: the page's core DSL entities, written with their prefix. Listed at `/entities/<entity>/`, so every flow, domain and ticket touching an entity is one click away.
- Only list entities the page is about, not every passing mention.
- When a `reactflow` route ends in an entity (`#/tender/schema/DBT-Tenders`), add that entity to `entities` too.
- Never use `labels:` (merged into `tags`) or `type` as a taxonomy (`type` is a reserved Hugo key).

## Unified DSL
Use this set of DSL prefixes for EVERY entity:
*FCOM-*: Front-end Component. E.g `FCOM-HomeLoginBox`.
*FDTO-*: Front-end DTO. E.g `FDTO-DeliveryWarehouses`, used for javascript or typescript data transfer objects.
*BDTO-*: Back-end DTO. E.g `BDTO-DeliveryWarehouses`, used for network data transfer objects.
*BENT-*: Back-end entity. E.g `BENT-Order`, for internal backend entities or structs.
*BPRO-*: Back-end property. E.g `BPRO-OrderItemSaleUnit`, for properties of backend entities or structs.
*BAGG-*: Back-end aggregate. E.g `BAGG-Workspace-Members`.
*BFUN-*: Back-end function or service method. E.g: `BFUN-CalculateTotalAmount`.
*DBT-*: Database table. E.g `DBT-Orders`. We talk about the database entity.
*DBQ-*: Database query. E.g `DBQ-GetWorkspaceSettings`. Queries found in database layer code.
*DOM-*: Example `DOM-order`. Pure domain, used only when talking to the entity in terms beyond apps or database.
*MET-*: Metric. It should include a link to a markdown doc, explaining hot to get metrics on that Flow/Model, GoogleCloudLogging, Sentry or Postgres.  

This elements will be always written with the prefix, followed by CamelCase word (`FDTO-CreateOrderRequest`, `BENT-OrderItem`, etc).

## An interconnected JavaScript database
Take advantage of react-flow JavaScript declaration of entities. Always try to relate with diagrams existing in src/content files.
A diagram JS file should have its related-hugo-index to back with the `<a class="back" href="/related-hugo-index/">← Docs</a>`.
A docs folder can also hold its diagram as data in a `_sdd.json` (same shape as a JS doc: `id`, `title`, `entities`, `relations`, `pages`), loaded by `src/content/index.js`. Spec conversions use it (see the `sdd-convert` skill, `sdd-convert-skill.md`).

## Interconnected files
Link files to directories or other files if possible, using `intention/boundedContext/domain` hierarchy.

- Use cannonical syntax
```markdown
[**Keyword** identifier](reign/boundedContext/flow/01-target.md)
```

## File naming and content
In a folder, prefix the files with `YYYYmmddd` (`20261102`), to keep an order. Add ticket code (Jira/Linear) if available, `20261102-C-15453-do-that.md`.

### Principles on files content
* Node segregation: if a concept gets too complex, segregate or enrich concerning files. Better more files than verbosity.
* Speak in absolute present: except for `ticket` files, use a descriptive, behavioral language, not related to changes made in pull requests. Do not use for example word `unchanged`.

### React Flow links

DO NOT embed diagrams like this: `{{< reactflow "#/nats-broker-availability/action-points" >}}`
But include in frontmatter:
```
reactflow:
  - "#/recurring-tenders"
  - "#/tender/schema/DBT-Tenders"
```

- Link a flow to its React Flow diagram when one exists in `src/content/flow/`.
- Link its core domain too, when present in `src/content/domain/`.
- Value is the route only, from `#` on. Never the host.
- Route shape: `#/<doc id>/<page id>/<entity>`; page and entity optional.
- `<doc id>` is the `id` exported by the `.js` content file.
- `reactflow` is an array, for flow, domain and infrastructure diagrams alike.
- Hugo renders them above the content as `Diagrams: tender/schema/DBT-Tenders, ...`, each link named by its route (`layouts/_partials/custom/content-begin.html`).
- The diagram back link prefers a page under `domains/` or `infrastructure/` (`layouts/diagrams.html`).
- They link to the React Flow app served by the same site at `/diagrams/`.
- To embed a diagram in the body: `{{< reactflow "#/<doc id>/<page id>" >}}` (optional 2nd arg: height).
- Omit `reactflow` when no diagram exists. Never point to a missing doc.

Example (`flows/tenders/recurring-tenders/TenderSeriesLifecycle.flow.md`):
```yaml
reactflow:
  - "#/recurring-tenders"
  - "#/tender/schema/DBT-Tenders"
```
