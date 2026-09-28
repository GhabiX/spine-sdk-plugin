# Integrated review

The original 43-file pending change was reviewed as SDK/WASM, Pi lifecycle, and SpineTree ownership changes. Component findings and pre-fix failure evidence are preserved in the adjacent review and fix reports.

- Source provenance: the old core pin did not reconstruct ABI/recipe v2. The fixed declaration records the base commit, exact patch, and 48 input hashes; rebuilt WASM is bound by provenance/node-wasm-build.json. The sibling Codex repository is unchanged.
- Pi custom steering: silent A followed by queued custom B produced live [B,B] and recovered [A,B]. Reconciliation now precedes user/custom events; assistant/tool events remain on the sampling path. The regression compares canonical source cells and committed recovery.
- Reexecution cleanup: stale ready failure could end a replacement lease. Cleanup now checks both registry and execution ownership inside CAS before releasing the allocation; replacement snapshots remain unchanged.

The plugin README now describes the actual revision-plus-patch source. Final package checks and tests run against one stable rebuilt WASM; exact commands/results are in result.json. candidate-files.json fixes the production commit scope; this report is not itself the test-pass claim.

Known capability boundary retained for the structure PoC: archive of a currently mapped capped Branch can invalidate later canonical import. This is a pre-existing restriction and is not covered by the successful lifecycle tests. Agent discovery, resource evolution, same-Branch memory revision, structural use, and real multi-Agent coordination still require the planned PoC/end-to-end stages.
