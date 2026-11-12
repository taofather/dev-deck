---
name: operations-deck
description: Build and maintain an infrastructure operations deck as a dev-deck React Flow diagram stored in a folder-local `_ops.json`, next to its Hugo pages. Use for rollouts, migrations and runbooks (broker setup, secrets, Helm releases, switches and reverts across environments) where the unit of work is an operation applied per environment, run by commands and checked by verifications. Not for product specs: use sdd-convert for PRD/ADR/PLAN material.
---

# operations-deck

## 0. Load unified-docs first (mandatory)

Invoke the `unified-docs` skill (`Skill` tool, `unified-docs`) before anything else.
Every rule of `unified-docs` applies (reigns, BoundedContexts, intentions, IntentionTags, DSL prefixes, `reactflow`
frontmatter, file naming). The rules below add to it; on conflict this file wins for the diagram storage and node set.

## 1. Input

- A rollout ticket, runbook, deploy log or ops doc, plus the code it deploys (charts, values files, scripts, CI config).
- Read them fully and check the facts that change (PR state, values on the target branch, what CI applies, Secret Manager)
  before writing them down. Never invent an operation, command or verification the sources do not support; a gap is
  written as a gap (`⚠️`), a guess as a hypothesis (`❓`).
- Skip RESTRICTED folders (`omnologus-consentio`, `omnologus-taofather`) unless the user names them.

## 2. Output: `_ops.json`, one per folder

| File | Where |
|------|-------|
| Diagram | `docs/<reign>/<bounded-context>/<intention>/_ops.json` (e.g. `docs/_WIP/document-transform-retry/_ops.json`); also loaded: `docs/*/*/<folder>.json` |
| Hugo pages | Markdown files in the **same folder** (ticket, deploy log, runbook), named per `unified-docs` (`YYYYmmdd-<ticket>-<slug>.md`) |

- `src/content/index.js` loads them at build time; under `npm run dev` the app reads and saves them live. No registration.
- Doc id: the JSON `id`, else the folder path below the reign. Set `id` explicitly so `reactflow` routes survive moves.
- An empty or invalid file is skipped with a console warning; it never breaks the app.
- One file per folder. Merge into an existing one: add nodes, relations and pages, keep existing ids.
- Each Hugo page in the folder lists the diagram in `reactflow:` and its core ids in `entities:`; when an id is renamed
  or removed, update those pages too.

### Orchestrator

Each `_ops.json` keeps **one** agent conversation: `"orchestrator": { "id": "<session uuid>", "started": "<ISO>" }`,
written by the bridge on the first message from the diagram's **🤖 Agent** panel. As that orchestrator: edit the file in
place, never remove or change `orchestrator`, give every new node a position in its kind column, and expect the user to
edit the same file from the UI: re-read it before each change and build on what is there (renamed or deleted nodes are
deliberate).

## 3. Node set

The kind comes from the id prefix (`DIMENSIONS` in `src/main.jsx`).

### Operations layer

| Kind | Prefix | Value | Rule |
|------|--------|-------|------|
| **TASK** | `TASK-` | `{ "status", "text", "env"? }` | Work to plan that is not itself applied to an env: a code fix, a decision, a blocker to clear (`TASK-TransformBridgeValues`). `status`: `todo`, `open`, `wip`, `review`, `blocked`, `done`. `env` only when it applies to one env (`TASK-MaintenanceWindow`, `env: prod`). |
| **COD** | `COD-` | `{ "status", "text" }` | One per code change: a pull request (also one that only commits manifests, values or a script). Name it by repo and PR: `COD-Rtapi6197`; a local script outside any repo is a COD with status `local` (`COD-nats-secure.sh`). `status`: `wip`, `review`, `dev` (merged into dev), `released`, `closed`, `local`. No `env`: it lives in a repo. Merged is not applied. |
| **OP** | `OP-` | `{ "status": [{ "env", "state" }], "text" }` | One per operation applied to environments: set up a broker, create secrets, switch a service, revert. Name it by what it achieves, **never by an environment** (`OP-SetupNats`, not `OP-StagingBrokerHelm`). Its text holds the procedure and the preconditions, written env-agnostic (§3 Environments). |
| **CMD** | `CMD-` | `{ "status": [{ "env", "state" }], "text", "cmd" }` | One per command that changes an environment and an OP runs: a script step, `helm upgrade`, `kubectl scale`. `cmd` holds it with `<env>` / `$CTX` placeholders, and when it wraps a script, the commands the script runs. A target is `done` once it ran there, `fail` when the run failed. |
| **VERIF** | `VERIF-` | `{ "status": [{ "env", "state" }], "text" }` | One per operational check with its expected result (`VERIF-OnlyClientPortExposed`: "nats-svc exposes only 4222"). Name it by the expected result. State `pending` (not checked), `done` (holds), `fail` (checked, does not hold). |
| **QUERY** | `QUERY-` | `{ "text", "query" }` | One per read-only command a VERIF runs: `kubectl get`, `gcloud … list`, `helm history`, a log grep, a script's read-only step. No `status`, no `env`: the `<env>` placeholder serves every env. Never a mutating command (that is a CMD). |
| **ACC** | `ACC-` | `{ "status", "text" }` | Optional: a lasting condition the whole rollout is accepted on (`ACC-BrokerMemoryCapped`). `status`: `open`, `partial`, `met`, `regressed`. Several VERIFs are evidence for one ACC. |

