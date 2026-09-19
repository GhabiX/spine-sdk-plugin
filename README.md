# Spine SDK Plugin

This directory is the **only** source of the Pi/DSH Spine plugin. Daily Pi
should `pi install` `packages/plugin` from here. EvoClaw vendor copies must be
cut from a git commit of this repo, not a second tree. Pi loads `dist/`; rebuild
after source changes (`npm run build` and `scripts/build-node-wasm.sh`).

This repository is the portable Spine product boundary for Node agent hosts.
It packages one Rust semantic kernel behind a narrow WASM ABI, a TypeScript SDK,
one shared transaction controller, and explicit Pi and DeepSeek Harness plugin
entrypoints.

The canonical semantics remain in CacheTree's `doc/FormularDef.md`. The sole
current `spine-core` implementation remains in SpineCodex and is identified by
`core-source.json`; this repository never carries a copied reducer.

## Packages

- `crates/spine-wasm`: stateful, coarse Rust/WASM transaction binding.
- `packages/sdk`: `@spinejit/spine-sdk`, versioned DTOs and the ESM runtime.
- `packages/host`: `@spinejit/spine-host`, the minimal Pi Plugin Host contract
  for ownership, dependency order, namespaces, lifecycle, immutable event
  observation, private storage, and session requests.
- `packages/plugin`: `@spinejit/spine-plugin`, shared controller plus `./pi`
  and `./deepseek-harness` entrypoints.
- `packages/spinetree-plugin`: `@spinetree/plugin`, an ordinary Pi project
  coordination plugin. It owns only the `spinetree` namespaces and does not
  replace the canonical Spine context or sampling owner. Its `spinetree_read`
  tool becomes a real, fixed-HEAD read when the factory receives an explicit
  snapshot store or `.spinetree` root adapter. An explicit change-capable store
  also enables `spinetree_change`, which applies immutable ProjectBranch
  updates through a required expected-HEAD CAS token. `GitSpineTreeStore`
  provides the explicit filesystem adapter: `initialize()` creates a
  `.spinetree` Git repository, snapshots are committed as immutable
  `state.json` objects, and `git update-ref` performs expected-HEAD CAS. The
  default factory remains contract-only and creates no workspace state.
  Explicit registry and mailbox adapters additionally enable `spinetree_send`:
  AgentId addresses are resolved to PiSession IDs, receipts are leased before
  `sessions.request`, and rejected or transiently failed delivery returns the
  receipt to `queued`.

  A mailbox that also exposes `receipt()` enables `spinetree_observe`. The
  caller supplies `{ receiptId, agentId }`; the plugin resolves that Agent,
  checks that the receipt's `to` field names the same Agent, and then performs
  the mailbox's idempotent `observed()` transition. This is an explicit
  recipient acknowledgement, not an automatic consequence of Pi accepting a
  prompt. The Host contract has no caller identity field, so the declared
  `agentId` is checked against the registry but is not a transport-level
  authentication mechanism. Unknown, ended, foreign, queued, or unknown
  receipts return typed observation errors.

  Registry and mailbox persistence use the same immutable snapshot and HEAD as
  the ProjectBranch tree. The application creates and initializes one
  `GitSpineTreeStore`, then passes adapters built from that store to the plugin:

  ```ts
  import {
    GitSpineTreeAgentRegistry,
    GitSpineTreeMailbox,
    GitSpineTreeStore,
    createSpineTreePlugin,
  } from "@spinetree/plugin";
  import { SpinePluginHost } from "@spinejit/spine-host";

  const store = GitSpineTreeStore.initialize("./.spinetree", initialSnapshot);
  const host = new SpinePluginHost({ sessions });
  host.register(createSpineTreePlugin({
    store,
    registry: new GitSpineTreeAgentRegistry(store),
    mailbox: new GitSpineTreeMailbox(store),
  }));
  ```

  `registry` and `mailbox` are written into the committed snapshot fields of
  the same Git history. Each mutation reads the current HEAD and publishes with
  expected-HEAD CAS; a concurrent writer is retried against its new snapshot,
  while an exhausted retry budget returns a typed stale-head error. The plugin
  never creates `.spinetree`, starts a Git process on its own, or turns the
  host's private storage into persistence.
- `fixtures/conformance`: host-neutral semantic traces.
- `tests`: native/WASM, recovery, and cross-host equivalence gates.

Pi and DeepSeek Harness history identifiers are transport metadata. They never
become Spine scope parents. Host adapters map typed evidence, persistence,
context publication, lifecycle, and child execution; they do not reduce Spine
state.

## Pi Plugin Host contract

