---
name: sdd-convert
description: Convert a spec (SDD, PRD, ADR, plan) from another repository into a dev-deck React Flow diagram stored as a folder-local `_sdd.json`, next to its Hugo pages. Use when asked to "convert a spec", "sdd-convert", or turn a spec/PRD/ADR/plan markdown into a reactflow diagram.
---

# sdd-convert

## 0. Load unified-docs first (mandatory)

Invoke the `unified-docs` skill (`Skill` tool, `unified-docs`) before anything else.
This skill is **the union of both**: every rule of `unified-docs` applies (reigns, BoundedContexts,
intentions, IntentionTags, DSL prefixes, `reactflow` frontmatter, file naming). The rules below only add to it.
On conflict, this file wins for the diagram storage and node set.

## 1. Input

- A spec file path, usually outside dev-deck (e.g. `knowledge/prds/...`, `src/rtapi-1/docs/...`).
- Read it fully. Never invent a requirement, decision, plan step or entity the spec does not state.
- Skip RESTRICTED folders (`omnologus-consentio`, `omnologus-taofather`) unless the user names them.

## 2. Output: `_sdd.json`, one per folder

The diagram is **JSON data, not JavaScript** (same approach as the WIP board `board.json`).

| File | Where |
|------|-------|
| Diagram | `dev-deck/docs/<reign>/<bounded-context>/<intention>/_sdd.json` (e.g. `docs/_WIP/NATS-secure/design/_sdd.json`) |
| Hugo pages | Markdown files in the **same folder**, named per `unified-docs` (`YYYYmmdd-<ticket>-<slug>.md`) |

- `src/content/index.js` loads every `docs/**/_sdd.json` at build time. No registration.
- The diagram tab follows the docs path: `docs/_WIP/NATS-secure/design` shows under `wip › NATS-secure › design`.
- Doc id: the JSON `id`, else the folder path below the reign, lower-cased and joined with `-`
  (`docs/_WIP/NATS-secure/design` → `nats-secure-design`). Set `id` explicitly when the folder may move out of `_WIP`, so `reactflow` routes stay stable.
- An empty or invalid `_sdd.json` is skipped (a warning in the browser console). It never breaks the app.
- One `_sdd.json` per folder. If the folder already has one, merge into it: add entities, relations and pages, keep existing ids.
- Each Hugo page in the folder lists the diagram in `reactflow:` (`"#/<doc-id>"`, plus page routes) and its core ids in `entities:`.

### Orchestrator

Each `_sdd.json` keeps **one** agent conversation, its orchestrator: `"orchestrator": { "id": "<session uuid>", "started": "<ISO>" }`.
The bridge writes it on the first message from the diagram's **🤖 Agent** panel; later messages resume it (`claude --resume <id>` from the agent root).
When you run as that orchestrator: edit the `_sdd.json` in place, never remove or change `orchestrator`, and give every new node a position in its kind column.

## 3. Node set

A spec diagram uses **only** these node kinds. The kind comes from the id prefix (`DIMENSIONS` in `src/main.jsx`).

### Spec layer (from the spec itself)

| Kind | Prefix | Entity value | Rule |
|------|--------|--------------|------|
| **PRD** | `PRD-` | `{ "text", "why" }` | One per product requirement. `text` = what the user gets. `why` is **mandatory**: the business reason, from the spec. |
| **ADR** | `ADR-` | `{ "text", "why" }` | One per architectural decision. `text` = the decision (present tense). `why` = context and the rejected alternative. |
| **PLAN** | `PLAN-` | `{ "text", "why" }` or string | One per implementation plan or phase. `text` = scope and order. `why` optional. |
| **TASK** | `TASK-` | `{ "status", "text" }` | One per unit of work in a plan. Put the Jira/Linear code in the id when there is one (`TASK-C14622`). `status`: `todo`, `wip`, `review`, `blocked`, `done`. |
| **ACC** | `ACC-` | `{ "status", "text" }` | One per acceptance criterion: a verifiable condition that must hold for a PRD or PLAN to be accepted. `text` = the condition in present tense, then its evidence (`"Broker memory cap ≤ pod limit. Today: 11.72 GB reported."`). `status`: `open`, `partial`, `met`, `regressed`. |

