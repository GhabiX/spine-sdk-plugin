# Pi SDK plugin review

Review scope: pending `packages/plugin` diff against `d631cc982f556fbc23c20ee133af928988b6e984`, including the new package-entry test and README. Read-only source/event-order review; no build, test, provider request, package load, or runtime probe was performed in this branch. Installed Pi dependency is 0.87.1. Production/source/test files were not changed.

## Finding requiring parent verification

**P2 — Persisted-tail reconciliation covers user steering but misses custom steering/follow-up.**

Location: [extension.ts](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/extension.ts:510) and [lifecycle.ts](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/lifecycle.ts:123).

Pi supports custom messages in its steering and follow-up queues. The added `message_end` path admits silent durable additions only when the incoming role is `user`. A queued custom message is an ordinary `role=custom` message and takes the unchecked path.

Minimal source-traced trigger:

1. During a running turn, an extension sends a context-only custom message A (`triggerTurn:false`) and separately queues a custom steering/follow-up message B. Keep context below the compaction threshold.
2. At turn end, Pi persists A without calling extension `message_end` handlers. Thus its durable branch has A at the next boundary n, while Spine still expects boundary n.
3. Agent-core starts the next turn by emitting B's `message_end` before request/context preparation. The Pi plugin observes B at n without first observing A, since B is not `user`.
4. After B is persisted at n+1, the new `context` reconciliation skips persisted A at n as already observed and observes B again at n+1. Canonical source characters are therefore [..., B, B], while durable replay builds [..., A, B]. Entry-ID projection can display A and B and hide the source-character mismatch.
5. A later sampling receipt/source digest is based on the live order. Reload/fork must replay the durable order, so live/recovered source identity consistency is no longer guaranteed. The exact runtime rejection is **not dynamically reproduced in this branch**; the event and boundary mismatch follows directly from the inspected implementation.

Primary event-order evidence:

- [Pi custom steer/follow-up and silent persistence](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1494): custom steering uses `agent.steer`/`agent.followUp`; context-only messages queue while running and `_appendCustomMessage` emits public events only.
- [Pi message_end ordering](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:579): extension notification precedes durable append; [silent tail flush](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:618) occurs after turn-end dispatch.
- [Agent-core next turn](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:115): pending messages are emitted before `prepareRequest`; [queue polling](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:180) follows turn end.
- [Pi below-threshold next-turn preparation](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:297) only rebuilds the host projection; it does not call the Spine context handler. The normal context hook occurs later via `transformContext`.
- [boundary-based tail skip](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/lifecycle.ts:125) and [replay source order](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/recovery.ts:143) establish the divergent n/n+1 assignments.

Classification: this is an incomplete edge of the newly introduced persisted-tail repair, **not evidence that the previously unsupported silent-message scenario worked at HEAD**. HEAD observed only live messages and already lacked durable-tail support. The new user-only repair and count-based reconciliation add a path that appears to support silent messages but still misbinds this legal delivery combination.

Recommended parent gate: extend the behavioral test at [pi-extension.test.mjs](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/test/pi-extension.test.mjs:215) with silent A → custom steer B → sampling commit → canonical recovery, verifying source characters/source IDs as well as displayed messages. Reconcile before custom start-of-turn messages as well as user messages. Do not blindly replay before every assistant/tool event: Spawn can have legitimate uncommitted staging before turn end, which `buildPiReplayPlan` rejects until its matching commit.

## Other reviewed changes

