# SpineTree tool contracts

`spinetree_read({ branch })` captures one HEAD and reads all result fields from
that immutable snapshot. In `spinetree.read.result/v2`, `binding` is the branch's
non-ended registry entry: `{ agentId, sessionId, branch, scope?, status }`.
Both running and paused Agents are discoverable; `binding` is null when none exists.
Multiple active entries return `SpineTreeReadError` with code `ambiguous-binding`
so callers do not route a message to an arbitrarily selected Agent.

Use `result.binding.agentId` as `spinetree_send.to`. AgentId and PiSessionId are
different identities. The lookup reflects the captured HEAD; send still checks
the recipient's current registry state.

This replaces v1's `{ agent, working, live }` binding. The legacy snapshot
`agents` map remains stored, but is no longer used to infer a binding. Existing
snapshots need explicit registry entries with actual Pi session identities to
expose current bindings. Read does not migrate or modify state.

Use the same snapshot store for tree reads and the persistent registry/mailbox
adapters. `GitSpineTreeAgentRegistry` also accepts `MemorySpineTreeStore` for
in-memory shared snapshots. A standalone `MemoryAgentRegistry` is independent
of a tree snapshot and is not queried by read: querying a second store would
break the fixed-HEAD guarantee.

Each tool declares its own JSON Schema and description. Host's `describeTool(name)`
returns this metadata, and the Pi composition forwards it to `registerTool`.
The five input contracts are:

| Tool | Required | Optional |
| --- | --- | --- |
| `spinetree_read` | `branch` | — |
| `spinetree_change` | `expectedHead`, non-empty `changes` | — |
| `spinetree_send` | `to`, `message` | `from`, `requestId` |
| `spinetree_observe` | `receiptId`, `agentId` | `leaseId` (required while leased) |
| `spinetree_rejuvenate` | `parent`, `branch` | `request` |

Strings must be non-empty. `change` items are `update` with `branch` and
`attributes`, `move` with `branch` and `parent`, or `archive` with `branch`.
Update attributes are limited to `goal` (string) and `constraints`, `skills`,
`tools` (arrays). The model-facing schemas reject unrecognized fields;
runtime checks still enforce state-dependent constraints such as CAS and
receipt ownership. Host does not add a schema validation layer to `executeTool`.

Without the required explicit adapters, a tool retains its input schema but its
description states that it returns `contract-only`. No implicit state is created.

## Queued messaging and observation

`spinetree_send` v2 only validates Agent addresses and enqueues. A fresh result is
`{ schema: "spinetree.send.result/v2", status: "queued", receipt, to, sessionId }`.
It never calls the session adapter or waits for the recipient. Reusing `requestId`
with the same message returns its current receipt; `status` equals `receipt.status`
(including leased or observed). A conflicting message under that key fails.
Memory adapters retain state only in process; Git adapters persist it before return.

Applications must call `dispatchSpineTreeMailbox({ registry, mailbox, sessions,
limit })` outside the sending tool stack. Each pass selects a bounded batch once;
messages enqueued during a prompt, including replies, wait for another pass.
The caller owns scheduling, fairness, timeouts and Pi connections/leases. There is
no automatic worker. The Pi adapter still awaits actual prompt completion.

Dispatcher prompt text is JSON with this exact envelope:

```json
{"schema":"spinetree.message/v1","receiptId":"mail-1","leaseId":"lease-1","to":"agent-b","from":"agent-a","message":"Please review the result"}
```

`from` is null when omitted. The message string is preserved. This envelope is
application text within Pi's existing prompt API, not a new Pi wire protocol.
The recipient uses `spinetree_observe({ receiptId, agentId: to, leaseId })` during
its prompt, then may enqueue a reply to `from` with `spinetree_send`. Observing
confirms receipt, not successful task completion or exactly-once business effects.
Agent checks establish routing consistency; they are not authentication.

State transitions are `queued -> leased -> delivered -> observed`, or
`leased -> observed` when the recipient confirms before its prompt completes.
Leased observation requires its current token. Delivered/observed allow omitted
tokens for existing callers and legacy receipts, but any supplied token must match.
Queued and failed cannot be observed. Delivered/observed retain the completing
leaseId as delivery identity, with leaseUntil cleared; it is no longer an active
lease. Same-token late success/rejection/error returns observed without a write.
A superseded token cannot observe or overwrite a newer delivery's state.

Without observation, accepted prompt completion marks delivered; rejected or
transient failures requeue; explicitly permanent errors mark failed. Busy targets
therefore leave the same receipt available for a later pass. Long prompts exceeding
the lease interval and lost acknowledgements can cause duplicate prompts: delivery
remains at least once. requestId deduplicates local enqueue, not remote execution.
Storage acknowledgement failures propagate and do not masquerade as transport errors.

Migration from send v1: schedule explicit dispatch, decode envelope text rather
than assuming plain message text, and pass its leaseId for in-prompt observation.
Custom mailbox implementations must implement these observation and late-completion
rules too; the built-in Memory/Git adapters share the transition functions.

## Explicit canonical Scope mapping

`commitSpineTreeScopes({ store, agentId, sessionId, transactionId, record,
projection, selections })` imports an already committed canonical sampling result.
`record` is the SDK `SamplingCommit`; `projection` is its installed `SpineProjection`.
The caller retains the receipt for retry if the project write fails. This API
does not execute operations, reduce memory or register an additional model tool.

Select `{ nodeId, parent }` to allocate a new ProjectBranch UUID under an existing
parent, or `{ nodeId, branch }` to bind an existing project branch. Only Task scopes
can be selected. Unselected scopes stay local. On each subsequent commit, pass an
empty selection to refresh known mappings, or add explicit selections for new work.
The Agent must exist in the same snapshot registry and belong to this Pi session.

Each branch stores `scopeBinding: { agentId, sessionId, thread, epoch, nodeId }`.
Live/Opened scopes keep the project branch live. Closed/Compacted scopes cap it
and copy the complete canonical `MemorySlot[]` with a single `memoryVersion`
increment and `memorySource` recording the binding, transaction, commit and post
boundary. Capping does not end the Agent or assert that the project goal is complete.
Existing project attributes remain unchanged when binding an existing branch.

For a mapped live branch, read resolves its mapped Agent from the same captured
registry snapshot. The returned `binding.branch` remains the Agent's immutable
home branch; `result.branch.id` identifies the branch being read. A capped mapped
branch returns null, including while a replacement Agent is provisioned but has
not yet bound a new live scope. Exclusive registration respects mapped live
ownership. A capped Scope mapping stops reserving the branch, but an Agent whose
immutable home is that branch still reserves it until explicitly ended. Capping
does not change that Agent lifecycle rule.

All selected branches and their import watermark publish in one expected-head
CAS commit. Stale HEAD retries re-read the snapshot (at most eight attempts by
default). The same latest receipt and selection replay without a write and return
the same allocated IDs, regardless of object key order. A changed replay is rejected; within an epoch subsequent
imports must follow the canonical commit chain. Retain and retry failed receipts
in order. An older import is rejected even if its original import once succeeded.

Canonical and project commits are separate transactions. There is no distributed
rollback or recovery worker. A live mapped scope disappearing from a projection
or across an epoch is explicitly unsupported; this slice does not infer a close
or implement compaction/fork migration. Session, lease and dispatcher ownership
remain with the caller.
