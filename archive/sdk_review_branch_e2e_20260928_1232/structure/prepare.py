from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil, subprocess, yaml

task = Path(__file__).resolve().parents[1]
sdk, runtime = task.parents[1], task / 'runtime-structure'
poc = sdk.parent / 'project-tree-poc'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert not runtime.exists()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=sdk, text=True).strip()
assert commit == '7b2a0fdc292badcf1029a426c7bb6d22a593cb48'
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=sdk, text=True)
subprocess.run(['cp', '-a', '--reflink=auto', str(task/'runtime-resources'), str(runtime)], check=True)
# Retain the reviewed adapter and dependencies; replace package inputs and
# generated artifacts with this committed revision in a new private snapshot.
for package in (sdk/'packages').iterdir():
    if not package.is_dir(): continue
    for name in ['src', 'dist', 'test', 'wasm', 'package.json', 'spine.toml', 'README.md']:
        source, dest = package/name, runtime/'sdk/packages'/package.name/name
        if source.is_dir(): shutil.copytree(source, dest, dirs_exist_ok=True, symlinks=True)
        elif source.is_file(): shutil.copy2(source, dest)
files = []
for p in sorted(runtime.rglob('*')):
    if p.is_symlink():
        assert p.resolve().is_relative_to(runtime)
        files.append({'path': str(p.relative_to(runtime)), 'symlink': str(p.readlink())})
    elif p.is_file():
        files.append({'path': str(p.relative_to(runtime)), 'sha256': sha(p), 'bytes': p.stat().st_size})
prior_path = task/'evidence/resources/runtime-manifest.json'
prior = {r['path']: r for r in json.loads(prior_path.read_text())['files']}
changed = [r['path'] for r in files if prior.get(r['path']) != r]
assert all(p.startswith('sdk/packages/spinetree-plugin/') for p in changed), changed
manifest = {'sdkCommit': commit, 'createdAt': datetime.now(timezone.utc).isoformat(),
            'files': files, 'changesSinceResources': changed, 'previousManifestSha256': sha(prior_path)}
(task/'evidence/structure/runtime-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
rel = subprocess.check_output(['bash', '/data/swe/FramePilot/cachetree/.codex/skills/run-project-tree-poc/scripts/new_testbed.sh', 'structure-spinetree-grok'], cwd=poc, text=True).strip()
run = poc/rel
(run/'SPEC.md').write_text('''# Ledger checks with separately retained evidence

Implement named exports `validateRow(row)` and `summarizeRows(rows)` in
`ledger.mjs`. A valid row is a non-null, non-array object with an `id` string
matching /^[A-Za-z0-9_-]{1,16}$/ and an `amountMinor` integer from 0 through
1,000,000,000 inclusive. Additional properties are allowed. validateRow returns
a boolean without throwing on invalid inputs.

summarizeRows receives an array of at most 100 rows and returns
{totalMinor, acceptedCount, invalidIndexes}. Sum valid row amounts exactly,
count each valid row (duplicate ids are allowed), and list invalid zero-based
indices in input order. A non-array input throws TypeError.

Provide a CLI: node ledger.mjs '<JSON rows>' prints the result as JSON.
Create tests for validation boundaries and aggregation, including duplicates,
empty input, malformed rows and non-array input. Keep validation and aggregation
as distinct completed branch obligations with their checked evidence retained;
then check their integration. Future requests will reorganize completed evidence.
Preserve source and tests. Use only one Agent.
''')
(run/'GOAL.md').write_text('Implement and independently check ledger validation and aggregation; retain separate completed Branch evidence for later reorganization.\n')
info = yaml.safe_load((run/'manifest.yaml').read_text())
info.update(task='completed-branch-move-archive', model='grok-4.7', provider='cachetree', thinking='high', slots=1,
            frozen_pack=None, official_score=None, verify_json=None, sdk_commit=commit,
            runtime_manifest=str(task/'evidence/structure/runtime-manifest.json'),
            command=f'node {task}/structure/dialogue.mjs {run}')
(run/'manifest.yaml').write_text(yaml.safe_dump(info, sort_keys=False))
tree = yaml.safe_load((task/'tree.yml').read_text())
assert tree['active'] == '06-structure'
tree['nodes']['06-structure']['status'] = 'in_progress'
tree['updated_at'] = datetime.now(timezone.utc).isoformat()
(task/'tree.yml').write_text(yaml.safe_dump(tree, sort_keys=False))
node = task/'nodes/06-structure.md'
text = node.read_text().replace('status: ready', 'status: in_progress')
text = text.replace('next: 明确拆分/归并/移动/归档与投影裁切的边界；复现mapped capped archive导入限制，修复必要问题并真实Agent验证',
                    'next: 用7b2a0fd固定包验证真实Pi移动/归档后继续采样，再运行Agent并追问其对归档边界的理解')
node.write_text(text)
refs = [Path(__file__).resolve(), task/'structure/dialogue.mjs', task/'structure/offline.mjs',
        task/'structure/verify-candidate.mjs', task/'evidence/structure/runtime-manifest.json',
        run/'SPEC.md', run/'GOAL.md', run/'manifest.yaml']
result = {'passed': True, 'testbed': str(run), 'sdkCommit': commit, 'runtimeFiles': len(files),
          'changedFiles': changed, 'modelRequests': 0,
          'references': [{'path': str(p), 'sha256': sha(p)} for p in refs]}
(task/'evidence/structure/preparation.json').write_text(json.dumps(result, indent=2)+'\n')
with (task/'worklog.md').open('a') as f:
    f.write('\n06 structure prepared: private 7b2a0fd runtime, deterministic Pi continuation and real ledger task. Archive retains branch memory and canonical mappings; it is not deletion or an arbitrary merge. No model requests yet.\n')
print(json.dumps({k: v for k, v in result.items() if k != 'references'}))
