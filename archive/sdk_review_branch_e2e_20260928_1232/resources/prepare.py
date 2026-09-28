from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil, subprocess, yaml

task = Path(__file__).resolve().parents[1]
sdk, runtime = task.parents[1], task / 'runtime-resources'
poc = sdk.parent / 'project-tree-poc'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert not runtime.exists()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=sdk, text=True).strip()
assert commit.startswith('ac887e6')
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=sdk, text=True)
subprocess.run(['cp', '-a', '--reflink=auto', str(task/'runtime'), str(runtime)], check=True)
# New runtime: retain the reviewed PoC adapter and dependencies, replace all
# current SDK package inputs/artifacts. The earlier frozen runtime stays intact.
for package in (sdk/'packages').iterdir():
    if not package.is_dir(): continue
    for name in ['src', 'dist', 'test', 'wasm', 'package.json', 'spine.toml', 'README.md']:
        source, dest = package/name, runtime/'sdk/packages'/package.name/name
        if source.is_dir(): shutil.copytree(source, dest, dirs_exist_ok=True, symlinks=True)
        elif source.is_file(): shutil.copy2(source, dest)
files=[]
for p in sorted(runtime.rglob('*')):
    if p.is_symlink():
        assert p.resolve().is_relative_to(runtime)
        files.append({'path':str(p.relative_to(runtime)), 'symlink':str(p.readlink())})
    elif p.is_file(): files.append({'path':str(p.relative_to(runtime)), 'sha256':sha(p), 'bytes':p.stat().st_size})
old = json.loads((task/'evidence/lifecycle/runtime-manifest.json').read_text())
previous={r['path']:r for r in old['files']}
changed=[r['path'] for r in files if previous.get(r['path']) != r]
assert all(p.startswith('sdk/packages/spinetree-plugin/') for p in changed), changed
manifest={'sdkCommit':commit,'createdAt':datetime.now(timezone.utc).isoformat(), 'files':files, 'changesSinceLifecycle':changed, 'previousManifestSha256':sha(task/'evidence/lifecycle/runtime-manifest.json')}
(task/'evidence/resources/runtime-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
rel=subprocess.check_output(['bash','/data/swe/FramePilot/cachetree/.codex/skills/run-project-tree-poc/scripts/new_testbed.sh','resources-spinetree-grok'],cwd=poc,text=True).strip()
run=poc/rel
(run/'SPEC.md').write_text('''# Reusable money-batch check

Several future obligations need the same amount aggregation. Implement a
self-contained Node script that reads JSON from process.argv[1]. Input is
{"amounts":[...]} with at most 100 elements. Return JSON
{"totalMinor":integer,"invalid":[zero-based indices]}.

Initially, an amount is accepted only if it is a string matching
^[0-9]{1,9}(?:\\.[0-9]{1,2})?$. Add its exact value in cents; reject all other
elements and report their indices. Do not trim or round. Example:
["1.20","2","bad"] => totalMinor 320, invalid [2].
Input is guaranteed to be an object with an amounts array of at most 100 items.

Test valid amounts, nonstrings, malformed amounts and limits. After checks,
make this capability available through the Branch resource system, with a
clear reusable checking skill as well as an executable tool, owned by root so
later obligations can inherit them. Use the supplied resource guidance and
actual tool contracts. Preserve each published script revision in its own file.
Use the published tool on another batch in a later inline obligation, and
check the result there. Save exact versions and checked limitations in memory.
Publication itself does not certify your checks. Do not create Agents.
''')
(run/'GOAL.md').write_text('Create, check, publish and actually reuse a money aggregation tool and its checking method.\n')
info=yaml.safe_load((run/'manifest.yaml').read_text())
info.update(task='branch-resource-version-consumption',model='grok-4.7',provider='cachetree',thinking='high',slots=1,frozen_pack=None,official_score=None,verify_json=None,sdk_commit=commit,runtime_manifest=str(task/'evidence/resources/runtime-manifest.json'),command=f'node {task}/resources/dialogue.mjs {run}')
(run/'manifest.yaml').write_text(yaml.safe_dump(info,sort_keys=False))
tree=yaml.safe_load((task/'tree.yml').read_text());tree['nodes']['05-resources']['status']='in_progress';tree['updated_at']=datetime.now(timezone.utc).isoformat()
(task/'tree.yml').write_text(yaml.safe_dump(tree,sort_keys=False))
node=task/'nodes/05-resources.md';node.write_text(node.read_text().replace('status: ready','status: in_progress').replace('next: 固定ac887e6资源接口；离线验证版本发布消费/继承/CAS，再真实Agent交互验证并保留可用性失败','next: 执行资源版本/继承/CAS离线PoC，再运行金额工具发布消费与反馈修订的真实Agent交互'))
refs=[Path(__file__).resolve(),task/'resources/dialogue.mjs',task/'evidence/resources/runtime-manifest.json',run/'SPEC.md',run/'GOAL.md',run/'manifest.yaml']
result={'passed':True,'testbed':str(run),'sdkCommit':commit,'runtimeFiles':len(files),'changedFiles':changed,'modelRequests':0,'references':[{'path':str(p),'sha256':sha(p)} for p in refs]}
(task/'evidence/resources/preparation.json').write_text(json.dumps(result,indent=2)+'\n')
with (task/'worklog.md').open('a') as f:f.write('\n05-resources prepared: ac887e6 private runtime; exact-version publication, local inheritance and feedback checks. No live model requests yet.\n')
print(json.dumps({k:v for k,v in result.items() if k!='references'}))
