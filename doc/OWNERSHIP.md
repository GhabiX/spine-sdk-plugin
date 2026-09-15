# Ownership Boundary

## Shared product

The WASM runtime owns identity allocation, typed fact admission, ordering,
reduction, archive validation, replay, namespace continuation, and canonical
context plans. The shared controller owns the persist-before-install protocol,
fault latch, schema checks, and recovery orchestration.

## Host adapters

Each adapter owns only typed host-event mapping, source-message transport,
durable append and flush, ContextPlan materialization, lifecycle wiring, UI,
context and compaction exclusivity, cancellation, and child execution policy.

Pi's history tree and DeepSeek Harness's session lineage remain distinct from
the Spine scope tree. Neither adapter may infer Spine facts from rendered text,
tool prose, UI state, or native tool grouping.

Pi owns native `AgentMessage` transport outside the semantic core and binds it
to core-assigned `SourceCellId` values. The extension is the final context
publisher and intercepts native compaction. It persists a Spine compact barrier
and replacement messages, publishes the replacement context, and accepts the
following Pi compaction entry only as an acknowledgement of that barrier.
Recovery additionally requires that adjacent native entry to carry Pi's
`fromHook: true` ownership marker. The before-hook abort signal faults the live
session if Pi aborts after the Spine transaction has already completed.

Two recovery capabilities are intentionally not simulated:

- an uncommitted durable Spawn terminal batch requires a Pi API that can
  restore/finalize the native parent tool result after restart.

Both cases fail closed. They are host integration gates, not alternate semantic
paths.

DeepSeek Harness provides runtime registration of required versioned extension
events and the atomic durable zero-to-many-message `surface/projection` seam.
The concrete adapter registers only `spine/archive` and
`spine/spawn-terminal`; projection remains a core event. Every append is
followed by the store-owned flush barrier, and absence of a durability listener
is a hard capability failure.

DSH has no generic ownership registry for context reducers and compaction. The
deployment composition therefore owns that proof: before controller creation
it must disable or reject competing context/compaction plugins through the
adapter's ownership callback. This callback is capability enforcement, not a
semantic reducer.

The loadable DSH extension enforces the available half of that proof itself:
it rejects an already-composed compaction provider, rechecks ownership while
recovering every session, and fault-latches any observed `compaction/*` event.
It maps only typed DSH session and lifecycle events. Successful `step/end` is a
pending boundary, not an immediate commit; PostSampling runs at the awaited
next `agent/pre-step` or `agent/turn-stopping`, so an exceptional request or
turn boundary can still select the correct failed/cancelled terminal.