### Infrastructure layer

Reuse the ids already declared in `src/content` and `_sdd.json` / other `_ops.json` files (`K8S-`, `NATS-`, `GCP-`, `OPS-`, `AP-`, and
the `unified-docs` DSL for code: `BFUN-`, `BENT-`, …). Grep before naming: the same id is the same thing across docs, and
renaming an id declared elsewhere breaks that diagram's links. Declare a new one only when no diagram has it.

### Environments and states

- **Targets, not names.** An OP, CMD or VERIF carries its environments as targets
  `[{ "env": "dev", "state": "done" }, { "env": "prod", "state": "pending" }]`; `env` ∈ `eph`, `dev`, `staging`,
  `sandbox`, `prod`. One node per concept; a second node for one env is a duplicate: merge it and add a target.
- **Env-agnostic text.** The env lives only in properties: an OP/CMD/VERIF `status` target, a TASK `env`, a link
  label. Ids, `text`, `cmd`, `query`, page titles and the doc `subtitle` never name an env: write `<env>`, "the env",
  or the condition that makes an env a target ("an env on the NATS bridge joins the .nats steps once …"). Which env
  runs which variant is read from the targets, so moving an env is a status edit, not a text rewrite.
  Not env names: git branches (`→ dev`), cluster or project names (`consentio-non-prod-cluster`, `consentio-prod`).

  ❌ The text names one env while the targets cover four; it is wrong for three of them:

  ```json
  "OP-BrokerReloader": { "text": "Rerun nats-secure.sh staging broker so nats-0 gets the #6163 reloader sidecar, before the certificate renewal window (~2027-01-17).", "status": [ { "env": "dev", "state": "done" }, { "env": "staging", "state": "pending" }, { "env": "sandbox", "state": "pending" }, { "env": "prod", "state": "pending" } ] },
  ```

  ✅ The text holds for every target; the targets say where it is done:

  ```json
  "OP-BrokerReloader": { "text": "Rerun nats-secure.sh <env> broker so nats-0 gets the #6163 reloader sidecar, before the certificate renewal window (~2027-01-17).", "status": [ { "env": "dev", "state": "done" }, { "env": "staging", "state": "pending" }, { "env": "sandbox", "state": "pending" }, { "env": "prod", "state": "pending" } ] },
  ```

  A note that is true for one env only is a precondition or a TASK with `env`, or a link label `(staging)`, not prose.
- A link that applies to one env carries it in its label: `before (prod)`, `includes (staging)`.
- LED: red if any target is `fail`, green when every target is `done`, yellow when some are, grey when none is.
- `tags` for cross-cutting state the id cannot hold: `conditional` (revert), `OutOfScope`, `🧹 cleanup`.

### Which kind?

| The item… | Kind |
|---|---|
| changes an environment, tracked per env | **OP** |
| is the literal command that does it | **CMD** (run by the OP) |
| is a check with an expected result, per env | **VERIF** |
| is the read-only command that check runs | **QUERY** |
| is code or config in a repo (PR, script) | **COD** |
| is work to do before an OP can run (fix, decision, blocker) | **TASK** |

