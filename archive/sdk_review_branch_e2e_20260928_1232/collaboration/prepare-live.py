from pathlib import Path
from datetime import datetime, timezone
import ast
import hashlib
import json
import shutil
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
evidence = task / 'evidence/collaboration'
base = task / 'runtime-collaboration-lockfix'
runtime = task / 'runtime-collaboration-live'
run = repo.parent / 'project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
assert commit == 'eeea5d68ff1231be43206c4038f43dc2154d8ddf'
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo, text=True)
assert not runtime.exists()
assert not any((run / p).exists() for p in ('.spinetree', '.pi-agent', '.pi-sessions', 'ready.json'))
before = evidence / 'live-preparation-before'
before.mkdir()
for p in [task / 'collaboration/dialogue.mjs', task / 'collaboration/child-provider.mjs', run / 'manifest.yaml', task / 'tree.yml', task / 'nodes/07-collaboration.md']:
    shutil.copy2(p, before / p.name)
subprocess.run(['cp', '-a', '--reflink=auto', str(base), str(runtime)], check=True)
relative = 'sdk/packages/spinetree-plugin/test/git-ref-lock.test.mjs'
shutil.copy2(repo / 'packages/spinetree-plugin/test/git-ref-lock.test.mjs', runtime / relative)
base_manifest_path = evidence / 'git-lock/runtime-manifest-lockfix.json'
base_manifest = json.loads(base_manifest_path.read_text())
files = []
changes = []
for row in base_manifest['files']:
    p = runtime / row['path']
    if 'sha256' in row:
        updated = {'path': row['path'], 'sha256': sha(p), 'bytes': p.stat().st_size}
    else:
        assert p.resolve().is_relative_to(runtime)
        updated = {'path': row['path'], 'symlink': str(p.readlink())}
    if updated != row:
        changes.append(row['path'])
    files.append(updated)
assert changes == [relative], changes
tracked = subprocess.check_output(['git', 'ls-files', 'packages'], cwd=repo, text=True).splitlines()
checked = []
for name in tracked:
    frozen = runtime / 'sdk' / name
    if frozen.is_file():
        actual = subprocess.check_output(['git', 'hash-object', str(frozen)], cwd=repo, text=True).strip()
        expected = subprocess.check_output(['git', 'rev-parse', f'{commit}:{name}'], cwd=repo, text=True).strip()
        assert actual == expected, name
        checked.append(name)
manifest_path = evidence / 'runtime-manifest-live.json'
manifest_path.write_text(json.dumps({'createdAt': datetime.now(timezone.utc).isoformat(), 'sdkCommit': commit, 'runtime': str(runtime), 'baseManifestSha256': sha(base_manifest_path), 'changedFiles': changes, 'commitFilesChecked': checked, 'files': files}, indent=2) + '\n')
for name in ('dialogue.mjs', 'child-provider.mjs'):
    p = task / 'collaboration' / name
    text = p.read_text().replace('runtime-structure', 'runtime-collaboration-live')
    if name == 'dialogue.mjs':
        text = text.replace('evidence/structure/runtime-manifest.json', 'evidence/collaboration/runtime-manifest-live.json')
        needle = " event({type:'ready',sessionId:id,agentId});"
        replacement = " const manifestPath=join(dir,'manifest.yaml');\n await writeFile(manifestPath,(await readFile(manifestPath,'utf8')).replace(/^status: prepared$/m,'status: running').replace(/^pid: null$/m,`pid: ${process.pid}`).replace(/^started_at: null$/m,`started_at: '${stamp()}'`));\n" + needle
        assert needle in text
        text = text.replace(needle, replacement)
    p.write_text(text)
    subprocess.run(['node', '--check', str(p)], check=True)
info = yaml.safe_load((run / 'manifest.yaml').read_text())
assert info['status'] == 'prepared'
info.update(sdk_commit=commit, runtime_manifest=str(manifest_path))
(run / 'manifest.yaml').write_text(yaml.safe_dump(info, sort_keys=False))
node = task / 'nodes/07-collaboration.md'
text = node.read_text().replace('next: 固定eeea5d68的新runtime，继续真实Grok双子Agent实现、typed return父验收、同B反馈与只读复盘', 'next: 最新eeea5d68完整快照已固定；启动真实Grok双子Agent实现、typed return父验收、同B反馈与只读复盘')
node.write_text(text)
tree = yaml.safe_load((task / 'tree.yml').read_text())
assert tree['active'] == '07-collaboration'
tree['updated_at'] = datetime.now(timezone.utc).isoformat()
(task / 'tree.yml').write_text(yaml.safe_dump(tree, sort_keys=False))
with (evidence / 'plan.md').open('a') as f:
    f.write('\n07 live preparation update: use committed eeea5d68 and a new runtime-collaboration-live snapshot. The prior lockfix snapshot and failed/successful offline attempts remain unchanged. Only the final test fixture differs from the previously validated lockfix snapshot.\n')
with (task / 'worklog.md').open('a') as f:
    f.write('\n07 real collaboration preparation: froze complete eeea5d68 package inputs in runtime-collaboration-live, including final ref-lock tests. Reused only the never-launched prepared testbed; no sessions or candidate files existed. No provider request during preparation.\n')
ast.parse(Path(__file__).read_text())
subprocess.run(['git', 'diff', '--check'], cwd=repo, check=True)
refs = [Path(__file__).resolve(), manifest_path, task / 'collaboration/dialogue.mjs', task / 'collaboration/child-provider.mjs', task / 'collaboration/child-preload.mjs', task / 'collaboration/verify-candidate.mjs', run / 'SPEC.md', run / 'GOAL.md', run / 'manifest.yaml']
result = {'passed': True, 'sdkCommit': commit, 'runtime': str(runtime), 'runtimeFilesVerified': len(files), 'commitFilesVerified': len(checked), 'changedFromOfflineRuntime': changes, 'testbed': str(run), 'modelRequests': 0, 'references': [{'path': str(p), 'sha256': sha(p)} for p in refs]}
(evidence / 'live-preparation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'references'}))
