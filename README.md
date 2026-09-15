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
- `packages/plugin`: `@spinejit/spine-plugin`, shared controller plus `./pi`
  and `./deepseek-harness` entrypoints.
- `fixtures/conformance`: host-neutral semantic traces.
- `tests`: native/WASM, recovery, and cross-host equivalence gates.

Pi and DeepSeek Harness history identifiers are transport metadata. They never
become Spine scope parents. Host adapters map typed evidence, persistence,
context publication, lifecycle, and child execution; they do not reduce Spine
state.

## Pi extension

`@spinejit/spine-plugin` declares its loadable entry in `pi.extensions`; the
same entry is available explicitly as `@spinejit/spine-plugin/pi/extension`.
It registers the four canonical tools, `/spine-status`, and `/spine-tree`, and
uses `@spinejit/spine-sdk/node` for the packaged WASM runtime.
Before each agent run, the extension's `before_agent_start` hook extends Pi's
assembled system prompt through the runtime's configured `SpineConfig`. This
keeps the canonical Spine instruction in `spine-core`; the Pi adapter does not
copy prompt text or rely on tool descriptions as a substitute for it.
In interactive Pi TUI mode it also renders the current projection as a small
`aboveEditor` widget keyed by `spine-tree`; the widget is refreshed after
session recovery, committed turns, compaction, and context preparation. JSON,
print, and RPC modes keep the existing command/notification behavior.

The Pi deployment profile must load Spine as the final and exclusive context
reducer and the exclusive compaction owner. The extension intercepts
`session_before_compact`, asks Pi's model registry for the summary, persists a
typed compact barrier and replacement messages, then publishes the new
projection before allowing Pi to append its acknowledgement entry. A native
compaction entry is accepted during recovery only when paired with the durable
Spine compact entry and marked `fromHook`; an unpaired or non-hook native
compaction fails closed. Overflow retry removes only the final retryable
`error`/`length` assistant from replacement context. If Pi aborts compaction
after Spine has completed, the extension faults and aborts the live session.
Assistant responses with `stopReason: "deferred"` are rejected because the
sampling contract only admits completed, failed, or cancelled terminals.
Committed input-token accounting records `input + cacheRead + cacheWrite` when
Pi provides safe non-negative values for all three components.
Session-start and session-tree recovery is generation guarded: a stale async
replay is disposed instead of replacing the runtime selected by the latest
session transition, and a new tree transition clears a prior lifecycle fault.

Spawn children return exactly one typed `spine_child_return` tool call. Pi can
replay a fully committed Spawn and verifies its durable per-child staging. If
Pi crashes after staging child terminal memory but before persisting the parent
tool result and turn commit, the extension fails closed on restart: Pi 0.84.2
does not expose a recovery-time native tool-result finalization API.

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