Pi remains the outer host. `@spinejit/spine-host` is a thin contract inside
that host, not another process or runtime. `@spinejit/spine-plugin` is the
single `spine.canonical` owner for Scope transitions, sampling, projection,
compaction, recovery, and Spawn. `@spinetree/plugin` is an ordinary contributor
that exposes `spinetree_*` tools and a namespaced status command. Without
explicit adapters its tools remain contract-only. The host rejects duplicate
owner slots and namespaces, gives each plugin private storage, and orders
activation by manifest dependencies.
The current contract only implements owner claims; event observation and
session requests are host services, not separate capability kinds. The
SpineTree plugin's in-memory change store and registry/mailbox remain testable
adapter boundaries. `GitSpineTreeStore` is an explicit Git-backed
`.spinetree` persistence adapter; no Pi launcher creates or attaches one by
default.

### Pi session requests

The optional `@spinejit/spine-host/pi` export provides
`createPiSessionAdapter(resolveSession)`. Supply a resolver for caller-owned
PiClient `SessionLease` objects, indexed by Pi session ID:

```ts
import { SpinePluginHost } from "@spinejit/spine-host";
import { createPiSessionAdapter, type PiSessionLease } from "@spinejit/spine-host/pi";

// Populate this map with active leases acquired by the application.
const leases = new Map<string, PiSessionLease>();
const host = new SpinePluginHost({
  sessions: createPiSessionAdapter(sessionId => leases.get(sessionId)),
});
```

The application owns PiClient connection, authentication, lease acquisition,
disposal and reconnection. The adapter checks the session ID and active lease,
then awaits `prompt(text)` or `steer(text)`. Successful resolution returns
`accepted: true`; a missing/inactive lease or a Pi command's `busy` or
`session_locked` error returns `accepted: false`. Other errors propagate
unchanged. The adapter adds no transport or connection lifecycle.

When used with explicit SpineTree registry/mailbox adapters, `spinetree_send`
routes AgentId to the corresponding Pi session, keeps the receipt leased while
`prompt` is pending, and marks it delivered when the command resolves. Rejected
requests and ordinary errors return to `queued`; errors explicitly marked
`permanent: true` produce `failed` under the existing mailbox policy.
Retrying the same caller requestId reuses its receipt. There is no automatic
retry worker. `requestId` is echoed only in the local Host response: Pi's
prompt/steer commands do not accept this mailbox ID. A lost acknowledgement
may therefore cause duplicate remote delivery on retry. `delivered` does not
mean the model observed the message, and this adapter never marks `observed`.
`spinetree_observe` is the separate recipient acknowledgement path; it does
not consume queued receipts or run a background worker. Tests cover the
adapter and mailbox with simulated leases; actual Pi Server/Client transport
integration remains to be verified.

`dispatchSpineTreeMailbox({ registry, mailbox, sessions, limit })` is an
explicit, caller-driven recovery pass for persisted work. It reads at most
`limit` due `queued` receipts and expired leases in enqueue order, acquires
each lease once, and routes the receipt through the same Pi session request
path as `spinetree_send`. Missing or ended Agents become `failed`; rejected
or transiently failed requests return to `queued`; lease races are reported
in `skipped`. The function does not start a worker, schedule itself, or add a
model-visible tool. Lease expiry and lost acknowledgements can still cause
duplicate remote delivery, so the caller controls when to run another pass.

`spinetree_rejuvenate` is enabled only with an explicit snapshot store, a
registry that exposes `list()` and `registerExclusive()`, and a caller-owned `rejuvenator.provision`
adapter. It validates that `{ parent, branch, request? }` names an existing
`capped` branch, that `parent` is the branch itself or an ancestor, and that
no active Agent is already bound to the branch. The provisioner receives
detached branch data plus the effective inherited context and owns Pi session
creation, transport, initial prompt, and cleanup. Its returned binding is
registered through the same registry; the result is
`spinetree.rejuvenate.result/v1`. There is no implicit Pi process creation or
cross-layer transaction, so a registry failure after external provisioning is
reported for the caller to clean up. Without all explicit adapters the tool
remains contract-only.

## Pi extension

`@spinejit/spine-plugin` declares its loadable entry in `pi.extensions`; the
same entry is available explicitly as `@spinejit/spine-plugin/pi/extension`.
It registers the four canonical tools and `/spine-tree`, and
uses `@spinejit/spine-sdk/node` for the packaged WASM runtime.
Before each agent run, the extension's `before_agent_start` hook extends Pi's
assembled system prompt through the runtime's configured `SpineConfig` and
rewrites `spine.*` names. The adapter then inserts one sentence after the D&C
ownership paragraph: finalize a completed branch; a user message that is a new
obligation rather than the current one belongs at its owning level. Canonical
instruction text otherwise remains in `spine-core`; the adapter does not copy
the rest of the prompt or rely on tool descriptions as a substitute for it.
In interactive Pi TUI mode it renders a folded SpineCodex-style pretty tree as an
`aboveEditor` widget keyed by `spine-tree`, refreshed only when the display
signature changes. `/spine-tree` prints that same pretty tree. `spine_spawn`
streams per-child status on the tool row. JSON, print, and RPC modes keep the
command/notification behavior.

