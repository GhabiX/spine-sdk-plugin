from pathlib import Path
from datetime import datetime, timezone
import ast
import hashlib
import json
import subprocess

task = Path(__file__).resolve().parents[1]
ev = task / 'evidence/structure'
out = ev / 'offline'
r = json.loads((out / 'result.json').read_text())
assert r['passed'] and r['samplings'] == 22 and r['toolPairs'] == 21
assert r['expectedToolErrors'] == 3 and r['expectedRevisionConflicts'] == 1
assert r['allAgentsEnded'] and r['branchCount'] == 5
snapshots = {s['label']: s['state'] for s in json.loads((out / 'snapshots.json').read_text())}
target = r['branches']['detail']
initial = snapshots['before-move']['branches'][target]
final = snapshots['continued-after-archive']['branches'][target]
assert initial['parent'] == r['branches']['groupA']
assert final['parent'] == r['branches']['groupB'] and final['status'] == 'archived'
for key in ['id', 'goal', 'memory', 'memoryVersion', 'memorySource', 'scopeBinding', 'skills', 'tools']:
    assert initial[key] == final[key], key
assert final == snapshots['archived-before-continuation']['branches'][target]
report = ev / 'offline-report.md'
report.write_text('''# Moving and archiving completed branches: offline result

Passed with actual frozen Pi, SDK 7b2a0fd, WASM, Git store and a scripted provider. No network or model requests were made.

22 samplings and 21 tool results established two completed groups and a nested completed detail. The detail moved from the first group to the second, was archived, remained readable, and subsequent Open/Close sampling completed. Five persistent Branch records remain. The detail retains its UUID, goal, memory v1, source, original canonical scope binding and resources. Only project parent, status and associated revisions change. The original Agent home and lease remain fixed; the Agent ended after disposal.

Three deliberate tool exceptions reject a cycle, moving live work and archiving live work. A separate old-revision update returns applied:false. These expected failures are asserted individually; they are not successful mutations. Archive does not remove a node or crop canonical context. Move does not rewrite historical canonical ownership. Neither operation merges two UUIDs.

[Result](offline/result.json), [snapshots](offline/snapshots.json), [offers and operations](offline/samples.json), [fixture](../../structure/offline.mjs). This proves the runtime path and rejection boundaries, not real Agent adoption; the live experiment follows.
''')
paths = [Path(__file__).resolve(), task/'structure/offline.mjs', out/'result.json', out/'snapshots.json', out/'samples.json', Path(r['session']), ev/'offline-command.log', ev/'runtime-manifest.json', ev/'preparation-validation.json', report]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
subprocess.run(['node', '--check', str(task/'structure/offline.mjs')], check=True)
subprocess.run(['git', 'diff', '--check'], cwd=task.parents[1], check=True)
ast.parse(Path(__file__).read_text())
for p in [report, task/'structure/offline.mjs', Path(__file__).resolve()]:
    assert all(line.rstrip() == line for line in p.read_text().splitlines()), str(p)
validation = {'passed': True, 'createdAt': datetime.now(timezone.utc).isoformat(), 'externalModelRequests': 0, 'samplings': 22, 'toolPairs': 21, 'expectedToolErrors': 3, 'expectedRevisionConflicts': 1, 'archivedDetailUnchangedAfterContinuation': True, 'allAgentsEnded': True, 'references': [{'path': str(p), 'sha256': sha(p)} for p in paths]}
(ev/'offline-validation.json').write_text(json.dumps(validation, indent=2)+'\n')
with (task/'worklog.md').open('a') as f:
    f.write('\n06 structure offline passed: 22 samplings/21 tools, completed detail moved and archived, later sampling completed without changing its retained evidence; cycle/live move/live archive and stale revision rejected. Frozen runtime unchanged; real Agent still pending.\n')
print(json.dumps({'passed': True, 'references': len(paths), 'report': str(report)}))
