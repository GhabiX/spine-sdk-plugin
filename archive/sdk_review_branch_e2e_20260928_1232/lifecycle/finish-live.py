from pathlib import Path
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import yaml

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/lifecycle'
run = Path('/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/lifecycle-spinetree-grok-20260928_1317')
audit = json.loads((out / 'trace-audit.json').read_text())
assert audit['passed'] and len(audit['errors']) == 1
assert json.loads((out / 'candidate-check.json').read_text())['passed']
assert json.loads((out / 'array-boundary-check.json').read_text())['passed']
old = (run / 'manifest.yaml').read_bytes()
(out / 'testbed-manifest-before-finish.yaml').write_bytes(old)
manifest = yaml.safe_load(old)
manifest.update(status='stopped', started_at='2026-09-28T05:26:02.807Z', ended_at='2026-09-28T05:41:16.614Z', pid=3615373, command=f'node {task}/lifecycle/dialogue.mjs {run}', official_score=None, official_benchmark=False, spawn_count=0, mailbox_used=False, mechanism_verified=True, autonomous_usability='mixed; retrospective factual correction and final close reminder required')
(run / 'manifest.yaml').write_text(yaml.safe_dump(manifest,sort_keys=False,allow_unicode=True))
with (run / 'worklog.md').open('a') as stream:
    stream.write('\nLifecycle task and interactive retrospective completed. Same session; one upstream stream interruption preserved and continued. 18 canonical samples, 26 paired tools, Open3/Next1/Close3, 114 independent functional checks passed. Retrospective initially misreported historical calls and later required a Close reminder. Original candidate unchanged after first turn. Host records: '+str(out)+'/trace-audit.json and usability-review.json. Process disposed; no background model work.\n')
index = run.parent / 'index.tsv'
with index.open('r+') as stream:
    fcntl.flock(stream,fcntl.LOCK_EX)
    before = stream.read()
    (out / 'testbed-index-before-finish.tsv').write_text(before)
    rows = before.splitlines()
    selected = [i for i,row in enumerate(rows) if run.name in row]
    assert len(selected) == 1
    fields = rows[selected[0]].split('\t')
    assert len(fields) == 9
    fields[4] = 'stopped'; fields[7] = '0'
    fields[8] = 'lifecycle mechanism passed; interactive usability mixed; SDK 68fa324; non-benchmark'
    rows[selected[0]] = '\t'.join(fields)
    stream.seek(0); stream.write('\n'.join(rows)+'\n'); stream.truncate()
paths = [out/'trace-audit.json',out/'candidate-check.json',out/'array-boundary-check.json',out/'memory-correction.json',out/'interview-facts.json',out/'usability-review.json',run/'manifest.yaml',run/'worklog.md',run/'reconcile.mjs',run/'test-reconcile.mjs',run/'result.json',run/'turn-2-error.json',run/'launch.log']
hashes = {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
hashes.update(audit['hashes'])
result = {'completedAt':datetime.now(timezone.utc).isoformat(),'mechanismPassed':True,'functionalChecks':114,'autonomousUsabilityPassed':False,'outcome':'lifecycle mechanics passed; usable with factual guidance; follow-up usability improvements remain','processEnded':True,'sameSession':True,'providerFailures':audit['errors'],'hashes':hashes,'taskBranchUnresolved':['retrospective claims inferred from missing history','omitted Close after completed retrospective'],'followup':'Carry these into skill/tool usability and final composition acceptance; do not treat them as verified fixes.'}
(out/'live-result.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'completed':True,'mechanismPassed':True,'autonomousUsabilityPassed':False,'hashes':len(hashes)}))
