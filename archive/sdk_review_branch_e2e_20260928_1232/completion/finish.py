"""Produce the final coverage matrix and gate without rerunning products/models."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
out = task / 'evidence/completion'
out.mkdir(parents=True, exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text())
stamp = datetime.now(timezone.utc).isoformat()

stages = ['lifecycle', 'memory', 'resources', 'structure', 'collaboration', 'composition']
stage_rows = []
source_hashes = {}
for name in stages:
    gate = read(task / 'evidence' / name / 'stage-completion.json')
    result = read(task / 'evidence' / name / 'live-result.json')
    assert gate['passed'] and gate['mechanismPassed']
    assert gate.get('realAgentWorkflowPassed', True)
    validation = read(task / 'evidence' / name / 'live-validation.json')
    assert validation['passed']
    assert validation['reportSha256'] == sha(task / 'evidence' / name / 'live-report.md')
    if 'resultSha256' in validation:
        assert validation['resultSha256'] == sha(task / 'evidence' / name / 'live-result.json')
    for path, digest in gate['sourceHashes'].items():
        assert sha(Path(path)) == digest, path
        source_hashes[path] = digest
    for filename in ['stage-completion.json', 'live-result.json', 'live-report.md', 'live-validation.json']:
        p = task / 'evidence' / name / filename
        source_hashes[str(p)] = sha(p)
    stage_rows.append({
        'stage': name,
        'gatePassed': gate['passed'],
        'mechanismPassed': gate['mechanismPassed'],
        'realAgentWorkflowPassed': gate.get('realAgentWorkflowPassed'),
        'observedUsabilityPassed': result.get('observedUsabilityPassed'),
        'autonomousUsabilityPassed': gate.get('autonomousUsabilityPassed', result.get('autonomousUsabilityPassed')),
        'generalUsabilityEstablished': gate.get('generalUsabilityEstablished', result.get('generalUsabilityEstablished')),
        'stageEvidence': str(task / 'evidence' / name / 'stage-completion.json'),
    })

matrix = [
    {'area': 'review-and-source', 'covered': True, 'evidence': ['review-sdk.md', 'review-pi.md', 'review-spinetree.md', 'core-provenance/report.md'], 'result': 'P1 source provenance, P2 custom steering order and P2 stale lease were fixed and verified; archive mapping and Git ref-lock fixes are committed.', 'limits': ['WASM provenance is reconstructible from the versioned patch and hash; cross-toolchain bit-for-bit rebuild is not claimed.']},
    {'area': 'lifecycle', 'covered': True, 'evidence': ['lifecycle/live-report.md', 'lifecycle/reload-diagnosis.json'], 'result': 'Empty-node metadata, reload stability and Open/Next/Close lifecycle passed offline and in a real Pi session.', 'limits': ['The real interview needed a Close reminder after retrospective; autonomous usability remains false.']},
    {'area': 'memory-and-reexecution', 'covered': True, 'evidence': ['memory/live-report.md', 'memory/read-contract'], 'result': 'Same Branch v1→v2, source preservation and recipient/parent reexecution checks passed; current binding and historical allocation are documented separately.', 'limits': ['The child did not directly read the old memory in this stage; historical allocation status is display data, not an active owner.']},
    {'area': 'resources', 'covered': True, 'evidence': ['resources/live-report.md', 'resources/offline-report.md'], 'result': 'Publish, version rejection, revision update, local override and sibling consumption passed with independent host checks.', 'limits': ['Skill association is not causal proof; one same-sampling offer was pre-transition, so later sibling evidence carries the new-version consumption claim.']},
    {'area': 'structure', 'covered': True, 'evidence': ['structure/live-report.md', 'structure/offline-report.md'], 'result': 'Move, cycle/live/archive rejection, archived historical mapping and post-archive continuation passed; memory/source/canonical mapping remained intact.', 'limits': ['Archive is not merge, deletion or canonical-context pruning.']},
    {'area': 'collaboration', 'covered': True, 'evidence': ['collaboration/live-report.md', 'collaboration/ownership-review.md'], 'result': 'Two child assignments, typed returns, parent checks, same-Branch feedback, observed mailbox and v1→v2 update passed.', 'limits': ['Root-only substantive review and a prompted correction keep autonomous usability false; overlapping child sessions do not prove speedup.']},
    {'area': 'composition', 'covered': True, 'evidence': ['composition/live-report.md', 'composition/trajectory-review.md'], 'result': 'Combined resources, memory/reexecution, structure, Spawn and parent acceptance passed; signed candidate checks passed.', 'limits': ['Two premature finals, an incompatible Next+Spawn attempt, failed direct checker probes, an unrepaired note assertion and inaccurate final readback remain recorded.']},
]
matrix.append({'area': 'split-integrate-versus-merge-prune', 'covered': 'partial',
               'evidence': ['structure/live-report.md', 'composition/trajectory-review.md'],
               'result': 'Obligations were split with Open/Spawn and integrated by parent acceptance; project parent move and archive were exercised.',
               'limits': ['No UUID merge, destructive subtree split, canonical prune or arbitrary concurrent bus was implemented or claimed. These are explicit coverage limits, not passing experiments.']})
for row in matrix:
    for rel in row['evidence']:
        candidates = [task / 'evidence' / rel, task / 'evidence' / rel.split('/')[0] / rel.split('/', 1)[1]] if '/' in rel else [task / 'evidence' / rel]
        if not any(p.exists() for p in candidates):
            # Some entries name a directory or a report in a stage; locate it deterministically.
            found = list((task / 'evidence').glob('**/' + Path(rel).name))
            assert found, rel

commit_rows = []
for commit, purpose in [
    ('68fa324ad0b409bc2fff083be897186e8aca850a', 'reviewed v2 SDK/Pi/SpineTree implementation and provenance'),
    ('ac887e6', 'document current binding versus historical allocation'),
    ('7b2a0fdc292badcf1029a426c7bb6d22a593cb48', 'retain archived terminal mappings'),
    ('eeea5d68ff1231be43206c4038f43dc2154d8ddf', 'bound Git ref-lock publication'),
]:
    subprocess.run(['git', 'cat-file', '-e', commit + '^{commit}'], cwd=repo, check=True, capture_output=True)
    commit_rows.append({'commit': commit, 'purpose': purpose})

tracked_status = subprocess.run(['git', 'status', '--short', '--untracked-files=no'], cwd=repo, check=True, text=True, capture_output=True).stdout
assert tracked_status == ''
subprocess.run(['git', 'diff', '--check'], cwd=repo, check=True, capture_output=True)

include = [
    'evidence/baseline.json', 'evidence/integration/final.json', 'evidence/commit/result.json',
    'evidence/review-sdk.md', 'evidence/review-pi.md', 'evidence/review-spinetree.md',
    'evidence/core-provenance/report.md', 'evidence/core-provenance/validation.json',
    'evidence/lifecycle/live-report.md', 'evidence/lifecycle/live-result.json', 'evidence/lifecycle/stage-completion.json',
    'evidence/memory/live-report.md', 'evidence/memory/live-result.json', 'evidence/memory/stage-completion.json',
    'evidence/resources/live-report.md', 'evidence/resources/live-result.json', 'evidence/resources/stage-completion.json',
    'evidence/structure/live-report.md', 'evidence/structure/live-result.json', 'evidence/structure/stage-completion.json',
    'evidence/collaboration/live-report.md', 'evidence/collaboration/live-result.json', 'evidence/collaboration/stage-completion.json',
    'evidence/composition/live-report.md', 'evidence/composition/live-result.json', 'evidence/composition/stage-completion.json',
    'evidence/completion/coverage-matrix.json', 'evidence/completion/final-report.md', 'evidence/completion/final-validation.json',
]
exclude = [
    'runtime-* snapshots', 'project-tree-poc/temp/testbed/**', 'raw .pi-sessions and spawn JSONL',
    'packages/**/temp/null/**', 'packages/**/temp/recyclebin/**', 'credentials and provider state',
    'intermediate collector logs not referenced by a report', 'all unrelated pre-existing untracked paths',
]

validation = {
    'passed': True, 'completedAt': stamp, 'stageGatesChecked': len(stage_rows),
    'trackedWorkingTreeClean': True, 'gitDiffCheck': True, 'sourceCommitsChecked': len(commit_rows),
    'modelsOrProductTestsRerun': False, 'coverageMatrixChecked': True,
    'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
    'stageRows': stage_rows, 'commits': commit_rows,
    'includeCount': len(include), 'include': include, 'exclude': exclude,
    'sourceHashes': source_hashes,
    'sourceHashesChecked': len(source_hashes),
    'historicalRecall': 'Bounded filename and USER.md searches found no reliable original earlier enumeration; coverage is tied to the inherited current plan and primary stage evidence.',
}
(out / 'coverage-matrix.json').write_text(json.dumps({'generatedAt': stamp, 'stages': stage_rows, 'areas': matrix, 'commits': commit_rows}, indent=2, ensure_ascii=False) + '\n')

report = f'''# SDK review and PoC final report

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

No tracked production changes remain after `eeea5d68`. The coverage is listed in [coverage-matrix.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/completion/coverage-matrix.json). Raw sessions, frozen runtime copies, testbeds, package temp outputs and credentials remain local evidence inputs and are excluded from a compact source/evidence commit; exact selected paths and byte hashes will be recorded by the commit gate.

The local Pi settings still point directly at this SDK/plugin checkout. No npm publication or push was performed; existing Pi processes were not reloaded by this verification. The final task gate still requires the compact evidence commit. Remaining usability limits are not labelled as verified fixes.
'''
(out / 'final-report.md').write_text(report)
validation['reportSha256'] = sha(out / 'final-report.md')
validation['matrixSha256'] = sha(out / 'coverage-matrix.json')
(out / 'final-validation.json').write_text(json.dumps(validation, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'passed': True, 'stages': len(stage_rows), 'commits': len(commit_rows), 'trackedWorkingTreeClean': True}))