- Empty node is a prompt-body change. [spine.toml](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/spine.toml:28) keeps the global policy and tool descriptions; [messages.ts](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/messages.ts:253) still emits id/summary/status and supports nonempty override bodies. I found no metadata/lifecycle removal in this diff. Whether agents understand the shorter policy remains an end-to-end observation, not a source-level correctness claim.
- One activation reads one TOML snapshot and shares it between the default runtime and tool catalog ([activation](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/extension.ts:190), [catalog](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/extension.ts:401)). Custom runtime factories are explicitly documented as responsible for their own config. Defaults still register Open/Close/Next/Spawn; child mode adds typed return.
- Package manifest now selects `dist/pi/extension.js`, which matches the `files` allowlist. The new package-entry test checks the actual npm packlist and real Pi extension loader against the complete runtime tool catalog. Its execution and source/dist freshness are owned by the parent; this review does not mark them passed.
- The compaction-owner handshake runs before tool/hook registration. Pi's event-bus handler invokes synchronous ownership assignment before its first await; runtime invalidation unsubscribes the listener. The sibling `pi-compact-fallback` uses the same channel and rejects a prior owner. No conflict-handshake defect was found. No repository plugin test directly covers both load orders plus reactivation; this is a behavioral test gap, not a confirmed failure.
- The `PublishedContext` change does not freeze the initial plan: `replaceContext` updates the same object with `Object.assign` ([publication](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/plugin/src/pi/extension.ts:934)), which the new request-time materializer closes over. Thus context edits can render without creating a canonical commit.
- New compaction checks compare the branch tail before the irreversible barrier; tests cover a durable message arriving during summary. The existing post-barrier failure latch remains. Shutdown now aborts before disposing the runtime; its new test proves only the direct abort/dispose order, not every interleaving with a real reload.
- Added fault diagnostics retain the original fault, stage, bounded error chain and transaction metadata, and abort even when diagnostic persistence fails. No new provider-payload archival code was added.
- Related controller/host-adapter/message test changes migrate the context recipe to v2 and remove `memory_slots`; no unrelated behavioral deletion was found. The invocation test now verifies the positive inherited loader path rather than assuming recent Node cannot run a bare TypeScript entry.

## Verification boundary and peer coordination

`git diff --check -- packages/plugin` returned exit 0. Source hashes below bind this review. No tests/builds were run, so this is not a runtime approval. Parent should reproduce/fix the custom-steering case before treating the new durable-tail feature as complete; parent owns all fixes, tests, builds, and commit decisions.

At the first peer read, SDK peer reported the separate core/WASM provenance mismatch (old core-source pin versus dirty local core); this was treated as a peer-owned finding and not independently re-audited here. Final peer-read result is appended below when this review is sealed.

## Source identities

```text
6acda82fdc44df138ea0175d1e1e296560106964062784b4ef365c226baaf68b  packages/plugin/package.json
c9041235c01258d922f701aac1d4e43f716fb2a1cbd646bdcec26ddd1a835ca6  packages/plugin/spine.toml
027ffb6e64605f03f0d1230e704a8d35dc6ddbcbfaa4330a7dac8ef7a7f81da7  packages/plugin/README.md
d12641a50f99fd812dcd2ab451c3d416f9e2139a12144dea3dc4509eb52c9847  packages/plugin/src/pi/extension.ts
a8ab285e27b0accd8bb490b7cf1cd0f0586946054fc0e451e882ff05c418b722  packages/plugin/src/pi/lifecycle.ts
c0e81dc2b8284155f856650b61573f8557a1c1a02b6de3a067c693d4f3c16167  packages/plugin/src/pi/messages.ts
ea261dfabde5426b08300853bcf9755eee3344462ef049c4e8295206dca268a6  packages/plugin/src/pi/recovery.ts
056db7cd5bb9a0e14908ea1f518eb45bca02807b22c2ce21d5a173bc5c0d3396  packages/plugin/test/pi-extension.test.mjs
abb8b8a51f70d1cf8861e15b45a874a267449ecc6d9626768dd1d442f47a286c  packages/plugin/test/pi-lifecycle.test.mjs
81fcea4caa1b59255a45f30c52046b5c38d6c6c49e3d1d9eb39eeb57b24bbf17  packages/plugin/test/pi-messages.test.mjs
293b1907885891e9c18127e9587f5da8776d5b73eaffcab1c517b97d79e868e8  packages/plugin/test/pi-package-entry.test.mjs
627631b613ba4ca29eba8df793f5280fd20b19f01d73826e9ffda14c15def5dc  node_modules/@earendil-works/pi-coding-agent/package.json
5ebfae51db5a900596145159428e7cb57d195af9d54a28f41d4ac8ff1bfd5729  node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js
75da7290cd348c070328de834a810503d00fd5ff1ea2cc204786fb498bd046df  node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js
81106b07522aaf9197858c4679fecd7fbd23c346376d6e1f2cc3dd5294d543f4  node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js
67c7ca2d24197ff46cb5f0a49d7c19a76825ab7c66bc942015a484b550396441  node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js
```

Final peer read: read `blackboard/review/sdk.md` and `blackboard/review/spinetree.md` immediately before sealing. Incorporated only their ownership boundaries: SDK peer now confirms P1 reproducible core/WASM provenance concern; SpineTree peer reports a separate P2 stale-lease cleanup path plus preexisting archive/import limitation. These are not Pi review findings or independent proof here. Neither report was needed to reach the custom-steering result.
