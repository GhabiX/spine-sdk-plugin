# Moving and archiving completed branches: offline result

Passed with actual frozen Pi, SDK 7b2a0fd, WASM, Git store and a scripted provider. No network or model requests were made.

22 samplings and 21 tool results established two completed groups and a nested completed detail. The detail moved from the first group to the second, was archived, remained readable, and subsequent Open/Close sampling completed. Five persistent Branch records remain. The detail retains its UUID, goal, memory v1, source, original canonical scope binding and resources. Only project parent, status and associated revisions change. The original Agent home and lease remain fixed; the Agent ended after disposal.

Three deliberate tool exceptions reject a cycle, moving live work and archiving live work. A separate old-revision update returns applied:false. These expected failures are asserted individually; they are not successful mutations. Archive does not remove a node or crop canonical context. Move does not rewrite historical canonical ownership. Neither operation merges two UUIDs.

[Result](offline/result.json), [snapshots](offline/snapshots.json), [offers and operations](offline/samples.json), [fixture](../../structure/offline.mjs). This proves the runtime path and rejection boundaries, not real Agent adoption; the live experiment follows.
