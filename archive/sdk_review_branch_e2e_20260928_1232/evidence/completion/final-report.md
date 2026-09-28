# SDK review and PoC final report

The reviewed SDK/plugin changes are committed through `eeea5d68ff1231be43206c4038f43dc2154d8ddf`. The six PoC stages completed their verification gates. The final result is mechanism and real-agent workflow success with explicit limits on autonomous usability.

## Covered areas

| Area | Result | Boundary |
| --- | --- | --- |
| Review/source | v2 ABI, empty node, Pi ordering, stale lease, archived mapping and Git ref-lock fixes verified | Cross-toolchain bit-for-bit WASM rebuild is not claimed |
| Lifecycle | Empty-node lifecycle and reload checks passed | Retrospective required a Close reminder |
| Memory/reexecution | v1→v2 source preservation and status contract passed | Child direct old-memory use was not demonstrated in this stage |
| Resources | Publication, revision, local override and sibling consumption passed | Skill causality is unproved; one offer was pre-transition |
| Structure | Move/archive then new work and historical mapping passed | No reopening archived UUID, merge, deletion or canonical pruning claim |
| Collaboration | Spawn, typed returns, parent checks, feedback and mailbox passed | Root review and prompted correction keep autonomous usability false |
| Composition | Combined workflow, signed candidate and final acceptance passed | Two premature finals and final readback inaccuracies remain |

## Verification anchors

- Initial integration: `npm run check`, `npm run build`, `npm test` passed with 372 tests; WASM golden and source guard passed. The first golden invocation omitted its module path and is retained as a command failure, followed by the explicit-path pass.
- SDK/WASM identity: commit `eeea5d68`, WASM SHA `71e1f4adfd43a66dbaec28116a89b1028607b04ceacb099cdfe376694b8e3acf`.
- Composition runtime: 16,564 entries checked, 92 package blobs matched the SDK commit, signed candidate checks covered 141 inputs, 7 batches, 6 non-array cases and 1 CLI case.
- The final real composition run used Grok 4.7 high across 6 sessions, 86 samples/receipts and 160 tool pairs. Six owners ended and the testbed was registered stopped.

## Unresolved usability and semantic limits

- Lifecycle and memory interviews needed a final Close reminder. Collaboration performed substantive review at root and needed a prompt to use a review branch; composition stopped early twice before later continuation completed the task.
- Composition preserved one note-format assertion failure, three failed direct checker invocations caused by the wrong argv convention, one rejected Next+Spawn combination, and inaccurate final claims about reads and parent reruns. These are evidence-quality/usability findings, not silently converted into passes.
- The experiments do not establish general autonomous usability, skill causality, speedup from overlapping child sessions, an arbitrary communication bus, or an official benchmark score.
- Archive retains historical mapping and memory; it does not demonstrate merge, deletion or canonical context pruning. Runtime integrity checks are file/hash checks, not system-call audits. The runtime source manifest's historical root name is explicitly rebased by the composition runtime review.

## Submission boundary

No tracked production changes remain after `eeea5d68`. The coverage is listed in [coverage-matrix.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/completion/coverage-matrix.json). Raw sessions, frozen runtime copies, testbeds, package temp outputs and credentials remain local evidence inputs and are excluded from a compact source/evidence commit; exact selected paths and byte hashes are in evidence/completion/final-slice.json (the manifest itself is verified through Git).

The local Pi settings still point directly at this SDK/plugin checkout. No npm publication or push was performed; existing Pi processes were not reloaded by this verification. The compact evidence slice is committed with `docs: record SDK review and six staged SpineTree PoCs`; the post-commit receipt stays local at evidence/completion/commit-receipt.json to avoid a self-referential commit hash. The task directory is archived and its old path remains a relative symlink. Remaining usability limits are not labelled as verified fixes.
