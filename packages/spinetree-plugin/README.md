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
| `spinetree_observe` | `receiptId`, `agentId` | — |
| `spinetree_rejuvenate` | `parent`, `branch` | `request` |

Strings must be non-empty. `change` items are `update` with `branch` and
`attributes`, `move` with `branch` and `parent`, or `archive` with `branch`.
Update attributes are limited to `goal` (string) and `constraints`, `skills`,
`tools` (arrays). The model-facing schemas reject unrecognized fields;
runtime checks still enforce state-dependent constraints such as CAS and
receipt ownership. Host does not add a schema validation layer to `executeTool`.

Without the required explicit adapters, a tool retains its input schema but its
description states that it returns `contract-only`. No implicit state is created.