- A dry run is usually a `DRY_RUN=1` variant inside the same CMD's `cmd`; give it its own CMD only when it is a separate step in the order.
- Remove what other nodes cover: a generic OP whose envs are all covered by more precise OPs, a CMD made obsolete by a
  merged PR, a TASK nobody needs. Before removing, move its links and any history worth keeping into the node that covers it.

## 4. Relations

`"relations": [[from, to, label], …]`:

- `OP → OP`, label `before`: the execution order (see §5). Keep this graph **acyclic**; a "then, if …" step of a revert
  goes in the OP text, not in a link back.
- `OP → CMD`, label `runs`. `CMD → CMD`, label `before`. `COD → CMD`, label `provides` (the script that holds the step).
- `OP → VERIF`, label `verified by` (`verified by (before)` for a precondition). `CMD → VERIF`, label `checked by`.
- `VERIF → QUERY`, label `runs`. `OP → QUERY`, label `uses` (a read the operation needs, not a verification).
- `COD → OP`, label `deployed by`. `TASK → OP`, label `done by`; `TASK → OP` or `TASK → TASK`, label `before` for preconditions.
- `TASK → TASK`, label `blocker` (from the switch or window TASK to what blocks it).
- `VERIF → ACC`, label `evidence for`. `OP → K8S-/GCP-/NATS-…`, label `changes`.

## 5. Operations: sorted and numbered

The Operations section is the runbook. Its order is the execution order, and every operation shows it.

1. **One page per OP** in a section `Operations`, page id `op-<kebab name>` (`op-setup-nats`).
2. **Titles numbered** `1- `, `2- `, …, `N- ` in execution order: `1- CreateNATSSecrets`, `2- SetupNats`, ….
   Renumbering strips an existing `N- ` prefix first, so prefixes never stack. Page ids stay unchanged.
   A step that differs per variant (broker, provider) is one OP per variant, numbered `N.<variant>- ` under the same N:
   `2.pubsub- ConfigureRetry`, `2.nats- ConfigureRetry`. Each variant OP has its own page, CMDs, VERIFs and QUERYs;
   only nodes that hold for every variant are shared.
3. **One order everywhere.** The order follows the OP `before` chain. Save it twice: the sidebar order of the
   Operations pages, and the positions of the By kind › OP page (one left-to-right line, `x = i * 280`), so the kind
   page never depends on dagre's layout of an unordered or cyclic graph.
4. Out-of-scope or conditional OPs go last (a revert after the forward steps, an out-of-scope OP at the end).
5. A cross-cutting procedure (a switch, a maintenance window) is an OP with its own page in the same numbered
   sequence, not an overview page beside it. It names the OPs it depends on in its text and keeps the `before` links,
   but its page does not show them: each OP and its CMDs live on their own page.

### Operation page content

- **Exactly one `OP-` per page**: the page's own OP. Neighbouring OPs never appear on it; the order lives in the
  page numbering and the `before` chain (shown on the By kind › OP page).
- **Entities** (explicit list): context (the TASKs `done by` it, the CODs `deployed by` it or `provides` its CMDs),
  the OP, its CMDs, its VERIFs, and the QUERYs those VERIFs run or the OP `uses`.
- **Layout** (saved `positions`, no `direction`):

| Row | y | Content |
|-----|---|---------|
| Context | -160 | TASKs, CODs, the OP (last) |
| Commands | 40 | The CMDs in execution order, left to right (x = i * 280) |
| Verifications | 260 | The VERIFs, left to right |
| Queries | 390 and below | Each VERIF's QUERYs stacked under it (a shared QUERY under the first VERIF); QUERYs no VERIF runs in an extra column at the right |

- Re-layout a page after adding or removing nodes, and drop saved positions of nodes no longer on it.

## 6. Pages

- `spec` · Home · `"entities": "*"`, columns per kind: TASK · COD · OP · ACC · VERIF · QUERY · CMD
  (x = 1080, 1440, 1800, 2160, 2520, 2880, 3240; implementation ids to the left).
- `By kind` section: one page per kind with a glob (`"TASK-*"`, `"COD-*"`, `"OP-*"`, `"VERIF-*"`, `"QUERY-*"`,
  `"CMD-*"`, `"ACC-*"`). New nodes land on glob pages by themselves.
- `Operations` section: §5.
- A page's `"entities"` may be a glob string (`"*"`, `"TASK-*"`, `"COD-*, OP-*"`) or an explicit list. The UI appends
  new nodes only to explicit lists.