| **COD** | `COD-` | `{ "status", "text" }` | One per code change: a pull request, including one that only commits manifests or Helm values. Name it by repo and PR: `COD-Rtapi5699`. `status`: `wip`, `review`, `dev` (merged into dev), `released`. No `env`: it lives in a repo. |
| **OP** | `OP-` | `{ "status": [{ "env", "state" }], "text" }` | One per operation applied to environments: `helm upgrade`, manifest or values applied, secret created, Terraform apply, CronJob run. Name it by what it changes: `OP-TransformNatsValues`. `status` lists its target environments, each `pending` or `done`. |

**TASK, COD, OP or ACC?**
- **TASK:** work to plan ("add a NetworkPolicy template"). It may need several OPs.
- **COD:** one code change in a repo, a PR ("PR #6076"). Merged is not applied: a PR that commits manifests changes nothing until an OP applies them.
- **OP:** one change applied to environments ("staging values rolled out"), pending or done per environment.
- **ACC:** a condition to verify, true or not regardless of who did what ("4222 accepts only rtapi and transform pods").
- Typical chain: `TASK → COD` *done by*, `COD → OP` *deployed by*, `OP → ACC` *satisfies*. A code-only change skips the OP (`COD → ACC`).
- A ticked checkbox in a spec ("[x] Close blocker 1") is usually a COD or OP that is done plus an ACC that is met, not a TASK.

**OP environments.** An OP's `status` is a list of targets: `[{ "env": "dev", "state": "done" }, { "env": "prod", "state": "pending" }]`.
The panel shows one checkbox per environment (`eph`, `dev`, `staging`, `sandbox`, `prod`) and a state for each ticked one.
The card shows one chip per target (✓ green when done); its LED is green when every target is done, yellow when some are, grey when none is.
An OP has no single `env` property.

**TASK or ACC?** Ask "is it work, or a state to verify?"

| It is an **ACC** when the spec item… | It is a **TASK** when the spec item… |
|---|---|
| is a condition, check or gate (deploy conditions, verification lists, "must", "only", "≤", "rejected") | is an action someone performs (merge, deploy, create, write, decide) |
| has evidence instead of steps (a config value, a log line, a metric, a ✅/❌ cell) | has steps or a PR |
| stays true after the work is done, and can regress | is finished once done |

- One spec line often holds both: "add `MaxBytes` (TASK) so the broadcast stream is capped (ACC)". Split it, then link `TASK → ACC` `satisfies`.
- An ACC states the outcome, not the means: `ACC-BrokerMemoryCapped`, not `ACC-AddGomemlimit`.
**Status LED.** An entity's `status` property (like `tags`, never a `[…]` prefix in `text`) shows as a LED on its card.
Any string is accepted; the panel suggests the usual ones. The colour comes from the words in it:

| LED | Status words |
|-----|--------------|
| 🔴 red | `blocked`, `regressed`, `fail` |
| 🟡 yellow, pulsing | `partial`, `review`, `progress`, `wip`, `dev` (COD), or any status with `⚠` (`[done ⚠]`) |
| 🟢 green | `done`, `met`, `ok`, `released` |
| ⚪ grey | `open`, `todo`, `planned`, or any other word |

No `status`, no LED: PRD, ADR and PLAN usually have none.

**Environment.** `"env"`: one of `eph`, `dev`, `staging`, `sandbox`, `prod`, shown as a badge on the card (prod in red).
Set it where it means something, on any kind but COD and OP: where an ACC is verified, where a TASK applies. An ACC met in staging but not in prod is two ACCs, one per env, or one ACC whose `env` moves as it is verified further.

Any entity object may carry `"tags": ["blocker", "prod"]`: labels shown as post-its on the node, like WIP board labels.
Use them for cross-cutting state the id cannot hold (`blocker`, `prod`, `roast-1`), not for the kind (the prefix already says it).

### Implementation layer (what the spec touches)

The `unified-docs` DSL prefixes (`FCOM-`, `FDTO-`, `BDTO-`, `BENT-`, `BPRO-`, `BAGG-`, `BFUN-`, `DBT-`, `DBP-`, `DBQ-`, `DBI-`, `EVT-`),
plus any prefix already in `DIMENSIONS` for infrastructure specs (`K8S-`, `NATS-`, `GCP-`, `OPS-`, `AP-`).

- **Reuse first.** Grep `src/content` and `docs/**/_sdd.json` before naming; the same id is the same thing across docs.
  A reused id needs no entry in this file's `entities`: its text comes from the doc that declares it.
