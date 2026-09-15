# Portable ABI Contract

Status: implementation contract for schema major `1`.

The JavaScript boundary is a coarse stateful runtime. Rust-only ownership types
such as `SamplingHandle` and `PreparedSamplingCommit` remain inside the binding.
Every request and response is bounded, serializable pure data carrying an
explicit schema discriminator.

The lifecycle is:

```text
restore -> sourceSnapshot / continueNamespace
observeSources -> preview -> publish
beginSampling -> persist started record
stageExecution -> finishExecution
prepareFinish -> persist commit record
install -> publish ContextPlan
compact(barrier) -> persist compact entry -> publish compacted ContextPlan
```

`prepareFinish` never installs. The host must durably persist the returned
commit record before calling `install`. A failed persistence discards
the unpersisted candidate. Replay installs the same canonical state without
replaying live-only host effects.

`compact` is idle-only. The host persists the typed barrier before issuing the
runtime command. The command advances the context epoch and returns the
replacement source plan; the host binds those core-assigned source identities
before publishing. The Pi adapter requires non-empty replacement metadata before
writing the durable entry. Compact barriers are also valid replay inputs.

`sourceSnapshot` returns the core-assigned source identities needed to bind
host messages to `ContextPlan` cells. `continueNamespace` changes physical host
session identity without changing Spine scope-tree semantics. Preview
publication is serialized by the shared controller with all other runtime
operations.

The npm package keeps the portable protocol at `@spinejit/spine-sdk` and exposes
the generated Node WASM runtime only at `@spinejit/spine-sdk/node`. The Node
artifact is generated with the exact `wasm-bindgen 0.2.127` CLI; importing the
portable root does not load Node built-ins or WASM.

The portable ABI does not expose ParseStack internals, filesystem config
loading, native tool grouping, rendered-text parsing, or host history topology.
The Node WASM wrapper additionally exposes `extendSystemPrompt(base)`, which
delegates prompt composition to the configured `SpineConfig` without exposing
the reducer or its internal state.