## 7. Deploy log and Hugo pages

- Incidents and deploy sessions go in `<folder>/../ops/<env>-deploy-log/YYYYmmdd-<ticket>-<slug>.md`: summary, components,
  UTC timeline, causes (root cause, amplifier, design gap; `❓` for hypotheses), target design, recovery commands,
  follow-ups with their diagram ids.
- The ticket page keeps its dated checks; when the diagram contradicts it, fix the ticket or mark the line outdated.

## 8. Skeleton

```json
{
  "id": "nats-secure-sdd",
  "title": "NATS Secure (operations)",
  "entities": {
    "COD-nats-secure.sh": { "status": "local", "text": "src/scripts/nats-secure.sh <env> <step>." },
    "OP-CreateNatsSecrets": { "status": [{ "env": "staging", "state": "done" }, { "env": "prod", "state": "pending" }], "text": "Create the NATS passwords and the CA container." },
    "OP-SetupNats": { "status": [{ "env": "staging", "state": "pending" }, { "env": "prod", "state": "pending" }], "text": "Install or upgrade the secured broker chart." },
    "CMD-NatsSecureSecrets": { "status": [{ "env": "staging", "state": "done" }], "text": "Create the secrets.", "cmd": "src/scripts/nats-secure.sh <env> secrets" },
    "VERIF-NatsSecretsExist": { "status": [{ "env": "staging", "state": "done" }, { "env": "prod", "state": "pending" }], "text": "Both passwords and the CA exist with a version." },
    "QUERY-NatsSecretsList": { "text": "NATS secrets in Secret Manager.", "query": "gcloud secrets list --project consentio-prod --filter=\"name~nats\"" }
  },
  "relations": [
    ["OP-CreateNatsSecrets", "OP-SetupNats", "before"],
    ["OP-CreateNatsSecrets", "CMD-NatsSecureSecrets", "runs"],
    ["COD-nats-secure.sh", "CMD-NatsSecureSecrets", "provides"],
    ["OP-CreateNatsSecrets", "VERIF-NatsSecretsExist", "verified by"],
    ["VERIF-NatsSecretsExist", "QUERY-NatsSecretsList", "runs"]
  ],
  "pages": [
    { "id": "spec", "section": "Home", "title": "Everything", "entities": "*" },
    { "id": "operations", "section": "By kind", "title": "OP · operations", "entities": "OP-*",
      "positions": { "OP-CreateNatsSecrets": { "x": 0, "y": 0 }, "OP-SetupNats": { "x": 280, "y": 0 } } },
    { "id": "op-create-nats-secrets", "section": "Operations", "title": "1- CreateNATSSecrets", "edgeType": "smoothstep",
      "entities": ["COD-nats-secure.sh", "OP-CreateNatsSecrets", "CMD-NatsSecureSecrets", "VERIF-NatsSecretsExist", "QUERY-NatsSecretsList"],
      "positions": {
        "COD-nats-secure.sh": { "x": 0, "y": -160 }, "OP-CreateNatsSecrets": { "x": 280, "y": -160 },
        "CMD-NatsSecureSecrets": { "x": 0, "y": 40 },
        "VERIF-NatsSecretsExist": { "x": 0, "y": 260 },
        "QUERY-NatsSecretsList": { "x": 0, "y": 390 } } },
    { "id": "op-setup-nats", "section": "Operations", "title": "2- SetupNats", "entities": ["OP-SetupNats"] }
  ]
}
```

## 9. Check

- The JSON parses, and `orchestrator` is unchanged.
- No id, `text`, `cmd`, `query`, page title or `subtitle` names an env (`grep -n -w -E 'dev|staging|sandbox|prod'`,
  ignoring `"env":` keys, branches and cluster/project names).
- No relation and no page `entities` entry points to a missing id; no text names a removed or renamed id
  (grep the folder's Markdown pages too).
- Every node on an Operations page has a saved position; no position is left for a node not on the page.
- Every Operations page lists exactly one `OP-` id.
- The Operations titles run `1- … N-` without gaps, in the same order as the By kind › OP line and the OP `before` chain.
- The app builds (`npx vite build` from the dev-deck app folder) and `/diagrams/#/<doc-id>` shows each kind in its colour
  (TASK olive, COD sky blue, OP violet, ACC teal, VERIF amber, QUERY slate, CMD dark red).
