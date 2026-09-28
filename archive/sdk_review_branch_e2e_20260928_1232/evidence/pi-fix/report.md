# Pi custom message order fix

The source-traced ordering problem is reproduced and fixed. Before the fix,
a silent durable custom A followed by queued custom B produced live canonical
sources `[B, B]`; durable replay restored `[A, B]`. Recovery succeeded, so this
was silent source divergence, not a demonstrated replay rejection.

`packages/plugin/src/pi/extension.ts:507` now reconciles the durable tail before
both user and custom `message_end` inputs. Pi 0.87.1 delivers queued custom steer
and follow-up messages before persistence and request/context preparation. The
change leaves assistant/tool-result observations alone, where Spawn terminal
staging can still be uncommitted. No lifecycle state machine was changed.

The regression in `packages/plugin/test/pi-extension.test.mjs:241` uses the real
packaged WASM and extension hooks in Pi's event order. It checks exact canonical
source snapshots, source IDs, projected content, a real sampling-start/commit
record, and recovery into a fresh extension. It does not make model requests or
claim a provider-backed AgentSession end-to-end result.

Validation:

- Before: plugin build passed; both source-order and committed-replay checks failed
  (`regression-before.log`, `regression-before-replay.log`).
- After: targeted regression passed all 3 counted tests (`regression-after-02.log`).
- Entire Pi plugin suite: 175 passed, 0 failed (`plugin-tests.log`). It includes
  existing Spawn, compaction, shutdown, package entry and configuration cases.
- Scoped `git diff --check -- packages/plugin`: exit 0.

The first after-fix run (`regression-after.log`) passed source-order and exact
source replay but exposed an overstrict test comparison of Pi's durable custom
entry timestamp and optional undefined fields. The test now compares projected
message meaning while retaining exact source snapshot equality. That failure
record is preserved. README now documents durable message order.

Only the assigned extension, test and README section were changed. No SDK/core
files, model requests, live sessions or commits were touched. Core provenance
and integration validation remain the parent's responsibility. `result.json`
binds source and evidence hashes.

Core peer replaced the packaged WASM during this work. The package-suite log
therefore is not an attestation that every test loaded one fixed final artifact.
The targeted regression was rerun afterward against the rebuilt WASM,
SHA-256 `71e1f4adfd43a66dbaec28116a89b1028607b04ceacb099cdfe376694b8e3acf`,
with equal before/after hashes and exit 0 (`rebuilt-wasm.json`). Parent must run
the integrated gate after all component changes settle.

Final peer read incorporated core's 48-source guard/provenance progress and
SpineTree's completed stale-owner fix/package check only as integration context.
The plugin README's separate development-source paragraph still requires the
parent's provenance update; this branch owns the appended message-order section.
