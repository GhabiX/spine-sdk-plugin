from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, sys, yaml

task = Path(__file__).resolve().parents[1]
testbed = Path(sys.argv[1]).resolve()
assert testbed.parent == task.parents[1].parent / 'project-tree-poc/temp/testbed'
assert (testbed/'manifest.yaml').exists()
assert not (testbed/'.spinetree').exists()
assert not (testbed/'SPEC.md').exists()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = json.loads((task/'evidence/lifecycle/runtime-manifest.json').read_text())
for row in manifest['files']:
    path = task/'runtime'/row['path']
    if 'sha256' in row:
        assert sha(path) == row['sha256'], str(path)
    else:
        assert str(path.readlink()) == row['symlink'], str(path)
(testbed/'SPEC.md').write_text('''# Decimal input contract — initial revision

Implement `parseMinorUnits(value)` as a named export in `parser.mjs`.
Return an integer number of minor units (100 minor units = 1 unit), or `null`
for invalid inputs. Do not throw on invalid inputs.

Only strings matching `^[0-9]{1,12}(?:\\.[0-9]{1,2})?$` are accepted initially.
Leading zeroes are allowed. There is no trimming, exponent, sign or rounding.
Examples: "0" -> 0, "12" -> 1200, "12.3" -> 1230, "001.09" -> 109.
All other values, including numbers, arrays, null, spaces, "+1", "1e2",
"1.234", ".50", "12.", and a 13-digit integer part, return null.

Create `parser.test.mjs` with representative valid, invalid and boundary cases.
Run the tests and record only checked facts in branch memory. This is a small
single obligation; no Spawn or unrelated file changes are needed.
''')
(testbed/'GOAL.md').write_text('Implement and check the initial decimal input contract in SPEC.md; preserve the completed Branch and evidence for later feedback.\n')
record = yaml.safe_load((testbed/'manifest.yaml').read_text())
record.update(task='same-branch-memory-revision', model='grok-4.7', provider='cachetree', thinking='high', slots=1, frozen_pack=None, sdk_commit=manifest['sdkCommit'], runtime_manifest=str(task/'evidence/lifecycle/runtime-manifest.json'), official_score=None, verify_json=None, command=f'node {task}/memory/dialogue.mjs {testbed}')
(testbed/'manifest.yaml').write_text(yaml.safe_dump(record, sort_keys=False))
tree = yaml.safe_load((task/'tree.yml').read_text())
tree['nodes']['04-memory']['status']='in_progress'
tree['updated_at']=datetime.now(timezone.utc).isoformat()
(task/'tree.yml').write_text(yaml.safe_dump(tree, sort_keys=False))
node = task/'nodes/04-memory.md'
text=node.read_text().replace('status: ready', 'status: in_progress').replace('next: 固定同B再执行与memory v2的验收场景，先离线再真实Agent交互', 'next: 执行真实Pi无网络脚本PoC，再运行金额解析Agent并发送新输入要求验证同B memory v2')
text=text.replace('- ../evidence/baseline.json', '- ../evidence/baseline.json\n- ../evidence/memory/preparation.json')
node.write_text(text)
paths=[task/'memory/offline.mjs', task/'memory/dialogue.mjs', Path(__file__).resolve(), testbed/'SPEC.md', testbed/'GOAL.md', testbed/'manifest.yaml', task/'evidence/lifecycle/runtime-manifest.json']
result={'passed':True,'createdAt':datetime.now(timezone.utc).isoformat(),'testbed':str(testbed),'frozenFilesVerified':len(manifest['files']),'sdkCommit':manifest['sdkCommit'],'references':[{'path':str(p),'sha256':sha(p)} for p in paths],'modelRequests':0}
(task/'evidence/memory/preparation.json').write_text(json.dumps(result,indent=2)+'\n')
with (task/'worklog.md').open('a') as f:
    f.write('\n04-memory prepared: isolated decimal parser task; actual Pi scripted no-network reexecution precedes real Grok conversation. Frozen runtime verified; no source/runtime changes.\n')
print(json.dumps(result))