- Declare a new implementation id only when no diagram has it yet.
- When the spec already has action points as `AP-` ids, TASKs point to them (`changes`), they do not restate them.

### Flow-only nodes

Decision/step nodes with no `ref` are allowed inside `nodes` pages (`"kind": "entry" | "refused"`).

## 4. Relations

`"relations": [[from, to, label], …]`:

- `PRD → ADR`, label `decided by`.
- `PRD → PLAN`, label `planned by`.
- `PLAN → TASK`, label `step`. `TASK → TASK`, label `before`, for ordering.
- `PRD → ACC`, label `accepted when`. `PLAN → ACC`, label `done when`.
- `TASK → ACC`, `COD → ACC` or `OP → ACC`, label `satisfies`. `TASK → COD` or `TASK → OP`, label `done by`. `COD → OP`, label `deployed by`. Between TASK, COD and OP, label `before`.
- `ADR → DBT-/BFUN-/FCOM-…`, label `shapes`.
- `TASK → DBT-/BFUN-/FCOM-…`, label `changes`. `ACC → K8S-/NATS-/BFUN-…`, label `checks` (what the criterion inspects).

Every PRD reaches at least one PLAN or implementation node. An orphan PRD is a spec gap: list it in the folder's Hugo page under `## Gaps`.
Every ACC has at least one `satisfies` TASK, unless it is already `[met]`. An unsatisfied open ACC is a gap too.

Column layout of a single spec page (left to right): PRD · ADR · PLAN · TASK · COD · OP · ACC (x = 0, 360, 720, 1080, 1440, 1800, 2160).

## 5. Pages

- No `pages` key → one `overview` page with every entity.
- `"entities": "*"` on a page means every entity (JSON has no `Object.keys`).
- Recommended set, in this order:
  1. `overview` · Home · `"entities": "*"`.
  2. `requirements` · PRDs and ADRs (`entities` page).
  3. `plan` · PLANs and TASKs (`entities` page, or `nodes`/`edges` with `"direction": "LR"`).
  4. `traceability` · PRD → ADR/PLAN → TASK → implementation (`entities` page).
  5. One `nodes`/`edges` or `sequence` page per behaviour the spec describes.

Page shapes are the same as JS docs: `entities`, `nodes` + `edges` (+ optional `groups`, `direction`), or a ZenUML `sequence` string.

## 6. Skeleton

```json
{
  "id": "nats-secure",
  "title": "NATS Secure",
  "subtitle": "C-14622 · knowledge/prds/... · 2026-11-05",
  "entities": {
    "PRD-EncryptedBroker": { "text": "Every NATS connection is TLS-encrypted.", "why": "ISO 27001 audit flags plaintext internal traffic." },
    "ADR-CertManagerCerts": { "text": "cert-manager issues the NATS certificates.", "why": "Already installed on the new clusters; manual certs expire silently." },
    "PLAN-Rollout": { "text": "Staging first, then production per namespace.", "why": "A broken TLS handshake stops every consumer." },
    "TASK-C14624": { "status": "review", "text": "Certificate reload sidecar." },
    "BFUN-NatsConnect": "rtapi NATS client connection."
  },
  "relations": [
    ["PRD-EncryptedBroker", "ADR-CertManagerCerts", "decided by"],
    ["PRD-EncryptedBroker", "PLAN-Rollout", "planned by"],
    ["PLAN-Rollout", "TASK-C14624", "step"],
    ["TASK-C14624", "BFUN-NatsConnect", "changes"]
  ],
  "pages": [
    { "id": "overview", "section": "Home", "title": "Everything", "entities": "*" },
    { "id": "plan", "section": "1 · Spec", "title": "Plan and tasks", "entities": ["PLAN-Rollout", "TASK-C14624"] }
  ]
}
```

## 7. Check

- The JSON parses: `node -e "JSON.parse(require('fs').readFileSync('<path>/_sdd.json','utf8'))"`.
- `cd dev-deck && npx vite build` passes.
- Open `/diagrams/#/<doc-id>`. Each kind has its own colour (PRD gold, ADR brown, PLAN steel blue, TASK olive, COD sky blue, OP violet, ACC teal), and the side panel shows **Why:**.
- Every `reactflow` route in the folder's Hugo pages points to an existing doc/page.