The context hook is also dirty-tracked. Recovery starts with the context that
was just published; repeated Pi context hooks therefore return the installed
projection without running another synchronous WASM preview. A new source
message, compact replacement, or committed sampling cycle invalidates or
refreshes that marker before the next publication. This keeps the host event
ordering unchanged while removing redundant preview work from long sessions.

Before recording an execution or starting Spawn children, the SDK calls the
pure `spine-core` validator through the WASM binding. The plugin does not copy
the canonical byte/count policy; it only keeps terminal-receipt checks needed
after child work returns. Pi's own child process stdout/stderr capture remains
owned by Pi and is outside this plugin boundary.

The Pi deployment profile must load Spine as the final and exclusive context
reducer and the exclusive compaction owner. The extension intercepts
`session_before_compact`, asks Pi's model registry for the summary, persists a
typed compact barrier and replacement messages, then publishes the new
projection before allowing Pi to append its acknowledgement entry. A native
compaction entry is accepted during recovery only when paired with the durable
Spine compact entry and marked `fromHook`; an unpaired or non-hook native
compaction fails closed.
Archive `durabilityId` is the persist key `archiveRecordId(record)`:
`attempt_id.value` on `sampling_started` and `commit_id.value` on
`sampling_commit`. `record_digest` is not the persist key; recovery accepts it
only as same-day compatibility when that field is present and equals
`durabilityId`. Overflow retry removes only the final retryable
`error`/`length` assistant from replacement context. If Pi aborts compaction
after Spine has completed, the extension faults and aborts the live session.
Assistant responses with `stopReason: "deferred"` are rejected because the
sampling contract only admits completed, failed, or cancelled terminals.
Committed input-token accounting records `input + cacheRead + cacheWrite` when
Pi provides safe non-negative values for all three components.
Session-start and session-tree recovery is generation guarded: a stale async
replay is disposed instead of replacing the runtime selected by the latest
session transition, and a new tree transition clears a prior lifecycle fault.

Spawn children inherit the parent sampling-start session prefix (`C_child =
C_parent · Δ_child`) by resuming a forked Pi session file, then receive an
identity/peer assignment envelope. The child process loads the same discovered
packages/extensions as a normal Pi agent, keeps the parent's active tool
allowlist plus typed `spine_child_return`, and can use `spine_open` /
`spine_close` / `spine_next` / `spine_spawn`. Nested spawn is hang-until-join in
the child process, matching SpineCodex child `spine.spawn`. Children still
return through `spine_child_return`; missing or duplicate returns mark that
child `errored` with a diagnostic μ and do not abort siblings. Pi can replay a
fully committed Spawn and verifies its durable per-child staging. If Pi crashes
after staging child terminal memory but before persisting the parent tool result
and turn commit, the extension fails closed on restart: Pi currently does not
expose a recovery-time native tool-result finalization API.

## DeepSeek Harness extension

`@spinejit/spine-plugin/deepseek-harness` binds directly to the public
`Session` and `SessionStore` contracts. It registers strict versioned codecs
for `spine/archive` and `spine/spawn-terminal`, publishes the complete ordered
model context through the core `surface/projection` event, and awaits
`SessionStore.flush()` after every archive, terminal staging, and projection.
Creation fails before sampling work when no durability listener participates.

The deployment composition supplies the ownership callback that disables or
rejects every competing DSH context reducer and native compaction path. The
adapter verifies this callback before creating its controller. Its disposer
removes the required-event registration when the owning plugin/session scope
ends. Complete durable Spawn staging can be recovered in canonical task order;
partial, duplicate, or malformed staging fails closed.

The loadable Cordis entry is
`@spinejit/spine-plugin/deepseek-harness/extension`. One DSH step is one
sampling cycle: typed session messages are admitted as sources, `llm/stream`
durably begins the attempt, typed native and Code Mode tool events stage Spine
operations, and the next pre-step or turn-stopping boundary performs
PostSampling. Request failures close the attempt before retry. Spawn uses the
typed `ctx.subagents.start()` structured-output contract and requires a
non-empty model-authored `memory` field.

The extension rejects a composed native compaction service at load and session
recovery, and faults if any `compaction/*` event appears. DSH does not yet have
a generic exclusive-owner registry, so deployments must keep native compaction
and competing context reducers out of the Spine-enabled composition.

## Development source

The workspace currently uses the sibling SpineCodex checkout through the path
recorded in `core-source.json`. CI and release automation must resolve that same
package from the exact recorded revision. A future ownership migration may move
the canonical crate here only if SpineCodex is changed atomically to depend on
the new location.

After generating a Node-targeted `spine_wasm.js` with the exact locked
`wasm-bindgen-cli` version, verify native/WASM equivalence with:

```bash
npm run test:wasm-golden -- /absolute/path/to/spine_wasm.js
```
