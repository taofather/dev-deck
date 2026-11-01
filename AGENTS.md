---
name: unified-docs
description: guide for bi-dimensional hybrid documentation engine.
---
This can be used as a skill giving guidelines to use dev-deck unified documentation.
It is hybrid and bi-dimensional because it lives in a hybrid hugo/react-flow repository.
We try to replicate the Markdown hugo docs into its react-flow diagrams siblings.

## Architecture Documentation Organization
- A Domain usually has the name of an area, an entity or a bounded context that usually has its database table and works as aggregate root.
- A Flow is everything interconnected in software, interconnected features that work together using domains. Flows can be composed by other flows.
- Tickets are development tasks around any topic. Those files contain issue tracker links.
- Infrastructure combines domains and flows in every area: clusters, cloud providers, messaging, secrets, release pipelines.

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

These elements will be always written with the prefix, followed by CamelCase word (`FDTO-CreateOrderRequest`, `BENT-OrderItem`, etc).

## An interconnected JavaScript database
Take advantage of react-flow JavaScript declaration of entities. Always try to relate with diagrams existing in src/content files.
A diagram JS file should have its related-hugo-index to back with the `<a class="back" href="/related-hugo-index/">← Docs</a>`.

## Markdown interconnected database

- Use canonical syntax
```markdown
[**Keyword** identifier](relative/path/to/target.md)
```

DO NOT connect with external projects out of active repository.

Include in frontmatter:
```yaml
reactflow:
  - "#/example/overview"
  - "#/example/overview/DBT-Users"
```

## Node segregation
- If a concept gets too complex, segregate or enrich concerning files. Better more files than verbosity.

## File content: speak in absolute present
Use a descriptive, behavioral language.

## File types

### Flow
The higher level, aggregates features.
`.flow.md`

**Frontmatter:**
```yaml
---
code: <slugified-flow>
type: flow
reactflow:                                # optional
  - "#/<flow-doc-id>"
  - "#/<domain-doc-id>/<page>/<ENTITY>"
---
```

**React Flow links:**
- Link a flow to its React Flow diagram when one exists in `src/content/`.
- Value is the route only, from `#` on. Never the host.
- Route shape: `#/<doc id>/<page id>/<entity>`; page and entity optional.
- `<doc id>` is the `id` exported by the `.js` content file.
- `reactflow` is an array of routes.
- Hugo renders them above the content as `Diagrams: example/overview, ...`, each link named by its route (`layouts/_partials/custom/content-begin.html`).
- To embed a diagram in the body: `{{< reactflow "#/<doc id>/<page id>" >}}` (optional 2nd arg: height).
- Omit `reactflow` when no diagram exists. Never point to a missing doc.
