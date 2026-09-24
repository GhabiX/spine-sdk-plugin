# Tool metadata

Plugins may include `parameters` (a JSON Schema object) alongside a tool's
`description` and `execute`. `SpinePluginHost.describeTool(name)` returns the
description and a cloned parameters object, without exposing the execute callback.
Unknown or disposed tools throw `SpinePluginHostError` with code `unknown-tool`.

The plugin owns its schema and behavior. Host passes metadata through and does
not validate tool arguments. The caller may validate before `executeTool`;
the tool must still check its runtime constraints. Parameters are optional for
existing plugins. The project Pi composition uses an unconstrained object only
for tools that omit them, and always preserves the plugin's description.

## Typed effects and post-commit sinks

The Host also exposes the minimal SpineTree Platform effect boundary:

```ts
context.effects.registerCommitter(owner, commit)
context.effects.registerPostCommitSink(sink)
context.effects.submit(effect)
context.effects.publishCommitted(record)
```

A plugin may register a committer only for an owner claim in its manifest. The
committer owns validation, semantic reduction, durable commit and idempotency;
the Host only validates the typed boundary and routes the effect. A committed
result contains a versioned `CommitReceipt` and complete post-commit record.
Matching sinks receive that record with a stable delivery ID. An owner plugin
may also call `publishCommitted` after its canonical commit has already been
completed; Host checks that the caller manifest owns the receipt target and
never performs a second commit. The published record is cloned and frozen
before sink delivery.

Sink delivery is deliberately not a distributed transaction. A sink failure
does not roll back the owner commit; the Host reports the committed receipt so
the caller can persist it in an outbox and perform retry/reconciliation. The
Host does not provide durable cross-store storage or exactly-once execution,
and it never creates a second canonical Spine reducer.
